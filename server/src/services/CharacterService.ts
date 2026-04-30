import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { ItemRarity, ItemSlot, ClassType } from '../types/game';

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

  // 图鉴：简单增量更新
  for (const enemyId of payload.bestiary) {
    await prisma.playerBestiary.upsert({
      where: { characterId_enemyTemplateId: { characterId, enemyTemplateId: enemyId } },
      create: { characterId, enemyTemplateId: enemyId, killCount: 1, firstKillAt: new Date() },
      update: { killCount: { increment: 1 }, lastKillAt: new Date() },
    });
  }

  for (const templateId of payload.equipmentCodex) {
    await prisma.playerEquipmentCodex.upsert({
      where: { characterId_templateId: { characterId, templateId } },
      create: { characterId, templateId, firstObtainAt: new Date(), obtainCount: 1 },
      update: { obtainCount: { increment: 1 } },
    });
  }

  // 物品：先删除该角色的旧物品，再重新写入（简化策略，后续可优化为增量）
  await prisma.playerItem.deleteMany({ where: { characterId } });

  const itemsToCreate: any[] = [];

  // 背包物品
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
      });
    }
  });

  // 装备栏物品
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
