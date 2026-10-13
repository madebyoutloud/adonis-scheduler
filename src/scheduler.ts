import { glob } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ContainerResolver } from '@adonisjs/core/container'
import type { ContainerBindings } from '@adonisjs/core/types'
import type { LockService } from '@adonisjs/lock/types'
import type { Logger } from '@adonisjs/core/logger'
import { Cron } from 'croner'
import type { Emitter } from '@adonisjs/core/events'
import { errors } from './errors.js'
import { Task } from './task.js'
import type {
  ErrorHandler,
  Factory,
  SchedulerConfig,
  SchedulerState,
  TaskDefinition,
  TaskRegisterOptions,
  TaskRunResult,
} from './types.js'
import { waitUntil } from './helpers.js'

export class Scheduler {
  private definitions: TaskDefinition[] = []
  private oneOffs = new Set<TaskDefinition>()
  private state: SchedulerState = 'created'
  private errorHandler?: ErrorHandler

  constructor(
    private config: SchedulerConfig,
    private resolver: ContainerResolver<ContainerBindings>,
    private logger: Logger,
    private emitter: Emitter<any>,
    private locks?: LockService,
  ) {}

  register(options: TaskRegisterOptions | typeof Task | Factory<typeof Task>): this {
    const definition = this.define(options)
    this.definitions.push(definition)

    if (this.hasState(['starting', 'running'])) {
      this.schedule(definition)
    }

    return this
  }

  /**
   * Run a task once right away, regardless of its schedule and scheduler state.
   * Locking and error handling work the same way as for scheduled runs.
   */
  async runOnce(options: TaskRegisterOptions | typeof Task | Factory<typeof Task>): Promise<TaskRunResult> {
    const definition = this.define(options)
    this.oneOffs.add(definition)

    try {
      await this.load(definition)
      return await this.run(definition)
    } finally {
      this.oneOffs.delete(definition)
    }
  }

  private define(options: TaskRegisterOptions | typeof Task | Factory<typeof Task>): TaskDefinition {
    const definition: TaskDefinition = {
      schedule: '* * * * *',
      state: 'created',
      jobs: [],
    }

    if (Task.isTask(options)) {
      definition.task = options
      Object.assign(definition, options.options ?? {})
    } else if (typeof options === 'function') {
      definition.loader = options
    } else {
      const command = Array.isArray(options.command) ? options.command : [options.command]
      Object.assign(definition, options)

      definition.loader = () => import('./command.task.js').then((module) => {
        return class extends module.CommandTask {
          static command = command
        }
      })
    }

    if (!definition.task && !definition.loader) {
      throw new Error('Task definition must have either a command or a task defined.')
    }

    return definition
  }

  async start(wait = false) {
    if (!this.hasState(['created', 'stopped'])) {
      this.logger.warn('Scheduler is already running')
      return
    }

    this.setState('starting')

    if (this.config.locations) {
      await Promise.all(this.config.locations.map((location) => this.registerFromGlob(location)))
    }

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
    this.definitions.forEach((definition) => this.unschedule(definition))
    await this.cancel()
    this.setState('stopped')
  }

  /**
   * Cancel all running jobs, scheduled and run once, and wait for them to finish.
   * Scheduled tasks keep running on their schedule, use stop() to stop them.
   */
  async cancel() {
    const jobs = [...this.definitions, ...this.oneOffs].flatMap((definition) => definition.jobs)
    await Promise.all(jobs.map((job) => job.cancel()))
  }

  onError(callback: ErrorHandler): this {
    this.errorHandler = callback
    return this
  }

  private async registerFromGlob(pattern: string) {
    const normalizedPattern = pattern.replace(/\.(?:js|ts)$/, '.{js,ts}')

    for await (const file of glob(normalizedPattern)) {
      try {
        const absolutePath = resolve(file)
        const module = await import(`file://${absolutePath}`)

        if (Task.isTask(module.default)) {
          this.register(module.default)
        }
      } catch (error) {
        console.warn(`Failed to load task from ${file}:`, error)
      }
    }
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

  private resolveLock(task: Task, definition: TaskDefinition) {
    if (!definition.lock) return

    if (!this.locks) {
      this.logger.warn('Lock is not available, install @adonisjs/lock to use task locking.')
      return
    }

    const lockDuration = definition.lock && typeof definition.lock !== 'boolean'
      ? definition.lock
      : this.config.lockDuration

    return this.locks.createLock(`scheduler:${task.name}`, lockDuration)
  }

  private async run(definition: TaskDefinition): Promise<TaskRunResult> {
    const task = await this.make(definition)
    const lock = this.resolveLock(task, definition)

    try {
      definition.jobs.push(task)

      if (lock && !(await lock.acquireImmediately())) {
        this.config.warnWhenLocked && this.logger.warn(`Task "${definition.task?.name}" is locked and cannot be run.`)

        return 'locked'
      }

      // canceled during lock acquire
      if (task.isCanceled) {
        await lock?.release()
        return 'canceled'
      }

      if (lock) task.$setLock(lock)

      await task.$execute(this.resolver)

      // task ignored the abort and finished anyway
      if (task.signal.reason instanceof errors.E_LOCK_LOST) throw task.signal.reason

      return task.isCanceled ? 'canceled' : 'completed'
    } catch (error) {
      // report the lost lock rather than the abort error it caused
      const reason = task.signal.reason instanceof errors.E_LOCK_LOST ? task.signal.reason : error
      await this.handleError(reason as Error, definition, task)

      return 'failed'
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

    await this.emitter.emit('scheduler:error', { error, task })
    await this.errorHandler?.(error, task)

    const hasNoHandler = !(task.onError || this.emitter.hasListeners('scheduler:error') || this.errorHandler)

    if (hasNoHandler) {
      throw error
    }
  }

  private unschedule(definition: TaskDefinition) {
    definition.cron?.stop()
    definition.cron = undefined
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
    }, async () => {
      await this.run(definition)
    })

    definition.state = 'ready'

    this.logger.debug(`Scheduler: Task "${definition.task?.name}" scheduled with "${definition.schedule}"`)
  }
}
