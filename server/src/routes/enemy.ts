import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// 获取所有怪物模板
router.get('/', async (_req, res) => {
  try {
    const enemies = await prisma.enemyTemplate.findMany({
      orderBy: [{ isBoss: 'asc' }, { expValue: 'asc' }],
    });
    res.json({ enemies });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 获取当前角色的怪物图鉴（已解锁 + 未解锁）
router.get('/bestiary/:characterId', authMiddleware, async (req: AuthRequest, res) => {
  const { characterId } = req.params;
  try {
    const [templates, bestiary] = await Promise.all([
      prisma.enemyTemplate.findMany({
        orderBy: [{ isBoss: 'asc' }, { expValue: 'asc' }],
      }),
      prisma.playerBestiary.findMany({
        where: { characterId },
      }),
    ]);

    const killMap = new Map(bestiary.map((b) => [b.enemyTemplateId, b]));

    const result = templates.map((t) => {
      const b = killMap.get(t.id);
      return {
        id: t.id,
        name: t.name,
        hp: t.hp,
        attack: t.attack,
        defense: t.defense,
        speed: t.speed,
        aggroRange: t.aggroRange,
        attackRange: t.attackRange,
        colorHex: t.colorHex,
        isBoss: t.isBoss,
        dropTableJson: t.dropTableJson,
        expValue: t.expValue,
        unlocked: !!b,
        killCount: b?.killCount ?? 0,
        firstKillAt: b?.firstKillAt?.toISOString() ?? null,
        lastKillAt: b?.lastKillAt?.toISOString() ?? null,
      };
    });

    res.json({ bestiary: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
