import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { INTERNAL_GAME_CONFIG } from '../config/gameConfig';

/**
 * 掉落服务（TASK-BE-004）。
 *
 * 设计要点：
 * 1. **确定性 PRNG**：复用 SpawnService 中相同思路（xmur3 + mulberry32）。
 *    种子：${seed}::${runId}::${enemyTemplateId}::${killSequence}
 *    同一击杀序列（runId + enemyTemplateId + killSequence）必须返回相同结果，
 *    防止断线重连后客户端二次拉取触发重复掉落。
 * 2. **背包容量**：以 PlayerItem where {characterId, runId} 计数为局内背包占用，
 *    超过 INVENTORY_CAPACITY 时跳过新建（不报错），并通过返回值向上层暴露 skipped 数量供审计。
 * 3. **倍率系数**：boss 怪走 INTERNAL_GAME_CONFIG.dropMultiplier.boss，普通怪走 common，
 *    rare 通道当前留作未来精英怪扩展用。
 */

// ============== PRNG（与 SpawnService 同实现，避免耦合）==============

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

function createDeterministicRng(...parts: (string | number)[]): () => number {
  const composite = parts.map((p) => String(p)).join('::');
  const hasher = xmur3(composite);
  return mulberry32(hasher());
}

// ============== 类型 ==============

const RUN_INVENTORY_CAPACITY = 24; // 与 RunService 一致：6*4=24

export interface DropTableEntry {
  itemId: string;
  chance: number;
}

export interface RolledLootItem {
  id: string;
  templateId: string;
  rarity: string | null;
  name: string;
  slot: string | null;
  description: string | null;
  stats: Partial<Record<string, number>> | null;
  stackCount: number;
  runId: string | null;
  location: string;
}

export interface RollEnemyLootResult {
  items: RolledLootItem[];
  skippedDueToFull: number;
  totalRolled: number;
}

interface EnemyTemplateLite {
  id: string;
  isBoss: boolean;
  dropTableJson: string | null;
}

// ============== 公开 API ==============

/**
 * 怪物掉落抽奖。
 *
 * @param seed         Run.seed
 * @param runId        当前 Run id（也用作 PlayerItem.runId）
 * @param enemyTemplate 已查到的敌人模板
 * @param characterId  归属角色
 * @param killSequence 当前角色击杀该敌人模板的累计次数（确定性输入）
 */
