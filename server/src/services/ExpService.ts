import { prisma } from '../config/database';
import { INTERNAL_GAME_CONFIG, getExpRequiredForNextLevel } from '../config/gameConfig';
import { createAuditLog } from './AuditService';
import { flagAnomaly } from './AntiCheatService';

/**
 * 经验/升级服务（TASK-BE-003）
 *
 * 职责：
 * - 校验来源 (source) 合法性
 * - 根据 source 计算「合法 amount」（服务端权威，忽略客户端篡改）
 * - 累加 exp，触发可能的多级升级（升级时同步发放 statPoints）
 * - 写审计与反作弊
 *
 * 防护：
 * - 高频调用（< rateLimitMs）：写 EXP_RATE flag，不阻断
 * - 客户端 amount 与权威值不符：写 EXP_MISMATCH flag，amount 仍以服务端为准
 * - amount > expValue * sourceMaxAmountMultiplier：写 EXP_OVERFLOW flag
 */

export type ExpSource = 'KILL_ENEMY' | 'EXTRACT' | 'QUEST';

const ALLOWED_SOURCES: ReadonlyArray<ExpSource> = ['KILL_ENEMY', 'EXTRACT', 'QUEST'];

export interface GainExpInput {
  source: ExpSource;
  amount?: number;
  enemyTemplateId?: string;
  runId?: string;
  questId?: string;
}

export interface GainExpResult {
  exp: number;
  level: number;
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
  levelUps: number;
  statsAwarded: number;
  skillPointsAwarded: number;
  source: ExpSource;
  legalAmount: number;
}

/** 内存级最近一次给经验的时间戳（按 character 维度），用于 EXP_RATE 简易判定 */
const lastGainAtMap = new Map<string, number>();

export function isAllowedSource(source: any): source is ExpSource {
  return typeof source === 'string' && ALLOWED_SOURCES.includes(source as ExpSource);
}

/**
 * 主入口：处理一次给经验请求
 * 调用方需在 route 层完成 JWT 鉴权 + characterId 归属校验。
 */
export async function gainExp(
  userId: string,
  characterId: string,
  input: GainExpInput,
  clientIp?: string
): Promise<GainExpResult> {
  // 1) 校验 source 白名单
  if (!isAllowedSource(input.source)) {
    const err: any = new Error(`非法经验来源: ${input.source}`);
    err.statusCode = 400;
    throw err;
  }

  // 2) 高频调用检测（仅记录 flag，不阻断）
  const now = Date.now();
  const last = lastGainAtMap.get(characterId);
  if (last && now - last < INTERNAL_GAME_CONFIG.expGuard.rateLimitMs) {
    await flagAnomaly({
      reason: 'EXP_RATE',
      characterId,
      details: {
        source: input.source,
        deltaMs: now - last,
        thresholdMs: INTERNAL_GAME_CONFIG.expGuard.rateLimitMs,
      },
      confidence: 30,
    });
  }
  lastGainAtMap.set(characterId, now);

  // 3) 根据 source 计算合法 amount
  const legalAmount = await resolveLegalAmount(characterId, input);

  // 4) 加载当前角色，事务更新 exp/level/statPoints
  const before = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      level: true,
      exp: true,
    },
  });
  if (!before) {
    const err: any = new Error('角色不存在');
    err.statusCode = 404;
    throw err;
  }

  const oldLevel = before.level;
  let curLevel = before.level;
  let curExp = before.exp + Math.max(0, legalAmount);

  // 升级循环（受 maxPlayerLevel 上限控制）
  let levelUps = 0;
  while (curLevel < INTERNAL_GAME_CONFIG.maxPlayerLevel) {
    const required = getExpRequiredForNextLevel(curLevel);
    if (curExp < required) break;
    curExp -= required;
    curLevel += 1;
    levelUps += 1;
  }

  // 满级时溢出经验留存（保持与前端一致：前端 while 条件包含 level<MAX 后退出循环，剩余 exp 留在 save.exp）
  // 但若已满级且 curExp 仍 ≥ 下一级所需，前端不会扣减；服务端这里同样保持 curExp 不动。
  // 注：若需限制满级 exp 上限，可在此 cap，例如 curExp = Math.min(curExp, getExpRequiredForNextLevel(curLevel))

  const statsAwarded = levelUps * INTERNAL_GAME_CONFIG.levelUpStatPoints;
  // 升级技能点：每级固定 +2 skillPoint（跨级按 levelUps * 2 累加）
  const skillPointsAwarded = levelUps * 2;

  await prisma.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: characterId },
      data: {
        exp: curExp,
        level: curLevel,
      },
    });

    if (statsAwarded > 0 || skillPointsAwarded > 0) {
      // 升级发放可分配属性点 + 技能点。CharacterStats 与 Character 是一一关系，
      // 部分历史角色可能没有 stats 行（极旧数据），用 upsert 兜底。
      await tx.characterStats.upsert({
        where: { characterId },
        update: {
          availableStatPoints: { increment: statsAwarded },
          skillPoints: { increment: skillPointsAwarded },
        },
        create: {
          characterId,
          baseHp: 0,
          baseMp: 0,
          baseAttack: 0,
          baseDefense: 0,
          baseSpeed: 0,
          fogResist: 0,
          availableStatPoints: statsAwarded,
          skillPoints: skillPointsAwarded,
        },
      });
    }
  });

  // 5) 审计日志（fire-and-forget）
  await createAuditLog({
    userId,
    characterId,
    action: 'EXP_GAIN',
    details: {
      source: input.source,
      legalAmount,
      clientAmount: input.amount ?? null,
      enemyTemplateId: input.enemyTemplateId ?? null,
      runId: input.runId ?? null,
      questId: input.questId ?? null,
      oldLevel,
      newLevel: curLevel,
      levelUps,
      statsAwarded,
      skillPointsAwarded,
      finalExp: curExp,
    },
    clientIp,
  }).catch(() => {});

  return {
    exp: curExp,
    level: curLevel,
    oldLevel,
    newLevel: curLevel,
    leveledUp: levelUps > 0,
    levelUps,
    statsAwarded,
    skillPointsAwarded,
    source: input.source,
    legalAmount,
  };
}

