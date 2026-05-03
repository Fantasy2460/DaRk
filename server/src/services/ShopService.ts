import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { INTERNAL_GAME_CONFIG } from '../config/gameConfig';
import { flagAnomaly } from './AntiCheatService';

export async function getShops() {
  return prisma.shop.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
}

export async function getShopItems(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      items: {
        include: { template: true },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!shop) return null;

  return shop.items.map((si) => {
    const t = si.template;
    return {
      shopItemId: si.id,
      id: t.id,
      name: t.name,
      type: t.type,
      slot: t.slot,
      rarity: t.rarity,
      description: t.description,
      price: si.price,
      currency: si.currency,
      stock: si.stock,
      stats: t.baseStatsJson ? JSON.parse(t.baseStatsJson) : undefined,
      consumableType: t.consumableType,
      consumableValue: t.consumableValue,
      consumableDuration: t.consumableDuration,
    };
  });
}

export async function buyShopItem(characterId: string, shopItemId: number) {
  return prisma.$transaction(async (tx) => {
    // 1. 查询角色
    const character = await tx.character.findUnique({
      where: { id: characterId },
    });
    if (!character) throw new Error('角色不存在');

    // 2. 查询商品
    const shopItem = await tx.shopItem.findUnique({
      where: { id: shopItemId },
      include: { template: true },
    });
    if (!shopItem) throw new Error('商品不存在');
    if (shopItem.stock === 0) throw new Error('商品已售罄');

    // 3. 校验金币
    if (character.gold < shopItem.price) {
      throw new Error('金币不足');
    }

    // 4. 查找背包空位
    const existingItems = await tx.playerItem.findMany({
      where: { characterId, location: 'inventory' },
      select: { slotPosition: true },
    });
    const occupied = new Set(existingItems.map((i) => i.slotPosition));
    let emptySlot = -1;
    for (let i = 0; i < 24; i++) {
      if (!occupied.has(i)) {
        emptySlot = i;
        break;
      }
    }
    if (emptySlot === -1) throw new Error('背包已满');

    // 5. 扣金币
    const newGold = character.gold - shopItem.price;
    await tx.character.update({
      where: { id: characterId },
      data: { gold: newGold },
    });

    // 6. 创建物品
    const newItem = await tx.playerItem.create({
      data: {
        id: generateId(),
        characterId,
        templateId: shopItem.templateId,
        rarity: shopItem.template.rarity,
        location: 'inventory',
        slotPosition: emptySlot,
        stackCount: 1,
        obtainedFrom: `shop:${shopItem.shopId}`,
      },
    });

    // 7. 扣库存（如果有限库存）
    if (shopItem.stock > 0) {
      await tx.shopItem.update({
        where: { id: shopItemId },
        data: { stock: { decrement: 1 } },
      });
    }

    // 8. 记录交易
    await tx.characterTransaction.create({
      data: {
        characterId,
        type: 'shop_buy',
        amount: -shopItem.price,
        balanceAfter: newGold,
        relatedItemId: newItem.id,
      },
    });

    return {
      item: {
        id: shopItem.templateId,
        name: shopItem.template.name,
        rarity: shopItem.template.rarity,
        slot: shopItem.template.slot,
        stats: shopItem.template.baseStatsJson ? JSON.parse(shopItem.template.baseStatsJson) : {},
        description: shopItem.template.description || '',
      },
      goldAfter: newGold,
      slotIndex: emptySlot,
    };
  });
}

/** 内存级最近一次出售时间戳（按 character 维度），用于 SELL_RATE 简易判定 */
const lastSellAtMap = new Map<string, number>();

export interface SellShopItemResult {
  goldGained: number;
  newGold: number;
  soldItem: {
    templateId: string;
    name: string;
  };
}

/**
 * 商店出售：
 * - 仅允许在主城出售已装入主城且未装备的物品（location !== 'equipped' && runId === null）
 * - 当前阶段禁止堆叠出售（quantity 必须为 1）
 * - 售价：优先使用 ItemTemplate.sellPrice；为 0 时回退 buyPrice * sellPriceRatio
 * - 全流程在 prisma.$transaction 中完成：扣物品、加金币、写交易记录
 *
 * 反作弊行为（写 AntiCheatFlag，不阻断除非业务校验失败）：
 *   - SELL_INVALID_ITEM：playerItemId 不存在或不归属
 *   - SELL_EQUIPPED：物品当前正在装备（location === 'equipped'）
 *   - SELL_RUN_ITEM：物品 runId 非空（局内物品禁止出售）
 *   - SELL_RATE：高频出售（< rateLimitMs）
 *
 * 调用方需在 route 层完成 JWT 鉴权 + characterId 归属校验。
 */
