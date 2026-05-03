import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { ItemRarity, ItemSlot, ClassType, Snapshot } from '../types/game';
import { gainExp } from './ExpService';
import { flagAnomaly } from './AntiCheatService';
import { createAuditLog } from './AuditService';
import { incrementKillSequence } from './RunService';
import {
  rollEnemyLoot,
  rollScenarioLoot,
  RolledLootItem,
} from './LootService';
import {
  equipItem as equipItemSvc,
  unequipItem as unequipItemSvc,
  EquipResult,
  UnequipResult,
} from './EquipmentService';
import {
  moveInventoryItem as moveInventoryItemSvc,
  sortInventory as sortInventorySvc,
  discardInventoryItem as discardInventoryItemSvc,
  useItem as useItemSvc,
  UseItemResult,
} from './InventoryService';

export interface GameSavePayload {
  selectedClass: ClassType | null;
  cityInventory: { item: any | null }[];
  cityEquipment: Record<ItemSlot, any | null>;
  talentProgress: Record<string, number>;
  gold: number;
  bestiary: string[];
  equipmentCodex: string[];
  level: number;
  exp: number;
  skillLevels: Record<string, number>;
}

export async function createCharacter(
  userId: string,
  name: string,
  classType: ClassType
) {
  const startingWeaponId =
    classType === 'warrior' ? 'rusty_sword' :
    classType === 'mage' ? 'cracked_wand' :
    'wooden_staff';

  const startingItems = [
    { templateId: startingWeaponId, equippedSlot: 'weapon' as const },
    { templateId: 'cloth_helm', equippedSlot: 'helmet' as const },
    { templateId: 'leather_armor', equippedSlot: 'armor' as const },
    { templateId: 'cloth_pants', equippedSlot: 'pants' as const },
    { templateId: 'old_boots', equippedSlot: 'shoes' as const },
    { templateId: 'wooden_shield', equippedSlot: 'offhand' as const },
    { templateId: 'copper_ring', equippedSlot: 'accessory' as const },
  ];

  const char = await prisma.character.create({
    data: {
      id: generateId(),
      userId,
      name,
      classType,
      level: 1,
      exp: 0,
      gold: 0,
      stats: {
        create: getBaseStatsForClass(classType),
      },
      skills: {
        create: getDefaultSkillsForClass(classType),
      },
      items: {
        create: startingItems.map((it) => ({
          id: generateId(),
          templateId: it.templateId,
          location: 'equipped',
          equippedSlot: it.equippedSlot,
          stackCount: 1,
        })),
      },
    },
    include: { stats: true, skills: true, items: { include: { template: true } } },
  });
  return char;
}

export async function getCharactersByUser(userId: string) {
  return prisma.character.findMany({
    where: { userId },
    include: { stats: true },
  });
}

export async function getCharacterWithSave(characterId: string) {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      stats: true,
      skills: true,
      talents: true,
      items: {
        include: { template: true },
      },
      bestiary: true,
      equipmentCodex: true,
    },
  });
  if (!char) return null;

  // 组装成前端 GameSave 格式
  const cityInventory = Array.from({ length: 24 }, (_, i) => {
    const item = char.items.find((pi) => pi.location === 'inventory' && pi.slotPosition === i);
    return { item: item ? serializeItem(item) : null };
  });

  const cityEquipment: Record<string, any | null> = {
    weapon: null,
    helmet: null,
    armor: null,
    pants: null,
    shoes: null,
    accessory: null,
    offhand: null,
  };
  for (const it of char.items) {
    if (it.location === 'equipped' && it.equippedSlot) {
      cityEquipment[it.equippedSlot] = serializeItem(it);
    }
  }

  const skillLevels: Record<string, number> = {};
  for (const s of char.skills) {
    skillLevels[s.skillId] = s.level;
  }

  const talentProgress: Record<string, number> = {};
  for (const t of char.talents) {
    talentProgress[t.talentId] = t.pointsInvested;
  }

  return {
    id: char.id,
    name: char.name,
    classType: char.classType,
    selectedClass: char.classType as ClassType,
    cityInventory,
    cityEquipment,
    talentProgress,
    gold: char.gold,
    bestiary: char.bestiary.map((b) => b.enemyTemplateId),
    equipmentCodex: char.equipmentCodex.map((c) => c.templateId),
    level: char.level,
    exp: char.exp,
    skillLevels,
    skillPoints: char.stats?.skillPoints ?? 0,
  };
}

