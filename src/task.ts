import type { ContainerResolver } from '@adonisjs/core/container'
import type { ContainerBindings } from '@adonisjs/core/types'
import type { LockService } from '@adonisjs/lock/types'
import { errors } from './errors.js'
import { track } from './helpers.js'
import type { TaskOptions } from './types.js'

type Lock = ReturnType<LockService['createLock']>

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class Task {
  private $controller = new AbortController()
  private $lock?: Lock
  private $lockTimer?: NodeJS.Timeout
  private $lockRenewal?: Promise<void>
  private $promise?: Promise<any>

  static options: TaskOptions

  static isTask(obj: unknown): obj is typeof Task {
    return typeof obj === 'function' && obj.prototype instanceof Task
  }

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(..._: any[]) {
    // ignore
  }

  get name() {
    const Ctor = this.constructor as typeof Task
    return Ctor.options.name ?? Ctor.name
  }

  get signal(): AbortSignal {
    return this.$controller.signal
  }

  get isCanceled() {
    return this.signal.aborted
  }

  abstract run(...args: any[]): Promise<void>

  async cancel() {
    await this.$abort()
    await this.$promise?.catch(() => {})
  }

  /** @internal */
  @track({ key: '$promise' })
  async $execute(resolver: ContainerResolver<ContainerBindings>) {
    // captured, lost lock is unset, but still released in case the store recovers
    const lock = this.$lock
    this.$lockRenewal = this.$renewLock()

    try {
      await resolver.call(this as Task, 'run')
    } finally {
      // unset first, so in-flight renewal does not schedule another one
      this.$lock = undefined

      clearTimeout(this.$lockTimer)
      await this.$lockRenewal
      await lock?.release().catch(() => {})
    }
  }

  /** @internal */
  $setLock(lock: Lock) {
    this.$lock = lock
  }

  /**
   * Does not wait for the task to finish, so it is safe to call from within the execution.
   */
  private async $abort(reason?: unknown) {
    if (this.signal.aborted) return

    this.$controller.abort(reason)
    await this.onCancel?.()
  }

  /**
   * Extend the lock at half of its remaining ttl while the task is running.
   * Failed extension is retried until the lock expires, then the lock is considered lost.
   */
  private $renewLock(): Promise<void> | undefined {
    const lock = this.$lock
    const remaining = lock?.getRemainingTime()

    // no lock (or task finished) or lock without ttl
    if (!lock || remaining === null || remaining === undefined) return

    if (remaining <= 0) {
      return this.$loseLock(new Error('Lock expired before it could be extended'))
    }

    this.$lockTimer = setTimeout(() => {
      this.$lockRenewal = lock.extend().then(
        () => this.$renewLock(),
        (error) => error?.code === 'E_LOCK_NOT_OWNED'
          ? this.$loseLock(error)
          // transient store error, retry while the lock is still valid
          : this.$renewLock(),
      )
    }, Math.max(remaining / 2, 100))
    this.$lockTimer.unref()
  }

  /**
   * Another process may run the task now, so abort it. Scheduler reports the error.
   */
  private async $loseLock(cause: unknown) {
    // task finished meanwhile
    if (!this.$lock) return

    this.$lock = undefined
    // must not reject, renewal is awaited before the lock release
    await this.$abort(new errors.E_LOCK_LOST([], { cause })).catch(() => {})
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Task {
  onCancel?(): Promise<void>
  onError?(error: Error): Promise<void>
}
