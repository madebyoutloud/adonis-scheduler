import 'reflect-metadata'
import { inject } from '@adonisjs/core'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { Scheduler } from '../src/scheduler.js'

export default class SchedulerRun extends BaseCommand {
  static commandName = 'scheduler:run'
  static description = 'Run a scheduler'

  static options: CommandOptions = {
    startApp: true,
  }

  private scheduler?: Scheduler

  prepare() {
    this.app.terminating(async () => {
      await this.scheduler?.stop()
    })
  }

  @inject()
  async run(scheduler: Scheduler): Promise<void> {
    this.scheduler = scheduler
    await this.scheduler.start(true)
  }
}