export async function sellShopItem(
  characterId: string,
  playerItemId: string,
  quantity: number = 1
): Promise<SellShopItemResult> {
  // 0. 当前阶段不支持堆叠出售
  if (!Number.isInteger(quantity) || quantity !== 1) {
    const err: any = new Error('当前阶段仅支持单件出售（quantity 必须为 1）');
    err.statusCode = 400;
    throw err;
  }

  // 1. 高频出售检测（仅记录 flag，不阻断）
  const now = Date.now();
  const last = lastSellAtMap.get(characterId);
  if (last && now - last < INTERNAL_GAME_CONFIG.sell.rateLimitMs) {
    await flagAnomaly({
      reason: 'SELL_RATE',
      characterId,
      details: {
        playerItemId,
        deltaMs: now - last,
        thresholdMs: INTERNAL_GAME_CONFIG.sell.rateLimitMs,
      },
      confidence: 30,
    });
  }
  lastSellAtMap.set(characterId, now);

  return prisma.$transaction(async (tx) => {
    // 2. 查询并校验 PlayerItem
    const playerItem = await tx.playerItem.findUnique({
      where: { id: playerItemId },
      include: { template: true },
    });

    if (!playerItem || playerItem.characterId !== characterId) {
      await flagAnomaly({
        reason: 'SELL_INVALID_ITEM',
        characterId,
        details: {
          playerItemId,
          exists: !!playerItem,
          ownerCharacterId: playerItem?.characterId ?? null,
        },
        confidence: 80,
      });
      const err: any = new Error('物品不存在或不归属当前角色');
      err.statusCode = 403;
      throw err;
    }

    if (playerItem.location === 'equipped') {
      await flagAnomaly({
        reason: 'SELL_EQUIPPED',
        characterId,
        details: { playerItemId, location: playerItem.location },
        confidence: 60,
      });
      const err: any = new Error('已装备物品无法出售，请先卸下');
      err.statusCode = 400;
      throw err;
    }

    if (playerItem.runId !== null) {
      await flagAnomaly({
        reason: 'SELL_RUN_ITEM',
        characterId,
        details: { playerItemId, runId: playerItem.runId },
        confidence: 60,
      });
      const err: any = new Error('局内物品无法在主城商店出售');
      err.statusCode = 400;
      throw err;
    }

    // 3. 计算售价：优先 sellPrice，缺失/为 0 时使用 buyPrice * sellPriceRatio 作为兜底
    const template = playerItem.template;
    let sellPrice = template.sellPrice ?? 0;
    if (sellPrice <= 0) {
      const ratio = INTERNAL_GAME_CONFIG.sell.sellPriceRatio;
      sellPrice = Math.max(0, Math.floor((template.buyPrice ?? 0) * ratio));
    }

    if (sellPrice <= 0) {
      const err: any = new Error('该物品不可出售');
      err.statusCode = 400;
      throw err;
    }

    // 4. 校验单笔交易上限
    if (sellPrice > INTERNAL_GAME_CONFIG.economy.maxSingleTransaction) {
      const err: any = new Error('单笔交易金额超过上限');
      err.statusCode = 400;
      throw err;
    }

    // 5. 查询角色并更新金币
    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: { id: true, gold: true },
    });
    if (!character) {
      const err: any = new Error('角色不存在');
      err.statusCode = 404;
      throw err;
    }

    const newGold = Math.min(
      character.gold + sellPrice,
      INTERNAL_GAME_CONFIG.economy.maxCarryGold
    );

    await tx.character.update({
      where: { id: characterId },
      data: { gold: newGold },
    });

    // 6. 删除 PlayerItem
    await tx.playerItem.delete({
      where: { id: playerItemId },
    });

    // 7. 记录交易：CharacterTransaction（type='SELL'，amount 为 +sellPrice）
    await tx.characterTransaction.create({
      data: {
        characterId,
        type: 'SELL',
        amount: sellPrice,
        balanceAfter: newGold,
        relatedItemId: playerItemId,
      },
    });

    return {
      goldGained: sellPrice,
      newGold,
      soldItem: {
        templateId: template.id,
        name: template.name,
      },
    };
  });
}
