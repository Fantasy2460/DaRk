import type { EquipmentSet, Item, Stats } from '../types';
import { api, ApiError } from '../network/ApiClient';
import { SaveManager } from '../managers/SaveManager';

/**
 * 装备系统：支持「同步内存修改 + 异步后端同步」两种调用语义。
 *
 * 既有调用方（ForestScene / MainCityScene）使用同步语义：
 *   const old = eq.equip(item);
 *   const old = eq.unequip(slot);
 *
 * 改造后这些同步方法在更新内存的同时 fire-and-forget 调一次后端 API，
 * 失败由 SaveManager 标志位捕获并降级为离线模式。
 *
 * 如调用方需要等待服务端确认（用于强一致 UI），可调 equipAsync / unequipAsync。
 */
export class EquipmentSystem {
  equipment: EquipmentSet;

  constructor(equipment: EquipmentSet) {
    this.equipment = equipment;
  }

  /** 同步穿戴装备：内存即时更新，并 fire-and-forget 调 API */
  equip(item: Item): Item | null {
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    void this.syncEquip(item);
    return old;
  }

  /** 同步卸下装备：内存即时更新，并 fire-and-forget 调 API */
  unequip(slot: keyof EquipmentSet): Item | null {
    const old = this.equipment[slot];
    this.equipment[slot] = null;
    void this.syncUnequip(slot);
    return old;
  }

  /** 异步穿戴：等待服务端确认，返回服务端权威 stats（如有） */
  async equipAsync(item: Item): Promise<{ old: Item | null; stats?: Partial<Stats> }> {
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    const resp = await this.syncEquip(item);
    return { old, stats: resp?.stats };
  }

  /** 异步卸下：等待服务端确认 */
  async unequipAsync(slot: keyof EquipmentSet): Promise<{ old: Item | null; stats?: Partial<Stats> }> {
    const old = this.equipment[slot];
    this.equipment[slot] = null;
    const resp = await this.syncUnequip(slot);
    return { old, stats: resp?.stats };
  }

  /** 计算当前总属性加成 */
  getTotalStats(): Partial<Stats> {
    const total: Partial<Stats> = {};
    const slots = Object.values(this.equipment);
    for (const item of slots) {
      if (!item) continue;
      for (const [key, value] of Object.entries(item.stats)) {
        const k = key as keyof Stats;
        const v = value as number | undefined;
        total[k] = (total[k] ?? 0) + (v ?? 0);
      }
    }
    return total;
  }

  /** 获取某部位的装备 */
  getSlot(slot: keyof EquipmentSet): Item | null {
    return this.equipment[slot];
  }

  // ====== 后端同步（私有） ======

  private async syncEquip(item: Item): Promise<{ stats?: Partial<Stats> } | null> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) return null;
    // playerItemId：旧前端 Item 类型没有 playerItemId 字段；当 Item 来自后端时 .id 即为 PlayerItem id；
    // 对纯 fallback Item，请求会被后端拒绝，降级到本地内存。
    const playerItemId = (item as any).playerItemId ?? item.id;
    if (!playerItemId) return null;
    try {
      const resp = await api.equipItem(characterId, { slot: item.slot, playerItemId });
      SaveManager.markOnline();
      return resp ?? null;
    } catch (e) {
      if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
        console.warn('[EquipmentSystem] equip 后端调用失败，仅本地内存生效:', e);
      }
      return null;
    }
  }

  private async syncUnequip(slot: keyof EquipmentSet): Promise<{ stats?: Partial<Stats> } | null> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) return null;
    try {
      const resp = await api.unequipItem(characterId, { slot });
      SaveManager.markOnline();
      return resp ?? null;
    } catch (e) {
      if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
        console.warn('[EquipmentSystem] unequip 后端调用失败，仅本地内存生效:', e);
      }
      return null;
    }
  }
}
