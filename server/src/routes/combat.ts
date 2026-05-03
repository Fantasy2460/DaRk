import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';
import { flagAnomaly } from '../services/AntiCheatService';

/**
 * 多人战斗权威服务（阶段三）—— 当前为占位实现。
 *
 * 阶段一/二：仅做基本的 JWT 鉴权与归属校验，避免接口被滥用，
 * 真正的伤害判定与状态广播将在阶段三的权威服务器中实现。
 *
 * 端点：
 *   POST /api/combat/damage  上报一次攻击伤害
 *   POST /api/combat/skill   释放技能
 *   GET  /api/combat/state/:runId 获取战斗快照
 *
 * 当前所有端点统一返回 501 NOT_IMPLEMENTED，但仍保留请求合法性校验，
 * 防止恶意客户端伪造 runId 触发未来阶段的隐患。
 */
const router = Router();

interface DamageBody {
  runId?: string;
  attackerType?: 'PLAYER' | 'ENEMY';
  attackerId?: string;
  targetType?: 'PLAYER' | 'ENEMY';
  targetId?: string;
  skillId?: string;
  baseDamage?: number;
}

interface SkillBody {
  runId?: string;
  characterId?: string;
  skillId?: string;
  targetX?: number;
  targetY?: number;
}

const NOT_IMPLEMENTED_BODY = {
  error: 'NOT_IMPLEMENTED',
  message: '战斗权威服务器开发中（阶段三）',
};

/**
 * 校验 runId 是否存在且当前用户的角色参与其中。
 * - 找不到 run → 400（不暴露存在性差异给非参与者）
 * - 不参与 → 403
 */
async function validateRunOwnership(
  runId: string | undefined,
  userId: string,
  characterId?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!runId || typeof runId !== 'string') {
    return { ok: false, status: 400, error: '缺少有效 runId' };
  }
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { participants: { include: { character: true } } },
  });
  if (!run) {
    return { ok: false, status: 400, error: 'Run 不存在或已结束' };
  }

  // 收集 run 中归属当前 user 的所有 character id
  const myCharacterIdsInRun = run.participants
    .filter((p) => p.character.userId === userId)
    .map((p) => p.character.id);
  // host 也算参与者
  const host = await prisma.character.findUnique({
    where: { id: run.characterId },
    select: { id: true, userId: true },
  });
  if (host && host.userId === userId) {
    myCharacterIdsInRun.push(host.id);
  }

  if (myCharacterIdsInRun.length === 0) {
    await flagAnomaly({
      reason: 'RUN_OWNERSHIP_VIOLATION',
      characterId: characterId ?? run.characterId,
      details: {
        endpoint: 'combat route',
        runId,
        requestedBy: userId,
        runHostUserId: host?.userId ?? null,
      },
      confidence: 90,
    });
    return { ok: false, status: 403, error: '当前用户不参与该 Run' };
  }

  if (characterId && !myCharacterIdsInRun.includes(characterId)) {
    await flagAnomaly({
      reason: 'COMBAT_CHARACTER_MISMATCH',
      characterId,
      details: {
        endpoint: 'combat route',
        runId,
        requestedBy: userId,
        myCharacterIdsInRun,
      },
      confidence: 80,
    });
    return { ok: false, status: 403, error: '指定 characterId 不属于当前用户' };
  }

  return { ok: true };
}

/**
 * POST /api/combat/damage
 * 上报一次伤害（占位）。
 */
router.post('/damage', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as DamageBody;

    // 基本字段校验
    if (
      !body.attackerType ||
      !body.targetType ||
      !body.attackerId ||
      !body.targetId ||
      typeof body.baseDamage !== 'number'
    ) {
      res.status(400).json({ error: '参数不完整' });
      return;
    }

    // 仅当攻击方为 PLAYER 时校验 attackerId 归属当前用户的角色
    const checkCharId =
      body.attackerType === 'PLAYER' ? body.attackerId : undefined;
    const validation = await validateRunOwnership(body.runId, req.userId!, checkCharId);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    res.status(501).json(NOT_IMPLEMENTED_BODY);
  } catch (err: any) {
    res.status(err?.statusCode ?? 400).json({ error: err.message });
  }
});

/**
 * POST /api/combat/skill
 * 释放技能（占位）。
 */
router.post('/skill', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as SkillBody;

    if (
      !body.characterId ||
      !body.skillId ||
      typeof body.targetX !== 'number' ||
      typeof body.targetY !== 'number'
    ) {
      res.status(400).json({ error: '参数不完整' });
      return;
    }

    const validation = await validateRunOwnership(
      body.runId,
      req.userId!,
      body.characterId
    );
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    res.status(501).json(NOT_IMPLEMENTED_BODY);
  } catch (err: any) {
    res.status(err?.statusCode ?? 400).json({ error: err.message });
  }
});

/**
 * GET /api/combat/state/:runId
 * 获取战斗快照（占位）。
 */
router.get('/state/:runId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const runId = req.params.runId;
    const validation = await validateRunOwnership(runId, req.userId!);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    res.status(501).json(NOT_IMPLEMENTED_BODY);
  } catch (err: any) {
    res.status(err?.statusCode ?? 400).json({ error: err.message });
  }
});

export default router;
