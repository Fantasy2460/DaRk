export type ClassType = 'warrior' | 'mage' | 'sage';
export type ItemRarity = 'C' | 'B' | 'A' | 'S';
export type ItemSlot = 'weapon' | 'helmet' | 'armor' | 'pants' | 'shoes' | 'accessory' | 'offhand';

export interface Stats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  fogResist: number;
}

export interface Item {
  id: string;
  name: string;
  rarity: ItemRarity;
  slot: ItemSlot;
  stats: Partial<Stats>;
  description: string;
}

export interface Consumable {
  id: string;
  name: string;
  type: 'instantHp' | 'instantMp' | 'slowHp' | 'slowMp' | 'vision';
  value: number;
  duration?: number;
  description: string;
}

export interface InventorySlot {
  item: Item | Consumable | null;
}

export interface EquipmentSet {
  weapon: Item | null;
  helmet: Item | null;
  armor: Item | null;
  pants: Item | null;
  shoes: Item | null;
  accessory: Item | null;
  offhand: Item | null;
}

export interface GameSave {
  selectedClass: ClassType | null;
  cityInventory: InventorySlot[];
  cityEquipment: EquipmentSet;
  talentProgress: Record<string, number>;
  gold: number;
  bestiary: string[];
  equipmentCodex: string[];
  level: number;
  exp: number;
  skillLevels: Record<string, number>;
  skillPoints: number;
}

// ---------------------- Snapshot ----------------------
// 启动期一次性返回的完整角色数据，扩展自 GameSave 字段以便前端直接解构。
// 同时附带 character / stats / skills / bestiary / equipmentCodex 详细字段。

export interface SnapshotCharacterInfo {
  id: string;
  name: string;
  classType: ClassType;
  level: number;
  exp: number;
  gold: number;
  totalDeaths: number;
  totalExtracts: number;
  deepestDepth: number;
  totalEnemiesKilled: number;
}

export interface SnapshotStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  fogResist: number;
  availableStatPoints: number;
  skillPoints: number;
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

export interface SnapshotSkillEntry {
  skillId: string;
  level: number;
  unlockedAt: string | null;
  name?: string;
  description?: string;
  type?: string;
  classType?: string;
  requiredLevel?: number;
  cooldown?: number;
  mpCost?: number;
  damage?: number | null;
  damagePercent?: number | null;
  range?: number | null;
  aoe?: boolean;
  maxLevel?: number | null;
  tier?: number;
  prerequisiteId?: string | null;
}

export interface SnapshotBestiaryEntry {
  enemyTemplateId: string;
  killCount: number;
  firstKillAt: string | null;
  lastKillAt: string | null;
}

export interface SnapshotCodexEntry {
  templateId: string;
  firstObtainAt: string | null;
  obtainCount: number;
}

export interface Snapshot extends GameSave {
  character: SnapshotCharacterInfo;
  stats: SnapshotStats;
  skills: SnapshotSkillEntry[];
  bestiaryEntries: SnapshotBestiaryEntry[];
  equipmentCodexEntries: SnapshotCodexEntry[];
}
