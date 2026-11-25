import { describe, expect, it } from 'vitest'
import { createGetScheduler, resolveDeviceGetConcurrency } from './device-get-scheduler'

describe('resolveDeviceGetConcurrency', () => {
  it('clamps to 1..3', () => {
    expect(resolveDeviceGetConcurrency(undefined)).toBe(1)
    expect(resolveDeviceGetConcurrency('0')).toBe(1)
    expect(resolveDeviceGetConcurrency('2')).toBe(2)
    expect(resolveDeviceGetConcurrency('9')).toBe(3)
    expect(resolveDeviceGetConcurrency('x')).toBe(1)
  })
})

describe('createGetScheduler', () => {
  it('runs serially when maxConcurrent is 1', async () => {
    const order: number[] = []
    const scheduler = createGetScheduler(1)
    const p1 = scheduler.run(async () => {
      order.push(1)
      await new Promise((r) => setTimeout(r, 20))
      order.push(2)
    })
    const p2 = scheduler.run(async () => {
      order.push(3)
    })
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2, 3])
  })

  it('allows two overlapping tasks when maxConcurrent is 2', async () => {
    const order: string[] = []
    const scheduler = createGetScheduler(2)
    const block = (name: string, ms: number) =>
      scheduler.run(async () => {
        order.push(`${name}-start`)
        await new Promise((r) => setTimeout(r, ms))
        order.push(`${name}-end`)
      })
    await Promise.all([block('a', 30), block('b', 10), block('c', 5)])
    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('a-end'))
    expect(order.indexOf('c-start')).toBeGreaterThan(order.indexOf('b-start'))
  })
})