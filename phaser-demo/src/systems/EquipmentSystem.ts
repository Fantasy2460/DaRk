import type { EquipmentSet, Item, Stats } from '../types';

export class EquipmentSystem {
  equipment: EquipmentSet;

  constructor(equipment: EquipmentSet) {
    this.equipment = equipment;
  }

  /** 穿戴装备，返回被替换的旧装备 */
  equip(item: Item): Item | null {
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    return old;
  }

  /** 卸下装备 */
  unequip(slot: keyof EquipmentSet): Item | null {
    const old = this.equipment[slot];
    this.equipment[slot] = null;
    return old;
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
}
