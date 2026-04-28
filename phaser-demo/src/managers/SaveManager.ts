import type { GameSave } from '../types';

const SAVE_KEY = 'dark_journey_save_v1';

export const defaultSave: GameSave = {
  selectedClass: null,
  cityInventory: Array.from({ length: 24 }, () => ({ item: null })),
  cityEquipment: {
    weapon: null,
    helmet: null,
    armor: null,
    pants: null,
    shoes: null,
    accessory: null,
    offhand: null,
  },
  talentProgress: {},
  gold: 0,
  bestiary: [],
  equipmentCodex: [],
  level: 1,
  exp: 0,
  skillLevels: {},
};

export class SaveManager {
  static load(): GameSave {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { ...defaultSave };
      const parsed = JSON.parse(raw) as Partial<GameSave>;
      return { ...defaultSave, ...parsed };
    } catch {
      return { ...defaultSave };
    }
  }

  static save(data: GameSave): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('存档失败:', e);
    }
  }

  static reset(): void {
    localStorage.removeItem(SAVE_KEY);
  }

  static exportJson(data: GameSave): string {
    return JSON.stringify(data, null, 2);
  }

  static importJson(json: string): GameSave | null {
    try {
      const parsed = JSON.parse(json);
      return { ...defaultSave, ...parsed };
    } catch {
      return null;
    }
  }
}
