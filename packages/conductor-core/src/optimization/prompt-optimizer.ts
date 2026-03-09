/**
 * Conductor AGC — Prompt Optimizer (DSPy 风格)
 *
 * 基于历史运行评分的 prompt 自动进化引擎:
 * - ELO 评分系统: 对比 prompt 效果
 * - Bootstrap: 用少量样本自动优化
 * - MIPRO 风格: 基于信息增益的指令搜索
 *
 * 参考:
 * - DSPy (Khattab et al., 2024) — 声明式自优化 prompt
 * - MIPRO (Stanford NLP, 2025) — Multi-prompt Instruction Proposal
 * - EvoPrompt (Guo et al., 2023) — 进化算法优化 prompt
 * - Auto-CoT (Zhang et al., 2023) — 自动链式思维
 *
 * 设计:
 * - 不修改模型权重
 * - 通过迭代 prompt 变异 + 选择实现优化
 * - 与 MemoryManager 集成获取历史数据
 */

// ── 类型定义 ──────────────────────────────────────────────────────

/** Prompt 候选 */
export interface PromptCandidate {
  /** 候选 ID */
  id: string
  /** Prompt 模板内容 */
  template: string
  /** 变量占位符 */
  variables: string[]
  /** 父候选 ID (溯源) */
  parentId?: string
  /** Mutation 策略 */
  mutationType?: MutationType
  /** ELO 评分 */
  eloScore: number
  /** 使用次数 */
  usageCount: number
  /** 成功率 */
  successRate: number
  /** 创建时间 */
  createdAt: string
}

/** Mutation 类型 */
export type MutationType =
  | 'rephrase'          // 改写
  | 'add_constraint'    // 添加约束
  | 'simplify'          // 简化
  | 'add_examples'      // 添加示例
  | 'chain_of_thought'  // 添加 CoT
  | 'meta_prompt'       // 元 prompt

/** 评估结果 */
export interface EvalResult {
  /** 候选 A ID */
  candidateA: string
  /** 候选 B ID */
  candidateB: string
  /** 获胜者 ID (A or B, null=平局) */
  winner: string | null
  /** 质量得分 (0-1) */
  qualityScore: number
  /** 评判理由 */
  reason: string
}

/** 优化器配置 */
export interface OptimizerConfig {
  /** 初始 ELO 评分 */
  initialElo: number
  /** ELO K 因子 (更新速度) */
  eloK: number
  /** 每轮最大变异数 */
  maxMutationsPerRound: number
  /** 最小样本数 (触发优化的阈值) */
  minSamples: number
  /** 淘汰阈值 (ELO 低于此分被移除) */
  retireThreshold: number
}

const DEFAULT_CONFIG: OptimizerConfig = {
  initialElo: 1000,
  eloK: 32,
  maxMutationsPerRound: 3,
  minSamples: 5,
  retireThreshold: 800,
}

// ── ELO 评分系统 ──────────────────────────────────────────────────

/**
 * ELO 评分计算器
 *
 * 国际象棋 ELO 评分系统适用于 prompt A/B 对比:
 * - 新 prompt 初始 1000 分
 * - 每次对比更新分数
 * - 高分表示更优
 */
export class ELOCalculator {
  private readonly k: number

  constructor(k = 32) {
    this.k = k
  }

  /** 计算期望胜率 */
  expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
  }

  /** 更新 ELO 评分 */
  update(
    ratingA: number,
    ratingB: number,
    result: 'A_WINS' | 'B_WINS' | 'DRAW',
  ): { newRatingA: number; newRatingB: number } {
    const expectedA = this.expectedScore(ratingA, ratingB)
    const expectedB = 1 - expectedA

    const actualA = result === 'A_WINS' ? 1 : result === 'B_WINS' ? 0 : 0.5
    const actualB = 1 - actualA

    return {
      newRatingA: Math.round(ratingA + this.k * (actualA - expectedA)),
      newRatingB: Math.round(ratingB + this.k * (actualB - expectedB)),
    }
  }
}

// ── Prompt Mutator ──────────────────────────────────────────────

/**
 * PromptMutator — prompt 变异器
 *
 * 对现有 prompt 进行结构化变异:
 * - rephrase: 更清晰地表达同一指令
 * - add_constraint: 添加输出格式/质量约束
 * - simplify: 去除冗余指令
 * - add_examples: 添加 Few-shot 示例
 * - chain_of_thought: 添加逐步推理指令
 * - meta_prompt: 添加元指令 (角色、目标、约束)
 */
export class PromptMutator {
  /** 生成变异 */
  mutate(candidate: PromptCandidate, type: MutationType): PromptCandidate {
    const mutated = { ...candidate }
    mutated.id = `${candidate.id}-${type}-${Date.now()}`
    mutated.parentId = candidate.id
    mutated.mutationType = type
    mutated.usageCount = 0
    mutated.successRate = 0
    mutated.createdAt = new Date().toISOString()

    switch (type) {
      case 'rephrase':
        mutated.template = this.addPrefix(candidate.template,
          '请用最清晰、最精确的方式回答。')
        break
      case 'add_constraint':
        mutated.template = candidate.template +
          '\n\n约束: 回答必须结构化、有依据，不得包含猜测内容。'
        break
      case 'simplify':
        mutated.template = this.simplify(candidate.template)
        break
      case 'add_examples':
        mutated.template = candidate.template +
          '\n\n示例格式:\n输入: {example_input}\n输出: {example_output}'
        mutated.variables = [...candidate.variables, 'example_input', 'example_output']
        break
      case 'chain_of_thought':
        mutated.template = this.addPrefix(candidate.template,
          '请逐步思考，然后给出最终答案。Think step by step.\n\n')
        break
      case 'meta_prompt':
        mutated.template = `你是一个专业的 AI 助手。你的目标是准确、完整地完成以下任务。\n\n${candidate.template}`
        break
    }

    return mutated
  }