export async function saveCharacterData(characterId: string, payload: GameSavePayload) {
  const char = await prisma.character.findUnique({ where: { id: characterId } });
  if (!char) throw new Error('角色不存在');

  // 更新角色基础属性
  await prisma.character.update({
    where: { id: characterId },
    data: {
      level: payload.level,
      exp: payload.exp,
      gold: payload.gold,
      classType: payload.selectedClass || char.classType,
    },
  });

  // 更新技能等级
  for (const [skillId, level] of Object.entries(payload.skillLevels)) {
    await prisma.characterSkill.upsert({
      where: { characterId_skillId: { characterId, skillId } },
      create: { characterId, skillId, level },
      update: { level },
    });
  }

  // 更新天赋
  for (const [talentId, points] of Object.entries(payload.talentProgress)) {
    await prisma.characterTalent.upsert({
      where: { characterId_talentId: { characterId, talentId } },
      create: { characterId, talentId, pointsInvested: points },
      update: { pointsInvested: points },
    });
  }

  // 图鉴：幂等写入（仅确保记录存在，不修改 killCount）
  // 真正的 killCount 累加由 handleKillEnemy 负责
  for (const enemyId of payload.bestiary) {
    await prisma.playerBestiary.upsert({
      where: { characterId_enemyTemplateId: { characterId, enemyTemplateId: enemyId } },
      create: { characterId, enemyTemplateId: enemyId, killCount: 1, firstKillAt: new Date() },
      update: {},
    });
  }

  for (const templateId of payload.equipmentCodex) {
    await prisma.playerEquipmentCodex.upsert({
      where: { characterId_templateId: { characterId, templateId } },
      create: { characterId, templateId, firstObtainAt: new Date(), obtainCount: 1 },
      update: { obtainCount: { increment: 1 } },
    });
  }

  // 物品：仅删除主城物品（runId=null），保留局内物品（runId 非空）以避免在 Run 期间整包 save 误删局内物品（TASK-BE-003）
  await prisma.playerItem.deleteMany({
    where: { characterId, runId: null },
  });

  const itemsToCreate: any[] = [];

  // 背包物品（主城）
  payload.cityInventory.forEach((slot, index) => {
    if (slot.item) {
      itemsToCreate.push({
        id: generateId(),
        characterId,
        templateId: slot.item.id,
        rarity: slot.item.rarity,
        statsJson: slot.item.stats ? JSON.stringify(slot.item.stats) : null,
        location: 'inventory',
        slotPosition: index,
        stackCount: 1,
        runId: null, // 显式置 null：主城物品语义
      });
    }
  });

  // 装备栏物品（主城）
  for (const [slot, item] of Object.entries(payload.cityEquipment)) {
    if (item) {
      itemsToCreate.push({
        id: generateId(),
        characterId,
        templateId: item.id,
        rarity: item.rarity,
        statsJson: item.stats ? JSON.stringify(item.stats) : null,
        location: 'equipped',
        equippedSlot: slot,
        stackCount: 1,
        runId: null, // 显式置 null：主城物品语义
      });
    }
  }

  if (itemsToCreate.length > 0) {
    await prisma.playerItem.createMany({ data: itemsToCreate });
  }

  return { success: true };
}

function serializeItem(it: any) {
  return {
    id: it.templateId,
    instanceId: it.id,
    name: it.template?.name || it.templateId,
    rarity: it.rarity || it.template?.rarity || 'C',
    slot: it.equippedSlot || it.template?.slot || 'weapon',
    stats: it.statsJson ? JSON.parse(it.statsJson) : {},
    description: it.template?.description || '',
  };
}

function getBaseStatsForClass(classType: ClassType) {
  switch (classType) {
    case 'warrior':
      return { baseHp: 150, baseMp: 50, baseAttack: 15, baseDefense: 10, baseSpeed: 160, fogResist: 5 };
    case 'mage':
      return { baseHp: 100, baseMp: 100, baseAttack: 20, baseDefense: 5, baseSpeed: 150, fogResist: 8 };
    case 'sage':
      return { baseHp: 120, baseMp: 80, baseAttack: 12, baseDefense: 8, baseSpeed: 155, fogResist: 10 };
    default:
      return { baseHp: 100, baseMp: 50, baseAttack: 10, baseDefense: 5, baseSpeed: 150, fogResist: 5 };
  }
}

export async function getCharacterInventory(characterId: string) {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      items: {
        include: { template: true },
      },
    },
  });
  if (!char) return null;

  const cityInventory = Array.from({ length: 24 }, (_, i) => {
    const item = char.items.find((pi) => pi.location === 'inventory' && pi.slotPosition === i);
    return { item: item ? serializeItem(item) : null };
  });

  const cityEquipment: Record<string, any | null> = {
    weapon: null,
    helmet: null,
    armor: null,
    pants: null,
    shoes: null,
    accessory: null,
    offhand: null,
  };
  for (const it of char.items) {
    if (it.location === 'equipped' && it.equippedSlot) {
      cityEquipment[it.equippedSlot] = serializeItem(it);
    }
  }

  return { cityInventory, cityEquipment };
}

