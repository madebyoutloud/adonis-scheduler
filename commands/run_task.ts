import { inject } from '@adonisjs/core'
import { args, BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { Scheduler } from '../src/scheduler.js'
import { Task } from '../src/task.js'

export default class TaskRun extends BaseCommand {
  static commandName = 'task:run'
  static description = 'Run a single task once, regardless of its schedule'
  static help = [
    'The path is relative to the application root, subpath imports (starting with #) work too.',
    '',
    '{{ binaryName }} task:run app/tasks/cleanup_task.js',
    '{{ binaryName }} task:run #tasks/cleanup_task',
  ]

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @args.string({ description: 'Path to the task file or subpath import' })
  declare path: string

  private scheduler?: Scheduler

  prepare() {
    // cancel the task on SIGINT / SIGTERM and wait for it to finish
    this.app.terminating(() => this.scheduler?.cancel())
  }

  @inject()
  async run(scheduler: Scheduler): Promise<void> {
    const task = await this.load()
    const name = task.options?.name || task.name || this.path

    this.scheduler = scheduler
    const result = await scheduler.runOnce(task)

    if (result === 'completed') {
      this.logger.success(`Task "${name}" completed`)
      return
    }

    this.exitCode = 1
    this.logger.error(`Task "${name}" ${result}`)
  }

  private async load(): Promise<typeof Task> {
    const specifier = this.path.startsWith('#') ? this.path : this.app.makeURL(this.path).href
    const module = await this.app.import(specifier).catch((error: unknown) => ({ error }))

    if (!Task.isTask(module.default)) {
      throw new Error(`Task "${this.path}" does not exist or does not export a task as default`, {
        cause: module.error,
      })
    }

    return module.default
  }
}
