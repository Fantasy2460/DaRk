import { prisma } from '../config/database';

/**
 * 反作弊标记服务（最小封装）
 *
 * 当前阶段：仅做事件记录（写入 anti_cheat_flags 表），不直接阻断玩家请求。
 * 后续可由审计后台扫描 confidence/type 进行人工复核。
 *
 * schema 字段映射：
 *   - type           → reason（如 'EXP_MISMATCH' / 'EXP_RATE'）
 *   - evidenceJson   → details（任意结构 JSON，用于复盘上下文）
 *   - confidence     → 可选信心度（0-100），不传时由调用方决定
 */
export interface FlagAnomalyInput {
  reason: string;
  characterId: string;
  details?: Record<string, any>;
  confidence?: number;
}

export async function flagAnomaly(input: FlagAnomalyInput): Promise<void> {
  try {
    await prisma.antiCheatFlag.create({
      data: {
        characterId: input.characterId,
        type: input.reason,
        confidence: input.confidence ?? null,
        evidenceJson: input.details ? JSON.stringify(input.details) : null,
      },
    });
    // 同时打一行 warn 日志便于运行时观察
    // 注意：不要在这里抛错，反作弊属于 fire-and-forget
    // eslint-disable-next-line no-console
    console.warn(
      `[AntiCheat] reason=${input.reason} characterId=${input.characterId} details=${
        input.details ? JSON.stringify(input.details) : '{}'
      }`
    );
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[AntiCheat] flagAnomaly failed:', err?.message ?? err);
  }
}

// ============================================================
// 管理端查询接口（TASK-BE-015）
// ============================================================

export interface ListFlagsQuery {
  characterId?: string;
  reason?: string;
  /** ISO 时间字符串或 Date */
  since?: string | Date;
  limit?: number;
}

export interface ListFlagsResult {
  flags: Array<{
    id: number;
    characterId: string;
    reason: string;
    confidence: number | null;
    evidence: any | null;
    detectedAt: Date;
  }>;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * 列出反作弊 flags（管理端用）。
 * - limit 默认 100，最大 500（超出会自动截断到 500）
 * - 按 createdAt 倒序返回最近的记录
 */
export async function listFlags(query: ListFlagsQuery): Promise<ListFlagsResult> {
  const where: any = {};
  if (query.characterId) where.characterId = query.characterId;
  if (query.reason) where.type = query.reason;
  if (query.since) {
    const sinceDate =
      query.since instanceof Date ? query.since : new Date(query.since);
    if (!Number.isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  const limitRaw = query.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(limitRaw, MAX_LIMIT));

  const rows = await prisma.antiCheatFlag.findMany({
    where,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  return {
    flags: rows.map((r) => ({
      id: r.id,
      characterId: r.characterId,
      reason: r.type,
      confidence: r.confidence,
      evidence: r.evidenceJson ? safeParseJson(r.evidenceJson) : null,
      detectedAt: r.createdAt,
    })),
  };
}

export interface SummaryEntry {
  reason: string;
  count: number;
  latestAt: Date;
}

/**
 * 各 reason 的累计计数与最后一次发生时间。
 * 用 Prisma groupBy 实现，性能尚可。
 */
export async function summarize(): Promise<{ summary: SummaryEntry[] }> {
  const groups = await prisma.antiCheatFlag.groupBy({
    by: ['type'],
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _count: { type: 'desc' } },
  });

  return {
    summary: groups.map((g) => ({
      reason: g.type,
      count: g._count._all,
      latestAt: g._max.createdAt as Date,
    })),
  };
}

function safeParseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
