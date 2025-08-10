import type { TaskOptions } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class Task {
  isCanceled = false
  promise?: Promise<void>

  static options: TaskOptions

  get name() {
    const Ctor = this.constructor as typeof Task
    return Ctor.options.name ?? Ctor.name
  }

  abstract run(): Promise<void>

  async $cancel() {
    this.isCanceled = true
    await this.onCancel?.()
    await this.promise
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Task {
  onCancel?(): Promise<void>
  onError?(error: Error): Promise<void>
}