function getDefaultSkillsForClass(classType: ClassType) {
  const skills: { skillId: string; level: number; unlockedAt?: Date }[] = [];
  if (classType === 'warrior') {
    skills.push({ skillId: 'slash', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'whirlwind', level: 1, unlockedAt: new Date() });
  } else if (classType === 'mage') {
    skills.push({ skillId: 'fireball', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'meteor', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'manaOverflow', level: 1, unlockedAt: new Date() });
  } else if (classType === 'sage') {
    skills.push({ skillId: 'heal', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'curse', level: 1, unlockedAt: new Date() });
  }
  return skills;
}

export interface CharacterStatsResult {
  baseStats: {
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
    fogResist: number;
  };
  equipmentBonus: {
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
  };
  finalStats: {
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    speed: number;
  };
}

function computeStats(
  baseHp: number,
  baseMp: number,
  baseAttack: number,
  baseDefense: number,
  baseSpeed: number,
  fogResist: number,
  level: number,
  equipmentItems: { statsJson: string | null }[]
): CharacterStatsResult {
  const levelMultiplier = 1 + (level - 1) * 0.05;

  const bonus = { maxHp: 0, maxMp: 0, attack: 0, defense: 0, speed: 0 };
  for (const item of equipmentItems) {
    if (!item.statsJson) continue;
    try {
      const stats = JSON.parse(item.statsJson) as Record<string, number>;
      if (stats.hp) bonus.maxHp += stats.hp;
      if (stats.maxHp) bonus.maxHp += stats.maxHp;
      if (stats.mp) bonus.maxMp += stats.mp;
      if (stats.maxMp) bonus.maxMp += stats.maxMp;
      if (stats.attack) bonus.attack += stats.attack;
      if (stats.defense) bonus.defense += stats.defense;
      if (stats.speed) bonus.speed += stats.speed;
    } catch {
      // ignore invalid json
    }
  }

  const base = {
    maxHp: Math.floor(baseHp * levelMultiplier),
    maxMp: Math.floor(baseMp * levelMultiplier),
    attack: Math.floor(baseAttack * levelMultiplier),
    defense: Math.floor(baseDefense * levelMultiplier),
    speed: Math.floor(baseSpeed * levelMultiplier),
    fogResist,
  };

  return {
    baseStats: base,
    equipmentBonus: bonus,
    finalStats: {
      maxHp: base.maxHp + bonus.maxHp,
      maxMp: base.maxMp + bonus.maxMp,
      attack: base.attack + bonus.attack,
      defense: base.defense + bonus.defense,
      speed: base.speed + bonus.speed,
    },
  };
}

export async function getCharacterStats(characterId: string): Promise<CharacterStatsResult> {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      stats: true,
      items: {
        where: { location: 'equipped' },
        select: { statsJson: true },
      },
    },
  });
  if (!char || !char.stats) throw new Error('角色不存在');

  const s = char.stats;
  return computeStats(
    s.baseHp, s.baseMp, s.baseAttack, s.baseDefense, s.baseSpeed, s.fogResist,
    char.level,
    char.items
  );
}

export async function calculateCharacterStats(
  characterId: string,
  overrideEquipment?: Record<string, any | null>
): Promise<CharacterStatsResult> {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: { stats: true },
  });
  if (!char || !char.stats) throw new Error('角色不存在');

  let items: { statsJson: string | null }[] = [];
  if (overrideEquipment) {
    for (const [, item] of Object.entries(overrideEquipment)) {
      if (item && item.stats) {
        items.push({ statsJson: JSON.stringify(item.stats) });
      }
    }
  } else {
    items = await prisma.playerItem.findMany({
      where: { characterId, location: 'equipped' },
      select: { statsJson: true },
    });
  }

  const s = char.stats;
  return computeStats(
    s.baseHp, s.baseMp, s.baseAttack, s.baseDefense, s.baseSpeed, s.fogResist,
    char.level,
    items
  );
}

