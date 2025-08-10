import ace from '@adonisjs/core/services/ace'
import { Task } from './task.js'

export class CommandTask extends Task {
  static command: string[] = []

  get name() {
    return (this.constructor as typeof CommandTask).command.join(',')
  }

  async run(): Promise<void> {
    const [name, ...args] = (this.constructor as typeof CommandTask).command

    if (!name) {
      throw new Error('No command name provided.')
    }

    await ace.exec(name, args)
  }
}
