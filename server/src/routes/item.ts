import { Router } from 'express';
import { prisma } from '../config/database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const templates = await prisma.itemTemplate.findMany({
      where: { isDeleted: false },
      orderBy: [{ type: 'asc' }, { rarity: 'asc' }, { name: 'asc' }],
    });

    const items = templates
      .filter((t) => t.type === 'equipment')
      .map((t) => ({
        id: t.id,
        name: t.name,
        rarity: t.rarity,
        slot: t.slot,
        stats: t.baseStatsJson ? JSON.parse(t.baseStatsJson) : {},
        description: t.description || '',
      }));

    const consumables = templates
      .filter((t) => t.type === 'consumable')
      .map((t) => ({
        id: t.id,
        name: t.name,
        type: t.consumableType,
        value: t.consumableValue,
        duration: t.consumableDuration,
        description: t.description || '',
      }));

    res.json({ items, consumables });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
