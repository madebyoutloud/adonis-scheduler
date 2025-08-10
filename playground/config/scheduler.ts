import { defineConfig } from '@outloud/adonis-scheduler'
import env from '#start/env'

const schedulerConfig = defineConfig({
  httpServer: env.get('SCHEDULER_HTTP_SERVER', false),
  warnWhenLocked: true,
})

export default schedulerConfig
