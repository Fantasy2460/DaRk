import type { Item, Consumable } from '../types';
import { ITEMS as LOCAL_ITEMS, CONSUMABLES as LOCAL_CONSUMABLES } from '../data/items';
import { api } from '../network/ApiClient';

class ItemDataManagerClass {
  private items: Item[] = [...LOCAL_ITEMS];
  private consumables: Consumable[] = [...LOCAL_CONSUMABLES];
  private loaded = false;

  async load(): Promise<void> {
    try {
      const { items, consumables } = await api.getItems();
      if (items) this.items = items;
      if (consumables) this.consumables = consumables;
      this.loaded = true;
      console.log(`[ItemDataManager] 已从服务器加载 ${this.items.length} 件装备, ${this.consumables.length} 种消耗品`);
    } catch (e) {
      console.warn('[ItemDataManager] 从服务器加载物品失败，使用本地数据:', e);
      this.items = [...LOCAL_ITEMS];
      this.consumables = [...LOCAL_CONSUMABLES];
    }
  }

  getItemById(id: string): Item | undefined {
    return this.items.find((i) => i.id === id);
  }

  getConsumableById(id: string): Consumable | undefined {
    return this.consumables.find((c) => c.id === id);
  }

  findById(id: string): Item | Consumable | undefined {
    return this.getItemById(id) ?? this.getConsumableById(id);
  }

  getAllItems(): Item[] {
    return this.items;
  }

  getAllConsumables(): Consumable[] {
    return this.consumables;
  }

  getItemsByRarity(rarity: string): Item[] {
    return this.items.filter((i) => i.rarity === rarity);
  }
}

export const ItemDataManager = new ItemDataManagerClass();
