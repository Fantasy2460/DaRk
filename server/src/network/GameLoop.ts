import { Server } from 'socket.io';
import {
  ServerPlayerState,
  ServerEnemyState,
  ServerProjectileState,
  ServerDropState,
  RoomStateSnapshot,
  PlayerInput,
  CombatStatistics,
  GameResult,
} from '../types/room';
import type { Snapshot, ClassType } from '../types/game';
import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { PUBLIC_GAME_CONFIG, INTERNAL_GAME_CONFIG } from '../config/gameConfig';

const MAP_WIDTH = 1280;
const MAP_HEIGHT = 960;
const TICK_MS = 50;

const BASE_SPEED = 180; // 与前端 GAME_CONFIG.playerSpeed 保持一致

const CLASS_SPEED_MULTIPLIER: Record<ClassType, number> = {
  warrior: 160 / BASE_SPEED,
  mage: 150 / BASE_SPEED,
  sage: 155 / BASE_SPEED,
};

// 敌人模板缓存（内存 fallback）
interface EnemyTemplateData {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  colorHex: string;
  isBoss: boolean;
  dropTableJson: string | null;
  expValue: number;
}

let cachedEnemyTemplates: EnemyTemplateData[] | null = null;

// 技能模板缓存（内存 fallback）
interface SkillTemplateData {
  id: string;
  name: string;
  damage: number | null;
  damagePercent: number | null;
  range: number | null;
  mpCost: number;
  cooldown: number;
  type: 'projectile' | 'aoe' | 'buff';
  description: string;
}

let cachedSkillTemplates: Map<string, SkillTemplateData> | null = null;

async function loadSkillTemplates(): Promise<Map<string, SkillTemplateData>> {
  if (cachedSkillTemplates) return cachedSkillTemplates;
  const map = new Map<string, SkillTemplateData>();
  try {
    const dbTemplates = await prisma.skillTemplate.findMany();
    for (const t of dbTemplates) {
      const inferredType = inferSkillType(t.id);
      map.set(t.id, {
        id: t.id,
        name: t.name,
        damage: t.damage ?? null,
        damagePercent: t.damagePercent ?? null,
        range: t.range ?? null,
        mpCost: t.mpCost,
        cooldown: t.cooldown,
        type: inferredType,
        description: t.description,
      });
    }
    cachedSkillTemplates = map;
    return map;
  } catch (err) {
    console.warn('[GameLoop] 从数据库加载 SkillTemplate 失败，使用本地 fallback', err);
    const { CLASSES } = require('../../phaser-demo/src/data/classes');
    for (const cls of CLASSES as any[]) {
      for (const s of cls.skills ?? []) {
        const inferredType = inferSkillType(s.id);
        map.set(s.id, {
          id: s.id,
          name: s.name,
          damage: s.damage ?? null,
          damagePercent: s.damagePercent ?? null,
          range: s.range ?? null,
          mpCost: s.mpCost ?? 0,
          cooldown: s.cooldown ?? 0,
          type: inferredType,
          description: s.description ?? '',
        });
      }
    }
    cachedSkillTemplates = map;
    return map;
  }
}

function inferSkillType(skillId: string): 'projectile' | 'aoe' | 'buff' {
  if (skillId.includes('fireball')) return 'projectile';
  if (skillId.includes('mana') || skillId.includes('overflow')) return 'buff';
  return 'aoe';
}

async function loadEnemyTemplates(): Promise<EnemyTemplateData[]> {
  if (cachedEnemyTemplates) return cachedEnemyTemplates;
  try {
    const dbTemplates = await prisma.enemyTemplate.findMany();
    cachedEnemyTemplates = dbTemplates as EnemyTemplateData[];
    return cachedEnemyTemplates;
  } catch (err) {
    console.warn('[GameLoop] 从数据库加载 EnemyTemplate 失败，使用本地 fallback', err);
    const { ENEMIES } = require('../../phaser-demo/src/data/enemies');
    const fallback: EnemyTemplateData[] = ENEMIES.map((e: any) => ({
      id: e.id,
      name: e.name,
      hp: e.hp,
      attack: e.attack,
      defense: e.defense,
      speed: e.speed,
      aggroRange: e.aggroRange,
      attackRange: e.attackRange,
      colorHex: e.color?.toString(16) ?? 'ffffff',
      isBoss: e.isBoss ?? false,
      dropTableJson: JSON.stringify(e.dropTable ?? []),
      expValue: e.expValue ?? 0,
    }));
    cachedEnemyTemplates = fallback;
    return fallback;
  }
}

