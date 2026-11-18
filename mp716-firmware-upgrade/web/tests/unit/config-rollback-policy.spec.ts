/**
 * 配置回滚策略 — 仅验证前端 Mock 任务状态机（开发环境）。
 * 设备端 mp716-task-tick 超时回滚：标记为【未在 RAM 固件验证】。
 */
import { describe, expect, it } from 'vitest'
import { confirmTask, createConfigTask, getTask } from '@/api/adapters/mock-state'

describe('config task rollback [Mock env only]', () => {
  it('creates pending task with rollback window', () => {
    const taskId = `wan-${Date.now()}`
    createConfigTask(taskId, 30)
    const st = getTask(taskId)
    expect(st?.state).toBe('pending')
    expect(st!.remainingSec).toBeGreaterThan(0)
  })

  it('confirm marks task confirmed', () => {
    const taskId = `lan-${Date.now()}`
    createConfigTask(taskId, 60)
    const st = confirmTask(taskId)
    expect(st?.state).toBe('confirmed')
  })
})
