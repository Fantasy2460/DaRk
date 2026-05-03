import type {
  ApiErrorPayload,
  HttpMethod,
  NetworkFailureHandler,
  NetworkFailureInfo,
  QueryParams,
  RequestOptions,
  UpgradeSkillResponse,
  EquipmentCodexResponse,
} from './ApiTypes';

/**
 * 统一基址：优先使用 VITE_API_BASE_URL，向后兼容旧的 VITE_API_URL，
 * 都缺失时退到本地默认地址。
 */
const API_BASE: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env?.VITE_API_URL as string | undefined) ||
  'http://localhost:3001/api';

/** debug 日志开关 */
const DEBUG_ENABLED: boolean = (() => {
  const raw = import.meta.env?.VITE_API_DEBUG;
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
})();

/** 默认超时 8 秒 */
const DEFAULT_TIMEOUT_MS = 8000;

const TOKEN_STORAGE_KEY = 'dj_token';

/**
 * 统一 API 异常：4xx/5xx 与底层网络错误都通过它向调用方暴露。
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly payload?: ApiErrorPayload | null;
  public readonly path: string;
  public readonly method: HttpMethod;

  constructor(params: {
    status: number;
    message: string;
    code?: string;
    payload?: ApiErrorPayload | null;
    path: string;
    method: HttpMethod;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.payload = params.payload ?? null;
    this.path = params.path;
    this.method = params.method;
  }

  /** 是否为网络层失败（DNS/断网/CORS 等）；status === 0 */
  get isNetwork(): boolean {
    return this.status === 0 && this.code !== 'TIMEOUT';
  }

  /** 是否为超时 */
  get isTimeout(): boolean {
    return this.code === 'TIMEOUT';
  }

  /** 是否为 HTTP 4xx/5xx */
  get isHttp(): boolean {
    return this.status >= 400;
  }
}

/**
 * 简单的 token 存储抽象。当前默认实现使用 localStorage。
 * 未来如要切换到内存或加密存储，只需替换实现并通过 ApiClient.setTokenStore 注入。
 */
export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

class LocalStorageTokenStore implements TokenStore {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignore (隐私模式或非浏览器环境)
    }
  }
}

/**
 * 端点常量。集中管理 path，避免散落字符串。
 */
export const Endpoints = {
  // ===== 健康检查 =====
  Health: '/health',

  // ===== 认证 =====
  Register: '/auth/register',
  Login: '/auth/login',

  // ===== 角色 =====
  CharacterList: '/characters/list',
  CharacterCreate: '/characters/create',
  CharacterSave: (characterId: string) => `/characters/${characterId}/save`,
  CharacterStats: (characterId: string) => `/characters/${characterId}/stats`,
  CharacterSkills: (characterId: string) => `/characters/${characterId}/skills`,
  CharacterInventory: (characterId: string) => `/characters/${characterId}/inventory`,
  CharacterCalculateStats: (characterId: string) =>
    `/characters/${characterId}/calculate-stats`,

  // ===== 怪物 / 图鉴 =====
  EnemiesList: '/enemies',
  EnemiesBestiary: (characterId: string) => `/enemies/bestiary/${characterId}`,

  // ===== 装备图鉴 =====
  EquipmentCodex: (characterId: string) => `/characters/${characterId}/codex/equipment`,

  // ===== 物品 =====
  ItemsList: '/items',

  // ===== 商店 =====
  ShopsList: '/shops',
  ShopItems: (shopId: string) => `/shops/${shopId}/items`,
  ShopBuy: '/shops/buy',
  // 占位：下一阶段后端实现卖出
  ShopSell: '/shops/sell',

  // ===== 审计 / 交易 =====
  AuditCreate: '/audit',
  AuditByCharacter: (characterId: string) => `/audit/character/${characterId}`,
  TransactionsCreate: '/transactions',
  TransactionsByCharacter: (characterId: string) =>
    `/transactions/character/${characterId}`,

  // ===== 角色快照（占位） =====
  Snapshot: (characterId: string) => `/characters/${characterId}/snapshot`,

  // ===== 经验 / 击杀（占位） =====
  GainExp: (characterId: string) => `/characters/${characterId}/gain-exp`,
  Kill: (characterId: string) => `/characters/${characterId}/kill`,
  LootRoll: (characterId: string) => `/characters/${characterId}/loot-roll`,

  // ===== 装备 / 背包（占位） =====
  Equip: (characterId: string) => `/characters/${characterId}/equip`,
  Unequip: (characterId: string) => `/characters/${characterId}/unequip`,
  InventoryMove: (characterId: string) => `/characters/${characterId}/inventory/move`,
  InventoryDiscard: (characterId: string) =>
    `/characters/${characterId}/inventory/discard`,
  InventorySort: (characterId: string) => `/characters/${characterId}/inventory/sort`,
  ItemUse: (characterId: string) => `/characters/${characterId}/items/use`,

  // ===== Run 流程（占位） =====
  RunStart: (_characterId: string) => `/runs/start`,
  RunDescend: (runId: string) => `/runs/${runId}/descend`,
  RunExtract: (runId: string) => `/runs/${runId}/extract`,
  RunDeath: (runId: string) => `/runs/${runId}/death`,

  // ===== 全局配置（占位） =====
  ConfigGame: '/config/game',

  // ===== 邮件系统 =====
  MailList: (characterId: string) => `/characters/${characterId}/mails`,
  MailClaim: (characterId: string, mailId: string) =>
    `/characters/${characterId}/mails/${mailId}/claim`,

  // ===== 技能模板与升级 =====
  SkillTemplates: '/skills/templates',
  SkillUpgrade: '/skills/upgrade',

  // ===== 装备强化 =====
  EnchantInfo: (playerItemId: string) => `/enchant/${playerItemId}`,
  EnchantApply: (playerItemId: string) => `/enchant/${playerItemId}`,

  // ===== 成就 =====
  AchievementsList: '/achievements',
  CharacterAchievements: (characterId: string) =>
    `/characters/${characterId}/achievements`,
  AchievementClaim: (achievementId: string) =>
    `/achievements/${achievementId}/claim`,

  // ===== 排行榜 =====
  Leaderboards: '/leaderboards',
  LeaderboardEntries: (seasonId: number | string) => `/leaderboards/${seasonId}`,

  // ===== 公告 =====
  Announcements: '/announcements',
  AnnouncementCreate: '/announcements',

  // ===== 多人战斗权威（占位，阶段三启用） =====
  CombatDamage: '/combat/damage',
  CombatSkill: '/combat/skill',
  CombatState: (runId: string) => `/combat/state/${runId}`,

  // ===== 反作弊管理端（admin only） =====
  AntiCheatFlags: '/anticheat/flags',
  AntiCheatSummary: '/anticheat/summary',
} as const;

