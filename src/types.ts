import type { Cron } from 'croner'
import type { Task } from './task.js'

export interface SchedulerConfig {
  /**
   * Should the scheduler start with HTTP server?
   */
  httpServer: boolean

  /**
   * Warn when a task is locked and cannot be run
   */
  warnWhenLocked: boolean
}

export interface TaskOptions {
  /**
   * A unique name for the task.
   */
  name?: string
  /**
   * The pattern to when the task should run.
   *
   * See https://croner.56k.guru/usage/pattern/ for more information.
   */
  schedule: string
  /**
   * Time zone to use for the task.
   */
  timeZone?: string
  /**
   * Lock the task to prevent it from running concurrently.
   *
   * @default false
   */
  lock?: boolean
}

export interface TaskRegisterOptions extends TaskOptions {
  command: string | string[]
}

export interface TaskDefinition extends TaskOptions {
  cron?: Cron
  loader?: Factory<typeof Task>
  task?: typeof Task
  state: 'created' | 'preparing' | 'ready'
  jobs: Task[]
}

export type ErrorHandler = (error: Error, task: Task) => (void | Promise<void>)

export type SchedulerState = 'created' | 'starting' | 'running' | 'stopping' | 'stopped'

// utils
export type MaybePromise<T> = T | Promise<T>

export type Factory<T> = () => MaybePromise<{ default: T } | T>
