/**
 * InventoryService（TASK-BE-EQUIP-INVENTORY）
 *
 * 处理背包内物品的整理、移动、丢弃、使用消耗品。
 *
 * 关键约定：
 * - 主城背包：PlayerItem.runId = null && location = 'inventory'，slotPosition ∈ [0, 23]
 * - 局内背包：PlayerItem.runId = <runId> && location = 'inventory'，本期使用同一套接口（按需传 runId）
 * - move：交换两个 slotPosition；如果目标位置为空，单纯改自己的 slotPosition；
 *         本期前端 ApiClient 用 { fromSlot, toSlot }；任务文档建议 { playerItemId, toIndex }，
 *         本服务两种入参都接受。
 * - sort：按策略（rarity / type / name）重排 slotPosition。装备物品（location='equipped'）不动。
 * - discard：删除一个 PlayerItem（仅 location='inventory'，equipped 物品不允许丢弃）。
 *           暂只支持 quantity===1（与卖出端点对齐）。
 * - useItem：扣 stackCount，返回 effect 让前端 patch 到 RunState（HP/MP/Buff）。
 *
 * 防作弊：
 * - 高频使用同一物品（< 200ms） → ITEM_USE_RATE
 * - 跨用户操作 → 由 route 层 auth 拦截
 * - 物品归属错误 → INVENTORY_ITEM_OWNERSHIP
 */

import { prisma } from '../config/database';
import { flagAnomaly } from './AntiCheatService';
import { createAuditLog } from './AuditService';

export const INVENTORY_CAPACITY = 24;

const RARITY_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

// ====================== move ======================

export interface MoveInput {
  // 主 Agent 任务文档命名
  playerItemId?: string;
  toIndex?: number;
  // ApiClient 现有契约
  fromSlot?: number;
  toSlot?: number;
  runId?: string | null;
}

export async function moveInventoryItem(
  userId: string,
  characterId: string,
  input: MoveInput,
  clientIp?: string
): Promise<{ success: true }> {
  const reqRunId = input.runId ?? null;

  let fromIndex: number | null = null;
  let toIndex: number | null = null;
  let playerItemId: string | null = input.playerItemId ?? null;

  if (typeof input.toIndex === 'number') toIndex = input.toIndex;
  if (typeof input.toSlot === 'number') toIndex = input.toSlot;
  if (typeof input.fromSlot === 'number') fromIndex = input.fromSlot;

  if (toIndex === null || toIndex < 0 || toIndex >= INVENTORY_CAPACITY) {
    const err: any = new Error('toIndex / toSlot 非法');
    err.statusCode = 400;
    throw err;
  }

  // 找到源物品
  let source: { id: string; slotPosition: number | null } | null = null;
  if (playerItemId) {
    const it = await prisma.playerItem.findUnique({
      where: { id: playerItemId },
      select: { id: true, characterId: true, runId: true, location: true, slotPosition: true },
    });
    if (!it) {
      const err: any = new Error('物品不存在');
      err.statusCode = 404;
      throw err;
    }
    if (it.characterId !== characterId) {
      await flagAnomaly({
        reason: 'INVENTORY_ITEM_OWNERSHIP',
        characterId,
        details: { playerItemId, actualOwner: it.characterId },
        confidence: 80,
      });
      const err: any = new Error('物品不属于该角色');
      err.statusCode = 403;
      throw err;
    }
    if ((it.runId ?? null) !== reqRunId || it.location !== 'inventory') {
      const err: any = new Error('物品不在请求的背包上下文');
      err.statusCode = 400;
      throw err;
    }
    source = { id: it.id, slotPosition: it.slotPosition };
  } else if (fromIndex !== null) {
    const it = await prisma.playerItem.findFirst({
      where: {
        characterId,
        runId: reqRunId,
        location: 'inventory',
        slotPosition: fromIndex,
      },
      select: { id: true, slotPosition: true },
    });
    if (!it) {
      // 源位置为空，无可移动 → 静默成功
      return { success: true };
    }
    source = { id: it.id, slotPosition: it.slotPosition };
  } else {
    const err: any = new Error('缺少 playerItemId / fromSlot');
    err.statusCode = 400;
    throw err;
  }

  if (source.slotPosition === toIndex) {
    return { success: true };
  }

  // 执行交换
  await prisma.$transaction(async (tx) => {
    const target = await tx.playerItem.findFirst({
      where: {
        characterId,
        runId: reqRunId,
        location: 'inventory',
        slotPosition: toIndex!,
      },
      select: { id: true },
    });

    if (target && target.id !== source!.id) {
      // 先把目标物品挪到一个临时无效位置（-1），避免唯一约束（虽然没建唯一索引，但保险起见）
      await tx.playerItem.update({
        where: { id: target.id },
        data: { slotPosition: -1 },
      });
      await tx.playerItem.update({
        where: { id: source!.id },
        data: { slotPosition: toIndex! },
      });
      await tx.playerItem.update({
        where: { id: target.id },
        data: { slotPosition: source!.slotPosition },
      });
    } else {
      await tx.playerItem.update({
        where: { id: source!.id },
        data: { slotPosition: toIndex! },
      });
    }
  });

  await createAuditLog({
    userId,
    characterId,
    action: 'INVENTORY_MOVE',
    details: {
      playerItemId: source.id,
      fromIndex: source.slotPosition,
      toIndex,
      runId: reqRunId,
    },
    clientIp,
  }).catch(() => {});

  return { success: true };
}

