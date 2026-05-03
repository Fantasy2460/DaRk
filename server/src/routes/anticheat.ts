import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { listFlags, summarize } from '../services/AntiCheatService';

/**
 * 反作弊管理端查询路由（TASK-BE-015）。
 *
 * 所有端点要求：
 *   1. JWT 认证（authMiddleware）
 *   2. 管理员（requireAdmin，简陋实现：环境变量白名单 / username='admin' 兜底）
 *
 * 端点：
 *   GET /api/anticheat/flags    列出反作弊 flags（支持过滤）
 *   GET /api/anticheat/summary  各 reason 的累计计数 + 最后一次发生时间
 */
const router = Router();

router.get('/flags', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const characterId =
      typeof req.query.characterId === 'string' ? req.query.characterId : undefined;
    const reason = typeof req.query.reason === 'string' ? req.query.reason : undefined;
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : undefined;

    const result = await listFlags({
      characterId,
      reason,
      since,
      limit: Number.isFinite(limit) ? (limit as number) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/summary', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const result = await summarize();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
