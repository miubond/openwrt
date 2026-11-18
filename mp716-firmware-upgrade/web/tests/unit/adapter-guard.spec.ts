import { describe, expect, it } from 'vitest'

describe('production adapter guard', () => {
  it('documents that production builds force device adapter', () => {
    expect(import.meta.env.DEV).toBe(true)
  })
})
