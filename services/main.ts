import app from '@adonisjs/core/services/app'

import type { Scheduler } from '../src/scheduler.js'

// eslint-disable-next-line import/no-mutable-exports
let scheduler: Scheduler

await app?.booted(async () => {
  scheduler = await app.container.make('scheduler')
})

export { scheduler as default }
