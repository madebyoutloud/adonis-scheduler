import { Task, type TaskOptions } from '@outloud/adonis-scheduler'
import timers from 'node:timers/promises'

export default class TestTask extends Task {
  static options: TaskOptions = {
    schedule: '* * * * * *',
    lock: true,
  }

  isRunning = false

  async run(): Promise<void> {
    console.log('Test task is running')

    this.isRunning = true

    setTimeout(() => {
      this.isRunning = false
    }, 5000)

    while (this.isRunning && !this.isCanceled) {
      await timers.setTimeout(50)
    }
  }
}
