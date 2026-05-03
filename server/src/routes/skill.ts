import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';
import { flagAnomaly } from '../services/AntiCheatService';
import { upgradeSkill } from '../services/SkillService';

const router = Router();

/**
 * 获取所有技能模板（含先修技能引用）。
 * 真实可用：直接读取 SkillTemplate 表，按 tier 升序返回。
 */
router.get('/templates', async (_req, res) => {
  try {
    const templates = await prisma.skillTemplate.findMany({
      orderBy: { tier: 'asc' },
      include: {
        prerequisite: {
          select: { id: true, name: true, tier: true },
        },
      },
    });
    res.json({ templates });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 技能升级（TASK-SKILL-BE）。
 * 鉴权 + 角色归属校验后委托 SkillService.upgradeSkill。
 */
router.post('/upgrade', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, skillId } = req.body ?? {};
    if (!characterId || !skillId) {
      res.status(400).json({ error: '缺少 characterId 或 skillId' });
      return;
    }

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
          endpoint: 'POST /skills/upgrade',
          skillId,
          actualOwner: character.userId,
          requestedBy: req.userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权操作该角色' });
      return;
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip;
    const result = await upgradeSkill(req.userId!, characterId, skillId, clientIp);

    if (!result.ok) {
      const status = result.code === 'CHARACTER_NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: result.code, message: result.message });
      return;
    }

    res.json({
      skillPoints: result.skillPoints,
      skillLevels: result.skillLevels,
      upgradedSkillId: result.upgradedSkillId,
      newLevel: result.newLevel,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'INTERNAL_ERROR' });
  }
});

export default router;
