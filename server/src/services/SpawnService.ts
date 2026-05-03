import { prisma } from '../config/database';
import { PUBLIC_GAME_CONFIG } from '../config/gameConfig';

/**
 * 服务器端怪物刷新与传送门坐标生成服务。
 *
 * 设计目标：
 * 1. **确定性**：同 seed + depth 必须返回相同结果（多人同步与反作弊基础）。
 * 2. **简单可控**：本期使用 mulberry32 + xmur3，避免引入额外依赖。
 * 3. **未来可扩展**：所有随机消耗集中在 `RngContext`，便于后续替换为更强 PRNG。
 */

// ============== PRNG ==============

/**
 * xmur3：将任意字符串散列为 32 位种子（输出函数）。
 * https://stackoverflow.com/a/47593316
 */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/**
 * mulberry32：32 位种子的轻量 PRNG，周期 2^32，质量适合本场景。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RngContext {
  next: () => number;
  /** [min, max] 闭区间整数 */
  nextInt: (min: number, max: number) => number;
  /** [min, max) 浮点 */
  nextFloat: (min: number, max: number) => number;
  pick: <T>(arr: T[]) => T;
}

function createRng(seed: string, depth: number, scope: string): RngContext {
  const composite = `${seed}::${depth}::${scope}`;
  const hasher = xmur3(composite);
  const rand = mulberry32(hasher());
  return {
    next: rand,
    nextInt: (min, max) => Math.floor(rand() * (max - min + 1)) + min,
    nextFloat: (min, max) => rand() * (max - min) + min,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
  };
}

// ============== 类型 ==============

export interface SpawnPoint {
  enemyTemplateId: string;
  x: number;
  y: number;
}

export interface PortalPoint {
  x: number;
  y: number;
}

// ============== 模板缓存 ==============

interface EnemyTemplateLite {
  id: string;
  isBoss: boolean;
}

let templatesCache: EnemyTemplateLite[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 分钟简单 TTL

async function getEnemyTemplates(): Promise<EnemyTemplateLite[]> {
  const now = Date.now();
  if (templatesCache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return templatesCache;
  }
  const rows = await prisma.enemyTemplate.findMany({
    select: { id: true, isBoss: true },
  });
  templatesCache = rows.sort((a, b) => a.id.localeCompare(b.id));
  cacheLoadedAt = now;
  return templatesCache;
}

/** 测试或开发时强制清缓存 */
export function clearSpawnCache() {
  templatesCache = null;
  cacheLoadedAt = 0;
}

// ============== 公开 API ==============

/**
 * 根据 seed + depth 生成怪物刷新点。
 * 同 seed + depth 多次调用返回完全一致的结果。
 *
 * @param sceneKey 场景标识（默认 forest），保留扩展位以便后续按场景切换尺寸/敌人池
 */
export async function generateSpawns(
  seed: string,
  depth: number,
  sceneKey = 'forest'
): Promise<SpawnPoint[]> {
  const templates = await getEnemyTemplates();
  if (templates.length === 0) return [];

  const normalEnemies = templates.filter((t) => !t.isBoss);
  const bossEnemies = templates.filter((t) => t.isBoss);

  const { worldWidth, worldHeight, enemySpawnCount, bossSpawnChance } = PUBLIC_GAME_CONFIG;

  const rng = createRng(seed, depth, `spawns:${sceneKey}`);

  const spawns: SpawnPoint[] = [];

  // 普通怪生成数量
  const count = rng.nextInt(enemySpawnCount.min, enemySpawnCount.max);

  // 边界 padding，避免贴边
  const padX = 80;
  const padY = 80;

  if (normalEnemies.length > 0) {
    for (let i = 0; i < count; i++) {
      const enemy = rng.pick(normalEnemies);
      const x = rng.nextInt(padX, worldWidth - padX);
      const y = rng.nextInt(padY, worldHeight - padY);
      spawns.push({ enemyTemplateId: enemy.id, x, y });
    }
  }

  // Boss：按概率刷新
  if (bossEnemies.length > 0 && rng.next() < bossSpawnChance) {
    const boss = rng.pick(bossEnemies);
    const x = rng.nextInt(padX, worldWidth - padX);
    const y = rng.nextInt(padY, worldHeight - padY);
    spawns.push({ enemyTemplateId: boss.id, x, y });
  }

  return spawns;
}

/**
 * 生成传送门坐标。
 * 简单版本：靠近世界右下"远端"区域，半径内随机抖动。
 */
export function generatePortal(seed: string, depth: number, sceneKey = 'forest'): PortalPoint {
  const { worldWidth, worldHeight } = PUBLIC_GAME_CONFIG;
  const rng = createRng(seed, depth, `portal:${sceneKey}`);

  // 远端锚点
  const anchorX = worldWidth - 200;
  const anchorY = worldHeight - 200;
  const jitter = 80;

  const x = Math.round(anchorX + rng.nextFloat(-jitter, jitter));
  const y = Math.round(anchorY + rng.nextFloat(-jitter, jitter));

  return { x, y };
}