// ====================== sort ======================

export interface SortInput {
  strategy?: 'rarity' | 'type' | 'name';
  runId?: string | null;
}

export async function sortInventory(
  userId: string,
  characterId: string,
  input: SortInput,
  clientIp?: string
): Promise<{ sorted: true; strategy: string }> {
  const strategy = input.strategy || 'rarity';
  const reqRunId = input.runId ?? null;

  const items = await prisma.playerItem.findMany({
    where: {
      characterId,
      runId: reqRunId,
      location: 'inventory',
    },
    include: { template: true },
  });

  if (items.length === 0) return { sorted: true, strategy };

  // 排序
  const sorted = [...items].sort((a, b) => {
    if (strategy === 'rarity') {
      const ra = RARITY_ORDER[a.rarity || a.template?.rarity || 'C'] ?? 99;
      const rb = RARITY_ORDER[b.rarity || b.template?.rarity || 'C'] ?? 99;
      if (ra !== rb) return ra - rb;
      // 次级：装备/消耗品分开
      const ta = a.template?.type || 'equipment';
      const tb = b.template?.type || 'equipment';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.template?.name || a.templateId).localeCompare(b.template?.name || b.templateId);
    } else if (strategy === 'type') {
      const ta = a.template?.type || 'equipment';
      const tb = b.template?.type || 'equipment';
      if (ta !== tb) return ta < tb ? -1 : 1;
      const ra = RARITY_ORDER[a.rarity || a.template?.rarity || 'C'] ?? 99;
      const rb = RARITY_ORDER[b.rarity || b.template?.rarity || 'C'] ?? 99;
      return ra - rb;
    } else {
      // name
      const na = a.template?.name || a.templateId;
      const nb = b.template?.name || b.templateId;
      return na.localeCompare(nb);
    }
  });

  // 重排 slotPosition：先全部置 -1（避免唯一性冲突），然后逐个赋值
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < sorted.length; i++) {
      await tx.playerItem.update({
        where: { id: sorted[i].id },
        data: { slotPosition: -(i + 1) },
      });
    }
    for (let i = 0; i < sorted.length; i++) {
      await tx.playerItem.update({
        where: { id: sorted[i].id },
        data: { slotPosition: i },
      });
    }
  });

  await createAuditLog({
    userId,
    characterId,
    action: 'INVENTORY_SORT',
    details: { strategy, count: sorted.length, runId: reqRunId },
    clientIp,
  }).catch(() => {});

  return { sorted: true, strategy };
}