function parseDropTable(json: string | null): { itemId: string; chance: number }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e: any) =>
          e && typeof e.itemId === 'string' && typeof e.chance === 'number' && e.chance > 0
      )
      .map((e: any) => ({ itemId: e.itemId, chance: e.chance }));
  } catch {
    return [];
  }
}

function getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export class GameLoop {
  private roomId: string;
  private io: Server;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  players = new Map<string, ServerPlayerState>();
  enemies = new Map<string, ServerEnemyState>();
  projectiles = new Map<string, ServerProjectileState>();
  drops = new Map<string, ServerDropState>();

  private skillTemplates: Map<string, SkillTemplateData> = new Map();

  // 实时伤害统计
  damageTracker = new Map<string, CombatStatistics>();
  private lastStatsBroadcast = 0;
  private tickCounter = 0;

  constructor(roomId: string, io: Server) {
    this.roomId = roomId;
    this.io = io;
  }

  async loadSkillTemplates(): Promise<void> {
    this.skillTemplates = await loadSkillTemplates();
    console.log(`[GameLoop] Room ${this.roomId} 加载 ${this.skillTemplates.size} 个技能模板`);
  }

  async initializeEnemies(): Promise<void> {
    const templates = await loadEnemyTemplates();
    if (templates.length === 0) {
      console.warn('[GameLoop] 无可用敌人模板，跳过生成');
      return;
    }

    const bossChance = PUBLIC_GAME_CONFIG.bossSpawnChance ?? 0.15;
    const spawnMin = PUBLIC_GAME_CONFIG.enemySpawnCount?.min ?? 6;
    const spawnMax = PUBLIC_GAME_CONFIG.enemySpawnCount?.max ?? 12;
    const spawnCount = Math.floor(Math.random() * (spawnMax - spawnMin + 1)) + spawnMin;

    const normalTemplates = templates.filter((t) => !t.isBoss);
    const bossTemplates = templates.filter((t) => t.isBoss);

    // 玩家出生中心（与 RoomManager 一致）
    const spawnCenter = { x: 640, y: 480 };

    for (let i = 0; i < spawnCount; i++) {
      const isBoss = bossTemplates.length > 0 && Math.random() < bossChance;
      const pool = isBoss ? bossTemplates : normalTemplates;
      if (pool.length === 0) continue;
      const tpl = pool[Math.floor(Math.random() * pool.length)];

      // 随机位置，避开出生中心 200px
      let pos: { x: number; y: number };
      let attempts = 0;
      do {
        pos = {
          x: Math.random() * MAP_WIDTH,
          y: Math.random() * MAP_HEIGHT,
        };
        attempts++;
      } while (getDistance(pos, spawnCenter) < 200 && attempts < 20);

      const enemy: ServerEnemyState = {
        id: generateId(),
        templateId: tpl.id,
        position: pos!,
        hp: tpl.hp,
        maxHp: tpl.hp,
        attack: tpl.attack,
        defense: tpl.defense,
        state: 'idle',
        aggroTargetId: null,
        aggroRange: tpl.aggroRange,
        attackRange: tpl.attackRange,
        attackCooldownEnd: 0,
        speed: tpl.speed,
        dropTable: parseDropTable(tpl.dropTableJson),
        damageTakenBy: new Map(),
      };
      this.enemies.set(enemy.id, enemy);
    }

    console.log(`[GameLoop] Room ${this.roomId} 生成 ${this.enemies.size} 个敌人`);
  }

  start(): void {
    if (this.intervalId) return;
    // 启动时异步初始化技能模板与敌人
    if (this.skillTemplates.size === 0) {
      this.loadSkillTemplates().catch((err) =>
        console.error('[GameLoop] loadSkillTemplates failed:', err)
      );
    }
    if (this.enemies.size === 0) {
      this.initializeEnemies().catch((err) =>
        console.error('[GameLoop] initializeEnemies failed:', err)
      );
    }
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
    console.log(`[GameLoop] Room ${this.roomId} started (tick=${TICK_MS}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log(`[GameLoop] Room ${this.roomId} stopped`);
    }
    // 房间清理：清空所有运行时集合
    this.players.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.drops.clear();
    this.damageTracker.clear();
    this.tickCounter = 0;
    this.lastStatsBroadcast = 0;
  }

  addPlayer(
    socketId: string,
    characterId: string,
    userId: string,
    initialPosition: { x: number; y: number },
    characterData?: Snapshot
  ): void {
    const classType: ClassType = characterData?.character?.classType ?? 'warrior';
    const level = characterData?.character?.level ?? 1;
    const stats = characterData?.stats;

    const levelMultiplier = 1 + (level - 1) * 0.05;

    // 基础属性（装备加成后的最终值优先，否则按职业默认计算）
    const maxHp = stats?.maxHp ?? Math.floor((classType === 'warrior' ? 150 : classType === 'mage' ? 100 : 120) * levelMultiplier);
    const maxMp = stats?.maxMp ?? Math.floor((classType === 'warrior' ? 50 : classType === 'mage' ? 100 : 80) * levelMultiplier);
    const attack = stats?.attack ?? Math.floor((classType === 'warrior' ? 15 : classType === 'mage' ? 20 : 12) * levelMultiplier);
    const defense = stats?.defense ?? Math.floor((classType === 'warrior' ? 10 : classType === 'mage' ? 5 : 8) * levelMultiplier);
    const baseSpeed = Math.floor(BASE_SPEED * (CLASS_SPEED_MULTIPLIER[classType] ?? 1));
    const speed = stats?.speed ?? baseSpeed;

    const player: ServerPlayerState = {
      id: socketId,
      characterId,
      userId,
      position: { ...initialPosition },
      velocity: { x: 0, y: 0 },
      speed,
      baseSpeed: speed,
      hp: maxHp,
      maxHp,
      mp: maxMp,
      maxMp,
      attack,
      defense,
      critRate: 0.1,
      isDodging: false,
      dodgeEndTime: 0,
      dodgeCooldownEnd: 0,
      isAttacking: false,
      attackCooldownEnd: 0,
      buffs: [],
      skillCooldowns: new Map(),
      inputBuffer: [],
      ready: false,
      inventory: [],
    };
    this.players.set(socketId, player);
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  handleInput(socketId: string, input: PlayerInput): void {
    const player = this.players.get(socketId);
    if (!player) return;
    player.inputBuffer.push(input);
  }

  private tick(): void {
    const now = Date.now();

    // 1. 处理输入队列
    for (const player of this.players.values()) {
      while (player.inputBuffer.length > 0) {
        const input = player.inputBuffer.shift()!;
        this.processInput(player, input, now);
      }
    }

    // 2. 更新玩家位置
    const dt = TICK_MS / 1000; // 0.05s
    for (const player of this.players.values()) {
      if (player.isDodging && now >= player.dodgeEndTime) {
        player.isDodging = false;
        player.speed = player.baseSpeed;
      }

      player.position.x += player.velocity.x * player.speed * dt;
      player.position.y += player.velocity.y * player.speed * dt;

      // 3. 边界校验
      player.position.x = Math.max(0, Math.min(MAP_WIDTH, player.position.x));
      player.position.y = Math.max(0, Math.min(MAP_HEIGHT, player.position.y));
    }

    // 4. 玩家状态更新（回血回蓝、buff衰减）
    for (const player of this.players.values()) {
      // 自然回血回蓝（按 classes.ts 中各职业的 hpRegen/mpRegen，当前简化：
      // warrior 2hp/s, 1mp/s; mage 1hp/s, 3mp/s; sage 1.5hp/s, 2mp/s）
      let hpRegen = 0;
      let mpRegen = 0;
      // 使用 baseSpeed 反推职业
      if (player.baseSpeed === Math.floor(BASE_SPEED * CLASS_SPEED_MULTIPLIER.warrior)) {
        hpRegen = 2;
        mpRegen = 1;
      } else if (player.baseSpeed === Math.floor(BASE_SPEED * CLASS_SPEED_MULTIPLIER.mage)) {
        hpRegen = 1;
        mpRegen = 3;
      } else if (player.baseSpeed === Math.floor(BASE_SPEED * CLASS_SPEED_MULTIPLIER.sage)) {
        hpRegen = 1.5;
        mpRegen = 2;
      } else {
        hpRegen = 1;
        mpRegen = 1;
      }
      // 恢复量 = regen * dt（dt=0.05s，即每秒 regen 的 5%）
      if (player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + hpRegen * dt);
      }
      if (player.mp < player.maxMp) {
        player.mp = Math.min(player.maxMp, player.mp + mpRegen * dt);
      }

      // Buff 衰减
      if (player.buffs.length > 0) {
        const beforeCount = player.buffs.length;
        player.buffs = player.buffs.filter((b) => b.endTime > now);
        if (player.buffs.length < beforeCount) {
          // Buff 移除后属性重算（简化：恢复 baseSpeed，后续 Phase 完善完整重算）
          player.speed = player.baseSpeed;
        }
      }
    }

    // 5. 敌人 AI 更新
    this.updateEnemies(now, dt);

    // 6. 死亡处理（敌人延迟移除 + 掉落）
    this.processEnemyDeaths(now);

    // 7. 弹道更新（Phase 4）
    this.updateProjectiles(now, dt);

    // 8. 玩家死亡检测
    this.checkPlayerDeaths();

    // 9. 生成快照并广播
    const snapshot = this.buildSnapshot();
    this.io.to(this.roomId).emit('game:state_sync', snapshot);

    // 10. 实时伤害统计广播（每 20 tick ≈ 1000ms）
    this.tickCounter++;
    if (this.tickCounter % 20 === 0) {
      if (now - this.lastStatsBroadcast >= 1000) {
        this.broadcastDamageStats(now);
      }
    }
  }

  private getOrCreateStats(playerId: string): CombatStatistics {
    let stats = this.damageTracker.get(playerId);
    if (!stats) {
      stats = {
        playerId,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        healDone: 0,
        healReceived: 0,
        critCount: 0,
        hitCount: 0,
        missCount: 0,
        damageBySkill: {},
        damageByEnemy: {},
        killCount: 0,
      };
      this.damageTracker.set(playerId, stats);
    }
    return stats;
  }

  private recordDamageDealt(playerId: string, damage: number, skillId?: string, isCrit?: boolean): void {
    const stats = this.getOrCreateStats(playerId);
    stats.totalDamageDealt += damage;
    stats.hitCount++;
    if (isCrit) stats.critCount++;
    if (skillId) {
      stats.damageBySkill[skillId] = (stats.damageBySkill[skillId] || 0) + damage;
    }
  }

  private recordDamageTaken(playerId: string, damage: number): void {
    const stats = this.getOrCreateStats(playerId);
    stats.totalDamageTaken += damage;
  }

  private recordHeal(sourceId: string, targetId: string, amount: number): void {
    const sourceStats = this.getOrCreateStats(sourceId);
    sourceStats.healDone += amount;
    if (targetId !== sourceId) {
      const targetStats = this.getOrCreateStats(targetId);
      targetStats.healReceived += amount;
    } else {
      sourceStats.healReceived += amount;
    }
  }

  private recordKill(playerId: string, enemyTemplateId: string, totalDamageToEnemy: number): void {
    const stats = this.getOrCreateStats(playerId);
    stats.killCount++;
    stats.damageByEnemy[enemyTemplateId] = (stats.damageByEnemy[enemyTemplateId] || 0) + totalDamageToEnemy;
  }

  private broadcastDamageStats(now: number): void {
    if (this.damageTracker.size === 0) return;
    const statsArray = Array.from(this.damageTracker.values());
    this.io.to(this.roomId).emit('stats:damage_update', statsArray);
    this.lastStatsBroadcast = now;
  }

  private processInput(
    player: ServerPlayerState,
    input: PlayerInput,
    now: number
  ): void {
    switch (input.type) {
      case 'move': {
        const dir = input.payload as { x: number; y: number };
        let vx = dir.x ?? 0;
        let vy = dir.y ?? 0;
        // 归一化
        const len = Math.sqrt(vx * vx + vy * vy);
        if (len > 0) {
          vx /= len;
          vy /= len;
        }
        player.velocity.x = vx;
        player.velocity.y = vy;
        break;
      }
      case 'attack': {
        // 攻击冷却校验
        if (now < player.attackCooldownEnd) break;

        player.isAttacking = true;
        player.attackCooldownEnd = now + 500; // 硬编码 500ms，Phase 4 接入武器/技能配置

        // 查找最近敌人
        let nearestEnemy: ServerEnemyState | null = null;
        let nearestDist = Infinity;
        const attackRange = 100; // 硬编码 100px，后续接入职业配置

        for (const enemy of this.enemies.values()) {
          if (enemy.state === 'dead') continue;
          const dx = enemy.position.x - player.position.x;
          const dy = enemy.position.y - player.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist && dist <= attackRange) {
            nearestDist = dist;
            nearestEnemy = enemy;
          }
        }

        if (nearestEnemy) {
          // 暴击判定
          const isCrit = Math.random() < player.critRate;
          const critMultiplier = isCrit ? 1.5 : 1.0;
          const rawDamage = Math.max(1, player.attack - nearestEnemy.defense);
          const damage = Math.floor(rawDamage * critMultiplier);

          nearestEnemy.hp -= damage;
          // 累计伤害归属
          const prevDamage = nearestEnemy.damageTakenBy.get(player.id) || 0;
          nearestEnemy.damageTakenBy.set(player.id, prevDamage + damage);

          if (nearestEnemy.hp <= 0) {
            nearestEnemy.state = 'dead';
            // Phase 3：死亡处理（掉落、经验、移除等）
          }

          this.recordDamageDealt(player.id, damage, 'attack', isCrit);

          this.io.to(this.roomId).emit('combat:damage', {
            sourceId: player.id,
            targetId: nearestEnemy.id,
            damage,
            isCrit,
          });
        }

        // isAttacking 在下一 tick 或一段时间后自动重置（简化处理）
        setTimeout(() => {
          player.isAttacking = false;
        }, 200);
        break;
      }
      case 'cast': {
        this.handleCast(player, input.payload, now);
        break;
      }
      case 'dodge': {
        if (now >= player.dodgeCooldownEnd && !player.isDodging) {
          player.isDodging = true;
          player.dodgeEndTime = now + 500;
          player.dodgeCooldownEnd = now + 8000;
          player.speed = player.speed * 2.5;
        }
        break;
      }
      case 'loot': {
        this.handleLoot(player, input.payload);
        break;
      }
      case 'extract': {
        this.handleExtract(player);
        break;
      }
      default:
        break;
    }
  }

  private updateEnemies(now: number, dt: number): void {
    for (const enemy of this.enemies.values()) {
      if (enemy.state === 'dead') continue;

      switch (enemy.state) {
        case 'idle': {
          // 寻找最近玩家
          let nearestPlayer: ServerPlayerState | null = null;
          let nearestDist = Infinity;
          for (const player of this.players.values()) {
            const dist = getDistance(enemy.position, player.position);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestPlayer = player;
            }
          }
          if (nearestPlayer && nearestDist <= enemy.aggroRange) {
            enemy.state = 'chase';
            enemy.aggroTargetId = nearestPlayer.id;
          }
          break;
        }
        case 'chase': {
          const target = enemy.aggroTargetId ? this.players.get(enemy.aggroTargetId) : null;
          if (!target) {
            enemy.state = 'idle';
            enemy.aggroTargetId = null;
            break;
          }
          const dist = getDistance(enemy.position, target.position);
          if (dist > enemy.aggroRange * 1.5) {
            enemy.state = 'idle';
            enemy.aggroTargetId = null;
            break;
          }
          if (dist <= enemy.attackRange) {
            enemy.state = 'attack';
            break;
          }
          // 向目标移动
          const dx = target.position.x - enemy.position.x;
          const dy = target.position.y - enemy.position.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            enemy.position.x += (dx / len) * enemy.speed * dt;
            enemy.position.y += (dy / len) * enemy.speed * dt;
          }
          // 边界校验
          enemy.position.x = Math.max(0, Math.min(MAP_WIDTH, enemy.position.x));
          enemy.position.y = Math.max(0, Math.min(MAP_HEIGHT, enemy.position.y));
          break;
        }
        case 'attack': {
          const target = enemy.aggroTargetId ? this.players.get(enemy.aggroTargetId) : null;
          if (!target) {
            enemy.state = 'idle';
            enemy.aggroTargetId = null;
            break;
          }
          const dist = getDistance(enemy.position, target.position);
          if (dist > enemy.attackRange) {
            enemy.state = 'chase';
            break;
          }
          if (now >= enemy.attackCooldownEnd) {
            const damage = Math.max(1, enemy.attack - target.defense);
            target.hp -= damage;
            enemy.attackCooldownEnd = now + 1000; // 默认 1000ms 冷却，后续可接入模板配置
            this.recordDamageTaken(target.id, damage);
            this.io.to(this.roomId).emit('combat:damage', {
              sourceId: enemy.id,
              targetId: target.id,
              damage,
              isCrit: false,
            });
          }
          break;
        }
      }
    }
  }

  private processEnemyDeaths(now: number): void {
    for (const [enemyId, enemy] of this.enemies.entries()) {
      if (enemy.hp <= 0 && enemy.state !== 'dead') {
        enemy.state = 'dead';
        enemy.deathTime = now;

        // 掉落判定（简化：按模板 dropTable 随机 roll）
        const drops: ServerDropState[] = [];
        for (const entry of enemy.dropTable) {
          if (Math.random() < entry.chance) {
            const drop: ServerDropState = {
              id: generateId(),
              templateId: entry.itemId,
              position: { ...enemy.position },
              ownerId: enemy.aggroTargetId, // 简化归属：当前仇恨目标
            };
            drops.push(drop);
            this.drops.set(drop.id, drop);
          }
        }

        this.io.to(this.roomId).emit('combat:enemy_death', {
          enemyId: enemy.id,
          position: enemy.position,
          drops: drops.map((d) => ({ id: d.id, templateId: d.templateId, position: d.position })),
        });

        // 伤害统计：按 damageTakenBy 记录各玩家对该敌人的总伤害，并累加 killCount
        for (const [playerId, totalDamage] of enemy.damageTakenBy.entries()) {
          this.recordKill(playerId, enemy.templateId, totalDamage);
        }
      }

      // 延迟移除（死亡后 3 秒）
      if (enemy.state === 'dead' && enemy.deathTime && now - enemy.deathTime > 3000) {
        this.enemies.delete(enemyId);
      }
    }
  }

  private handleCast(
    player: ServerPlayerState,
    payload: unknown,
    now: number
  ): void {
    const castPayload = payload as { skillId?: string; targetX?: number; targetY?: number } | undefined;
    if (!castPayload) return;
    const skillId = castPayload.skillId;
    const targetX = castPayload.targetX ?? player.position.x;
    const targetY = castPayload.targetY ?? player.position.y;
    if (!skillId) return;

    const skill = this.skillTemplates.get(skillId);
    if (!skill) {
      console.warn(`[GameLoop] 玩家 ${player.id} 尝试释放未知技能 ${skillId}`);
      return;
    }

    // MP 校验
    if (player.mp < skill.mpCost) {
      console.warn(`[GameLoop] 玩家 ${player.id} MP 不足，无法释放 ${skillId}`);
      return;
    }

    // 冷却校验
    const cooldownEnd = player.skillCooldowns.get(skillId) ?? 0;
    if (now < cooldownEnd) {
      console.warn(`[GameLoop] 玩家 ${player.id} 技能 ${skillId} 冷却中`);
      return;
    }

    // 扣除 MP 并设置冷却
    player.mp -= skill.mpCost;
    player.skillCooldowns.set(skillId, now + skill.cooldown);

    switch (skill.type) {
      case 'projectile': {
        this.spawnProjectile(player, skillId, skill, targetX, targetY);
        break;
      }
      case 'aoe': {
        this.handleAoeSkill(player, skill, targetX, targetY);
        break;
      }
      case 'buff': {
        this.handleBuffSkill(player, skill, now);
        break;
      }
      default:
        break;
    }
  }

  private spawnProjectile(
    player: ServerPlayerState,
    skillId: string,
    skill: SkillTemplateData,
    targetX: number,
    targetY: number
  ): void {
    const dx = targetX - player.position.x;
    const dy = targetY - player.position.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const projectile: ServerProjectileState = {
      id: generateId(),
      ownerId: player.id,
      skillId,
      position: { ...player.position },
      velocity: { x: dx / len, y: dy / len },
      speed: 400, // px/s，硬编码默认值
      maxRange: skill.range ?? 400,
      traveledDistance: 0,
      radius: 15,
      isPiercing: false,
    };

    this.projectiles.set(projectile.id, projectile);
  }

  private handleAoeSkill(
    player: ServerPlayerState,
    skill: SkillTemplateData,
    targetX: number,
    targetY: number
  ): void {
    const range = skill.range ?? 0;
    const isHeal = skill.id.includes('heal');
    const isMeteor = skill.id.includes('meteor');
    const isCurse = skill.id.includes('curse');

    if (isHeal) {
      // 治愈：以玩家自身为中心，治疗自己（当前单人）
      const healAmount = this.calculateSkillValue(skill, player);
      const beforeHp = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + healAmount);
      const actualHeal = player.hp - beforeHp;
      this.recordHeal(player.id, player.id, actualHeal);
      this.io.to(this.roomId).emit('combat:heal', {
        sourceId: player.id,
        targetId: player.id,
        amount: actualHeal,
      });
      return;
    }

    // 范围伤害技能（星落 / 衰弱等）
    const center = isMeteor || isCurse ? { x: targetX, y: targetY } : player.position;
    const damage = this.calculateSkillValue(skill, player);

    for (const enemy of this.enemies.values()) {
      if (enemy.state === 'dead') continue;
      const dist = getDistance(center, enemy.position);
      if (dist <= range) {
        enemy.hp -= damage;
        const prevDamage = enemy.damageTakenBy.get(player.id) || 0;
        enemy.damageTakenBy.set(player.id, prevDamage + damage);
        if (enemy.hp <= 0) {
          enemy.state = 'dead';
        }
        this.recordDamageDealt(player.id, damage, skill.id, false);
        this.io.to(this.roomId).emit('combat:damage', {
          sourceId: player.id,
          targetId: enemy.id,
          damage,
          isCrit: false,
        });
      }
    }
  }

  private handleLoot(player: ServerPlayerState, payload: unknown): void {
    const lootPayload = payload as { dropId?: string } | undefined;
    const dropId = lootPayload?.dropId;
    if (!dropId) return;

    const drop = this.drops.get(dropId);
    if (!drop) return;

    // 距离校验（< 30px）
    const dist = getDistance(player.position, drop.position);
    if (dist >= 30) {
      console.warn(`[GameLoop] 玩家 ${player.id} 拾取 ${dropId} 失败：距离 ${dist.toFixed(1)}px >= 30px`);
      return;
    }

    // 背包容量校验
    const INVENTORY_CAPACITY = INTERNAL_GAME_CONFIG.inventory.inventoryCapacity;
    if (player.inventory.length >= INVENTORY_CAPACITY) {
      console.warn(`[GameLoop] 玩家 ${player.id} 拾取 ${dropId} 失败：背包已满 ${player.inventory.length}/${INVENTORY_CAPACITY}`);
      return;
    }

    // 加入局内背包
    player.inventory.push(drop.templateId);
    this.drops.delete(dropId);

    this.io.to(this.roomId).emit('item:looted', {
      dropId,
      playerId: player.id,
      itemTemplateId: drop.templateId,
    });
  }

  private async handleExtract(player: ServerPlayerState): Promise<void> {
    // 简化校验：允许任何位置撤离（后续可接入传送门坐标校验）
    const stats = this.damageTracker.get(player.id);

    this.stop();

    const result: GameResult = {
      reason: 'extract',
      goldEarned: 0, // TODO: 接入金币系统
      expEarned: 0,  // TODO: 接入经验系统
      itemsKept: [...player.inventory],
      enemiesKilled: stats?.killCount ?? 0,
      floorReached: 1, // 暂时固定 1 层
    };

    this.io.to(this.roomId).emit('game:game_over', {
      ...result,
      playerId: player.id,
    });

    // 存档合并：将局内 inventory 合并到角色存档
    // TODO: 接入 CharacterService.saveCharacterData 或 RunService.extractRun
    // 当前仅广播 game_over，存档合并由前端或后续 Phase 统一处理

    // 恢复 HP/MP（局内状态已随 stop() 清空，若保留 player 可在此恢复）
    player.hp = player.maxHp;
    player.mp = player.maxMp;
  }

  private handleBuffSkill(
    player: ServerPlayerState,
    skill: SkillTemplateData,
    now: number
  ): void {
    // 法力流溢：增加 MP 回复 buff（简化处理：直接恢复一定 MP，后续可扩展为持续 buff）
    const duration = 10000; // 10s
    const mpRegenBoost = 5; // 额外 MP 回复
    player.buffs.push({
      type: 'mana_flow',
      value: mpRegenBoost,
      endTime: now + duration,
      stackCount: 1,
    });
    this.io.to(this.roomId).emit('player:buff_update', {
      playerId: player.id,
      buffs: player.buffs.map((b) => ({ type: b.type, value: b.value, endTime: b.endTime })),
    });
  }

  private calculateSkillValue(skill: SkillTemplateData, player: ServerPlayerState): number {
    if (skill.damagePercent && skill.damagePercent > 0) {
      return Math.floor(skill.damagePercent / 100 * player.attack);
    }
    return skill.damage ?? 0;
  }

  private updateProjectiles(now: number, dt: number): void {
    const ENEMY_HIT_RADIUS = 20;
    for (const [projectileId, projectile] of this.projectiles.entries()) {
      // 更新位置
      projectile.position.x += projectile.velocity.x * projectile.speed * dt;
      projectile.position.y += projectile.velocity.y * projectile.speed * dt;
      projectile.traveledDistance += projectile.speed * dt;

      // 超射程移除
      if (projectile.traveledDistance >= projectile.maxRange) {
        this.projectiles.delete(projectileId);
        continue;
      }

      // 碰撞检测（圆形）
      let hit = false;
      for (const enemy of this.enemies.values()) {
        if (enemy.state === 'dead') continue;
        const dist = getDistance(projectile.position, enemy.position);
        if (dist <= projectile.radius + ENEMY_HIT_RADIUS) {
          // 命中
          const skill = this.skillTemplates.get(projectile.skillId);
          const owner = this.players.get(projectile.ownerId);
          const damage = skill && owner
            ? this.calculateSkillValue(skill, owner)
            : 0;

          if (damage > 0) {
            enemy.hp -= damage;
            const prevDamage = enemy.damageTakenBy.get(projectile.ownerId) || 0;
            enemy.damageTakenBy.set(projectile.ownerId, prevDamage + damage);
            if (enemy.hp <= 0) {
              enemy.state = 'dead';
            }
            this.recordDamageDealt(projectile.ownerId, damage, projectile.skillId, false);
            this.io.to(this.roomId).emit('combat:damage', {
              sourceId: projectile.ownerId,
              targetId: enemy.id,
              damage,
              isCrit: false,
            });
          }

          if (!projectile.isPiercing) {
            this.projectiles.delete(projectileId);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
    }
  }

  private checkPlayerDeaths(): void {
    for (const player of this.players.values()) {
      if (player.hp <= 0) {
        this.stop();

        const result: GameResult = {
          reason: 'death',
          goldEarned: 0,
          expEarned: 0,
          itemsKept: [],
          enemiesKilled: this.damageTracker.get(player.id)?.killCount ?? 0,
          floorReached: 1,
        };

        this.io.to(this.roomId).emit('game:game_over', {
          ...result,
          playerId: player.id,
        });

        player.hp = 0;
      }
    }
  }

  private buildSnapshot(): RoomStateSnapshot {
    return {
      players: Array.from(this.players.values()),
      enemies: Array.from(this.enemies.values()),
      projectiles: Array.from(this.projectiles.values()),
      drops: Array.from(this.drops.values()),
    };
  }
}
