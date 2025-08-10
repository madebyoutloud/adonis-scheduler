import type { ApplicationService } from '@adonisjs/core/types'
import type { LockService } from '@adonisjs/lock/types'
import { Scheduler } from '../src/scheduler.js'
import type { SchedulerConfig } from '../src/types.js'

export default class SchedulerProvider {
  private scheduler?: Scheduler

  constructor(protected app: ApplicationService) {}

  private getConfig(): SchedulerConfig {
    return this.app.config.get<SchedulerConfig>('scheduler', {})
  }

  private async getLocks(): Promise<LockService | undefined> {
    if (this.app.container.hasBinding('lock.manager')) {
      return await this.app.container.make('lock.manager')
    }
  }

  register() {
    this.app.container.singleton(Scheduler, async () => {
      return new Scheduler(
        this.getConfig(),
        this.app.container.createResolver(),
        await this.app.container.make('logger'),
        await this.getLocks(),
      )
    })

    this.app.container.alias('scheduler', Scheduler)
  }

  async ready() {
    const config = this.getConfig()

    if (this.app.getEnvironment() === 'web' && config.httpServer) {
      this.scheduler = await this.app.container.make(Scheduler)
      await this.scheduler.start()
    }
  }

  async shutdown() {
    await this.scheduler?.stop()
  }
}

declare module '@adonisjs/core/types' {
  export interface ContainerBindings {
    scheduler: Scheduler
  }
}