export async function rollEnemyLoot(
  seed: string,
  runId: string,
  enemyTemplate: EnemyTemplateLite,
  characterId: string,
  killSequence: number
): Promise<RollEnemyLootResult> {
  let dropTable = parseDropTable(enemyTemplate.dropTableJson);
  if (dropTable.length === 0) {
    // 兜底：从内存敌人数据获取掉落表
    const { ENEMIES } = require('../../phaser-demo/src/data/enemies');
    const memEnemy = ENEMIES.find((e: any) => e.id === enemyTemplate.id);
    if (memEnemy?.dropTable) {
      dropTable = memEnemy.dropTable.map((d: any) => ({ itemId: d.itemId, chance: d.chance }));
    }
  }
  if (dropTable.length === 0) {
    return { items: [], skippedDueToFull: 0, totalRolled: 0 };
  }

  const multiplier = enemyTemplate.isBoss
    ? INTERNAL_GAME_CONFIG.dropMultiplier.boss
    : INTERNAL_GAME_CONFIG.dropMultiplier.common;

  const rng = createDeterministicRng(seed, runId, enemyTemplate.id, killSequence);

  // 当前局内背包占用
  let runInventoryUsed = await prisma.playerItem.count({
    where: { characterId, runId },
  });

  const winners: DropTableEntry[] = [];
  for (const entry of dropTable) {
    const roll = rng();
    const adjustedChance = Math.max(0, Math.min(1, entry.chance * multiplier));
    if (roll < adjustedChance) {
      winners.push(entry);
    }
  }

  const items: RolledLootItem[] = [];
  let skippedDueToFull = 0;

  if (winners.length === 0) {
    return { items, skippedDueToFull: 0, totalRolled: 0 };
  }

  // 一次性查 ItemTemplate（用于校验 itemId 真实存在 + 序列化展示信息）
  const templateIds = Array.from(new Set(winners.map((w) => w.itemId)));
  const templates = await prisma.itemTemplate.findMany({
    where: { id: { in: templateIds } },
    select: {
      id: true,
      name: true,
      slot: true,
      rarity: true,
      description: true,
      baseStatsJson: true,
    },
  });
  const tplMap = new Map(templates.map((t) => [t.id, t]));

  for (const win of winners) {
    const tpl = tplMap.get(win.itemId);
    if (!tpl) {
      // 配置错乱：dropTable 引用了不存在的物品 → 跳过
      // eslint-disable-next-line no-console
      console.warn(
        `[Loot] 跳过掉落：ItemTemplate 不存在 itemId=${win.itemId} enemyTemplateId=${enemyTemplate.id}`
      );
      continue;
    }

    if (runInventoryUsed >= RUN_INVENTORY_CAPACITY) {
      skippedDueToFull += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[Loot] 局内背包已满，跳过掉落 itemId=${win.itemId} characterId=${characterId} runId=${runId}`
      );
      continue;
    }

    const newId = generateId();
    await prisma.playerItem.create({
      data: {
        id: newId,
        characterId,
        templateId: tpl.id,
        rarity: tpl.rarity ?? null,
        location: 'inventory',
        equippedSlot: null,
        slotPosition: null,
        stackCount: 1,
        obtainedFrom: `kill:${enemyTemplate.id}`,
        runId,
      },
    });
    runInventoryUsed += 1;

    items.push({
      id: newId,
      templateId: tpl.id,
      rarity: tpl.rarity ?? null,
      name: tpl.name,
      slot: tpl.slot ?? null,
      description: tpl.description ?? null,
      stats: tpl.baseStatsJson ? JSON.parse(tpl.baseStatsJson) : null,
      stackCount: 1,
      runId,
      location: 'inventory',
    });
  }

  return { items, skippedDueToFull, totalRolled: winners.length };
}

/**
 * 场景随机掉落（HP 球 / MP 球 / 宝箱占位等）。
 * 当前阶段使用简单硬编码概率表，未来可改为 LootTable 表驱动。
 */
export async function rollScenarioLoot(
  seed: string,
  runId: string,
  source: string,
  characterId: string,
  options?: { x?: number; y?: number; lootTableId?: string }
): Promise<RollEnemyLootResult> {
  const tables: Record<string, DropTableEntry[]> = {
    HP_ORB: [{ itemId: 'hp_potion_small', chance: 0.1 }],
    MP_ORB: [{ itemId: 'mp_potion_small', chance: 0.1 }],
  };

  const table = tables[source] || [];
  if (table.length === 0) {
    return { items: [], skippedDueToFull: 0, totalRolled: 0 };
  }

  // 场景类掉落不挂在某个怪身上，使用 source + 坐标 + 时间窗（按 30 秒粒度）作为种子摘要，
  // 同一秒内重复请求会得到同样结果（避免点击 spam 抽奖）。
  const bucket = Math.floor(Date.now() / 30_000);
  const x = options?.x ?? 0;
  const y = options?.y ?? 0;
  const rng = createDeterministicRng(seed, runId, source, x, y, bucket);

  let runInventoryUsed = await prisma.playerItem.count({
    where: { characterId, runId },
  });

  const items: RolledLootItem[] = [];
  let skippedDueToFull = 0;
  let totalRolled = 0;

  for (const entry of table) {
    const roll = rng();
    if (roll < entry.chance) {
      totalRolled += 1;
      const tpl = await prisma.itemTemplate.findUnique({
        where: { id: entry.itemId },
        select: { id: true, name: true, slot: true, rarity: true, description: true, baseStatsJson: true },
      });
      if (!tpl) continue;

      if (runInventoryUsed >= RUN_INVENTORY_CAPACITY) {
        skippedDueToFull += 1;
        continue;
      }

      const newId = generateId();
      await prisma.playerItem.create({
        data: {
          id: newId,
          characterId,
          templateId: tpl.id,
          rarity: tpl.rarity ?? null,
          location: 'inventory',
          equippedSlot: null,
          slotPosition: null,
          stackCount: 1,
          obtainedFrom: `scenario:${source}`,
          runId,
        },
      });
      runInventoryUsed += 1;

      items.push({
        id: newId,
        templateId: tpl.id,
        rarity: tpl.rarity ?? null,
        name: tpl.name,
        slot: tpl.slot ?? null,
        description: tpl.description ?? null,
        stats: tpl.baseStatsJson ? JSON.parse(tpl.baseStatsJson) : null,
        stackCount: 1,
        runId,
        location: 'inventory',
      });
    }
  }

  return { items, skippedDueToFull, totalRolled };
}

// ============== 工具 ==============

function parseDropTable(json: string | null): DropTableEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e: any) =>
          e &&
          typeof e.itemId === 'string' &&
          typeof e.chance === 'number' &&
          e.chance > 0
      )
      .map((e: any) => ({ itemId: e.itemId, chance: e.chance }));
  } catch {
    return [];
  }
}
