import { setImmediate } from 'node:timers/promises'
import { AppFactory } from '@adonisjs/core/factories/app'
import { EmitterFactory } from '@adonisjs/core/factories/events'
import { LoggerFactory } from '@adonisjs/core/factories/logger'
import type { LockService } from '@adonisjs/lock/types'
import { Verrou } from '@verrou/core'
import { memoryStore } from '@verrou/core/drivers/memory'
import { afterEach, beforeEach, vi } from 'vitest'
import { Scheduler } from '../src/scheduler.js'
import type { SchedulerConfig } from '../src/types.js'

export const MINUTE = 60_000

export async function createScheduler(options: {
  config?: Partial<SchedulerConfig>
  locks?: LockService
} = {}) {
  const app = new AppFactory().create(new URL('../', import.meta.url))
  await app.init()

  const logs: string[] = []
  const logger = new LoggerFactory().merge({ enabled: true, level: 'trace' })
    .pushLogsTo(logs)
    .create()
  const emitter = new EmitterFactory().create(app)

  const scheduler = new Scheduler(
    { httpServer: false, warnWhenLocked: false, lockDuration: '1m', ...options.config },
    app.container.createResolver(),
    logger,
    emitter,
    options.locks,
  )

  return { scheduler, logs }
}

export function createMemoryLocks() {
  return new Verrou({
    default: 'memory',
    stores: { memory: { driver: memoryStore() } },
  }) as unknown as LockService
}

/**
 * Let pending task executions (make -> execute -> run) settle.
 * setImmediate is not faked, so it yields to the real event loop.
 * Timers due now are fired too, async-mutex (memory lock store) uses
 * a 0ms setTimeout to reject an already acquired lock. Fake timers bump
 * a 0ms timer created during a tick to 1ms, hence advancing by 1ms.
 */
export async function flush() {
  await setImmediate()
  await vi.advanceTimersByTimeAsync(1)
  await setImmediate()
}

/**
 * Fake the clock for every test in the current suite.
 * croner and lock renewal only rely on setTimeout and Date.
 */
export function useFakeClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}
