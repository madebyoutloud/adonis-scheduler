import { E_LOCK_NOT_OWNED, Lock } from '@verrou/core'
import { describe, expect, it, vi } from 'vitest'
import { errors } from '../src/errors.js'
import { Task } from '../src/task.js'
import type { TaskOptions } from '../src/types.js'
import { MINUTE, createMemoryLocks, createScheduler, flush, useFakeClock } from './helpers.js'

/**
 * Task that keeps running until the test releases it or it gets canceled.
 */
function defineBlockingTask(options: TaskOptions) {
  const runs = vi.fn()
  let gate = Promise.withResolvers<undefined>()

  class Blocking extends Task {
    static options = options

    async run() {
      runs()
      await Promise.race([
        gate.promise,
        new Promise((resolve) => this.signal.addEventListener('abort', resolve)),
      ])
    }
  }

  return {
    Blocking,
    runs,
    async finish() {
      gate.resolve(undefined)
      gate = Promise.withResolvers<undefined>()
      await flush()
    },
  }
}

async function tick(ms = MINUTE) {
  await vi.advanceTimersByTimeAsync(ms)
  await flush()
}

describe('Scheduler locks', () => {
  useFakeClock()

  it('skips a run while the previous one holds the lock', async () => {
    const { Blocking, runs, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: true })
    const { scheduler, logs } = await createScheduler({
      config: { warnWhenLocked: true },
      locks: createMemoryLocks(),
    })

    scheduler.register(Blocking)
    await scheduler.start()

    await tick()
    expect(runs).toHaveBeenCalledTimes(1)

    await tick()
    expect(runs).toHaveBeenCalledTimes(1)
    expect(logs.some((line) => line.includes('is locked and cannot be run'))).toBe(true)

    await finish()
    await tick()
    expect(runs).toHaveBeenCalledTimes(2)

    await finish()
    await scheduler.stop()
  })

  it('runs overlapping jobs when lock is disabled', async () => {
    const { Blocking, runs, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *' })
    const { scheduler } = await createScheduler({ locks: createMemoryLocks() })

    scheduler.register(Blocking)
    await scheduler.start()

    await tick()
    await tick()
    expect(runs).toHaveBeenCalledTimes(2)

    await finish()
    await scheduler.stop()
  })

  it('runs a task only once across schedulers sharing a lock store', async () => {
    const locks = createMemoryLocks()
    const { Blocking, runs, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: true })
    const { scheduler: first } = await createScheduler({ locks })
    const { scheduler: second } = await createScheduler({ locks })

    first.register(Blocking)
    second.register(Blocking)
    await first.start()
    await second.start()

    await tick()
    expect(runs).toHaveBeenCalledTimes(1)

    await finish()
    await Promise.all([first.stop(), second.stop()])
  })

  it('holds the lock while running and releases it afterwards', async () => {
    const locks = createMemoryLocks()
    const { Blocking, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: true })
    const { scheduler } = await createScheduler({ locks })

    scheduler.register(Blocking)
    await scheduler.start()

    await tick()
    expect(await locks.createLock('scheduler:blocking').isLocked()).toBe(true)

    await finish()
    expect(await locks.createLock('scheduler:blocking').isLocked()).toBe(false)

    await scheduler.stop()
  })

  it('releases the lock when the task fails', async () => {
    const locks = createMemoryLocks()
    const handler = vi.fn()

    class Failing extends Task {
      static options = { name: 'failing', schedule: '* * * * *', lock: true }

      async run() {
        throw new Error('boom')
      }
    }

    const { scheduler } = await createScheduler({ locks })
    scheduler.register(Failing).onError(handler)
    await scheduler.start()

    await tick()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(await locks.createLock('scheduler:failing').isLocked()).toBe(false)

    await scheduler.stop()
  })

  it('releases the lock when the task is canceled', async () => {
    const locks = createMemoryLocks()

    class LongRunning extends Task {
      static options = { name: 'long', schedule: '* * * * *', lock: true }

      async run() {
        await new Promise((resolve) => this.signal.addEventListener('abort', resolve))
      }
    }

    const { scheduler } = await createScheduler({ locks })
    scheduler.register(LongRunning)
    await scheduler.start()

    await tick()
    expect(await locks.createLock('scheduler:long').isLocked()).toBe(true)

    await scheduler.stop()
    expect(await locks.createLock('scheduler:long').isLocked()).toBe(false)
  })

  it('renews the lock while a task runs longer than its ttl', async () => {
    const locks = createMemoryLocks()
    const { Blocking, runs, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: '45s' })
    const { scheduler } = await createScheduler({ locks })

    scheduler.register(Blocking)
    await scheduler.start()

    await tick()

    // without renewal the lock would expire 45s after the first run
    await tick()
    await tick()
    expect(runs).toHaveBeenCalledTimes(1)
    expect(await locks.createLock('scheduler:blocking').isLocked()).toBe(true)

    await finish()
    await scheduler.stop()
  })

  it('stops renewing the lock once the task finishes', async () => {
    const { Blocking, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: '45s' })
    const { scheduler } = await createScheduler({ locks: createMemoryLocks() })

    scheduler.register(Blocking)
    await scheduler.start()

    await tick()
    await finish()
    await scheduler.stop()

    // cron stopped and renewal timer cleared
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts the task and reports when the lock is taken over', async () => {
    const locks = createMemoryLocks()
    const handler = vi.fn()
    const { Blocking, runs } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: '45s' })
    const { scheduler } = await createScheduler({ locks })

    scheduler.register(Blocking).onError(handler)
    await scheduler.start()

    await tick()

    // lock expired and another process acquired it
    // memory store cannot simulate a different owner, it keeps the first one
    const extend = vi.spyOn(Lock.prototype, 'extend')
      .mockRejectedValueOnce(new E_LOCK_NOT_OWNED())

    // renewal at half of the ttl finds the lock owned by someone else
    await tick(30_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.any(errors.E_LOCK_LOST), expect.any(Blocking))
    expect(runs).toHaveBeenCalledTimes(1)

    extend.mockRestore()
    await scheduler.stop()
  })

  it('retries a failed lock extension and keeps running', async () => {
    const locks = createMemoryLocks()
    const handler = vi.fn()
    const extend = vi.spyOn(Lock.prototype, 'extend')
      .mockRejectedValueOnce(new Error('store unavailable'))
    const { Blocking, runs, finish } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: '45s' })
    const { scheduler } = await createScheduler({ locks })

    scheduler.register(Blocking).onError(handler)
    await scheduler.start()

    await tick()
    await tick()
    await tick()

    expect(extend.mock.calls.length).toBeGreaterThan(1)
    expect(runs).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
    expect(await locks.createLock('scheduler:blocking').isLocked()).toBe(true)

    extend.mockRestore()
    await finish()
    await scheduler.stop()
  })

  it('considers the lock lost when extension keeps failing until it expires', async () => {
    const locks = createMemoryLocks()
    const handler = vi.fn()
    const extend = vi.spyOn(Lock.prototype, 'extend')
      .mockRejectedValue(new Error('store unavailable'))
    const { Blocking } = defineBlockingTask({ name: 'blocking', schedule: '* * * * *', lock: '45s' })
    const { scheduler } = await createScheduler({ locks })

    scheduler.register(Blocking).onError(handler)
    await scheduler.start()

    await tick()
    // retries are halved towards the expiry, give the last one time to run
    await tick(46_000)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBeInstanceOf(errors.E_LOCK_LOST)

    extend.mockRestore()
    await scheduler.stop()
  })
})
