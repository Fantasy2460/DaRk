import type { InventorySlot, Item, Consumable } from '../types';

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

  /** 添加物品 */
  addItem(item: Item | Consumable): boolean {
    const idx = this.findEmptySlot();
    if (idx === -1) return false;
    this.slots[idx] = { item };
    return true;
  }

  /** 移除物品 */
  removeItem(index: number): Item | Consumable | null {
    const item = this.slots[index]?.item ?? null;
    this.slots[index] = { item: null };
    return item;
  }

  /** 交换两个格子 */
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
}