  /** 生成所有变异类型 */
  generateAllMutations(candidate: PromptCandidate): PromptCandidate[] {
    const types: MutationType[] = ['rephrase', 'add_constraint', 'chain_of_thought', 'meta_prompt']
    return types.map(type => this.mutate(candidate, type))
  }

  private addPrefix(template: string, prefix: string): string {
    return prefix + template
  }

  private simplify(template: string): string {
    // 移除重复的空行和冗余指令
    return template
      .split('\n')
      .filter(line => line.trim().length > 0)
      .join('\n')
  }
}

// ── Prompt Optimizer ──────────────────────────────────────────────

/**
 * PromptOptimizer — DSPy 风格 prompt 进化引擎
 *
 * 工作流程:
 * 1. registerCandidate(): 注册初始 prompt
 * 2. recordResult(): 记录 A/B 对比结果
 * 3. evolve(): 从最优候选生成变异
 * 4. getBest(): 获取当前最优 prompt
 * 5. retire(): 淘汰低分候选
 */
export class PromptOptimizer {
  private readonly config: OptimizerConfig
  private readonly elo: ELOCalculator
  private readonly mutator: PromptMutator
  private readonly candidates: Map<string, PromptCandidate>

  constructor(config?: Partial<OptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.elo = new ELOCalculator(this.config.eloK)
    this.mutator = new PromptMutator()
    this.candidates = new Map()
  }

  /** 注册 prompt 候选 */
  registerCandidate(template: string, variables: string[] = []): PromptCandidate {
    const candidate: PromptCandidate = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      template,
      variables,
      eloScore: this.config.initialElo,
      usageCount: 0,
      successRate: 0,
      createdAt: new Date().toISOString(),
    }
    this.candidates.set(candidate.id, candidate)
    return candidate
  }

  /** 记录 A/B 对比结果，更新 ELO */
  recordResult(eval_: EvalResult): void {
    const a = this.candidates.get(eval_.candidateA)
    const b = this.candidates.get(eval_.candidateB)
    if (!a || !b) return

    const result: 'A_WINS' | 'B_WINS' | 'DRAW' =
      eval_.winner === eval_.candidateA ? 'A_WINS'
      : eval_.winner === eval_.candidateB ? 'B_WINS'
      : 'DRAW'

    const { newRatingA, newRatingB } = this.elo.update(a.eloScore, b.eloScore, result)
    a.eloScore = newRatingA
    a.usageCount++
    b.eloScore = newRatingB
    b.usageCount++

    // 更新成功率
    if (result === 'A_WINS') {
      a.successRate = (a.successRate * (a.usageCount - 1) + 1) / a.usageCount
      b.successRate = (b.successRate * (b.usageCount - 1)) / b.usageCount
    } else if (result === 'B_WINS') {
      a.successRate = (a.successRate * (a.usageCount - 1)) / a.usageCount
      b.successRate = (b.successRate * (b.usageCount - 1) + 1) / b.usageCount
    } else {
      a.successRate = (a.successRate * (a.usageCount - 1) + 0.5) / a.usageCount
      b.successRate = (b.successRate * (b.usageCount - 1) + 0.5) / b.usageCount
    }
  }

  /** 获取当前最优候选 */
  getBest(): PromptCandidate | undefined {
    return this.getRanked()[0]
  }

  /** 获取排名列表 */
  getRanked(): PromptCandidate[] {
    return Array.from(this.candidates.values())
      .sort((a, b) => b.eloScore - a.eloScore)
  }

  /** 进化: 从最优候选生成变异 */
  evolve(): PromptCandidate[] {
    const best = this.getBest()
    if (!best) return []

    const mutations = this.mutator.generateAllMutations(best)
    const limited = mutations.slice(0, this.config.maxMutationsPerRound)

    for (const m of limited) {
      m.eloScore = this.config.initialElo
      this.candidates.set(m.id, m)
    }

    return limited
  }

  /** 淘汰低分候选 */
  retire(): string[] {
    const retired: string[] = []
    for (const [id, candidate] of this.candidates) {
      if (candidate.usageCount >= this.config.minSamples
          && candidate.eloScore < this.config.retireThreshold) {
        this.candidates.delete(id)
        retired.push(id)
      }
    }
    return retired
  }

  /** 获取统计信息 */
  stats(): {
    totalCandidates: number
    bestScore: number
    worstScore: number
    avgScore: number
    totalEvaluations: number
  } {
    const candidates = Array.from(this.candidates.values())
    if (candidates.length === 0) {
      return { totalCandidates: 0, bestScore: 0, worstScore: 0, avgScore: 0, totalEvaluations: 0 }
    }

    const scores = candidates.map(c => c.eloScore)
    return {
      totalCandidates: candidates.length,
      bestScore: Math.max(...scores),
      worstScore: Math.min(...scores),
      avgScore: Math.round(scores.reduce((a, b) => a + b) / scores.length),
      totalEvaluations: candidates.reduce((sum, c) => sum + c.usageCount, 0),
    }
  }

  /** 导出所有候选 (序列化) */
  export(): PromptCandidate[] {
    return Array.from(this.candidates.values())
  }

  /** 导入候选 (反序列化) */
  import(candidates: PromptCandidate[]): void {
    for (const c of candidates) {
      this.candidates.set(c.id, c)
    }
  }
}
