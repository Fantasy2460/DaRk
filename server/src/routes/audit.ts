import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createAuditLog, getAuditLogsByCharacter } from '../services/AuditService';
import { getCharacterOwner } from '../services/CharacterService';
import { flagAnomaly } from '../services/AntiCheatService';

const router = Router();

/** 内存级最近一次审计写入时间戳（按 user 维度），用于 AUDIT_RATE 简易判定 */
const lastAuditAtMap = new Map<string, number>();
const AUDIT_RATE_LIMIT_MS = 100;

// 写入审计日志
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, action, details } = req.body;
    if (!action) {
      res.status(400).json({ error: '缺少 action 字段' });
      return;
    }

    // 若指定 characterId，必须归属当前 user
    if (characterId) {
      const ownerUserId = await getCharacterOwner(characterId);
      if (!ownerUserId) {
        res.status(404).json({ error: '角色不存在' });
        return;
      }
      if (ownerUserId !== req.userId) {
        await flagAnomaly({
          reason: 'CHARACTER_OWNERSHIP_VIOLATION',
          characterId,
          details: {
            endpoint: 'POST /audit',
            action,
            actualOwner: ownerUserId,
            requestedBy: req.userId,
          },
          confidence: 90,
        });
        res.status(403).json({ error: '无权写入该角色的审计日志' });
        return;
      }
    }

    // 高频写入检测
    const userId = req.userId!;
    const now = Date.now();
    const last = lastAuditAtMap.get(userId);
    if (last && now - last < AUDIT_RATE_LIMIT_MS) {
      // 没有 characterId 时，flag 暂用 'unknown' 作占位以满足 schema NOT NULL
      const flagCharId = characterId ?? 'unknown';
      await flagAnomaly({
        reason: 'AUDIT_RATE',
        characterId: flagCharId,
        details: {
          userId,
          action,
          deltaMs: now - last,
          thresholdMs: AUDIT_RATE_LIMIT_MS,
        },
        confidence: 30,
      });
    }
    lastAuditAtMap.set(userId, now);

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const log = await createAuditLog({
      userId,
      characterId,
      action,
      details,
      clientIp: clientIp || undefined,
    });
    res.json({ success: true, id: log.id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 查询某角色的审计日志
router.get('/character/:characterId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const characterId = req.params.characterId;

    // 归属校验
    const ownerUserId = await getCharacterOwner(characterId);
    if (!ownerUserId) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerUserId !== req.userId) {
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'GET /audit/character/:characterId',
          actualOwner: ownerUserId,
          requestedBy: req.userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权查看该角色' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await getAuditLogsByCharacter(characterId, limit);
    res.json({ logs });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
