import type { ContainerResolver } from '@adonisjs/core/container'
import type { ContainerBindings } from '@adonisjs/core/types'
import type { LockService } from '@adonisjs/lock/types'
import type { Logger } from '@adonisjs/core/logger'
import { Cron } from 'croner'
import type { Emitter } from '@adonisjs/core/events'
import type { Task } from './task.js'
import type {
  ErrorHandler,
  Factory,
  SchedulerConfig,
  SchedulerState,
  TaskDefinition,
  TaskRegisterOptions,
} from './types.js'
import { waitUntil } from './helpers.js'

export class Scheduler {
  private definitions: TaskDefinition[] = []
  private state: SchedulerState = 'created'
  private errorHandler?: ErrorHandler

  constructor(
    private config: SchedulerConfig,
    private resolver: ContainerResolver<ContainerBindings>,
    private logger: Logger,
    private emitter: Emitter<any>,
    private locks?: LockService,
  ) {}

  register(options: TaskRegisterOptions | Factory<typeof Task>): this {
    const definition: TaskDefinition = {
      schedule: '* * * * *',
      state: 'created',
      jobs: [],
    }

    if (typeof options === 'object') {
      const command = Array.isArray(options.command) ? options.command : [options.command]
      Object.assign(definition, options)

      definition.loader = () => import('./command.task.js').then((module) => {
        return class extends module.CommandTask {
          static command = command
        }
      })
    } else {
      definition.loader = options
    }

    if (!definition.loader) {
      throw new Error('Task definition must have either a command or a task defined.')
    }

    this.definitions.push(definition)

    if (this.hasState(['starting', 'running'])) {
      this.schedule(definition)
    }

    return this
  }

  async start(wait = false) {
    if (!this.hasState(['created', 'stopped'])) {
      this.logger.warn('Scheduler is already running')
      return
    }

    this.setState('starting')

    await Promise.all(this.definitions.map((definition) => this.schedule(definition)))

    if (!this.definitions.length) {
      this.logger.warn('No tasks registered, scheduler will not run any jobs.')
    }

    this.setState('running')

    if (wait) {
      return waitUntil(() => this.state === 'stopped')
    }
  }

  async stop() {
    if (this.state === 'starting') {
      await waitUntil(() => this.state !== 'starting')
    }

    if (this.state !== 'running') {
      this.logger.warn('Scheduler is not running')
      return
    }

    this.setState('stopping')
    await Promise.all(this.definitions.map((definition) => this.terminate(definition)))
    this.setState('stopped')
  }

  onError(callback: ErrorHandler): this {
    this.errorHandler = callback
    return this
  }

  private async load(definition: TaskDefinition) {
    if (definition.loader) {
      const module = await definition.loader()
      definition.task = 'default' in module ? module.default : module
    }

    if (!definition.task) {
      throw new Error('Failed to load task, no loader or task provided.')
    }

    Object.assign(definition, definition.task.options ?? {})
  }

  private async make(definition: TaskDefinition): Promise<Task> {
    return await this.resolver.make(definition.task)
  }

  private async run(definition: TaskDefinition) {
    const task = await this.make(definition)
    const lockDuration = definition.lock && typeof definition.lock !== 'boolean'
      ? definition.lock
      : this.config.lockDuration

    const lock = definition.lock
      ? this.locks?.createLock(`scheduler:${task.name}`, lockDuration)
      : undefined

    if (definition.lock && !this.locks) {
      this.logger.warn('Lock is not available, install @adonisjs/lock to use task locking.')
    }

    if (lock) {
      const acquired = await lock.acquireImmediately()

      if (!acquired) {
        this.config.warnWhenLocked && this.logger.warn(`Task "${definition.task?.name}" is locked and cannot be run.`)

        return
      }
    }

    try {
      definition.jobs.push(task)

      const promise = this.resolver.call(task, 'run')
        // make sure cancel waits for the lock release
        .finally(() => lock?.release())

      // do not throw error if you try to await the task, e.g. in cancel
      task.promise = promise.catch(() => {
        // ignore
      })

      await promise
    } catch (error) {
      await this.handleError(error as Error, definition, task)
    } finally {
      definition.jobs.splice(definition.jobs.indexOf(task), 1)
    }
  }

  private hasState(state: SchedulerState | SchedulerState[]): boolean {
    const states = Array.isArray(state) ? state : [state]

    return states.includes(this.state)
  }

  private setState(state: SchedulerState) {
    if (this.state === state) {
      return
    }

    this.state = state
    this.logger.info(`Scheduler: ${state}`)
  }

  private async handleError(error: Error, _: TaskDefinition, task: Task) {
    await task.onError?.(error)

    this.emitter.emit('scheduler:error', { error, task })

    await this.errorHandler?.(error, task)

    if (!this.emitter.hasListeners('scheduler:error') && !this.errorHandler) {
      throw error
    }
  }

  private async cancel(job: Task) {
    await job.$cancel()
  }

  private async terminate(definition: TaskDefinition) {
    definition.cron?.stop()
    definition.cron = undefined

    await Promise.all(definition.jobs.map((job) => this.cancel(job)))

    definition.state = 'created'
  }

  private async schedule(definition: TaskDefinition) {
    if (definition.state !== 'created') {
      return
    }

    definition.state = 'preparing'

    if (!definition.task) {
      await this.load(definition)
    }

    definition.cron = new Cron(definition.schedule, {
      timezone: definition.timeZone,
    }, () => this.run(definition))

    definition.state = 'ready'

    this.logger.debug(`Scheduler: Task "${definition.task?.name}" scheduled with "${definition.schedule}"`)
  }
}