export async function getCharacterSkills(characterId: string, playerLevel: number) {
  const char = await prisma.character.findUnique({
    where: { id: characterId },
    select: { classType: true },
  });
  if (!char) throw new Error('角色不存在');

  // 获取该职业所有技能模板
  const templates = await prisma.skillTemplate.findMany({
    where: { classType: char.classType },
    orderBy: { requiredLevel: 'asc' },
  });

  // 获取角色已解锁的技能
  const unlocked = await prisma.characterSkill.findMany({
    where: { characterId },
  });
  const unlockedMap = new Map(unlocked.map((s) => [s.skillId, s]));

  return templates.map((t) => {
    const u = unlockedMap.get(t.id);
    return {
      skillId: t.id,
      name: t.name,
      description: t.description,
      classType: t.classType,
      type: t.type,
      requiredLevel: t.requiredLevel,
      cooldown: t.cooldown,
      mpCost: t.mpCost,
      damage: t.damage,
      damagePercent: t.damagePercent,
      range: t.range,
      aoe: t.aoe,
      maxLevel: t.maxLevel,
      unlocked: !!u && playerLevel >= t.requiredLevel,
      currentLevel: u?.level ?? 1,
      unlockedAt: u?.unlockedAt?.toISOString() ?? null,
    };
  });
}

// ============================================================
// 启动期快照：一次性返回完整 GameSave + 详细元数据
// 单次查询（include 链），不进行 N+1
// 仅返回主城物品（runId = null），装备物品 equipped:true 与背包物品 equipped:false 都包含
// 入参 characterId；归属校验由 route 层处理（用 getCharacterOwner 辅助）
// ============================================================

export async function getCharacterOwner(characterId: string): Promise<string | null> {
  const c = await prisma.character.findUnique({
    where: { id: characterId },
    select: { userId: true },
  });
  return c?.userId ?? null;
}

const INVENTORY_CAPACITY_SNAPSHOT = 24;

/**
 * 防御性兜底：把 (runId=null, location='inventory', slotPosition=null) 的孤儿物品
 * 就地分配到 0..23 中最低未占用槽位并持久化。
 *
 * 历史背景：旧版 RunService.extractRun 使用 updateMany 合并物品时未设置 slotPosition，
 * 导致 getCharacterSnapshot 中按 slotPosition===i 匹配时永远漏掉这些物品（实际数据没丢）。
 * 此函数确保下一次 snapshot 调用时把孤儿物品补回主城背包视图，且仅在确实存在孤儿时执行。
 */
