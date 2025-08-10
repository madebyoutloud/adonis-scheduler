import timers from 'node:timers/promises'

export async function waitUntil(callback: () => boolean, interval = 50) {
  while (!callback()) {
    await timers.setTimeout(interval)
  }
}
