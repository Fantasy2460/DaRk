import type { GameSave } from '../types';
import { api, ApiError } from '../network/ApiClient';
import { setAuditCharacterId } from '../utils/AuditLogger';

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
  skillPoints: 0,
};

/**
 * 离线状态标志：在 ApiClient 触发网络失败回调后置为 true。
 * 后续业务调用据此走本地兜底路径；待下一次成功调用后由调用方 reset。
 */
let _isOffline = false;

/** 简单节流：连续多次 save() 在 throttleMs 内合并为一次写盘 */
const SAVE_THROTTLE_MS = 500;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: GameSave | null = null;

// ApiClient 网络失败钩子：一次失败标记为离线，由后续成功调用复位
api.onNetworkFailure((info) => {
  // 仅 timeout / network 视为离线，HTTP 4xx/5xx 不视为掉线
  if (info.kind === 'timeout' || info.kind === 'network') {
    _isOffline = true;
  }
});

export class SaveManager {
  /** 当前是否处于离线模式（被 ApiClient 网络失败钩子置位） */
  static isOffline(): boolean {
    return _isOffline;
  }

  /** 调用方在 API 调用成功后可手动复位离线标志 */
  static markOnline(): void {
    _isOffline = false;
  }

  /** 当前活跃的角色 ID */
  static getCharacterId(): string | null {
    return localStorage.getItem(CHARACTER_ID_KEY);
  }

  static setCharacterId(id: string | null) {
    if (id) {
      localStorage.setItem(CHARACTER_ID_KEY, id);
      setAuditCharacterId(id);
    } else {
      localStorage.removeItem(CHARACTER_ID_KEY);
      setAuditCharacterId(null);
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

  /**
   * 异步加载：优先从服务器 snapshot 端点读取（包含完整 GameSave 兼容字段），
   * 失败时回退到 /characters/:id/save 旧端点，再失败回退本地。
   */
  static async load(): Promise<GameSave> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      // 优先：snapshot
      try {
        const resp = await api.getSnapshot(characterId);
        // BE-002 约定：返回 { snapshot: {...} } 或者直接是 GameSave 兼容对象
        const snapshot = resp?.snapshot ?? resp?.save ?? resp;
        if (snapshot && typeof snapshot === 'object') {
          const merged: GameSave = SaveManager.mergeSnapshot(snapshot);
          SaveManager.markOnline();
          try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
          return merged;
        }
      } catch (e) {
        if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
          _isOffline = true;
        } else {
          console.warn('[SaveManager] snapshot 加载失败，尝试旧端点:', e);
        }
      }

      // 回退：旧 /save 端点
      try {
        const { save } = await api.getCharacterSave(characterId);
        if (save) {
          const merged = { ...defaultSave, ...save } as GameSave;
          SaveManager.markOnline();
          try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
          return merged;
        }
      } catch (e) {
        if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
          _isOffline = true;
        } else {
          console.warn('[SaveManager] /save 端点失败，回退本地:', e);
        }
      }
    }
    return SaveManager.loadLocal();
  }

  /**
   * 把 snapshot 返回的字段合并为 GameSave。后端约定：
   * snapshot 至少包含 selectedClass / cityInventory / cityEquipment / gold / level / exp /
   * bestiary / equipmentCodex / skillLevels / talentProgress 字段；
   * 任何缺失字段使用 defaultSave 的值兜底。
   */
  private static mergeSnapshot(snapshot: any): GameSave {
    const merged: GameSave = { ...defaultSave };
    const fields: (keyof GameSave)[] = [
      'selectedClass',
      'cityInventory',
      'cityEquipment',
      'talentProgress',
      'gold',
      'bestiary',
      'equipmentCodex',
      'level',
      'exp',
      'skillLevels',
      'skillPoints',
    ];
    for (const k of fields) {
      const v = (snapshot as any)[k];
      if (v !== undefined && v !== null) {
        (merged as any)[k] = v;
      }
    }
    // cityInventory 长度兜底
    if (!Array.isArray(merged.cityInventory) || merged.cityInventory.length < 24) {
      const base = Array.isArray(merged.cityInventory) ? merged.cityInventory : [];
      merged.cityInventory = [
        ...base,
        ...Array.from({ length: 24 - base.length }, () => ({ item: null })),
      ];
    }
    return merged;
  }

  /**
   * 异步保存（节流）：
   * 1. 节流 SAVE_THROTTLE_MS 后才写入；
   * 2. 优先调旧的整包 saveCharacterData（保留作兜底/兼容路径）；
   * 3. 同时落 LocalStorage 副本；
   * 4. 网络失败时静默降级，不抛异常给调用方（fire-and-forget）。
   */
  static async save(data: GameSave): Promise<void> {
    _pendingSave = data;
    if (_saveTimer) {
      // 节流期内的多次调用合并
      return;
    }

    return new Promise<void>((resolve) => {
      _saveTimer = setTimeout(async () => {
        _saveTimer = null;
        const toWrite = _pendingSave!;
        _pendingSave = null;
        await SaveManager.flushSave(toWrite);
        resolve();
      }, SAVE_THROTTLE_MS);
    });
  }

  /** 立即落盘（不走节流），供退出/紧急保存等场景调用 */
  static async saveImmediately(data: GameSave): Promise<void> {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    _pendingSave = null;
    await SaveManager.flushSave(data);
  }

  private static async flushSave(data: GameSave): Promise<void> {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken() && !_isOffline) {
      try {
        await api.saveCharacterData(characterId, data);
        SaveManager.markOnline();
      } catch (e) {
        if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
          _isOffline = true;
        }
        console.warn('[SaveManager] 服务器存档失败，仅保留本地副本:', e);
      }
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[SaveManager] 本地存档失败:', e);
    }
  }

  static reset(): void {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    _pendingSave = null;
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