async function reconcileOrphanInventoryItems(characterId: string): Promise<void> {
  const orphans = await prisma.playerItem.findMany({
    where: {
      characterId,
      runId: null,
      location: 'inventory',
      slotPosition: null,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (orphans.length === 0) return;

  // 在事务内重新读取已占用槽位 + 逐条 update，避免并发竞争。
  await prisma.$transaction(async (tx) => {
    const occupiedItems = await tx.playerItem.findMany({
      where: {
        characterId,
        runId: null,
        location: 'inventory',
        slotPosition: { not: null },
      },
      select: { slotPosition: true },
    });
    const occupied = new Set<number>();
    for (const it of occupiedItems) {
      if (typeof it.slotPosition === 'number' && it.slotPosition >= 0) {
        occupied.add(it.slotPosition);
      }
    }

    let cursor = 0;
    for (const orphan of orphans) {
      while (cursor < INVENTORY_CAPACITY_SNAPSHOT && occupied.has(cursor)) {
        cursor++;
      }
      if (cursor >= INVENTORY_CAPACITY_SNAPSHOT) {
        // 没有空位（极端：背包已被装备/有效物占满）；保留 slotPosition=null，下次再试
        break;
      }
      occupied.add(cursor);
      await tx.playerItem.update({
        where: { id: orphan.id },
        data: { slotPosition: cursor },
      });
      cursor++;
    }
  });
}

export async function getCharacterSnapshot(characterId: string): Promise<Snapshot | null> {
  // 防御性兜底：修复历史孤儿物品（runId=null && location='inventory' && slotPosition=null）
  // 这些数据可能由历史 extractRun 旧版 updateMany（不分配 slotPosition）残留产生。
  // 仅在发现孤儿时执行；用事务避免并发竞争。
  await reconcileOrphanInventoryItems(characterId);

  const char = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      stats: true,
      skills: { include: { skill: true } },
      talents: true,
      // 仅取主城物品（runId = null）；装备和背包物品都属于主城（用 equipped 区分）
      items: {
        where: { runId: null },
        include: {
          template: true,
          enchantment: true,
        },
      },
      bestiary: true,
      equipmentCodex: true,
    },
  });
  if (!char) return null;

  // ----- cityInventory：背包 24 格 -----
  const cityInventory = Array.from({ length: 24 }, (_, i) => {
    const item = char.items.find(
      (pi) => pi.location === 'inventory' && pi.slotPosition === i
    );
    return { item: item ? serializeItemFull(item) : null };
  });

  // ----- cityEquipment：7 个装备槽位 -----
  const cityEquipment: Record<string, any | null> = {
    weapon: null,
    helmet: null,
    armor: null,
    pants: null,
    shoes: null,
    accessory: null,
    offhand: null,
  };
  for (const it of char.items) {
    if (it.location === 'equipped' && it.equippedSlot) {
      cityEquipment[it.equippedSlot] = serializeItemFull(it);
    }
  }

  // ----- skillLevels & skills 详细 -----
  const skillLevels: Record<string, number> = {};
  const skillsDetailed = char.skills.map((s) => {
    skillLevels[s.skillId] = s.level;
    return {
      skillId: s.skillId,
      level: s.level,
      unlockedAt: s.unlockedAt?.toISOString() ?? null,
      name: s.skill?.name,
      description: s.skill?.description,
      type: s.skill?.type,
      classType: s.skill?.classType,
      requiredLevel: s.skill?.requiredLevel,
      cooldown: s.skill?.cooldown,
      mpCost: s.skill?.mpCost,
      damage: s.skill?.damage ?? null,
      damagePercent: s.skill?.damagePercent ?? null,
      range: s.skill?.range ?? null,
      aoe: s.skill?.aoe,
      maxLevel: s.skill?.maxLevel ?? null,
      tier: s.skill?.tier,
      prerequisiteId: s.skill?.prerequisiteId ?? null,
    };
  });

  // ----- talentProgress -----
  const talentProgress: Record<string, number> = {};
  for (const t of char.talents) {
    talentProgress[t.talentId] = t.pointsInvested;
  }

  // ----- bestiary（GameSave 字段：仅 ID 列表；外加详细 entries）-----
  const bestiaryIds = char.bestiary.map((b) => b.enemyTemplateId);
  const bestiaryEntries = char.bestiary.map((b) => ({
    enemyTemplateId: b.enemyTemplateId,
    killCount: b.killCount,
    firstKillAt: b.firstKillAt?.toISOString() ?? null,
    lastKillAt: b.lastKillAt?.toISOString() ?? null,
  }));

  // ----- equipmentCodex -----
  const codexIds = char.equipmentCodex.map((c) => c.templateId);
  const equipmentCodexEntries = char.equipmentCodex.map((c) => ({
    templateId: c.templateId,
    firstObtainAt: c.firstObtainAt?.toISOString() ?? null,
    obtainCount: c.obtainCount,
  }));

  // ----- stats（基础 + 装备汇总）-----
  const baseStats = char.stats ?? {
    baseHp: 0,
    baseMp: 0,
    baseAttack: 0,
    baseDefense: 0,
    baseSpeed: 0,
    fogResist: 0,
    availableStatPoints: 0,
    skillPoints: 0,
  };

  const equippedItems = char.items.filter(
    (i) => i.location === 'equipped'
  );
  const computed = computeStats(
    baseStats.baseHp,
    baseStats.baseMp,
    baseStats.baseAttack,
    baseStats.baseDefense,
    baseStats.baseSpeed,
    baseStats.fogResist,
    char.level,
    equippedItems.map((i) => ({ statsJson: i.statsJson }))
  );

  const stats = {
    hp: computed.finalStats.maxHp,
    maxHp: computed.finalStats.maxHp,
    mp: computed.finalStats.maxMp,
    maxMp: computed.finalStats.maxMp,
    attack: computed.finalStats.attack,
    defense: computed.finalStats.defense,
    speed: computed.finalStats.speed,
    fogResist: computed.baseStats.fogResist,
    availableStatPoints: baseStats.availableStatPoints,
    skillPoints: baseStats.skillPoints,
    baseHp: computed.baseStats.maxHp,
    baseMp: computed.baseStats.maxMp,
    baseAttack: computed.baseStats.attack,
    baseDefense: computed.baseStats.defense,
    baseSpeed: computed.baseStats.speed,
    equipmentBonus: computed.equipmentBonus,
  };

  return {
    // GameSave 兼容字段（保持与旧 getCharacterWithSave 一致的命名）
    selectedClass: char.classType as ClassType,
    cityInventory,
    cityEquipment: cityEquipment as any,
    talentProgress,
    gold: char.gold,
    bestiary: bestiaryIds,
    equipmentCodex: codexIds,
    level: char.level,
    exp: char.exp,
    skillLevels,
    skillPoints: baseStats.skillPoints,

    // 扩展字段
    character: {
      id: char.id,
      name: char.name,
      classType: char.classType as ClassType,
      level: char.level,
      exp: char.exp,
      gold: char.gold,
      totalDeaths: char.totalDeaths,
      totalExtracts: char.totalExtracts,
      deepestDepth: char.deepestDepth,
      totalEnemiesKilled: char.totalEnemiesKilled,
    },
    stats,
    skills: skillsDetailed,
    bestiaryEntries,
    equipmentCodexEntries,
  };
}