// ====================== discard ======================

export interface DiscardInput {
  // 主 Agent 任务文档：{ playerItemId, quantity? }
  playerItemId?: string;
  quantity?: number;
  // ApiClient 契约：{ slot, count? }
  slot?: number;
  count?: number;
  runId?: string | null;
}

export async function discardInventoryItem(
  userId: string,
  characterId: string,
  input: DiscardInput,
  clientIp?: string
): Promise<{ discarded: true; templateId: string }> {
  const reqRunId = input.runId ?? null;
  const quantity = input.quantity ?? input.count ?? 1;
  if (quantity !== 1) {
    const err: any = new Error('当前仅支持 quantity=1 的丢弃');
    err.statusCode = 400;
    throw err;
  }

  let target: { id: string; templateId: string; characterId: string; runId: string | null; location: string } | null = null;

  if (input.playerItemId) {
    const it = await prisma.playerItem.findUnique({
      where: { id: input.playerItemId },
      select: { id: true, templateId: true, characterId: true, runId: true, location: true },
    });
    if (!it) {
      const err: any = new Error('物品不存在');
      err.statusCode = 404;
      throw err;
    }
    target = it;
  } else if (typeof input.slot === 'number') {
    const it = await prisma.playerItem.findFirst({
      where: {
        characterId,
        runId: reqRunId,
        location: 'inventory',
        slotPosition: input.slot,
      },
      select: { id: true, templateId: true, characterId: true, runId: true, location: true },
    });
    if (!it) {
      const err: any = new Error('指定槽位为空');
      err.statusCode = 400;
      throw err;
    }
    target = it;
  } else {
    const err: any = new Error('缺少 playerItemId / slot');
    err.statusCode = 400;
    throw err;
  }

  if (target.characterId !== characterId) {
    await flagAnomaly({
      reason: 'INVENTORY_ITEM_OWNERSHIP',
      characterId,
      details: { playerItemId: target.id, actualOwner: target.characterId, action: 'DISCARD' },
      confidence: 80,
    });
    const err: any = new Error('物品不属于该角色');
    err.statusCode = 403;
    throw err;
  }
  if (target.location !== 'inventory') {
    const err: any = new Error('该物品当前已装备，请先卸下再丢弃');
    err.statusCode = 400;
    throw err;
  }

  await prisma.playerItem.delete({ where: { id: target.id } });

  await createAuditLog({
    userId,
    characterId,
    action: 'DISCARD',
    details: {
      playerItemId: target.id,
      templateId: target.templateId,
      runId: reqRunId,
    },
    clientIp,
  }).catch(() => {});

  return { discarded: true, templateId: target.templateId };
}

// ====================== useItem ======================

export interface UseItemInput {
  // 主 Agent 任务文档：{ playerItemId, runId? }
  playerItemId?: string;
  // ApiClient 契约：{ slot, runId? }
  slot?: number;
  runId?: string | null;
}

export interface UseItemEffect {
  type: 'instantHp' | 'instantMp' | 'slowHp' | 'slowMp' | 'vision';
  value: number;
  duration?: number;
  // 便捷字段（前端直接用）：
  hp?: number;
  mp?: number;
  buffs?: Array<{
    type: 'slowHp' | 'slowMp' | 'vision';
    value: number;
    duration: number;
  }>;
}

export interface UseItemResult {
  effect: UseItemEffect;
  remainingStackCount: number;
  consumed: boolean;
  templateId: string;
}

const ITEM_USE_RATE_THRESHOLD_MS = 200;
const lastUseByCharItem = new Map<string, number>();

