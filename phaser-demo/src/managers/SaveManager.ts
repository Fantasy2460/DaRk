import type { GameSave } from '../types';
import { api } from '../network/ApiClient';

const SAVE_KEY = 'dark_journey_save_v1';
const CHARACTER_ID_KEY = 'dj_character_id';

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
  /** 当前活跃的角色 ID */
  static getCharacterId(): string | null {
    return localStorage.getItem(CHARACTER_ID_KEY);
  }

  static setCharacterId(id: string | null) {
    if (id) {
      localStorage.setItem(CHARACTER_ID_KEY, id);
    } else {
      localStorage.removeItem(CHARACTER_ID_KEY);
    }
  }

  /** 仅从本地读取（同步，用于初始化兜底） */
  static loadLocal(): GameSave {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { ...defaultSave };
      const parsed = JSON.parse(raw) as Partial<GameSave>;
      return { ...defaultSave, ...parsed };
    } catch {
      return { ...defaultSave };
    }
  }

  /** 异步加载：优先从服务器读取，失败时回退本地 */
  static async load(): Promise<GameSave> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const { save } = await api.getCharacterSave(characterId);
        if (save) {
          const merged = { ...defaultSave, ...save };
          // 同步更新本地副本
          localStorage.setItem(SAVE_KEY, JSON.stringify(merged));
          return merged;
        }
      } catch (e) {
        console.warn('服务器读档失败，回退本地:', e);
      }
    }
    return SaveManager.loadLocal();
  }

  /** 异步保存：优先写服务器，同时保留本地副本 */
  static async save(data: GameSave): Promise<void> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        await api.saveCharacterData(characterId, data);
      } catch (e) {
        console.warn('服务器存档失败，仅保留本地:', e);
      }
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('本地存档失败:', e);
    }
  }

  static reset(): void {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(CHARACTER_ID_KEY);
    api.logout();
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