/**
 * 根据 source 计算服务端权威 amount。
 *
 * KILL_ENEMY：
 *   - 必须传 enemyTemplateId
 *   - 服务端从 EnemyTemplate.expValue 取期望值，**忽略客户端 amount**
 *   - 若客户端 amount 与期望不一致 → EXP_MISMATCH flag
 *   - 若客户端 amount > 期望 * sourceMaxAmountMultiplier → 同时写 EXP_OVERFLOW flag
 *
 * EXTRACT：
 *   - 必须传 runId
 *   - 当前阶段：暂返回 0（占位，待 BE-004/规则确认后接入）
 *
 * QUEST：
 *   - 当前未实现 → 抛 400
 */
async function resolveLegalAmount(
  characterId: string,
  input: GainExpInput
): Promise<number> {
  switch (input.source) {
    case 'KILL_ENEMY': {
      if (!input.enemyTemplateId) {
        const err: any = new Error('KILL_ENEMY 必须提供 enemyTemplateId');
        err.statusCode = 400;
        throw err;
      }
      const tpl = await prisma.enemyTemplate.findUnique({
        where: { id: input.enemyTemplateId },
        select: { id: true, expValue: true, isBoss: true },
      });
      if (!tpl) {
        const err: any = new Error(`EnemyTemplate 不存在: ${input.enemyTemplateId}`);
        err.statusCode = 400;
        throw err;
      }

      const expected = tpl.expValue;
      const clientAmount = typeof input.amount === 'number' ? input.amount : null;

      // 客户端上报 amount 与期望不符 → 记录反作弊
      if (clientAmount !== null && clientAmount !== expected) {
        await flagAnomaly({
          reason: 'EXP_MISMATCH',
          characterId,
          details: {
            source: 'KILL_ENEMY',
            enemyTemplateId: tpl.id,
            expected,
            clientAmount,
          },
          confidence: 50,
        });

        const overflowLimit =
          expected * INTERNAL_GAME_CONFIG.expGuard.sourceMaxAmountMultiplier;
        if (clientAmount > overflowLimit) {
          await flagAnomaly({
            reason: 'EXP_OVERFLOW',
            characterId,
            details: {
              source: 'KILL_ENEMY',
              enemyTemplateId: tpl.id,
              expected,
              clientAmount,
              overflowLimit,
            },
            confidence: 80,
          });
        }
      }

      return expected;
    }

    case 'EXTRACT': {
      if (!input.runId) {
        const err: any = new Error('EXTRACT 必须提供 runId');
        err.statusCode = 400;
        throw err;
      }
      // 占位：撤离奖励暂返回 0，待规则确认后接入。
      // 后续可参考 RunService 中的 elapsedTimeSec 进行计算。
      return 0;
    }

    case 'QUEST': {
      const err: any = new Error('QUEST 经验来源未实现');
      err.statusCode = 400;
      throw err;
    }

    default: {
      const err: any = new Error(`非法经验来源: ${(input as any).source}`);
      err.statusCode = 400;
      throw err;
    }
  }
}
