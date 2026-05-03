export const GAME_CONFIG = {
  width: 960,
  height: 640,
  worldWidth: 1920,
  worldHeight: 1280,
  tileSize: 64,
  playerSpeed: 180,
  dodgeCooldown: 800,
  dodgeInvincibleTime: 500,
  attackCooldown: 1000,
  visionRadius: 160,
  fogGrowthRate: 0.2,
  maxFog: 90,
  inventoryRows: 6,
  inventoryCols: 4,
  bossSpawnChance: 0.15,
  enemySpawnCount: { min: 6, max: 12 },
  treeCount: 24,
};

export const RARITY_COLORS: Record<string, number> = {
  C: 0x9ca3af,
  B: 0x22c55e,
  A: 0x3b82f6,
  S: 0xf59e0b,
};

export const RARITY_NAMES: Record<string, string> = {
  C: '普通',
  B: '优秀',
  A: '史诗',
  S: '传说',
};

export const SLOT_NAMES: Record<string, string> = {
  weapon: '武器',
  helmet: '头盔',
  armor: '衣服',
  pants: '裤子',
  shoes: '鞋子',
  accessory: '首饰',
  offhand: '副手',
};

export function getExpToNextLevel(level: number): number {
  return level * 100;
}

export const MAX_PLAYER_LEVEL = 9;
