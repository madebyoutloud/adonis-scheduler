import 'reflect-metadata'
import { args, BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class MakeTask extends BaseCommand {
  static commandName = 'make:task'
  static description = 'Make a new task class'

  static options: CommandOptions = {
    allowUnknownFlags: true,
  }

  /**
   * The name of the job file.
   */
  @args.string({ description: 'Name of the task' })
  declare name: string

  /**
   * Execute command
   */
  async run(): Promise<void> {
    const codemods = await this.createCodemods()

    await codemods.makeUsingStub(import.meta.dirname + '/../stubs', 'command/task.stub', {
      entity: this.app.generators.createEntity(this.name),
    })
  }
}
