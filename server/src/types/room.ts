export interface ServerBuff {
  type: string;
  value: number;
  endTime: number;
  stackCount: number;
}

export interface ServerPlayerState {
  id: string; // socketId
  characterId: string;
  userId: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  speed: number;
  baseSpeed: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  critRate: number;
  isDodging: boolean;
  dodgeEndTime: number;
  dodgeCooldownEnd: number;
  isAttacking: boolean;
  attackCooldownEnd: number;
  buffs: ServerBuff[];
  skillCooldowns: Map<string, number>;
  inputBuffer: PlayerInput[];
  ready: boolean;
  inventory: string[]; // 局内背包：存储 item templateId 列表，容量上限 24
}

export type EnemyStateType = 'idle' | 'chase' | 'attack' | 'dead';

export interface ServerEnemyState {
  id: string;
  templateId: string;
  position: { x: number; y: number };
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  state: EnemyStateType;
  aggroTargetId: string | null;
  aggroRange: number;
  attackRange: number;
  attackCooldownEnd: number;
  speed: number;
  dropTable: { itemId: string; chance: number }[];
  deathTime?: number; // 死亡时间戳，用于延迟移除
  damageTakenBy: Map<string, number>; // 各玩家对该敌人造成的累计伤害
}

export interface ServerProjectileState {
  id: string;
  ownerId: string;
  skillId: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  speed: number;
  maxRange: number;
  traveledDistance: number;
  radius: number;
  isPiercing: boolean;
}

export interface ServerDropState {
  id: string;
  templateId: string;
  position: { x: number; y: number };
  ownerId: string | null; // 归属玩家
}

export interface RoomStateSnapshot {
  players: ServerPlayerState[];
  enemies: ServerEnemyState[];
  projectiles: ServerProjectileState[];
  drops: ServerDropState[];
}

export type PlayerInputType =
  | 'move'
  | 'attack'
  | 'cast'
  | 'dodge'
  | 'loot'
  | 'extract';

export interface PlayerInput {
  type: PlayerInputType;
  payload: unknown;
  timestamp: number;
}

export interface CombatStatistics {
  playerId: string;
  totalDamageDealt: number;
  totalDamageTaken: number;
  healDone: number;
  healReceived: number;
  critCount: number;
  hitCount: number;
  missCount: number;
  damageBySkill: Record<string, number>;
  damageByEnemy: Record<string, number>;
  killCount: number;
}

export type GameResultReason = 'death' | 'extract';

export interface GameResult {
  reason: GameResultReason;
  goldEarned: number;
  expEarned: number;
  itemsKept: string[];
  enemiesKilled: number;
  floorReached: number;
}
