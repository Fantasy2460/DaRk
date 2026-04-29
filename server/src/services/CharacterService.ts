import { prisma } from '../config/database';
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
  const char = await prisma.character.create({
    data: {
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
    },
    include: { stats: true, skills: true },
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
  // 根据职业返回默认解锁的技能
  const skills: { skillId: string; level: number; unlockedAt?: Date }[] = [];
  if (classType === 'warrior') {
    skills.push({ skillId: 'heavy_slash', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'whirlwind', level: 1, unlockedAt: new Date() });
  } else if (classType === 'mage') {
    skills.push({ skillId: 'fireball', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'starfall', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'mana_flow', level: 1, unlockedAt: new Date() });
  } else if (classType === 'sage') {
    skills.push({ skillId: 'heal_light', level: 1, unlockedAt: new Date() });
    skills.push({ skillId: 'weakness_curse', level: 1, unlockedAt: new Date() });
  }
  return skills;
}
