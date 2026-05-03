import { api } from '../network/ApiClient';
import { SaveManager } from '../managers/SaveManager';

let characterId: string | null = null;

export function setAuditCharacterId(id: string | null) {
  characterId = id;
}

function getCharacterId(): string | null {
  return characterId || SaveManager.getCharacterId();
}

/** 发送审计日志（fire-and-forget，不阻塞游戏） */
export function logAudit(action: string, details?: Record<string, any>) {
  const charId = getCharacterId();
  if (!charId) {
    console.warn('[AuditLogger] 未找到角色ID，跳过日志:', action);
    return;
  }
  api.logAudit(action, charId, details).catch((e) => {
    console.warn('[AuditLogger] 发送日志失败:', action, e.message);
  });
}

/** 记录金币变化（fire-and-forget） */
export function logTransaction(
  type: string,
  amount: number,
  balanceAfter: number,
  extra?: { relatedItemId?: string; relatedRunId?: string }
) {
  const charId = getCharacterId();
  if (!charId) {
    console.warn('[AuditLogger] 未找到角色ID，跳过交易记录:', type);
    return;
  }
  api
    .logTransaction(charId, type, amount, balanceAfter, extra?.relatedItemId, extra?.relatedRunId)
    .catch((e) => {
      console.warn('[AuditLogger] 发送交易记录失败:', type, e.message);
    });
}

// ===== 快捷方法 =====

/** 装备掉落 */
export function logItemDrop(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  enemyName: string;
  enemyId: string;
  isBoss: boolean;
  depth: number;
  x: number;
  y: number;
  dropSource: 'dropTable' | 'bonusC' | 'bonusB' | 'bonusHp' | 'bonusMp' | 'serverRoll';
}) {
  logAudit('item_drop', params);
}

/** 拾取物品 */
export function logItemPickup(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  depth: number;
  x: number;
  y: number;
  slotIndex: number;
  source: 'ground_drop' | 'hp_orb' | 'mp_orb';
}) {
  logAudit('item_pickup', params);
}

/** 装备更换 */
export function logEquipChange(params: {
  operation: 'equip' | 'unequip';
  slot: string;
  itemName: string;
  itemId: string;
  itemRarity: string;
  oldItemName?: string;
  oldItemId?: string;
  oldItemRarity?: string;
  depth?: number;
  location: 'forest' | 'city';
}) {
  logAudit('equip_change', params);
}

/** 商店购买 */
export function logShopBuy(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  shopType: string;
  price: number;
  goldBefore: number;
  goldAfter: number;
  slotIndex: number;
}) {
  logAudit('shop_buy', params);
  logTransaction('shop_buy', -params.price, params.goldAfter, {
    relatedItemId: params.itemId,
  });
}

/** 消耗品使用 */
export function logConsumableUse(params: {
  itemName: string;
  itemId: string;
  effectType: string;
  depth?: number;
  slotIndex: number;
  hpBefore?: number;
  hpAfter?: number;
  mpBefore?: number;
  mpAfter?: number;
}) {
  logAudit('consumable_use', params);
}

/** 死亡记录 */
export function logDeath(params: {
  depth: number;
  enemiesKilled: number;
  elapsedTimeSec: number;
  cause?: string;
}) {
  logAudit('player_death', params);
}

/** 撤离记录 */
export function logExtract(params: {
  depth: number;
  enemiesKilled: number;
  elapsedTimeSec: number;
  itemsCarried: number;
}) {
  logAudit('player_extract', params);
}

/** 进入下一层 */
export function logGoDeeper(params: {
  fromDepth: number;
  toDepth: number;
  enemiesKilledSoFar: number;
}) {
  logAudit('go_deeper', params);
}

/** 出售物品 */
export function logSell(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  price: number;
  goldBefore: number;
  goldAfter: number;
  location: 'forest' | 'city';
}) {
  logAudit('item_sell', params);
  logTransaction('item_sell', params.price, params.goldAfter, {
    relatedItemId: params.itemId,
  });
}

/** 丢弃物品 */
export function logDiscard(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  location: 'forest' | 'city';
}) {
  logAudit('item_discard', params);
}

/** 玩家升级 */
export function logLevelUp(params: {
  oldLevel: number;
  newLevel: number;
  statsAwarded: number;
}) {
  logAudit('player_level_up', params);
}

/** 开始探险 */
export function logStartRun(params: {
  classType: string;
  depth: number;
}) {
  logAudit('run_start', params);
}
