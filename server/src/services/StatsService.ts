/**
 * StatsService（TASK-BE-EQUIP-INVENTORY 配套服务）
 *
 * 单一职责：根据角色基础属性 + 当前装备的 PlayerItem.statsJson + ItemEnchantment.bonusStatsJson
 * 计算最终属性，并 upsert 到 CharacterStats（baseHp/baseMp/... 等基础字段不动，
 * 装备加成不写回 CharacterStats，仅作为返回值供前端 patch / 回显使用）。
 *
 * 注意事项：
 * - 与 CharacterService.computeStats 保持一致的累加规则（hp/maxHp、mp/maxMp 兼容写法都加到 maxHp/maxMp 上）。
 * - 装备只统计「主城物品」（runId = null）的 equipped:true，
 *   局内 Run 中的装备由前端 RunState 自行结算，本服务不参与（避免主城 stats 被局内换装污染）。
 * - 强化加成：若 PlayerItem 关联了 ItemEnchantment，则把 bonusStatsJson 也累加到装备加成中。
 * - 等级缩放：finalStats = floor(base * (1 + (level - 1) * 0.05))，与 CharacterService.computeStats 一致。
 */

import { prisma } from '../config/database';

export interface FinalStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  fogResist: number;
  availableStatPoints: number;
  baseHp: number;
  baseMp: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  equipmentBonus: {
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
  };
}

function safeParseStats(s: string | null | undefined): Record<string, number> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, number>;
  } catch {
    return {};
  }
}

function accumulateStats(
  bonus: { maxHp: number; maxMp: number; attack: number; defense: number; speed: number },
  stats: Record<string, number>
) {
  if (stats.hp) bonus.maxHp += stats.hp;
  if (stats.maxHp) bonus.maxHp += stats.maxHp;
  if (stats.mp) bonus.maxMp += stats.mp;
  if (stats.maxMp) bonus.maxMp += stats.maxMp;
  if (stats.attack) bonus.attack += stats.attack;
  if (stats.defense) bonus.defense += stats.defense;
  if (stats.speed) bonus.speed += stats.speed;
}

/**
 * 重新计算并返回角色 stats。
 *
 * 不会修改 CharacterStats.baseHp/baseMp 等基础字段（这些字段属于角色基础值，由职业初始化与升级流程决定）。
 * 仅在数据库中 upsert 一次空的 update 以触发 updatedAt（如果未来有相关需求可在此追加）。
 *
 * 实际的「装备加成」直接通过返回值给上层使用，不持久化到 CharacterStats 表。
 */
export async function recalculate(characterId: string): Promise<FinalStats> {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      stats: true,
      items: {
        where: {
          location: 'equipped',
          runId: null, // 仅统计主城装备
        },
        include: {
          enchantment: true,
        },
      },
    },
  });

  if (!char) {
    const err: any = new Error('角色不存在');
    err.statusCode = 404;
    throw err;
  }

  const baseStats = char.stats ?? {
    baseHp: 0,
    baseMp: 0,
    baseAttack: 0,
    baseDefense: 0,
    baseSpeed: 0,
    fogResist: 0,
    availableStatPoints: 0,
  };

  const levelMultiplier = 1 + (char.level - 1) * 0.05;
  const base = {
    maxHp: Math.floor(baseStats.baseHp * levelMultiplier),
    maxMp: Math.floor(baseStats.baseMp * levelMultiplier),
    attack: Math.floor(baseStats.baseAttack * levelMultiplier),
    defense: Math.floor(baseStats.baseDefense * levelMultiplier),
    speed: Math.floor(baseStats.baseSpeed * levelMultiplier),
  };

  const bonus = { maxHp: 0, maxMp: 0, attack: 0, defense: 0, speed: 0 };
  for (const item of char.items) {
    accumulateStats(bonus, safeParseStats(item.statsJson));
    if (item.enchantment) {
      accumulateStats(bonus, safeParseStats(item.enchantment.bonusStatsJson));
    }
  }

  const final: FinalStats = {
    hp: base.maxHp + bonus.maxHp,
    maxHp: base.maxHp + bonus.maxHp,
    mp: base.maxMp + bonus.maxMp,
    maxMp: base.maxMp + bonus.maxMp,
    attack: base.attack + bonus.attack,
    defense: base.defense + bonus.defense,
    speed: base.speed + bonus.speed,
    fogResist: baseStats.fogResist,
    availableStatPoints: baseStats.availableStatPoints,
    baseHp: base.maxHp,
    baseMp: base.maxMp,
    baseAttack: base.attack,
    baseDefense: base.defense,
    baseSpeed: base.speed,
    equipmentBonus: bonus,
  };

  // 不直接修改 CharacterStats（避免覆盖基础属性），仅作为计算结果返回。
  return final;
}
