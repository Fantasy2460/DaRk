import type { InventorySlot, Item, Consumable } from '../types';
import { api, ApiError } from '../network/ApiClient';
import { SaveManager } from '../managers/SaveManager';

/**
 * 背包系统：与 EquipmentSystem 类似采用「同步内存修改 + 异步后端同步」语义。
 *
 * - addItem / removeItem / swapSlots：保持原同步签名（局内战斗高频调用，使用客户端预测）
 * - moveAsync / discardAsync / sortAsync：异步走 /inventory/move|discard|sort 端点
 * - useItemAsync：消耗品使用，走 /items/use（实际 effect 应用建议由 GameState.useConsumable 完成）
 *
 * 网络失败时，addItem 等同步操作的客户端预测保留（玩家看到拾取成功），
 * 后续 SaveManager.save() 整包同步会做最终一致性兜底。
 */
export class InventorySystem {
  slots: InventorySlot[];
  capacity: number;

  constructor(slots: InventorySlot[], capacity = 24) {
    this.capacity = capacity;
    // 兼容旧存档：如果传入的 slots 长度不足，自动补满空位
    if (slots.length < capacity) {
      this.slots = [...slots, ...Array.from({ length: capacity - slots.length }, () => ({ item: null }))];
    } else {
      this.slots = slots;
    }
  }

  /** 寻找第一个空位 */
  findEmptySlot(): number {
    return this.slots.findIndex((s) => !s.item);
  }

  /**
   * 添加物品 —— 同步客户端预测。
   * 成功返回 true。背包满时返回 false（拾取被拒绝）。
   * 不主动调后端：场景层应通过 reportKill / lootRoll 让后端决定 newItems，
   * 然后通过 GameState 注入 runInventory；本地拾取的预测在 SaveManager.save() 时做最终同步。
   */
  addItem(item: Item | Consumable): boolean {
    const idx = this.findEmptySlot();
    if (idx === -1) return false;
    this.slots[idx] = { item };
    return true;
  }

  /** 添加到指定格子，失败返回 false */
  addItemAt(index: number, item: Item | Consumable): boolean {
    if (index < 0 || index >= this.slots.length) return false;
    if (this.slots[index]?.item) return false;
    this.slots[index] = { item };
    return true;
  }

  /** 移除物品 */
  removeItem(index: number): Item | Consumable | null {
    const item = this.slots[index]?.item ?? null;
    this.slots[index] = { item: null };
    return item;
  }

  /** 交换两个格子（同步内存交换；如需后端持久化，调 moveAsync） */
  swapSlots(from: number, to: number): void {
    const temp = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to] = temp;
  }

  /** 是否有空位 */
  hasSpace(): boolean {
    return this.slots.some((s) => !s.item);
  }

  /** 获取所有物品 */
  getItems(): (Item | Consumable | null)[] {
    return this.slots.map((s) => s.item);
  }

  // ====== 异步：走后端 API ======

  /**
   * 异步：在背包内移动物品（持久化）。
   * 后端校验通过后再 patch 本地 slots；失败时本地不变并抛错。
   */
  async moveAsync(fromSlot: number, toSlot: number): Promise<boolean> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      // 离线：本地直接交换
      this.swapSlots(fromSlot, toSlot);
      return true;
    }
    try {
      await api.moveInventoryItem(characterId, { fromSlot, toSlot });
      SaveManager.markOnline();
      this.swapSlots(fromSlot, toSlot);
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
        // 网络失败：降级本地
        this.swapSlots(fromSlot, toSlot);
        return true;
      }
      console.warn('[InventorySystem] moveAsync 后端拒绝:', e);
      return false;
    }
  }

  /**
   * 异步：丢弃指定格子的物品。
   * 成功后本地 slots 置空。
   */
  async discardAsync(slot: number, count?: number): Promise<boolean> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken() && !SaveManager.isOffline()) {
      try {
        await api.discardInventoryItem(characterId, { slot, count });
        SaveManager.markOnline();
      } catch (e) {
        if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
          console.warn('[InventorySystem] discardAsync 后端拒绝:', e);
          return false;
        }
        // 网络失败 → 降级本地
      }
    }
    this.removeItem(slot);
    return true;
  }

  /**
   * 异步：整理背包（合并堆叠 + 去空位）。
   * 后端权威排序后会通过下一次 SaveManager.load() 反向同步本地，因此这里
   * 触发后只做粗略本地紧凑预测；如需精确结果需重新拉一次 snapshot。
   */
  async sortAsync(): Promise<boolean> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken() && !SaveManager.isOffline()) {
      try {
        const resp = await api.sortInventory(characterId);
        SaveManager.markOnline();
        // 如果后端直接返回新顺序，使用它
        const inv = resp?.inventory ?? resp?.cityInventory;
        if (Array.isArray(inv)) {
          for (let i = 0; i < this.slots.length; i++) {
            this.slots[i] = inv[i] ?? { item: null };
          }
          return true;
        }
      } catch (e) {
        if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
          console.warn('[InventorySystem] sortAsync 后端拒绝:', e);
          return false;
        }
      }
    }
    // 本地预测：把所有非空格紧凑到前面，保留顺序
    const items = this.slots.filter((s) => s.item).map((s) => s.item);
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = i < items.length ? { item: items[i]! } : { item: null };
    }
    return true;
  }

  /**
   * 异步：使用消耗品。
   * 注意：此方法仅触发后端，effect 解析与 RunState patch 由 GameState.useConsumable 处理。
   * 这里返回原始响应供调用方读取。
   */
  async useItemAsync(slotIndex: number, runId?: string): Promise<any> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) return null;
    try {
      const resp = await api.useItem(characterId, { slot: slotIndex, runId });
      SaveManager.markOnline();
      return resp;
    } catch (e) {
      if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
        console.warn('[InventorySystem] useItemAsync 后端拒绝:', e);
      }
      return null;
    }
  }
}
