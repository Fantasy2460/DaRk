/**
 * 游戏配置：分为公开配置（PUBLIC）与服务器内部配置（INTERNAL）
 *
 * - PUBLIC_GAME_CONFIG：客户端渲染/操作所必须的常量，可通过 `GET /api/config/game` 公开下发
 *   （分辨率、移动速度、背包尺寸、敌人/Boss 生成范围、闪避冷却、迷雾参数、稀有度展示等）
 *
 * - INTERNAL_GAME_CONFIG：仅服务器使用的规则系数与权威逻辑参数，禁止通过 API 暴露
 *   （升级公式系数、掉落系数、经济相关上限、Boss/精英修正等内部规则）
 *
 * 同步策略：当前 PUBLIC 配置以代码常量形式维护，版本号取本文件 `CONFIG_VERSION` 常量值，
 * 后续若改为 DB 驱动可在此处替换实现，不影响路由签名。
 */

export const CONFIG_VERSION = '2026-05-01.1';

// ============== 公开配置（客户端可见） ==============
export const PUBLIC_GAME_CONFIG = {
  // 渲染与世界尺寸
  width: 960,
  height: 640,
  worldWidth: 1920,
  worldHeight: 1280,
  tileSize: 64,

  // 角色操作
  playerSpeed: 180,
  dodgeCooldown: 800,
  dodgeInvincibleTime: 500,
  attackCooldown: 1000,

  // 视野与迷雾
  visionRadius: 160,
  fogGrowthRate: 0.5,
  maxFog: 100,

  // 背包
  inventoryRows: 6,
  inventoryCols: 4,

  // 敌人生成
  bossSpawnChance: 0.15,
  enemySpawnCount: { min: 6, max: 12 },

  // 场景装饰
  treeCount: 24,

  // 角色等级上限
  maxPlayerLevel: 9,

  // 稀有度配色（保留十六进制字符串，前端使用时按需转换）
  rarityColors: {
    C: '#9ca3af',
    B: '#22c55e',
    A: '#3b82f6',
    S: '#f59e0b',
  },

  rarityNames: {
    C: '普通',
    B: '优秀',
    A: '史诗',
    S: '传说',
  },

  slotNames: {
    weapon: '武器',
    helmet: '头盔',
    armor: '衣服',
    pants: '裤子',
    shoes: '鞋子',
    accessory: '首饰',
    offhand: '副手',
  },
} as const;

// ============== 内部配置（服务器规则，禁止下发） ==============
export const INTERNAL_GAME_CONFIG = {
  /**
   * 升级公式系数：升到第 N 级所需经验 = floor(base * pow^(N-1) + linear * (N-1))
   *
   * 默认值 { base: 100, pow: 1, linear: 100 } 等价于 N * 100，
   * 与前端 `phaser-demo/src/config/gameConfig.ts#getExpToNextLevel`（level * 100）一致：
   *   N=1 → 100，N=2 → 200，N=3 → 300 ...
   *
   * 说明：当 pow=1 时，base * pow^(N-1) 退化为常数 base；
   *       当 pow>1 时（如 1.15），公式变为指数曲线，可在服务端单点切换。
   */
  expCurve: {
    base: 100,
    pow: 1,
    linear: 100,
  },

  /** 每次升级获得的可分配属性点（前端尚未消费，但权威值由服务端结算） */
  levelUpStatPoints: 5,

  /** 玩家等级上限（与前端 PUBLIC_GAME_CONFIG.maxPlayerLevel 一致；服务器在升级判定时用此为权威上限） */
  maxPlayerLevel: 9,

  /**
   * 经验来源相关防作弊阈值
   * - sourceMaxAmountMultiplier：客户端上报 amount 超过期望值的倍率上限（例如 KILL_ENEMY 期望=expValue，>2*expValue 则告警）
   * - rateLimitMs：同一 character 上次给经验距今 < rateLimitMs 视为高频（仅记录 flag，不阻断）
   */
  expGuard: {
    sourceMaxAmountMultiplier: 2,
    rateLimitMs: 500,
  },

  // 掉落系数：用于服务器权威化阶段统一缩放
  dropMultiplier: {
    common: 1.0,
    rare: 1.0,
    boss: 1.0,
  },

  // 金币经济上限与流通限制
  economy: {
    maxCarryGold: 99_999_999,
    maxSingleTransaction: 9_999_999,
  },

  /**
   * 商店出售相关：
   * - sellPriceRatio：当 ItemTemplate.sellPrice 缺失或为 0 时，使用 buyPrice * sellPriceRatio 作为兜底卖价
   * - rateLimitMs：同一 character 上次出售距今 < rateLimitMs 视为高频（仅记录 flag，不阻断）
   */
  sell: {
    sellPriceRatio: 0.4,
    rateLimitMs: 200,
  },

  // Boss 与精英修正系数
  bossModifiers: {
    hpMultiplier: 1.0,
    attackMultiplier: 1.0,
    defenseMultiplier: 1.0,
    expMultiplier: 1.0,
  },

  // 服务器 tick 频率（阶段三权威化使用）
  serverTickRate: 20,

  /**
   * 装备/背包/消耗品相关阈值（TASK-BE-EQUIP-INVENTORY）
   * - inventoryCapacity：背包容量（与前端 inventoryRows*inventoryCols 对齐：6*4=24）
   * - itemUseRateLimitMs：同一 PlayerItem 上次使用距今 < 该阈值视为高频（仅记录 flag，不阻断）
   * - allowedSortStrategies：背包整理支持的策略集
   */
  inventory: {
    inventoryCapacity: 24,
    itemUseRateLimitMs: 200,
    allowedSortStrategies: ['rarity', 'type', 'name'] as const,
  },
} as const;

/**
 * 服务端权威：给定当前等级 N，返回升到 N+1 所需经验。
 * 与前端 `getExpToNextLevel(N) = N * 100` 等价（默认配置下）。
 */
export function getExpRequiredForNextLevel(currentLevel: number): number {
  const { base, pow, linear } = INTERNAL_GAME_CONFIG.expCurve;
  // 升到第 (currentLevel + 1) 级，使用 N = currentLevel + 1 代入公式
  // 但前端语义是「currentLevel 升下一级所需」=（currentLevel）*100，
  // 即 N=currentLevel 代入 floor(base * pow^(N-1) + linear * (N-1))，
  // N=1 → 100，N=2 → 200，恰好一致。
  const N = Math.max(1, Math.floor(currentLevel));
  return Math.floor(base * Math.pow(pow, N - 1) + linear * (N - 1));
}

// 类型导出（仅服务端内部消费时可用）
export type PublicGameConfig = typeof PUBLIC_GAME_CONFIG;
export type InternalGameConfig = typeof INTERNAL_GAME_CONFIG;
