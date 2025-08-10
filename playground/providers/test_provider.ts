import type { ApplicationService } from '@adonisjs/core/types'
import { Scheduler } from '@outloud/adonis-scheduler'

export default class TestProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {
    const scheduler = await this.app.container.make(Scheduler)

    scheduler.register(() => import('../app/tasks/test_task.js'))
  }

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}
}
