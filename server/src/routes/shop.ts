import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getShops, getShopItems, buyShopItem, sellShopItem } from '../services/ShopService';
import { getCharacterOwner } from '../services/CharacterService';
import { createAuditLog } from '../services/AuditService';
import { flagAnomaly } from '../services/AntiCheatService';

const router = Router();

// 获取商店列表
router.get('/', async (_req, res) => {
  try {
    const shops = await getShops();
    res.json({ shops });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 购买商品（放在参数路由之前）
router.post('/buy', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, shopItemId } = req.body;
    if (!characterId || !shopItemId) {
      res.status(400).json({ error: '缺少 characterId 或 shopItemId' });
      return;
    }

    // 归属校验：character 必须属于当前 user
    const ownerUserId = await getCharacterOwner(characterId);
    if (!ownerUserId) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerUserId !== req.userId) {
      await flagAnomaly({
        reason: 'SHOP_BUY_OWNERSHIP',
        characterId,
        details: {
          endpoint: 'POST /shops/buy',
          shopItemId,
          actualOwner: ownerUserId,
          requestedBy: req.userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权操作该角色' });
      return;
    }

    const result = await buyShopItem(characterId, shopItemId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 出售物品（放在参数路由之前）
router.post('/sell', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, playerItemId } = req.body;
    // 兼容前端 ApiClient 使用 count 字段；同时接受 quantity
    const rawQty = req.body.quantity ?? req.body.count ?? 1;

    if (!characterId || !playerItemId) {
      res.status(400).json({ error: '缺少 characterId 或 playerItemId' });
      return;
    }

    // 归属校验：character 必须属于当前 user
    const ownerUserId = await getCharacterOwner(characterId);
    if (!ownerUserId) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerUserId !== req.userId) {
      await flagAnomaly({
        reason: 'SELL_INVALID_ITEM',
        characterId,
        details: {
          playerItemId,
          reason: 'character_not_owned',
          requesterUserId: req.userId,
          ownerUserId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权操作该角色' });
      return;
    }

    const quantity = Number(rawQty);
    const result = await sellShopItem(characterId, playerItemId, quantity);

    // 写审计日志（fire-and-forget 风格，但保留 await 让错误能被 catch）
    try {
      await createAuditLog({
        userId: req.userId!,
        characterId,
        action: 'SHOP_SELL',
        details: {
          playerItemId,
          quantity,
          goldGained: result.goldGained,
          newGold: result.newGold,
          soldItem: result.soldItem,
        },
        clientIp: req.ip,
      });
    } catch (auditErr: any) {
      // eslint-disable-next-line no-console
      console.warn('[ShopSell] audit log failed:', auditErr?.message ?? auditErr);
    }

    res.json({ success: true, ...result });
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    res.status(status).json({ error: err.message });
  }
});

// 获取某个商店的商品列表
router.get('/:id/items', async (req, res) => {
  try {
    const items = await getShopItems(req.params.id);
    if (!items) {
      res.status(404).json({ error: '商店不存在' });
      return;
    }
    res.json({ items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
