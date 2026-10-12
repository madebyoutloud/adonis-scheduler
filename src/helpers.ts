import timers from 'node:timers/promises'

export async function waitUntil(callback: () => boolean, interval = 50) {
  while (!callback()) {
    await timers.setTimeout(interval)
  }
}

export function track(options: {
  key: string
}) {
  return function decorateAsTrack<T, A extends any[], R>(
    _target: T,
    _property: string,
    descriptor: TypedPropertyDescriptor<(this: T, ...args: A) => Promise<R>>,
  ) {
    const fn = descriptor.value!

    descriptor.value = function (this: any, ...args: A): Promise<R> {
      if (this[options.key]) {
        return this[options.key]
      }

      const promise = fn.apply(this, args)
      this[options.key] = promise

      return promise.finally(() => {
        if (this[options.key] === promise) {
          this[options.key] = undefined
        }
      })
    }
  }
}