/** 把 query 参数序列化为 URLSearchParams 字符串（跳过 null/undefined） */
function buildQueryString(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue;
    params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

class ApiClient {
  private tokenStore: TokenStore = new LocalStorageTokenStore();
  /** 内存缓存，避免每次都读 storage */
  private cachedToken: string | null | undefined = undefined;
  /** 调试模式（独立于 env，运行时也可切换） */
  private debug: boolean = DEBUG_ENABLED;
  /** 网络失败回调集合 */
  private failureHandlers: Set<NetworkFailureHandler> = new Set();

  // ====== 配置项 ======

  /** 替换底层 token 存储（如改用内存或加密 store） */
  setTokenStore(store: TokenStore) {
    this.tokenStore = store;
    this.cachedToken = undefined;
  }

  /** 运行时切换 debug 日志 */
  setDebug(enabled: boolean) {
    this.debug = enabled;
  }

  /** 当前基址（便于调试 / 在拼装 socket 地址时复用） */
  getBaseUrl(): string {
    return API_BASE;
  }

  // ====== Token 管理 ======

  setToken(token: string | null) {
    this.cachedToken = token;
    this.tokenStore.set(token);
  }

  getToken(): string | null {
    if (this.cachedToken !== undefined) return this.cachedToken;
    this.cachedToken = this.tokenStore.get();
    return this.cachedToken;
  }

  // ====== 网络失败回调 ======

  /** 注册网络失败钩子，返回反注册函数 */
  onNetworkFailure(handler: NetworkFailureHandler): () => void {
    this.failureHandlers.add(handler);
    return () => this.failureHandlers.delete(handler);
  }

  private emitFailure(info: NetworkFailureInfo) {
    if (this.failureHandlers.size === 0) return;
    for (const h of this.failureHandlers) {
      try {
        h(info);
      } catch (e) {
        // 不让回调异常影响主流程
        console.warn('[ApiClient] onNetworkFailure handler threw:', e);
      }
    }
  }

  // ====== 通用方法 ======

  get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  del<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  // ====== 核心 request ======

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const fullPath = `${path}${buildQueryString(options?.query)}`;
    const url = `${API_BASE}${fullPath}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    };
    if (!options?.skipAuth) {
      const token = this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    // 如果调用方传了 signal，把它的 abort 也合并进来
    if (options?.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const aborted = (err as { name?: string })?.name === 'AbortError';
      const isTimeout = aborted; // 当前实现下，只有超时/外部 signal 会触发 abort
      const info: NetworkFailureInfo = {
        path: fullPath,
        method,
        kind: isTimeout ? 'timeout' : 'network',
        cause: err,
      };
      this.emitFailure(info);
      const apiErr = new ApiError({
        status: 0,
        message: isTimeout ? `请求超时 (${timeoutMs}ms): ${method} ${fullPath}` : `网络错误: ${method} ${fullPath}`,
        code: isTimeout ? 'TIMEOUT' : 'NETWORK',
        payload: null,
        path: fullPath,
        method,
      });
      if (this.debug) {
        console.warn(`[ApiClient] ${method} ${fullPath} -> ${apiErr.code}`, err);
      }
      throw apiErr;
    }
    clearTimeout(timeoutId);

    let data: any = null;
    // 204 / 空 body 的兜底
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (this.debug) {
      console.log(`[ApiClient] ${method} ${fullPath} -> ${res.status}`);
    }

    if (!res.ok) {
      const payload = (data && typeof data === 'object' ? data : null) as ApiErrorPayload | null;
      const message =
        payload?.error || payload?.message || `请求失败: ${res.status} ${method} ${fullPath}`;
      const code = typeof payload?.code === 'string' ? payload.code : undefined;
      this.emitFailure({
        path: fullPath,
        method,
        kind: 'http',
        status: res.status,
        cause: payload,
      });
      throw new ApiError({
        status: res.status,
        message,
        code,
        payload,
        path: fullPath,
        method,
      });
    }

    return data as T;
  }

  // ============================================================
  //  以下为业务封装方法
  //  注意：保留旧签名以兼容现有 scene/manager 调用，
  //  返回类型暂用宽松定义（any/未知形状），后续 TASK 可逐步收敛。
  // ============================================================

  // ===== 认证 =====
  async register(username: string, email: string, password: string): Promise<any> {
    const data = await this.post<any>(Endpoints.Register, { username, email, password });
    if (data?.token) this.setToken(data.token);
    return data;
  }

  async login(usernameOrEmail: string, password: string): Promise<any> {
    const data = await this.post<any>(Endpoints.Login, { usernameOrEmail, password });
    if (data?.token) this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // ===== 角色 =====
  getCharacters(): Promise<any> {
    return this.get<any>(Endpoints.CharacterList);
  }

  createCharacter(name: string, classType: string): Promise<any> {
    return this.post<any>(Endpoints.CharacterCreate, { name, classType });
  }

  getCharacterSave(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.CharacterSave(characterId));
  }

  getCharacterInventory(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.CharacterInventory(characterId));
  }

  saveCharacterData(characterId: string, payload: any): Promise<any> {
    return this.post<any>(Endpoints.CharacterSave(characterId), payload);
  }

  getCharacterSkills(characterId: string, level: number): Promise<any> {
    return this.get<any>(Endpoints.CharacterSkills(characterId), {
      query: { level },
    });
  }

  getCharacterStats(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.CharacterStats(characterId));
  }

  calculateCharacterStats(
    characterId: string,
    equipment?: Record<string, any | null>
  ): Promise<any> {
    return this.post<any>(Endpoints.CharacterCalculateStats(characterId), { equipment });
  }

  // ===== 怪物与图鉴 =====
  getEnemies(): Promise<any> {
    return this.get<any>(Endpoints.EnemiesList);
  }

  getCharacterBestiary(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.EnemiesBestiary(characterId));
  }

  getEquipmentCodex(characterId: string): Promise<EquipmentCodexResponse> {
    return this.get<EquipmentCodexResponse>(Endpoints.EquipmentCodex(characterId));
  }

  // ===== 物品 =====
  getItems(): Promise<any> {
    return this.get<any>(Endpoints.ItemsList);
  }

  // ===== 商店 =====
  getShops(): Promise<any> {
    return this.get<any>(Endpoints.ShopsList);
  }

  getShopItems(shopId: string): Promise<any> {
    return this.get<any>(Endpoints.ShopItems(shopId));
  }

  buyShopItem(characterId: string, shopItemId: number): Promise<any> {
    return this.post<any>(Endpoints.ShopBuy, { characterId, shopItemId });
  }

  /** 占位：商店卖出（后端尚未实现） */
  sellShopItem(characterId: string, playerItemId: string, count?: number): Promise<any> {
    return this.post<any>(Endpoints.ShopSell, { characterId, playerItemId, count });
  }

  // ===== 审计日志 =====
  logAudit(action: string, characterId?: string, details?: Record<string, any>): Promise<any> {
    return this.post<any>(Endpoints.AuditCreate, { action, characterId, details });
  }

  getAuditLogs(characterId: string, limit?: number): Promise<any> {
    return this.get<any>(Endpoints.AuditByCharacter(characterId), {
      query: { limit: limit ?? 100 },
    });
  }

  // ===== 金币交易 =====
  logTransaction(
    characterId: string,
    type: string,
    amount: number,
    balanceAfter: number,
    relatedItemId?: string,
    relatedRunId?: string
  ): Promise<any> {
    return this.post<any>(Endpoints.TransactionsCreate, {
      characterId,
      type,
      amount,
      balanceAfter,
      relatedItemId,
      relatedRunId,
    });
  }

  getTransactions(characterId: string, limit?: number): Promise<any> {
    return this.get<any>(Endpoints.TransactionsByCharacter(characterId), {
      query: { limit: limit ?? 100 },
    });
  }

  // ===== 健康检查 =====
  health(): Promise<any> {
    return this.get<any>(Endpoints.Health, { skipAuth: true });
  }

  // ============================================================
  //  以下为「占位」业务方法，后端尚未实现，仅供后续 TASK 直接接入
  // ============================================================

  /** 占位：获取角色总览快照（含属性/装备/背包/技能聚合） */
  getSnapshot(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.Snapshot(characterId));
  }

  /** 占位：上报经验获取 */
  gainExp(characterId: string, payload: { amount: number; source?: string }): Promise<any> {
    return this.post<any>(Endpoints.GainExp(characterId), payload);
  }

  /** 占位：上报击杀（用于服务器权威算分/掉落判定） */
  reportKill(
    characterId: string,
    payload: { enemyTemplateId: string; depth: number; runId?: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.Kill(characterId), payload);
  }

  /** 占位：服务器掷掉落（loot roll）权威 */
  rollLoot(
    characterId: string,
    payload: { enemyTemplateId: string; depth: number; runId?: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.LootRoll(characterId), payload);
  }

  /** 占位：穿装备 */
  equipItem(
    characterId: string,
    payload: { slot: string; playerItemId: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.Equip(characterId), payload);
  }

  /** 占位：脱装备 */
  unequipItem(characterId: string, payload: { slot: string }): Promise<any> {
    return this.post<any>(Endpoints.Unequip(characterId), payload);
  }

  /** 占位：背包内移动 */
  moveInventoryItem(
    characterId: string,
    payload: { fromSlot: number; toSlot: number }
  ): Promise<any> {
    return this.post<any>(Endpoints.InventoryMove(characterId), payload);
  }

  /** 占位：背包丢弃 */
  discardInventoryItem(
    characterId: string,
    payload: { slot: number; count?: number }
  ): Promise<any> {
    return this.post<any>(Endpoints.InventoryDiscard(characterId), payload);
  }

  /** 占位：背包整理 */
  sortInventory(characterId: string): Promise<any> {
    return this.post<any>(Endpoints.InventorySort(characterId));
  }

  /** 占位：消耗品使用 */
  useItem(
    characterId: string,
    payload: { slot: number; runId?: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.ItemUse(characterId), payload);
  }

  /** 占位：开始一次 run */
  startRun(characterId: string, payload?: { roomId?: string }): Promise<any> {
    return this.post<any>(Endpoints.RunStart(characterId), { characterId, ...(payload ?? {}) });
  }

  /** 占位：进入下一层 */
  descendRun(
    characterId: string,
    payload: { runId: string; fromDepth: number }
  ): Promise<any> {
    return this.post<any>(Endpoints.RunDescend(payload.runId), payload);
  }

  /** 占位：撤离 */
  extractRun(
    characterId: string,
    payload: { runId: string; depth: number }
  ): Promise<any> {
    return this.post<any>(Endpoints.RunExtract(payload.runId), payload);
  }

  /** 占位：死亡结算 */
  reportDeath(
    characterId: string,
    payload: { runId: string; depth: number; cause?: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.RunDeath(payload.runId), payload);
  }

  /** 占位：拉取全局游戏配置（数值/常量同步） */
  getGameConfig(): Promise<any> {
    return this.get<any>(Endpoints.ConfigGame, { skipAuth: true });
  }

  /** 占位：邮件列表 */
  getMailList(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.MailList(characterId));
  }

  /** 占位：领取邮件 */
  claimMail(characterId: string, mailId: string): Promise<any> {
    return this.post<any>(Endpoints.MailClaim(characterId, mailId));
  }

  // ===== 技能模板（真实可用） =====
  /** 获取所有技能模板（包含先修技能引用） */
  getSkillTemplates(): Promise<any> {
    return this.get<any>(Endpoints.SkillTemplates, { skipAuth: true });
  }

  /**
   * 技能升级（真实可用）。
   * 成功返回 {@link UpgradeSkillResponse}；后端业务错误（400 + error code）通过 {@link ApiError} 抛出，
   * 调用方需根据 `err.code` 或 `err.payload.error` 判断业务错误类型。
   */
  upgradeSkill(characterId: string, skillId: string): Promise<UpgradeSkillResponse> {
    return this.post<UpgradeSkillResponse>(Endpoints.SkillUpgrade, { characterId, skillId });
  }

  // ===== 装备强化 =====
  /** 真实可用：获取指定 PlayerItem 的当前强化等级与加成 */
  getEnchantInfo(playerItemId: string): Promise<any> {
    return this.get<any>(Endpoints.EnchantInfo(playerItemId));
  }

  /** 占位：装备强化（后端尚未实现具体逻辑） */
  enchantItem(
    playerItemId: string,
    payload: { characterId: string; materialItemId?: string }
  ): Promise<any> {
    return this.post<any>(Endpoints.EnchantApply(playerItemId), payload);
  }

  // ===== 成就 =====
  /** 真实可用：获取所有成就模板 */
  getAchievements(): Promise<any> {
    return this.get<any>(Endpoints.AchievementsList, { skipAuth: true });
  }

  /** 真实可用：获取角色的成就进度（含未完成） */
  getCharacterAchievements(characterId: string): Promise<any> {
    return this.get<any>(Endpoints.CharacterAchievements(characterId));
  }

  /** 占位：领取成就奖励 */
  claimAchievement(achievementId: string): Promise<any> {
    return this.post<any>(Endpoints.AchievementClaim(achievementId));
  }

  // ===== 排行榜 =====
  /** 真实可用：获取所有赛季列表 */
  getLeaderboards(): Promise<any> {
    return this.get<any>(Endpoints.Leaderboards, { skipAuth: true });
  }

  /** 真实可用：获取指定赛季前 100 名 */
  getLeaderboardEntries(seasonId: number | string): Promise<any> {
    return this.get<any>(Endpoints.LeaderboardEntries(seasonId), {
      skipAuth: true,
    });
  }

  // ===== 公告 =====
  /** 真实可用：拉取当前生效的公告 */
  getAnnouncements(): Promise<any> {
    return this.get<any>(Endpoints.Announcements, { skipAuth: true });
  }

  // ===== 多人战斗权威（占位） =====
  /** 占位：上报一次伤害（当前后端返回 501） */
  reportCombatDamage(payload: {
    runId: string;
    attackerType: 'PLAYER' | 'ENEMY';
    attackerId: string;
    targetType: 'PLAYER' | 'ENEMY';
    targetId: string;
    skillId?: string;
    baseDamage: number;
  }): Promise<any> {
    return this.post<any>(Endpoints.CombatDamage, payload);
  }

  /** 占位：释放技能（当前后端返回 501） */
  useCombatSkill(payload: {
    runId: string;
    characterId: string;
    skillId: string;
    targetX: number;
    targetY: number;
  }): Promise<any> {
    return this.post<any>(Endpoints.CombatSkill, payload);
  }

  /** 占位：获取战斗快照（当前后端返回 501） */
  getCombatState(runId: string): Promise<any> {
    return this.get<any>(Endpoints.CombatState(runId));
  }

  // ============================================================
  //  反作弊管理端（admin only）
  //  普通用户调用会得到 403，仅供后台管理 UI 使用。
  // ============================================================

  /**
   * 列出反作弊 flags（管理员）。
   * @param query.characterId 仅返回某角色相关
   * @param query.reason      仅返回某 reason
   * @param query.since       仅返回 since 之后
   * @param query.limit       默认 100，上限 500
   */
  getAntiCheatFlags(query?: {
    characterId?: string;
    reason?: string;
    since?: string;
    limit?: number;
  }): Promise<any> {
    return this.get<any>(Endpoints.AntiCheatFlags, {
      query: {
        characterId: query?.characterId,
        reason: query?.reason,
        since: query?.since,
        limit: query?.limit,
      },
    });
  }

  /** 各 reason 的累计计数与最后一次时间（管理员） */
  getAntiCheatSummary(): Promise<any> {
    return this.get<any>(Endpoints.AntiCheatSummary);
  }
}

export const api = new ApiClient();
