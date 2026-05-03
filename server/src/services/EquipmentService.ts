/**
 * EquipmentService（TASK-BE-EQUIP-INVENTORY）
 *
 * 处理装备穿戴 / 卸下的事务化逻辑。
 *
 * 关键约定：
 * - 7 个有效装备槽位：weapon / helmet / armor / pants / shoes / accessory / offhand
 * - 主城装备：PlayerItem.runId = null && location = 'equipped' && equippedSlot = <slot>
 * - 局内装备：PlayerItem.runId = <runId> && location = 'equipped' && equippedSlot = <slot>
 *   （本期支持局内换装，但调用方需在请求中明确传 runId 才会进入局内分支；
 *    并且必须保证 PlayerItem.runId 与请求 runId 一致，否则视为越权。）
 * - equip 时若目标槽已有装备：旧装备 equipped:false（location='inventory'，equippedSlot=null），
 *   并尝试给它分配一个空闲 slotPosition。如果背包已满，本端点拒绝换装并回滚。
 * - unequip：把装备恢复到背包，要求背包未满（含已有 inventory 物品 < 24）。
 *
 * 防作弊：
 * - 跨用户操作 → 由 route 层 authMiddleware + getCharacterOwner 完成；本服务不再校验。
 * - 物品归属错误（playerItemId 不属于该角色） → 抛 403 + 写 EQUIP_ITEM_OWNERSHIP flag。
 * - 槽位不匹配（如鞋戴武器槽） → 抛 400 + 写 EQUIP_SLOT_MISMATCH flag。
 */

import { prisma } from '../config/database';
import { ItemSlot } from '../types/game';
import { flagAnomaly } from './AntiCheatService';
import { createAuditLog } from './AuditService';
import { recalculate, FinalStats } from './StatsService';

const VALID_SLOTS: ItemSlot[] = [
  'weapon', 'helmet', 'armor', 'pants', 'shoes', 'accessory', 'offhand',
];
export const INVENTORY_CAPACITY = 24;

export function isValidSlot(s: any): s is ItemSlot {
  return typeof s === 'string' && (VALID_SLOTS as string[]).includes(s);
}

