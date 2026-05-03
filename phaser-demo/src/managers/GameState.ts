import type { GameSave, RunState, ClassType, EquipmentSet, InventorySlot, Item, Consumable } from '../types';
import { SaveManager } from './SaveManager';
import { CLASSES } from '../data/classes';
import { ENEMIES } from '../data/enemies';
import { getExpToNextLevel, MAX_PLAYER_LEVEL } from '../config/gameConfig';
import { api, ApiError } from '../network/ApiClient';
import { logStartRun } from '../utils/AuditLogger';

/**
 * 升级结果，addExp 在升级时回传给 UI 用于触发动画/提示
 */
export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  level: number;
  exp: number;
  legalAmount?: number;
  source?: string;
}

/** 击杀上报结果，含可能的 newItems 与 bestiary entry 等 */
export interface KillResult {
  exp: number;
  level: number;
  leveledUp: boolean;
  newItems?: (Item | Consumable)[];
  bestiaryEntry?: string;
  source?: string;
}

/** 后端 RunService 返回的怪物刷新点 */
export interface RunSpawnPoint {
  enemyTemplateId: string;
  x: number;
  y: number;
}

/** 后端 RunService 返回的传送门坐标 */
export interface RunPortalPoint {
  x: number;
  y: number;
}

/** 出售物品后端返回 */
export interface SellItemResult {
  goldGained: number;
  newGold: number;
  soldItem: { templateId: string; name: string };
}

/** 使用消耗品后的 buff/即时效果 */
export interface UseItemResult {
  hp?: number;
  mp?: number;
  buffs?: Array<{ type: string; value: number; duration?: number }>;
}

export class GameState {
  private static instance: GameState;
  save: GameSave;
  run: RunState | null = null;
  /** 当前 run 的服务器 ID（来自 api.startRun() 返回，用于后续 descend/extract/death/loot/exp 上下文） */
  runId: string | null = null;
  /** 后端 startRun/descend 返回的刷新点列表，场景层据此生成敌人 */
  runSpawns: RunSpawnPoint[] | null = null;
  /** 后端 startRun/descend 返回的传送门坐标 */
  runPortal: RunPortalPoint | null = null;
  /** 当前 run 的 seed（多人/反作弊溯源用） */
  runSeed: string | null = null;

  private constructor() {
    // 同步加载本地兜底数据，随后可通过 syncFromServer() 拉取云端最新存档
    this.save = SaveManager.loadLocal();
  }

