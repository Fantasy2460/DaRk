export type ClassType = 'warrior' | 'mage' | 'sage';

export interface PlayerClass {
  id: ClassType;
  name: string;
  description: string;
  baseStats: Stats;
  skills: Skill[];
}

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

export type ItemRarity = 'C' | 'B' | 'A' | 'S';
export type ItemSlot = 'weapon' | 'helmet' | 'armor' | 'pants' | 'shoes' | 'accessory' | 'offhand';

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

export interface ActiveConsumableEffect {
  type: 'slowHp' | 'slowMp' | 'vision';
  value: number;
  remainingMs: number;
  tickIntervalMs: number;
  lastTickMs: number;
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

export type SkillType = 'active' | 'passive';

export interface Skill {
  id: string;
  name: string;
  description: string;
  type?: SkillType;
  requiredLevel?: number;
  cooldown: number;
  mpCost: number;
  damage?: number;
  damagePercent?: number;
  range?: number;
  aoe?: boolean;
  maxLevel?: number;
}

export interface SkillTreeTier {
  level: number;
  skills: Skill[];
}

export interface EnemyType {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  color: number;
  isBoss: boolean;
  dropTable: { itemId: string; chance: number }[];
  expValue: number;
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

export interface DamageSourceStat {
  id: string;
  name: string;
  color: number;
  castCount: number;
  totalDamage: number;
}

export interface RunDamageStats {
  totalDamage: number;
  sources: Record<string, DamageSourceStat>;
  version: number;
}

export interface RunState {
  forestDepth: number;
  runInventory: InventorySlot[];
  runEquipment: EquipmentSet;
  currentHp: number;
  currentMp: number;
  fogValue: number;
  elapsedTime: number;
  enemiesKilled: number;
  itemsFound: string[];
  damageStats: RunDamageStats;
}
