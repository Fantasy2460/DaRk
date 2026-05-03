import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';
import { flagAnomaly } from '../services/AntiCheatService';

const router = Router();

/**
 * 内部工具：根据 playerItemId 校验物品归属。
 * 返回 { item, error }。error 为非空时直接返回给客户端。
 */
async function loadOwnedItem(playerItemId: string, userId: string) {
  const item = await prisma.playerItem.findUnique({
    where: { id: playerItemId },
    include: {
      character: { select: { id: true, userId: true } },
      enchantment: true,
    },
  });
  if (!item) {
    return { item: null, status: 404, error: '物品不存在' };
  }
  if (item.character.userId !== userId) {
    await flagAnomaly({
      reason: 'ENCHANT_ITEM_OWNERSHIP',
      characterId: item.character.id,
      details: {
        endpoint: 'enchant route',
        playerItemId,
        actualOwner: item.character.userId,
        requestedBy: userId,
      },
      confidence: 90,
    });
    return { item: null, status: 403, error: '无权操作该物品' };
  }
  return { item, status: 200 as const };
}

/**
 * 获取指定 PlayerItem 当前的强化等级与加成。
 * 真实可用：读 ItemEnchantment 表，未强化返回 enchantLevel = 0。
 */
router.get('/:playerItemId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { playerItemId } = req.params;
    const result = await loadOwnedItem(playerItemId, req.userId!);
    if (!result.item) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const ench = result.item.enchantment;
    res.json({
      playerItemId,
      enchantLevel: ench?.enchantLevel ?? 0,
      bonusStatsJson: ench?.bonusStatsJson ?? null,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 装备强化（占位）。
 * 仅做归属校验，强化结果计算与材料消耗后续 TASK 实现。
 */
router.post('/:playerItemId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { playerItemId } = req.params;
    const result = await loadOwnedItem(playerItemId, req.userId!);
    if (!result.item) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(501).json({
      error: 'NOT_IMPLEMENTED',
      message: '装备强化功能开发中',
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