  static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState();
    }
    return GameState.instance;
  }

  /** 登录后调用：从服务器同步最新存档（snapshot） */
  async syncFromServer(): Promise<void> {
    try {
      const serverSave = await SaveManager.load();
      this.save = serverSave;
    } catch (e) {
      console.warn('同步服务器存档失败:', e);
    }
  }

  /** 选择职业 */
  selectClass(classId: ClassType): void {
    this.save.selectedClass = classId;
    this.persist();
  }

  // ============================================================
  //  Run 流程
  // ============================================================

  private static readonly RUN_STORAGE_KEY = 'dark_journey_run_v1';

  /** 开始一次森林探险（异步：调 /runs/start，失败则离线 fallback） */
  async startRun(): Promise<void> {
    const cls = CLASSES.find((c) => c.id === this.save.selectedClass);
    if (!cls) throw new Error('未选择职业');

    // 先初始化本地 RunState（失败也能继续单机）
    this.run = {
      forestDepth: 1,
      runInventory: Array.from({ length: 24 }, () => ({ item: null })),
      runEquipment: { ...this.save.cityEquipment },
      currentHp: cls.baseStats.maxHp,
      currentMp: cls.baseStats.maxMp,
      fogValue: 0,
      elapsedTime: 0,
      enemiesKilled: 0,
      itemsFound: [],
      damageStats: {
        totalDamage: 0,
        sources: {},
        version: 0,
      },
    };
    this.runId = null;
    this.runSpawns = null;
    this.runPortal = null;
    this.runSeed = null;

    // 尝试从 LocalStorage 恢复之前未结束的 runId（页面刷新场景）
    try {
      const cached = localStorage.getItem(GameState.RUN_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.runId && typeof parsed.runId === 'string') {
          this.runId = parsed.runId;
          if (typeof parsed.depth === 'number') this.run.forestDepth = parsed.depth;
          console.warn('[GameState] 从 LocalStorage 恢复 runId:', this.runId);
        }
      }
    } catch {
      // ignore parse error
    }

    logStartRun({
      classType: this.save.selectedClass ?? 'warrior',
      depth: this.run?.forestDepth ?? 1,
    });

    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      return;
    }

    try {
      const resp = await api.startRun(characterId);
      const id = resp?.runId ?? resp?.run?.id ?? resp?.id ?? null;
      if (id) {
        this.runId = String(id);
      }
      // 后端会一并返回 spawns/portal/seed（参见 server/RunService.startRun）。
      // 场景层（ForestScene）通过这些字段渲染怪物与传送门，保持服务端权威。
      if (Array.isArray(resp?.spawns)) {
        this.runSpawns = resp.spawns as RunSpawnPoint[];
      }
      if (resp?.portal && typeof resp.portal.x === 'number' && typeof resp.portal.y === 'number') {
        this.runPortal = resp.portal as RunPortalPoint;
      }
      if (typeof resp?.seed === 'string') {
        this.runSeed = resp.seed;
      }
      // 持久化 runId 到 LocalStorage，防止刷新后丢失
      try {
        localStorage.setItem(
          GameState.RUN_STORAGE_KEY,
          JSON.stringify({ runId: this.runId, depth: this.run?.forestDepth ?? 1 })
        );
      } catch {
        /* ignore */
      }
      SaveManager.markOnline();
    } catch (e) {
      console.warn('[GameState] startRun 后端调用失败，进入离线 run 模式:', e);
    }
  }

  /** 同步版 startRun：保留旧调用方兼容（场景层 .startRun() 可能不带 await） */
  startRunSync(): void {
    void this.startRun();
  }

  /**
   * 安全撤离，将局内收获带回主城。
   * 异步调 /runs/:id/extract，事务由后端做；本地仍执行预测合并以提供即时 UI 反馈，
   * 网络成功后再 sync snapshot 覆盖本地。
   */
  async extractRun(): Promise<void> {
    if (!this.run) return;

    // 本地预测合并（先合并回主城，用户看到即时效果）
    this.save.cityEquipment = { ...this.run.runEquipment };
    for (const slot of this.run.runInventory) {
      if (!slot.item) continue;
      const emptyIdx = this.save.cityInventory.findIndex((s) => !s.item);
      if (emptyIdx >= 0) {
        this.save.cityInventory[emptyIdx] = { item: slot.item };
      }
    }
    for (const itemId of this.run.itemsFound) {
      if (!this.save.equipmentCodex.includes(itemId)) {
        this.save.equipmentCodex.push(itemId);
      }
    }

    const depth = this.run.forestDepth;
    const runId = this.runId;
    const characterId = SaveManager.getCharacterId();
    this.run = null;
    this.runId = null;
    this.runSpawns = null;
    this.runPortal = null;
    this.runSeed = null;

    // 清除 LocalStorage 中的 run 缓存
    try {
      localStorage.removeItem(GameState.RUN_STORAGE_KEY);
    } catch {
      /* ignore */
    }

    if (characterId && api.getToken() && runId && !SaveManager.isOffline()) {
      try {
        await api.extractRun(characterId, { runId, depth });
        SaveManager.markOnline();
        // 拉一次 snapshot 覆盖本地预测，确保权威数据
        try {
          const fresh = await SaveManager.load();
          this.save = fresh;
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.warn('[GameState] extractRun 后端调用失败，仅保留本地预测合并:', e);
      }
    }

    this.persist();
  }

  /** 同步版包装：旧调用方兼容 */
  extractRunSync(): void {
    void this.extractRun();
  }

  /** 死亡，丢失本次局内所有物品 */
  async dieInRun(): Promise<void> {
    const depth = this.run?.forestDepth ?? 1;
    const runId = this.runId;
    const characterId = SaveManager.getCharacterId();
    this.run = null;
    this.runId = null;
    this.runSpawns = null;
    this.runPortal = null;
    this.runSeed = null;

    // 清除 LocalStorage 中的 run 缓存
    try {
      localStorage.removeItem(GameState.RUN_STORAGE_KEY);
    } catch {
      /* ignore */
    }

    if (characterId && api.getToken() && runId && !SaveManager.isOffline()) {
      try {
        await api.reportDeath(characterId, { runId, depth });
        SaveManager.markOnline();
      } catch (e) {
        console.warn('[GameState] reportDeath 后端调用失败:', e);
      }
    }

    this.persist();
  }

  /** 同步版包装 */
  dieInRunSync(): void {
    void this.dieInRun();
  }

  /** 进入下一层（仅在 run 内调用） */
  async descendRun(): Promise<void> {
    if (!this.run) return;
    const fromDepth = this.run.forestDepth;
    this.run.forestDepth = fromDepth + 1;
    const runId = this.runId;
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken() && runId && !SaveManager.isOffline()) {
      try {
        const resp = await api.descendRun(characterId, { runId, fromDepth });
        SaveManager.markOnline();
        // 后端返回 { depth, seed, spawns, portal }
        if (Array.isArray(resp?.spawns)) {
          this.runSpawns = resp.spawns as RunSpawnPoint[];
        }
        if (resp?.portal && typeof resp.portal.x === 'number' && typeof resp.portal.y === 'number') {
          this.runPortal = resp.portal as RunPortalPoint;
        }
        if (typeof resp?.seed === 'string') {
          this.runSeed = resp.seed;
        }
        // 更新 LocalStorage 中的 depth
        try {
          localStorage.setItem(
            GameState.RUN_STORAGE_KEY,
            JSON.stringify({ runId, depth: this.run.forestDepth })
          );
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.warn('[GameState] descendRun 后端调用失败:', e);
      }
    }
  }

  // ============================================================
  //  战斗 / 经验 / 击杀
  // ============================================================

  /**
   * 记录击杀怪物：
   * - 优先调 /characters/:id/kill 一体化端点（exp + bestiary + loot）
   * - 网络可用时返回 KillResult，调用方可据此做 UI 表现
   * - 离线降级：本地公式计算经验、本地 bestiary
   *
   * 兼容旧调用：旧调用方写 `state.recordKill(enemyId)` 不 await，没问题（fire-and-forget）。
   */
  async recordKill(enemyId: string): Promise<KillResult | null> {
    if (!this.save.bestiary.includes(enemyId)) {
      this.save.bestiary.push(enemyId);
    }
    if (this.run) {
      this.run.enemiesKilled++;
    }

    const characterId = SaveManager.getCharacterId();
    const runId = this.runId ?? undefined;
    const depth = this.run?.forestDepth ?? 1;

    if (characterId && api.getToken() && !SaveManager.isOffline()) {
      try {
        const resp = await api.reportKill(characterId, { enemyTemplateId: enemyId, depth, runId });
        SaveManager.markOnline();
        // 服务端权威 patch
        if (typeof resp?.exp === 'number') this.save.exp = resp.exp;
        if (typeof resp?.level === 'number') this.save.level = resp.level;
        // newItems 加入 runInventory（后端已校验背包空位/runId）
        if (this.run && Array.isArray(resp?.newItems)) {
          for (const it of resp.newItems) {
            if (!it) continue;
            const emptyIdx = this.run.runInventory.findIndex((s) => !s.item);
            if (emptyIdx >= 0) {
              this.run.runInventory[emptyIdx] = { item: it };
            }
            // bestiary entry / itemsFound 记录
            if (it?.id && !this.run.itemsFound.includes(it.id)) {
              this.run.itemsFound.push(it.id);
            }
          }
        }
        this.persist();
        return {
          exp: resp.exp ?? this.save.exp,
          level: resp.level ?? this.save.level,
          leveledUp: !!resp.leveledUp,
          newItems: Array.isArray(resp?.newItems) ? resp.newItems : undefined,
          bestiaryEntry: resp?.bestiaryEntry,
          source: 'remote',
        };
      } catch (e) {
        if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
          // 进入离线，降级到本地公式
        } else {
          console.warn('[GameState] reportKill 后端调用失败，降级本地公式:', e);
        }
      }
    }

    // 离线/失败兜底：本地公式
    const enemy = ENEMIES.find((e) => e.id === enemyId);
    if (enemy) {
      const result = this.addExpLocal(enemy.expValue);
      this.persist();
      return {
        exp: result.exp,
        level: result.level,
        leveledUp: result.leveledUp,
        source: 'local',
      };
    }
    this.persist();
    return null;
  }

  /**
   * 增加经验 —— 兼容签名：
   *   addExp(amount)                  // 旧形态：纯本地公式
   *   addExp(amount, source, ...)      // 新形态：上报后端权威
   *
   * 注意 ApiClient.gainExp 期望 `{ amount, source }`，因此第二参数为 source 时走 remote。
   */
  async addExp(
    amount: number,
    source?: string,
    _enemyTemplateId?: string,
    _runId?: string
  ): Promise<LevelUpResult> {
    if (!source) {
      // 旧签名：本地直算
      return this.addExpLocal(amount);
    }

    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      // 离线：本地兜底
      return this.addExpLocal(amount);
    }

    try {
      const resp = await api.gainExp(characterId, { amount, source });
      SaveManager.markOnline();
      const oldLevel = this.save.level;
      if (typeof resp?.exp === 'number') this.save.exp = resp.exp;
      if (typeof resp?.level === 'number') this.save.level = resp.level;
      this.persist();
      return {
        leveledUp: !!resp?.leveledUp || (typeof resp?.level === 'number' && resp.level > oldLevel),
        oldLevel: resp?.oldLevel ?? oldLevel,
        newLevel: resp?.newLevel ?? this.save.level,
        level: this.save.level,
        exp: this.save.exp,
        legalAmount: typeof resp?.legalAmount === 'number' ? resp.legalAmount : amount,
        source: 'remote',
      };
    } catch (e) {
      if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
        console.warn('[GameState] gainExp 失败，降级本地公式:', e);
      }
      return this.addExpLocal(amount);
    }
  }

  /** 旧本地公式：升级直到 exp 不够下一级 */
  addExpLocal(amount: number): LevelUpResult {
    const oldLevel = this.save.level;
    this.save.exp += amount;
    let required = getExpToNextLevel(this.save.level);
    while (this.save.exp >= required && this.save.level < MAX_PLAYER_LEVEL) {
      this.save.exp -= required;
      this.save.level++;
      required = getExpToNextLevel(this.save.level);
    }
    return {
      leveledUp: this.save.level > oldLevel,
      oldLevel,
      newLevel: this.save.level,
      level: this.save.level,
      exp: this.save.exp,
      source: 'local',
    };
  }

  /** 记录拾取装备 */
  recordItemFound(itemId: string): void {
    if (this.run) {
      this.run.itemsFound.push(itemId);
    }
  }

  // ============================================================
  //  消耗品使用 —— effect 应用到 RunState
  // ============================================================

  /**
   * 使用消耗品（异步走 /items/use）。
   * - slotIndex：背包格索引
   * - 返回 effect（hp/mp/buffs），调用方需把 effect 应用到 Player / RunState
   *
   * 注意：本方法不直接 mutate Player（Player 实例由场景持有），仅做 RunState 的 hp/mp 即时回填，
   *       buffs 由场景调用方接管。
   */
  async useConsumable(slotIndex: number): Promise<UseItemResult | null> {
    const characterId = SaveManager.getCharacterId();
    const runId = this.runId ?? undefined;
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      return null;
    }
    try {
      const resp = await api.useItem(characterId, { slot: slotIndex, runId });
      SaveManager.markOnline();
      const effect: UseItemResult = resp?.effect ?? {
        hp: resp?.hp,
        mp: resp?.mp,
        buffs: resp?.buffs,
      };
      // 即时 patch RunState 血量/法力（如果存在）；上限交由调用方（场景）裁剪
      if (this.run) {
        if (typeof effect.hp === 'number') {
          this.run.currentHp = Math.max(0, this.run.currentHp + effect.hp);
        }
        if (typeof effect.mp === 'number') {
          this.run.currentMp = Math.max(0, this.run.currentMp + effect.mp);
        }
      }
      return effect;
    } catch (e) {
      if (!(e instanceof ApiError && (e.isNetwork || e.isTimeout))) {
        console.warn('[GameState] useItem 失败:', e);
      }
      return null;
    }
  }

  // ============================================================
  //  商店出售
  // ============================================================

  /**
   * 主城出售物品。
   * - playerItemId 来自 snapshot 端点的 `instanceId`（每件 PlayerItem 的数据库 ID）。
   * - 后端原子事务：扣除 PlayerItem、增加金币、写 CharacterTransaction。
   * - 前端在调用方完成后通常需要刷新一次 snapshot（拉取最新背包）。
   */
  async sellItem(playerItemId: string): Promise<SellItemResult | null> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      return null;
    }
    try {
      const resp = await api.sellShopItem(characterId, playerItemId, 1);
      SaveManager.markOnline();
      const result: SellItemResult = {
        goldGained: resp?.goldGained ?? 0,
        newGold: resp?.newGold ?? this.save.gold,
        soldItem: resp?.soldItem ?? { templateId: '', name: '' },
      };
      this.save.gold = result.newGold;
      // 本地预测：从 cityInventory 中移除该 instanceId 的物品
      for (let i = 0; i < this.save.cityInventory.length; i++) {
        const slot = this.save.cityInventory[i];
        if (slot?.item && (slot.item as any).instanceId === playerItemId) {
          this.save.cityInventory[i] = { item: null };
          break;
        }
      }
      this.persist();
      return result;
    } catch (e) {
      if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) {
        console.warn('[GameState] sellItem 网络失败:', e);
      } else {
        console.warn('[GameState] sellItem 后端拒绝:', e);
        // 业务错误（比如装备中、属于 run）需要把信息抛给调用方
        throw e;
      }
      return null;
    }
  }

  // ============================================================
  //  技能升级
  // ============================================================

  /**
   * 升级一项技能。
   * - 离线模式直接返回 { ok: false, error: 'OFFLINE' }，不做本地推测；
   * - 在线模式调 /api/skills/upgrade，等待服务器响应后再覆盖本地 skillPoints / skillLevels；
   * - 业务错误（SKILL_UPGRADE_*）原样回传给调用方做 UI 提示；
   * - 网络/超时错误归一为 'NETWORK_ERROR'。
   *
   * 注意：本方法不做乐观预测，绝不在请求前先扣本地 SP。
   */
  async upgradeSkill(
    skillId: string
  ): Promise<{ ok: boolean; error?: string; message?: string; newLevel?: number }> {
    const characterId = SaveManager.getCharacterId();
    if (!characterId || !api.getToken() || SaveManager.isOffline()) {
      return { ok: false, error: 'OFFLINE' };
    }

    try {
      const resp = await api.upgradeSkill(characterId, skillId);
      SaveManager.markOnline();
      this.save.skillPoints = resp.skillPoints;
      this.save.skillLevels = { ...resp.skillLevels };
      this.persist();
      return { ok: true, newLevel: resp.newLevel };
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.isNetwork || e.isTimeout) {
          return { ok: false, error: 'NETWORK_ERROR', message: e.message };
        }
        const bizCode = typeof e.payload?.error === 'string' ? e.payload.error : undefined;
        if (bizCode && bizCode.startsWith('SKILL_UPGRADE_')) {
          return { ok: false, error: bizCode, message: e.payload?.message ?? e.message };
        }
        if (
          bizCode === 'CHARACTER_NOT_FOUND' ||
          bizCode === 'SKILL_TEMPLATE_NOT_FOUND'
        ) {
          return { ok: false, error: bizCode, message: e.payload?.message ?? e.message };
        }
        return { ok: false, error: bizCode ?? 'NETWORK_ERROR', message: e.message };
      }
      console.warn('[GameState] upgradeSkill 未知异常:', e);
      return { ok: false, error: 'NETWORK_ERROR' };
    }
  }

  // ============================================================
  //  持久化
  // ============================================================

  persist(): void {
    // fire-and-forget，不阻塞游戏主循环
    SaveManager.save(this.save).catch(() => {});
  }

  resetAll(): void {
    SaveManager.reset();
    this.save = SaveManager.loadLocal();
    this.run = null;
    this.runId = null;
    this.runSpawns = null;
    this.runPortal = null;
    this.runSeed = null;
  }
}