function serializeItem(it: any) {
  return {
    id: it.templateId,
    instanceId: it.id,
    name: it.template?.name || it.templateId,
    rarity: it.rarity || it.template?.rarity || 'C',
    slot: it.equippedSlot || it.template?.slot || 'weapon',
    stats: it.statsJson ? safeJsonParse(it.statsJson) : {},
    description: it.template?.description || '',
    stackCount: it.stackCount ?? 1,
  };
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * 收集当前角色主城装备表（不含局内）。
 */
async function loadCityEquipment(characterId: string) {
  const items = await prisma.playerItem.findMany({
    where: { characterId, runId: null, location: 'equipped' },
    include: { template: true },
  });
  const equipment: Record<string, any | null> = {
    weapon: null, helmet: null, armor: null, pants: null,
    shoes: null, accessory: null, offhand: null,
  };
  for (const it of items) {
    if (it.equippedSlot) equipment[it.equippedSlot] = serializeItem(it);
  }
  return equipment;
}

/**
 * 找一个空闲背包槽位（0..23），找不到返回 -1。
 * 用于「替换装备时把旧装备放回背包」。
 */
async function findFreeInventorySlot(characterId: string, runId: string | null): Promise<number> {
  const used = await prisma.playerItem.findMany({
    where: {
      characterId,
      runId,
      location: 'inventory',
    },
    select: { slotPosition: true },
  });
  const usedSet = new Set<number>();
  for (const u of used) {
    if (typeof u.slotPosition === 'number') usedSet.add(u.slotPosition);
  }
  for (let i = 0; i < INVENTORY_CAPACITY; i++) {
    if (!usedSet.has(i)) return i;
  }
  return -1;
}

export interface EquipInput {
  playerItemId: string;
  slot: ItemSlot;
  runId?: string | null;
}

export interface EquipResult {
  stats: FinalStats;
  equipment: Record<string, any | null>;
  replacedItem: any | null;
}

export async function equipItem(
  userId: string,
  characterId: string,
  input: EquipInput,
  clientIp?: string
): Promise<EquipResult> {
  if (!input.playerItemId || !isValidSlot(input.slot)) {
    const err: any = new Error('缺少 playerItemId 或 slot 非法');
    err.statusCode = 400;
    throw err;
  }

  // 加载并校验目标 PlayerItem
  const item = await prisma.playerItem.findUnique({
    where: { id: input.playerItemId },
    include: { template: true },
  });
  if (!item) {
    const err: any = new Error('物品不存在');
    err.statusCode = 404;
    throw err;
  }
  if (item.characterId !== characterId) {
    await flagAnomaly({
      reason: 'EQUIP_ITEM_OWNERSHIP',
      characterId,
      details: {
        playerItemId: input.playerItemId,
        actualOwner: item.characterId,
      },
      confidence: 80,
    });
    const err: any = new Error('物品不属于该角色');
    err.statusCode = 403;
    throw err;
  }
  if (item.template.type !== 'equipment') {
    const err: any = new Error('该物品不是装备');
    err.statusCode = 400;
    throw err;
  }
  if (item.template.slot && item.template.slot !== input.slot) {
    await flagAnomaly({
      reason: 'EQUIP_SLOT_MISMATCH',
      characterId,
      details: {
        playerItemId: input.playerItemId,
        templateSlot: item.template.slot,
        requestedSlot: input.slot,
      },
      confidence: 60,
    });
    const err: any = new Error(
      `装备槽位不匹配：期望 ${item.template.slot}，请求 ${input.slot}`
    );
    err.statusCode = 400;
    throw err;
  }

  // 局内换装 vs 主城换装
  const reqRunId = input.runId ?? null;
  const itemRunId = item.runId ?? null;
  if (reqRunId !== itemRunId) {
    await flagAnomaly({
      reason: 'EQUIP_RUN_MISMATCH',
      characterId,
      details: {
        playerItemId: input.playerItemId,
        itemRunId,
        requestRunId: reqRunId,
      },
      confidence: 50,
    });
    const err: any = new Error('runId 与物品所属上下文不一致');
    err.statusCode = 400;
    throw err;
  }

  // 事务：替换装备
  const replacedItem = await prisma.$transaction(async (tx) => {
    // 找当前同槽位的旧装备
    const oldEquipped = await tx.playerItem.findFirst({
      where: {
        characterId,
        runId: itemRunId,
        location: 'equipped',
        equippedSlot: input.slot,
      },
      include: { template: true },
    });

    let replaced: any | null = null;
    if (oldEquipped && oldEquipped.id !== item.id) {
      // 给旧装备腾位置
      const freeSlot = await findFreeInventorySlot(characterId, itemRunId);
      if (freeSlot < 0) {
        const err: any = new Error('背包已满，无法卸下当前装备');
        err.statusCode = 400;
        throw err;
      }
      await tx.playerItem.update({
        where: { id: oldEquipped.id },
        data: {
          location: 'inventory',
          equippedSlot: null,
          slotPosition: freeSlot,
        },
      });
      replaced = serializeItem(oldEquipped);
    }

    // 把目标物品穿上
    if (!(oldEquipped && oldEquipped.id === item.id)) {
      await tx.playerItem.update({
        where: { id: item.id },
        data: {
          location: 'equipped',
          equippedSlot: input.slot,
          slotPosition: null,
        },
      });
    }

    return replaced;
  });

  // 重算 stats（仅对主城操作有意义；局内换装不写 CharacterStats，但仍然返回让前端展示）
  const stats = await recalculate(characterId);
  const equipment = await loadCityEquipment(characterId);

  await createAuditLog({
    userId,
    characterId,
    action: 'EQUIP',
    details: {
      playerItemId: input.playerItemId,
      slot: input.slot,
      runId: itemRunId,
      replacedItemId: replacedItem?.instanceId ?? null,
    },
    clientIp,
  }).catch(() => {});

  return { stats, equipment, replacedItem };
}

export interface UnequipInput {
  slot: ItemSlot;
  runId?: string | null;
}

export interface UnequipResult {
  stats: FinalStats;
  equipment: Record<string, any | null>;
  unequippedItem: any | null;
}

export async function unequipItem(
  userId: string,
  characterId: string,
  input: UnequipInput,
  clientIp?: string
): Promise<UnequipResult> {
  if (!isValidSlot(input.slot)) {
    const err: any = new Error('slot 非法');
    err.statusCode = 400;
    throw err;
  }

  const reqRunId = input.runId ?? null;

  const unequipped = await prisma.$transaction(async (tx) => {
    const equipped = await tx.playerItem.findFirst({
      where: {
        characterId,
        runId: reqRunId,
        location: 'equipped',
        equippedSlot: input.slot,
      },
      include: { template: true },
    });
    if (!equipped) {
      const err: any = new Error('该槽位当前无装备');
      err.statusCode = 400;
      throw err;
    }

    // 背包容量校验（只统计同 runId 的 inventory 物品）
    const invCount = await tx.playerItem.count({
      where: {
        characterId,
        runId: reqRunId,
        location: 'inventory',
      },
    });
    if (invCount >= INVENTORY_CAPACITY) {
      const err: any = new Error('背包已满，无法卸下装备');
      err.statusCode = 400;
      err.code = 'INVENTORY_FULL';
      throw err;
    }

    const freeSlot = await findFreeInventorySlot(characterId, reqRunId);
    if (freeSlot < 0) {
      const err: any = new Error('背包已满，无法卸下装备');
      err.statusCode = 400;
      err.code = 'INVENTORY_FULL';
      throw err;
    }

    await tx.playerItem.update({
      where: { id: equipped.id },
      data: {
        location: 'inventory',
        equippedSlot: null,
        slotPosition: freeSlot,
      },
    });

    return serializeItem(equipped);
  });

  const stats = await recalculate(characterId);
  const equipment = await loadCityEquipment(characterId);

  await createAuditLog({
    userId,
    characterId,
    action: 'UNEQUIP',
    details: {
      slot: input.slot,
      runId: reqRunId,
      playerItemId: unequipped?.instanceId ?? null,
    },
    clientIp,
  }).catch(() => {});

  return { stats, equipment, unequippedItem: unequipped };
}
