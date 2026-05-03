import { Router } from 'express';
import { prisma } from '../config/database';

const router = Router();

/**
 * 获取全部排行榜赛季列表。
 * 真实可用：读取 LeaderboardSeason 表，按 id 倒序（最新赛季在前）。
 */
router.get('/', async (_req, res) => {
  try {
    const seasons = await prisma.leaderboardSeason.findMany({
      orderBy: { id: 'desc' },
    });
    res.json({ seasons });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 获取指定赛季的前 100 名。
 * 真实可用：LeaderboardEntry 与 Character 之间没有 Prisma relation，
 * 因此先取 entries，再批量查 Character 名称/职业拼回。
 */
router.get('/:seasonId', async (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId, 10);
    if (Number.isNaN(seasonId)) {
      res.status(400).json({ error: 'seasonId 必须是数字' });
      return;
    }

    const entries = await prisma.leaderboardEntry.findMany({
      where: { seasonId },
      orderBy: { score: 'desc' },
      take: 100,
    });

    const characterIds = Array.from(new Set(entries.map((e) => e.characterId)));
    const characters = characterIds.length
      ? await prisma.character.findMany({
          where: { id: { in: characterIds } },
          select: { id: true, name: true, classType: true },
        })
      : [];
    const charMap = new Map(characters.map((c) => [c.id, c]));

    const result = entries.map((e) => ({
      seasonId: e.seasonId,
      category: e.category,
      characterId: e.characterId,
      score: e.score,
      rank: e.rank,
      updatedAt: e.updatedAt.toISOString(),
      character: charMap.get(e.characterId) ?? null,
    }));

    res.json({ entries: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