// 增强版物品序列化：包含附魔信息（若存在）
function serializeItemFull(it: any) {
  const base = {
    id: it.templateId,
    instanceId: it.id,
    name: it.template?.name || it.templateId,
    rarity: it.rarity || it.template?.rarity || 'C',
    slot: it.equippedSlot || it.template?.slot || 'weapon',
    stats: it.statsJson ? safeParseJson(it.statsJson) : {},
    description: it.template?.description || '',
    stackCount: it.stackCount ?? 1,
  };
  if (it.enchantment) {
    return {
      ...base,
      enchantment: {
        enchantLevel: it.enchantment.enchantLevel,
        bonusStats: it.enchantment.bonusStatsJson
          ? safeParseJson(it.enchantment.bonusStatsJson)
          : {},
      },
    };
  }
  return base;
}

function safeParseJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ============================================================
// TASK-BE-004：击杀敌人处理
// ============================================================

/** 内存级最近一次击杀同一 enemyTemplate 的时间戳，用于 KILL_RATE 简易判定 */
const lastKillByCharEnemy = new Map<string, number>();
const KILL_RATE_THRESHOLD_MS = 200;

export interface HandleKillEnemyInput {
  enemyTemplateId: string;
  runId: string;
}

export interface HandleKillEnemyResult {
  exp: number;
  level: number;
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
  levelUps: number;
  statsAwarded: number;
  newItems: RolledLootItem[];
  bestiaryEntry: {
    templateId: string;
    killCount: number;
    firstKill: boolean;
  };
}

/**
 * 处理一次怪物击杀（端点 POST /api/characters/:id/kill）。
 *
 * 步骤：
 * 1. 校验 character 归属
 * 2. 校验 Run 存在、归属 character、状态 IN_PROGRESS（result == null && endedAt == null）
 *    → 否则写 LOOT_INVALID_RUN flag，抛 403
 * 3. 校验 EnemyTemplate 存在 → 否则抛 400
 * 4. KILL_RATE 检测（同一 enemyTemplate < 200ms 内重复）
 * 5. ExpService.gainExp（KILL_ENEMY）
 * 6. PlayerBestiary upsert（killCount += 1）
 * 7. RunService.incrementKillSequence(runId) → killSequence
 * 8. LootService.rollEnemyLoot(seed, runId, template, characterId, killSequence)
 * 9. AuditLog（KILL_ENEMY）
 */
