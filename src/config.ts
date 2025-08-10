import type { SchedulerConfig } from './types.js'

export function defineConfig<T extends SchedulerConfig>(config: T): T {
  return config
}