export async function useItem(
  userId: string,
  characterId: string,
  input: UseItemInput,
  clientIp?: string
): Promise<UseItemResult> {
  const reqRunId = input.runId ?? null;

  // 找到目标
  let item: any = null;
  if (input.playerItemId) {
    item = await prisma.playerItem.findUnique({
      where: { id: input.playerItemId },
      include: { template: true },
    });
  } else if (typeof input.slot === 'number') {
    item = await prisma.playerItem.findFirst({
      where: {
        characterId,
        runId: reqRunId,
        location: 'inventory',
        slotPosition: input.slot,
      },
      include: { template: true },
    });
  }

  if (!item) {
    const err: any = new Error('物品不存在或槽位为空');
    err.statusCode = 404;
    throw err;
  }
  if (item.characterId !== characterId) {
    await flagAnomaly({
      reason: 'INVENTORY_ITEM_OWNERSHIP',
      characterId,
      details: { playerItemId: item.id, actualOwner: item.characterId, action: 'USE' },
      confidence: 80,
    });
    const err: any = new Error('物品不属于该角色');
    err.statusCode = 403;
    throw err;
  }
  if (item.template?.type !== 'consumable') {
    const err: any = new Error('该物品不是消耗品');
    err.statusCode = 400;
    throw err;
  }

  // 高频使用检测
  const rateKey = `${characterId}::${item.id}`;
  const now = Date.now();
  const last = lastUseByCharItem.get(rateKey);
  if (last && now - last < ITEM_USE_RATE_THRESHOLD_MS) {
    await flagAnomaly({
      reason: 'ITEM_USE_RATE',
      characterId,
      details: {
        playerItemId: item.id,
        templateId: item.templateId,
        deltaMs: now - last,
        thresholdMs: ITEM_USE_RATE_THRESHOLD_MS,
      },
      confidence: 50,
    });
  }
  lastUseByCharItem.set(rateKey, now);

  // 解析效果（与前端 Consumable 接口一致：type/value/duration）
  const effectType = (item.template.consumableType || '') as
    'instantHp' | 'instantMp' | 'slowHp' | 'slowMp' | 'vision';
  const effectValue = item.template.consumableValue ?? 0;
  const effectDuration = item.template.consumableDuration ?? undefined;

  if (!effectType) {
    const err: any = new Error('消耗品配置缺少 consumableType');
    err.statusCode = 500;
    throw err;
  }

  const effect: UseItemEffect = {
    type: effectType,
    value: effectValue,
    duration: effectDuration,
  };
  if (effectType === 'instantHp') effect.hp = effectValue;
  if (effectType === 'instantMp') effect.mp = effectValue;
  if (effectType === 'slowHp' || effectType === 'slowMp' || effectType === 'vision') {
    effect.buffs = [
      {
        type: effectType,
        value: effectValue,
        duration: effectDuration ?? 0,
      },
    ];
  }

  // 扣物品：stackCount > 1 → 减 1；否则删除
  let remainingStackCount = 0;
  let consumed = false;
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.playerItem.findUnique({ where: { id: item.id } });
    if (!fresh) {
      const err: any = new Error('物品已不存在');
      err.statusCode = 404;
      throw err;
    }
    if (fresh.stackCount > 1) {
      const updated = await tx.playerItem.update({
        where: { id: fresh.id },
        data: { stackCount: { decrement: 1 } },
      });
      remainingStackCount = updated.stackCount;
    } else {
      await tx.playerItem.delete({ where: { id: fresh.id } });
      remainingStackCount = 0;
      consumed = true;
    }
  });

  await createAuditLog({
    userId,
    characterId,
    action: 'USE_CONSUMABLE',
    details: {
      playerItemId: item.id,
      templateId: item.templateId,
      effectType,
      effectValue,
      effectDuration,
      runId: reqRunId,
      remainingStackCount,
      consumed,
    },
    clientIp,
  }).catch(() => {});

  return {
    effect,
    remainingStackCount,
    consumed,
    templateId: item.templateId,
  };
}
