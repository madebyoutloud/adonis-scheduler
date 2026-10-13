import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { Task } from '../src/task.js'
import { MINUTE, createMemoryLocks, createScheduler, flush, useFakeClock } from './helpers.js'

describe('Scheduler', () => {
  useFakeClock()

  it('runs a registered task on its schedule', async () => {
    const run = vi.fn()

    class EveryMinute extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        run()
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(EveryMinute)
    await scheduler.start()

    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    await flush()
    expect(run).toHaveBeenCalledTimes(3)

    await scheduler.stop()
  })

  it('schedules tasks registered after start', async () => {
    const run = vi.fn()

    class Late extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        run()
      }
    }

    const { scheduler } = await createScheduler()
    await scheduler.start()
    scheduler.register(Late)

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)

    await scheduler.stop()
  })

  it('loads tasks lazily from a factory', async () => {
    const run = vi.fn()

    class Lazy extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        run()
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(() => ({ default: Lazy }))
    await scheduler.start()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)

    await scheduler.stop()
  })

  it('stops scheduling after stop()', async () => {
    const run = vi.fn()

    class EveryMinute extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        run()
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(EveryMinute)
    await scheduler.start()
    await scheduler.stop()

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    await flush()
    expect(run).not.toHaveBeenCalled()
  })

  it('cancels running jobs on stop()', async () => {
    const onCancel = vi.fn()
    let signal: AbortSignal | undefined

    class LongRunning extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        signal = this.signal
        await new Promise((resolve) => this.signal.addEventListener('abort', resolve))
      }

      async onCancel() {
        onCancel()
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(LongRunning)
    await scheduler.start()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    expect(signal?.aborted).toBe(false)

    await scheduler.stop()
    expect(signal?.aborted).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('waits for canceled jobs to finish on stop()', async () => {
    let finished = false

    class SlowCleanup extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        await new Promise((resolve) => this.signal.addEventListener('abort', resolve))
        // cleanup after abort spanning several event loop turns
        for (let i = 0; i < 5; i++) await setImmediate()
        finished = true
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(SlowCleanup)
    await scheduler.start()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()

    await scheduler.stop()
    expect(finished).toBe(true)
  })

  it('cancels running jobs on cancel() and keeps the schedule', async () => {
    const run = vi.fn()

    class LongRunning extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        run()
        await new Promise((resolve) => this.signal.addEventListener('abort', resolve))
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(LongRunning)
    await scheduler.start()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    await scheduler.cancel()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()
    expect(run).toHaveBeenCalledTimes(2)

    await scheduler.stop()
  })

  it('passes task errors to the error handler', async () => {
    const error = new Error('boom')
    const handler = vi.fn()

    class Failing extends Task {
      static options = { schedule: '* * * * *' }

      async run() {
        throw error
      }
    }

    const { scheduler } = await createScheduler()
    scheduler.register(Failing).onError(handler)
    await scheduler.start()

    await vi.advanceTimersByTimeAsync(MINUTE)
    await flush()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(error, expect.any(Failing))

    await scheduler.stop()
  })

  it('warns when started twice', async () => {
    const { scheduler, logs } = await createScheduler()

    await scheduler.start()
    await scheduler.start()

    expect(logs.some((line) => line.includes('Scheduler is already running'))).toBe(true)

    await scheduler.stop()
  })

  describe('runOnce', () => {
    it('runs a task immediately without starting the scheduler', async () => {
      const run = vi.fn()

      class Once extends Task {
        static options = { schedule: '0 0 1 1 *' }

        async run() {
          run()
        }
      }

      const { scheduler } = await createScheduler()

      expect(await scheduler.runOnce(Once)).toBe('completed')
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('loads the task from a factory', async () => {
      const run = vi.fn()

      class Lazy extends Task {
        async run() {
          run()
        }
      }

      const { scheduler } = await createScheduler()

      expect(await scheduler.runOnce(() => ({ default: Lazy }))).toBe('completed')
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('reports a failure to the error handler', async () => {
      const error = new Error('boom')
      const handler = vi.fn()

      class Failing extends Task {
        async run() {
          throw error
        }
      }

      const { scheduler } = await createScheduler()
      scheduler.onError(handler)

      expect(await scheduler.runOnce(Failing)).toBe('failed')
      expect(handler).toHaveBeenCalledWith(error, expect.any(Failing))
    })

    it('rejects when the task fails without an error handler', async () => {
      class Failing extends Task {
        async run() {
          throw new Error('boom')
        }
      }

      const { scheduler } = await createScheduler()

      await expect(scheduler.runOnce(Failing)).rejects.toThrow('boom')
    })

    it('does not run a task locked elsewhere', async () => {
      const locks = createMemoryLocks()
      const run = vi.fn()

      class Locked extends Task {
        static options = { name: 'locked', schedule: '* * * * *', lock: true }

        async run() {
          run()
        }
      }

      await locks.createLock('scheduler:locked', '1m').acquireImmediately()
      const { scheduler } = await createScheduler({ locks })

      const result = scheduler.runOnce(Locked)
      await flush()

      expect(await result).toBe('locked')
      expect(run).not.toHaveBeenCalled()
    })

    it('is canceled by cancel() which waits for it to finish', async () => {
      const onCancel = vi.fn()
      let started = false
      let finished = false

      class LongRunning extends Task {
        async run() {
          started = true
          await new Promise((resolve) => this.signal.addEventListener('abort', resolve))
          await setImmediate()
          finished = true
        }

        async onCancel() {
          onCancel()
        }
      }

      const { scheduler } = await createScheduler()

      const result = scheduler.runOnce(LongRunning)
      await flush()
      expect(started).toBe(true)

      await scheduler.cancel()
      expect(finished).toBe(true)
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(await result).toBe('canceled')
    })
  })
})
