import type Configure from '@adonisjs/core/commands/configure'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(import.meta.dirname + '/stubs', 'config/scheduler.stub', {})

  await codemods.defineEnvVariables({
    SCHEDULER_HTTP_SERVER: false,
  })

  await codemods.defineEnvValidations({
    variables: {
      SCHEDULER_HTTP_SERVER: `Env.schema.boolean.optional()`,
    },
  })

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@outloud/adonis-scheduler/provider')
      .addCommand('@outloud/adonis-scheduler/commands')
  })
}