export async function handleKillEnemy(
  userId: string,
  characterId: string,
  input: HandleKillEnemyInput,
  clientIp?: string
): Promise<HandleKillEnemyResult> {
  // 1) 角色归属
  const ownerId = await getCharacterOwner(characterId);
  if (ownerId === null) {
    const err: any = new Error('角色不存在');
    err.statusCode = 404;
    throw err;
  }
  if (ownerId !== userId) {
    await flagAnomaly({
      reason: 'CHARACTER_OWNERSHIP_VIOLATION',
      characterId,
      details: {
        endpoint: 'handleKillEnemy',
        actualOwner: ownerId,
        requestedBy: userId,
      },
      confidence: 90,
    });
    const err: any = new Error('无权操作该角色');
    err.statusCode = 403;
    throw err;
  }

  if (!input.enemyTemplateId || !input.runId) {
    const err: any = new Error('缺少 enemyTemplateId 或 runId');
    err.statusCode = 400;
    throw err;
  }

  // 2) 校验 Run（存在 + 归属 + 进行中）
  const run = await prisma.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      characterId: true,
      seed: true,
      result: true,
      endedAt: true,
    },
  });
  if (!run || run.characterId !== characterId || run.result !== null || run.endedAt !== null) {
    await flagAnomaly({
      reason: 'LOOT_INVALID_RUN',
      characterId,
      details: {
        runId: input.runId,
        enemyTemplateId: input.enemyTemplateId,
        runFound: !!run,
        belongsToCharacter: run ? run.characterId === characterId : false,
        result: run?.result ?? null,
        endedAt: run?.endedAt ?? null,
      },
      confidence: 70,
    });
    const err: any = new Error('Run 不存在或已结束');
    err.statusCode = 403;
    throw err;
  }

  // 3) 校验 EnemyTemplate
  const enemyTemplate = await prisma.enemyTemplate.findUnique({
    where: { id: input.enemyTemplateId },
    select: {
      id: true,
      isBoss: true,
      expValue: true,
      dropTableJson: true,
    },
  });
  if (!enemyTemplate) {
    const err: any = new Error(`EnemyTemplate 不存在: ${input.enemyTemplateId}`);
    err.statusCode = 400;
    throw err;
  }

  // 4) KILL_RATE 检测
  const rateKey = `${characterId}::${input.enemyTemplateId}`;
  const now = Date.now();
  const last = lastKillByCharEnemy.get(rateKey);
  if (last && now - last < KILL_RATE_THRESHOLD_MS) {
    await flagAnomaly({
      reason: 'KILL_RATE',
      characterId,
      details: {
        enemyTemplateId: input.enemyTemplateId,
        runId: input.runId,
        deltaMs: now - last,
        thresholdMs: KILL_RATE_THRESHOLD_MS,
      },
      confidence: 40,
    });
  }
  lastKillByCharEnemy.set(rateKey, now);

  // 5) 经验
  const expResult = await gainExp(
    userId,
    characterId,
    {
      source: 'KILL_ENEMY',
      enemyTemplateId: enemyTemplate.id,
      runId: input.runId,
    },
    clientIp
  );

  // 6) Bestiary upsert
  const existingBestiary = await prisma.playerBestiary.findUnique({
    where: {
      characterId_enemyTemplateId: {
        characterId,
        enemyTemplateId: enemyTemplate.id,
      },
    },
    select: { killCount: true, firstKillAt: true },
  });
  const isFirstKill = !existingBestiary;
  const updated = await prisma.playerBestiary.upsert({
    where: {
      characterId_enemyTemplateId: {
        characterId,
        enemyTemplateId: enemyTemplate.id,
      },
    },
    create: {
      characterId,
      enemyTemplateId: enemyTemplate.id,
      killCount: 1,
      firstKillAt: new Date(),
      lastKillAt: new Date(),
    },
    update: {
      killCount: { increment: 1 },
      lastKillAt: new Date(),
    },
    select: { killCount: true },
  });

  // 7) 击杀序号（确定性 PRNG 输入之一）
  const killSequence = await incrementKillSequence(input.runId);

  // 8) 掉落
  let lootResult: { items: RolledLootItem[]; skippedDueToFull: number; totalRolled: number } = {
    items: [],
    skippedDueToFull: 0,
    totalRolled: 0,
  };
  if (run.seed) {
    lootResult = await rollEnemyLoot(
      run.seed,
      input.runId,
      enemyTemplate,
      characterId,
      killSequence
    );
  }

  // 9) 审计日志
  await createAuditLog({
    userId,
    characterId,
    action: 'KILL_ENEMY',
    details: {
      enemyTemplateId: enemyTemplate.id,
      runId: input.runId,
      killSequence,
      expGained: expResult.legalAmount,
      newLevel: expResult.newLevel,
      leveledUp: expResult.leveledUp,
      drops: lootResult.items.map((i) => ({
        templateId: i.templateId,
        rarity: i.rarity,
      })),
      droppedCount: lootResult.items.length,
      skippedDueToFull: lootResult.skippedDueToFull,
      isFirstKill,
    },
    clientIp,
  }).catch(() => {});

  return {
    exp: expResult.exp,
    level: expResult.level,
    oldLevel: expResult.oldLevel,
    newLevel: expResult.newLevel,
    leveledUp: expResult.leveledUp,
    levelUps: expResult.levelUps,
    statsAwarded: expResult.statsAwarded,
    newItems: lootResult.items,
    bestiaryEntry: {
      templateId: enemyTemplate.id,
      killCount: updated.killCount,
      firstKill: isFirstKill,
    },
  };
}

// ============================================================
// TASK-BE-004：场景随机掉落（HP 球 / MP 球 / 宝箱占位）
// ============================================================

export interface HandleScenarioLootInput {
  runId: string;
  source: string;
  lootTableId?: string;
  x?: number;
  y?: number;
}

export interface HandleScenarioLootResult {
  items: RolledLootItem[];
}

