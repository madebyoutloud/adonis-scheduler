import type { ContainerResolver } from '@adonisjs/core/container'
import type { ContainerBindings } from '@adonisjs/core/types'
import type { LockService } from '@adonisjs/lock/types'
import { track } from './helpers.js'
import type { TaskOptions } from './types.js'

type Lock = ReturnType<LockService['createLock']>

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class Task {
  private $controller = new AbortController()
  private $lock?: Lock
  private $lockTimer?: NodeJS.Timeout
  private $lockRenewal?: Promise<void>

  promise?: Promise<any>

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

  @track({ key: 'promise' })
  async execute(resolver: ContainerResolver<ContainerBindings>) {
    this.$renewLock()

    try {
      await resolver.call(this as Task, 'run')
    } finally {
      const lock = this.$lock
      // unset first, so in-flight renewal does not schedule another one
      this.$lock = undefined

      clearTimeout(this.$lockTimer)
      await this.$lockRenewal
      await lock?.release().catch(() => {})
    }
  }

  async cancel() {
    this.$controller.abort()
    await this.onCancel?.()
    await this.promise?.catch(() => {})
  }

  /** @internal */
  $setLock(lock: Lock) {
    this.$lock = lock
  }

  /**
   * Extend the lock at half of its remaining ttl while the task is running.
   */
  private $renewLock() {
    const remaining = this.$lock?.getRemainingTime()

    // no lock, lock without ttl or already expired
    if (!remaining || remaining <= 0) return

    this.$lockTimer = setTimeout(() => {
      this.$lockRenewal = this.$lock?.extend()
        .catch(() => {})
        .then(() => this.$renewLock())
    }, remaining / 2)
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Task {
  onCancel?(): Promise<void>
  onError?(error: Error): Promise<void>
}
