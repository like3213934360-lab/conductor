/**
 * topology.spec.ts — DAG 拓扑排序 + 条件边评估 单元测试
 */
import { describe, it, expect } from 'vitest'
import { topologicalSort, findReadyNodes, evaluateEdgeCondition } from '../topology.js'
import type { RunGraph } from '@anthropic/antigravity-shared'

describe('topologicalSort', () => {
  it('应正确排序线性 DAG', () => {
    const graph: RunGraph = {
      nodes: [
        { id: 'A', name: 'Node A', dependsOn: [], input: {}, skippable: false, priority: 0 },
        { id: 'B', name: 'Node B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
        { id: 'C', name: 'Node C', dependsOn: ['B'], input: {}, skippable: false, priority: 0 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    }
    const sorted = topologicalSort(graph)
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'))
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('C'))
  })

  it('应检测环形依赖', () => {
    const graph: RunGraph = {
      nodes: [
        { id: 'A', name: 'Node A', dependsOn: ['B'], input: {}, skippable: false, priority: 0 },
        { id: 'B', name: 'Node B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    }
    expect(() => topologicalSort(graph)).toThrow()
  })
})

describe('findReadyNodes', () => {
  const graph: RunGraph = {
    nodes: [
      { id: 'A', name: 'Node A', dependsOn: [], input: {}, skippable: false, priority: 2 },
      { id: 'B', name: 'Node B', dependsOn: [], input: {}, skippable: false, priority: 1 },
      { id: 'C', name: 'Node C', dependsOn: ['A', 'B'], input: {}, skippable: false, priority: 0 },
    ],
    edges: [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ],
  }

  it('应返回无前驱依赖的根节点', () => {
    const ready = findReadyNodes(graph, {
      A: 'pending',
      B: 'pending',
      C: 'pending',
    })
    expect(ready).toContain('A')
    expect(ready).toContain('B')
    expect(ready).not.toContain('C')
  })

  it('应按 priority 降序排列', () => {
    const ready = findReadyNodes(graph, {
      A: 'pending',
      B: 'pending',
      C: 'pending',
    })
    expect(ready[0]).toBe('A') // priority 2 > 1
    expect(ready[1]).toBe('B')
  })

  it('前驱全部完成后子节点就绪', () => {
    const ready = findReadyNodes(graph, {
      A: 'completed',
      B: 'completed',
      C: 'pending',
    })
    expect(ready).toEqual(['C'])
  })

  it('前驱未完成时子节点不就绪', () => {
    const ready = findReadyNodes(graph, {
      A: 'completed',
      B: 'running',
      C: 'pending',
    })
    expect(ready).toEqual([])
  })
})

describe('evaluateEdgeCondition', () => {
  it('应正确评估 == 条件', () => {
    const edge = { from: 'A', to: 'B', condition: 'A.status == "pass"' }
    const outputs = { A: { status: 'pass' } }
    expect(evaluateEdgeCondition(edge, outputs)).toBe(true)
  })

  it('应正确评估 != 条件', () => {
    const edge = { from: 'A', to: 'B', condition: 'A.status != "fail"' }
    const outputs = { A: { status: 'pass' } }
    expect(evaluateEdgeCondition(edge, outputs)).toBe(true)
  })

  it('应正确评估 > 条件', () => {
    const edge = { from: 'A', to: 'B', condition: 'A.score > 80' }
    const outputs = { A: { score: 95 } }
    expect(evaluateEdgeCondition(edge, outputs)).toBe(true)
  })

  it('条件中引用不存在的节点应返回 false', () => {
    const edge = { from: 'X', to: 'B', condition: 'X.score > 80' }
    const outputs = {}
    expect(evaluateEdgeCondition(edge, outputs)).toBe(false)
  })

  it('应拒绝 __proto__ 注入', () => {
    const edge = { from: 'A', to: 'B', condition: 'A.__proto__ == "pass"' }
    const outputs = { A: { status: 'pass' } }
    expect(evaluateEdgeCondition(edge, outputs)).toBe(false)
  })
})