export async function handleScenarioLoot(
  userId: string,
  characterId: string,
  input: HandleScenarioLootInput,
  clientIp?: string
): Promise<HandleScenarioLootResult> {
  // 角色归属
  const ownerId = await getCharacterOwner(characterId);
  if (ownerId === null) {
    const err: any = new Error('角色不存在');
    err.statusCode = 404;
    throw err;
  }
  if (ownerId !== userId) {
    await flagAnomaly({
      reason: 'CHARACTER_OWNERSHIP_VIOLATION',
      characterId,
      details: {
        endpoint: 'handleScenarioLoot',
        actualOwner: ownerId,
        requestedBy: userId,
      },
      confidence: 90,
    });
    const err: any = new Error('无权操作该角色');
    err.statusCode = 403;
    throw err;
  }

  if (!input.runId || !input.source) {
    const err: any = new Error('缺少 runId 或 source');
    err.statusCode = 400;
    throw err;
  }

  // Run 校验
  const run = await prisma.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      characterId: true,
      seed: true,
      result: true,
      endedAt: true,
    },
  });
  if (!run || run.characterId !== characterId || run.result !== null || run.endedAt !== null) {
    await flagAnomaly({
      reason: 'LOOT_INVALID_RUN',
      characterId,
      details: {
        runId: input.runId,
        source: input.source,
        runFound: !!run,
        belongsToCharacter: run ? run.characterId === characterId : false,
      },
      confidence: 70,
    });
    const err: any = new Error('Run 不存在或已结束');
    err.statusCode = 403;
    throw err;
  }

  if (!run.seed) {
    return { items: [] };
  }

  const result = await rollScenarioLoot(run.seed, input.runId, input.source, characterId, {
    x: input.x,
    y: input.y,
    lootTableId: input.lootTableId,
  });

  await createAuditLog({
    userId,
    characterId,
    action: 'SCENARIO_LOOT',
    details: {
      runId: input.runId,
      source: input.source,
      droppedCount: result.items.length,
      drops: result.items.map((i) => ({ templateId: i.templateId, rarity: i.rarity })),
      skippedDueToFull: result.skippedDueToFull,
    },
    clientIp,
  }).catch(() => {});

  return { items: result.items };
}

// ============================================================
// TASK-BE-EQUIP-INVENTORY：装备穿脱 + 背包整理/移动/丢弃/消耗品
// 共用的归属校验小工具
// ============================================================

async function assertCharacterOwnership(userId: string, characterId: string) {
  const ownerId = await getCharacterOwner(characterId);
  if (ownerId === null) {
    const err: any = new Error('角色不存在');
    err.statusCode = 404;
    throw err;
  }
  if (ownerId !== userId) {
    await flagAnomaly({
      reason: 'CHARACTER_OWNERSHIP',
      characterId,
      details: { actualOwner: ownerId, requestedBy: userId },
      confidence: 90,
    });
    const err: any = new Error('无权操作该角色');
    err.statusCode = 403;
    throw err;
  }
}

// -------- 装备 --------
export async function handleEquip(
  userId: string,
  characterId: string,
  body: { playerItemId?: string; slot?: string; runId?: string | null },
  clientIp?: string
): Promise<EquipResult> {
  await assertCharacterOwnership(userId, characterId);
  return equipItemSvc(
    userId,
    characterId,
    {
      playerItemId: body.playerItemId!,
      slot: body.slot as ItemSlot,
      runId: body.runId ?? null,
    },
    clientIp
  );
}

// -------- 卸下装备 --------
export async function handleUnequip(
  userId: string,
  characterId: string,
  body: { slot?: string; runId?: string | null },
  clientIp?: string
): Promise<UnequipResult> {
  await assertCharacterOwnership(userId, characterId);
  return unequipItemSvc(
    userId,
    characterId,
    {
      slot: body.slot as ItemSlot,
      runId: body.runId ?? null,
    },
    clientIp
  );
}

// -------- 背包移动 --------
export async function handleMove(
  userId: string,
  characterId: string,
  body: {
    playerItemId?: string;
    toIndex?: number;
    fromSlot?: number;
    toSlot?: number;
    runId?: string | null;
  },
  clientIp?: string
): Promise<{ success: true }> {
  await assertCharacterOwnership(userId, characterId);
  return moveInventoryItemSvc(userId, characterId, body, clientIp);
}

// -------- 背包整理 --------
export async function handleSort(
  userId: string,
  characterId: string,
  body: { strategy?: 'rarity' | 'type' | 'name'; runId?: string | null },
  clientIp?: string
): Promise<{ sorted: true; strategy: string }> {
  await assertCharacterOwnership(userId, characterId);
  return sortInventorySvc(userId, characterId, body || {}, clientIp);
}

// -------- 丢弃物品 --------
export async function handleDiscard(
  userId: string,
  characterId: string,
  body: {
    playerItemId?: string;
    quantity?: number;
    slot?: number;
    count?: number;
    runId?: string | null;
  },
  clientIp?: string
): Promise<{ discarded: true; templateId: string }> {
  await assertCharacterOwnership(userId, characterId);
  return discardInventoryItemSvc(userId, characterId, body, clientIp);
}

// -------- 使用消耗品 --------
export async function handleUseItem(
  userId: string,
  characterId: string,
  body: { playerItemId?: string; slot?: number; runId?: string | null },
  clientIp?: string
): Promise<UseItemResult> {
  await assertCharacterOwnership(userId, characterId);
  return useItemSvc(userId, characterId, body, clientIp);
}
