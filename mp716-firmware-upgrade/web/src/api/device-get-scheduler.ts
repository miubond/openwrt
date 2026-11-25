/** Limits concurrent device GETs; concurrency 1 preserves strict serialization. */
export function resolveDeviceGetConcurrency(envValue: string | undefined): number {
  const parsed = parseInt(envValue ?? '1', 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(3, parsed))
}

export function createGetScheduler(maxConcurrent: number) {
  let active = 0
  const queue: Array<() => void> = []

  function pump() {
    while (active < maxConcurrent && queue.length > 0) {
      const start = queue.shift()
      if (!start) break
      start()
    }
  }

  function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++
        task().then(resolve, reject).finally(() => {
          active--
          pump()
        })
      }
      if (active < maxConcurrent) start()
      else queue.push(start)
    })
  }

  return { run }
}