/**
 * actor-loop.spec.ts — Reflexion Actor Loop 单元测试
 */
import { describe, it, expect, vi } from 'vitest'
import { ReflexionActorLoop } from '../actor-loop.js'
import type { IEpisodicMemory, EpisodicEntry, ReflexionPrompt, ReflexionEvaluation } from '@anthropic/antigravity-shared'

/** 创建 Mock IEpisodicMemory */
function createMockMemory(): IEpisodicMemory {
  return {
    recall: vi.fn().mockReturnValue([]),
    evaluate: vi.fn().mockReturnValue({ runId: 'test', success: true, severity: 0, evaluatedAt: '' }),
    reflect: vi.fn(),
    incrementAppliedCount: vi.fn(),
  }
}

describe('ReflexionActorLoop', () => {
  describe('enrichRunContext', () => {
    it('无历史反思时返回空提示', () => {
      const memory = createMockMemory()
      const loop = new ReflexionActorLoop(memory)
      const result = loop.enrichRunContext('test goal')
      expect(result.promptCount).toBe(0)
      expect(result.reflexionPrompts).toEqual([])
    })

    it('应注入反思记忆到上下文', () => {
      const memory = createMockMemory()
      const prompts: ReflexionPrompt[] = [
        { sourceRunId: 'run-1', promptType: 'reflection', text: '避免使用 any 类型', relevance: 0.9 },
        { sourceRunId: 'run-2', promptType: 'warning', text: '注意边界检查', relevance: 0.8 },
      ]
      vi.mocked(memory.recall).mockReturnValue(prompts)

      const loop = new ReflexionActorLoop(memory)
      const result = loop.enrichRunContext('test goal')
      expect(result.promptCount).toBe(2)
      expect(result.reflexionPrompts).toContain('避免使用 any 类型')
      expect(result.sourceRunIds).toContain('run-1')
    })

    it('应更新 reflection 类型提示的应用计数', () => {
      const memory = createMockMemory()
      const prompts: ReflexionPrompt[] = [
        { sourceRunId: 'run-1', promptType: 'reflection', text: 'test', relevance: 0.9 },
        { sourceRunId: 'run-2', promptType: 'warning', text: 'test', relevance: 0.8 },
      ]
      vi.mocked(memory.recall).mockReturnValue(prompts)

      const loop = new ReflexionActorLoop(memory)
      loop.enrichRunContext('test goal')

      // 只有 reflection 类型会更新计数
      expect(memory.incrementAppliedCount).toHaveBeenCalledTimes(1)
      expect(memory.incrementAppliedCount).toHaveBeenCalledWith('run-1')
    })
  })

  describe('onRunComplete', () => {
    const entry: EpisodicEntry = {
      runId: 'run-1',
      goal: 'test',
      outcome: 'failed',
      riskLevel: 'medium',
      lane: 'standard',
      keyInsights: ['失败原因'],
      nodeCount: 3,
      files: ['src/main.ts'],
      createdAt: new Date().toISOString(),
    }

    it('应触发评估 (评估成功时不反思)', () => {
      const memory = createMockMemory()
      vi.mocked(memory.evaluate).mockReturnValue({
        runId: 'run-1', success: true, severity: 0, evaluatedAt: '',
      })

      const loop = new ReflexionActorLoop(memory)
      loop.onRunComplete(entry)

      expect(memory.evaluate).toHaveBeenCalledWith(entry)
      expect(memory.reflect).not.toHaveBeenCalled()
    })

    it('评估失败时应触发反思', () => {
      const memory = createMockMemory()
      vi.mocked(memory.evaluate).mockReturnValue({
        runId: 'run-1', success: false, failureCategory: 'wrong_output', severity: 0.8, evaluatedAt: '',
      })

      const loop = new ReflexionActorLoop(memory)
      loop.onRunComplete(entry)

      expect(memory.evaluate).toHaveBeenCalled()
      expect(memory.reflect).toHaveBeenCalled()
    })

    it('评估/反思异常不应阻塞 (静默失败)', () => {
      const memory = createMockMemory()
      vi.mocked(memory.evaluate).mockImplementation(() => { throw new Error('boom') })

      const loop = new ReflexionActorLoop(memory)
      // 不应抛出异常
      expect(() => loop.onRunComplete(entry)).not.toThrow()
    })

    it('autoReflect 关闭时不触发评估', () => {
      const memory = createMockMemory()
      const loop = new ReflexionActorLoop(memory, { autoReflect: false })
      loop.onRunComplete(entry)
      expect(memory.evaluate).not.toHaveBeenCalled()
    })
  })
})
