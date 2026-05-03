import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';
import { flagAnomaly } from '../services/AntiCheatService';

/**
 * 成就路由。
 * 由于本路由同时承载 `/api/achievements/*` 与 `/api/characters/:id/achievements`，
 * 在 index.ts 中以 `/api` 作为挂载前缀，路径在此处书写完整子路径。
 */
const router = Router();

/**
 * 获取所有成就模板。
 * 真实可用：读取 Achievement 表全部记录。
 */
router.get('/achievements', async (_req, res) => {
  try {
    const achievements = await prisma.achievement.findMany({
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    });
    res.json({ achievements });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 获取某角色的成就进度（含未完成的）。
 * 真实可用：JWT + 归属校验。
 */
router.get(
  '/characters/:id/achievements',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const characterId = req.params.id;
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { id: true, userId: true },
      });
      if (!character) {
        res.status(404).json({ error: '角色不存在' });
        return;
      }
      if (character.userId !== req.userId) {
        await flagAnomaly({
          reason: 'CHARACTER_OWNERSHIP_VIOLATION',
          characterId,
          details: {
            endpoint: 'GET /characters/:id/achievements',
            actualOwner: character.userId,
            requestedBy: req.userId,
          },
          confidence: 90,
        });
        res.status(403).json({ error: '无权查看该角色的成就' });
        return;
      }

      const records = await prisma.playerAchievement.findMany({
        where: { characterId },
        include: { achievement: true },
      });
      res.json({ achievements: records });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * 领取成就奖励（占位）。
 */
router.post('/achievements/:id/claim', authMiddleware, async (_req: AuthRequest, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    message: '成就领取功能开发中',
  });
});

export default router;
