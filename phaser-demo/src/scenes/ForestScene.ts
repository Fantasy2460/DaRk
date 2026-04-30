import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { SaveManager } from '../managers/SaveManager';
import { api } from '../network/ApiClient';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { FogSystem } from '../systems/FogSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { EquipmentSystem } from '../systems/EquipmentSystem';
import { ItemDataManager } from '../managers/ItemDataManager';
import { GAME_CONFIG, RARITY_COLORS, SLOT_NAMES, getExpToNextLevel } from '../config/gameConfig';
import { CLASSES } from '../data/classes';
import {
  logItemDrop,
  logItemPickup,
  logEquipChange,
  logConsumableUse,
  logDeath,
  logExtract,
  logGoDeeper,
} from '../utils/AuditLogger';
import type { Item, EnemyType } from '../types';

export class ForestScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private trees: Phaser.GameObjects.Container[] = [];
  private fogSystem!: FogSystem;
  private runInventory!: InventorySystem;
  private runEquipment!: EquipmentSystem;
  private portal!: Phaser.GameObjects.Container;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemyTemplates: EnemyType[] = [];

  // HUD
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBg!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private mpBar!: Phaser.GameObjects.Rectangle;
  private mpBg!: Phaser.GameObjects.Rectangle;
  private mpText!: Phaser.GameObjects.Text;
  private fogText!: Phaser.GameObjects.Text;
  private depthText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private expBar!: Phaser.GameObjects.Rectangle;
  private expBg!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private lastLevel = 1;

  // 掉落物（装备 / 即时生效药水）
  private drops: { container: Phaser.GameObjects.Container; item?: Item; effect?: 'hp' | 'mp' }[] = [];

  // 飞行投射物
  private projectiles: {
    container: Phaser.GameObjects.Container;
    vx: number;
    vy: number;
    damage: number;
    directHitDamage?: number;
    splashDamage?: number;
    range: number;
    traveled: number;
    aoeRange: number;
  }[] = [];

  // 法力流溢光球
  private lightOrbs: {
    container: Phaser.GameObjects.Container;
    damage: number;
    target: Enemy;
    life: number;
  }[] = [];

  // 技能 HUD
  private skillSlots: {
    bg: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Container;
    keyText: Phaser.GameObjects.Text;
    cooldownOverlay: Phaser.GameObjects.Rectangle;
    skillIndex: number;
  }[] = [];

  // 消耗品快捷栏 HUD
  private consumableSlots: {
    bg: Phaser.GameObjects.Rectangle;
    nameText: Phaser.GameObjects.Text;
    keyText: Phaser.GameObjects.Text;
    index: number;
  }[] = [];

  // 背包 UI
  private bagOpen = false;
  private bagUI: Phaser.GameObjects.GameObject[] = [];
  private bagInfoText!: Phaser.GameObjects.Text;

  // 传送门菜单 UI
  private portalMenuUI: Phaser.GameObjects.GameObject[] = [];

  private getMouseWorldPoint(): { x: number; y: number } {
    const pointer = this.input.activePointer;
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  constructor() {
    super({ key: 'ForestScene' });
  }

  async create() {
    const state = GameState.getInstance();
    if (!state.run) {
      this.scene.start('MainCityScene');
      return;
    }

    this.runInventory = new InventorySystem(state.run.runInventory);
    this.runEquipment = new EquipmentSystem(state.run.runEquipment);

    this.createGround();
    this.createTrees();
    this.createPlayer();
    await this.applyEquipmentStats();
    this.loadAndCreateEnemies().catch(() => {});
    this.createPortal();
    this.createHUD();
    this.setupInput();

    this.lastLevel = state.save.level;

    this.fogSystem = new FogSystem(this);
    this.fogSystem.create();

    // 相机
    this.cameras.main.startFollow(this.player.container, true, 0.1, 0.1);
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);
    this.cameras.main.setZoom(1.2);
  }

  private createGround() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x16213e, 1);
    graphics.fillRect(0, 0, GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);

    for (let x = 0; x < GAME_CONFIG.worldWidth; x += GAME_CONFIG.tileSize) {
      for (let y = 0; y < GAME_CONFIG.worldHeight; y += GAME_CONFIG.tileSize) {
        const color = (x + y) % 128 === 0 ? 0x1a1a40 : 0x16213e;
        graphics.fillStyle(color, 1);
        graphics.fillRect(x, y, GAME_CONFIG.tileSize, GAME_CONFIG.tileSize);
      }
    }

    graphics.fillStyle(0x0f0f23, 1);
    graphics.fillRect(0, 0, GAME_CONFIG.worldWidth, 32);
    graphics.fillRect(0, GAME_CONFIG.worldHeight - 32, GAME_CONFIG.worldWidth, 32);
    graphics.fillRect(0, 0, 32, GAME_CONFIG.worldHeight);
    graphics.fillRect(GAME_CONFIG.worldWidth - 32, 0, 32, GAME_CONFIG.worldHeight);
    graphics.setDepth(0);
  }

  private createTrees() {
    for (let i = 0; i < GAME_CONFIG.treeCount; i++) {
      const x = Phaser.Math.Between(100, GAME_CONFIG.worldWidth - 100);
      const y = Phaser.Math.Between(100, GAME_CONFIG.worldHeight - 100);
      const tree = this.createTree(x, y);
      this.trees.push(tree);
    }
  }

  private createTree(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const shadow = this.add.ellipse(4, 8, 48, 20, 0x000000, 0.3);
    const trunk = this.add.rectangle(0, -10, 12, 30, 0x5c4033);
    trunk.setOrigin(0.5, 1);
    const crown1 = this.add.ellipse(0, -35, 60, 50, 0x1a472a);
    const crown2 = this.add.ellipse(-5, -40, 50, 45, 0x2d6a4f);
    const crown3 = this.add.ellipse(5, -30, 45, 40, 0x1b4332);
    container.add([shadow, trunk, crown1, crown2, crown3]);
    container.setSize(40, 60);
    container.setDepth(y);
    return container;
  }

  private createPlayer() {
    const state = GameState.getInstance();
    const startX = GAME_CONFIG.worldWidth / 2;
    const startY = GAME_CONFIG.worldHeight / 2;
    this.player = new Player(this, startX, startY, state.save.selectedClass!, state.save.level);
  }

  private async loadAndCreateEnemies() {
    if (this.enemyTemplates.length === 0) {
      try {
        const data = await api.getEnemies();
        this.enemyTemplates = (data.enemies ?? []).map((e: any) => this.mapEnemyTemplate(e));
      } catch (err) {
        console.warn('从服务器加载敌人模板失败，使用本地数据:', err);
        // 回退：从 ItemDataManager 获取的本地数据不会包含敌人模板
        // 这里保留一个最小 fallback，或者直接从后端 init 逻辑复制一份
        this.enemyTemplates = this.getFallbackEnemyTemplates();
      }
    }
    this.spawnEnemies();
  }

  private mapEnemyTemplate(raw: any): EnemyType {
    return {
      id: raw.id,
      name: raw.name,
      hp: raw.hp,
      attack: raw.attack,
      defense: raw.defense,
      speed: raw.speed,
      aggroRange: raw.aggroRange,
      attackRange: raw.attackRange,
      color: parseInt(raw.colorHex, 16),
      isBoss: raw.isBoss,
      dropTable: raw.dropTableJson ? JSON.parse(raw.dropTableJson) : [],
      expValue: raw.expValue,
    };
  }

  private getFallbackEnemyTemplates(): EnemyType[] {
    return [
      { id: 'goblin', name: '哥布林', hp: 40, attack: 10, defense: 3, speed: 60, aggroRange: 180, attackRange: 40, color: 0x4ade80, isBoss: false, dropTable: [{ itemId: 'rusty_sword', chance: 0.1 }, { itemId: 'copper_ring', chance: 0.08 }, { itemId: 'hp_potion_small', chance: 0.15 }], expValue: 15 },
      { id: 'skeleton', name: '骷髅兵', hp: 55, attack: 14, defense: 5, speed: 55, aggroRange: 200, attackRange: 40, color: 0xe5e7eb, isBoss: false, dropTable: [{ itemId: 'iron_sword', chance: 0.05 }, { itemId: 'wooden_shield', chance: 0.08 }, { itemId: 'hp_potion_small', chance: 0.1 }], expValue: 20 },
      { id: 'wolf', name: '暗影狼', hp: 45, attack: 16, defense: 2, speed: 100, aggroRange: 250, attackRange: 45, color: 0x8b5cf6, isBoss: false, dropTable: [{ itemId: 'shadow_dagger', chance: 0.04 }, { itemId: 'leather_boots', chance: 0.06 }, { itemId: 'mp_potion_small', chance: 0.12 }], expValue: 18 },
      { id: 'orc', name: '兽人战士', hp: 90, attack: 20, defense: 8, speed: 55, aggroRange: 200, attackRange: 50, color: 0x166534, isBoss: false, dropTable: [{ itemId: 'iron_helm', chance: 0.05 }, { itemId: 'chain_armor', chance: 0.04 }, { itemId: 'hp_potion_large', chance: 0.08 }], expValue: 25 },
      { id: 'dark_mage', name: '黑暗法师', hp: 50, attack: 24, defense: 3, speed: 50, aggroRange: 300, attackRange: 180, color: 0x7c3aed, isBoss: false, dropTable: [{ itemId: 'crystal_staff', chance: 0.04 }, { itemId: 'magic_orb', chance: 0.02 }, { itemId: 'mp_potion_large', chance: 0.1 }], expValue: 22 },
      { id: 'forest_troll', name: '森林巨魔', hp: 200, attack: 30, defense: 12, speed: 40, aggroRange: 220, attackRange: 55, color: 0x92400e, isBoss: true, dropTable: [{ itemId: 'flame_blade', chance: 0.05 }, { itemId: 'dragon_scale_armor', chance: 0.03 }, { itemId: 'crown_of_kings', chance: 0.01 }, { itemId: 'hp_potion_large', chance: 0.2 }], expValue: 60 },
    ];
  }

  private spawnEnemies() {
    const count = Phaser.Math.Between(GAME_CONFIG.enemySpawnCount.min, GAME_CONFIG.enemySpawnCount.max);
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(100, GAME_CONFIG.worldWidth - 100);
      const y = Phaser.Math.Between(100, GAME_CONFIG.worldHeight - 100);
      const isBoss = Math.random() < GAME_CONFIG.bossSpawnChance;
      const pool = isBoss ? this.enemyTemplates.filter((e) => e.isBoss) : this.enemyTemplates.filter((e) => !e.isBoss);
      if (pool.length === 0) continue;
      const config = Phaser.Utils.Array.GetRandom(pool);
      const enemy = new Enemy(this, x, y, config);
      this.enemies.push(enemy);
    }
  }

  private createPortal() {
    const x = Phaser.Math.Between(200, GAME_CONFIG.worldWidth - 200);
    const y = Phaser.Math.Between(200, GAME_CONFIG.worldHeight - 200);
    this.portal = this.add.container(x, y);

    const glow = this.add.ellipse(0, 0, 60, 60, 0x3b82f6, 0.3);
    const core = this.add.ellipse(0, 0, 30, 30, 0x60a5fa);
    const label = this.add.text(0, -40, '传送门', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);

    this.portal.add([glow, core, label]);
    this.portal.setDepth(y);

    this.tweens.add({
      targets: glow,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0.1,
      duration: 1200,
      yoyo: true,
      repeat: -1,
    });
  }

  private createHUD() {
    const cam = this.cameras.main;

    // 左上角信息
    this.fogText = this.add.text(20, 20, '迷雾: 0%', { fontSize: '14px', color: '#a78bfa' }).setScrollFactor(0).setDepth(2000);
    this.depthText = this.add.text(20, 44, '层数: 1', { fontSize: '14px', color: '#fbbf24' }).setScrollFactor(0).setDepth(2000);
    this.killText = this.add.text(20, 68, '击杀: 0', { fontSize: '14px', color: '#ef4444' }).setScrollFactor(0).setDepth(2000);
    this.levelText = this.add.text(20, 92, '等级: 1', { fontSize: '14px', color: '#fbbf24' }).setScrollFactor(0).setDepth(2000);

    // 技能栏上方的生命条与法力条（带具体数值）
    const barY = cam.height - 130;
    this.hpBg = this.add.rectangle(cam.width / 2, barY, 200, 14, 0x000000).setScrollFactor(0).setDepth(2000);
    this.hpBar = this.add.rectangle(cam.width / 2 - 100, barY, 200, 14, 0xef4444).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2000);
    this.hpText = this.add.text(cam.width / 2, barY, '', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const mpY = barY + 20;
    this.mpBg = this.add.rectangle(cam.width / 2, mpY, 200, 10, 0x000000).setScrollFactor(0).setDepth(2000);
    this.mpBar = this.add.rectangle(cam.width / 2 - 100, mpY, 200, 10, 0x3b82f6).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2000);
    this.mpText = this.add.text(cam.width / 2, mpY, '', { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const expY = mpY + 16;
    this.expBg = this.add.rectangle(cam.width / 2, expY, 200, 8, 0x000000).setScrollFactor(0).setDepth(2000);
    this.expBar = this.add.rectangle(cam.width / 2 - 100, expY, 200, 8, 0xfbbf24).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2000);

    this.createSkillHUD();
    this.createConsumableHUD();

    // 操作提示
    this.add.text(cam.width - 20, cam.height - 20, 'WASD移动 | 鼠标指向朝向 | 空格攻击 | Q闪避 | B背包 | C属性 | N技能页 | T/Y/U/I/O技能 | 1-5使用消耗品 | 靠近传送门按E撤离/深入', {
      fontSize: '12px',
      color: '#94a3b8',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(2000);
  }

  private createSkillHUD() {
    const cam = this.cameras.main;
    const skills = this.player.getSkills();
    const keyLabels = ['T', 'Y', 'U', 'I', 'O'];
    const slotSize = 44;
    const gap = 8;
    const totalWidth = keyLabels.length * slotSize + (keyLabels.length - 1) * gap;
    const startX = (cam.width - totalWidth) / 2 + slotSize / 2;
    const y = cam.height - 70;

    for (let i = 0; i < keyLabels.length; i++) {
      const x = startX + i * (slotSize + gap);
      const bg = this.add.rectangle(x, y, slotSize, slotSize, 0x1e293b)
        .setScrollFactor(0).setDepth(2000);
      bg.setStrokeStyle(2, i < skills.length ? 0x475569 : 0x334155);

      const icon = i < skills.length
        ? this.createSkillIcon(skills[i].id, x, y)
        : this.add.container(x, y).setScrollFactor(0).setDepth(2001);

      const keyText = this.add.text(x + slotSize / 2 - 4, y - slotSize / 2 + 4, keyLabels[i], {
        fontSize: '10px',
        color: '#94a3b8',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(2002);

      const cooldownOverlay = this.add.rectangle(x, y, slotSize, slotSize, 0x000000, 0.6)
        .setScrollFactor(0).setDepth(2002).setVisible(false);

      this.skillSlots.push({ bg, icon, keyText, cooldownOverlay, skillIndex: i });
    }
  }

  private createConsumableHUD() {
    const cam = this.cameras.main;
    const slotSize = 40;
    const gap = 6;
    const totalWidth = 5 * slotSize + 4 * gap;
    const startX = (cam.width - totalWidth) / 2 + slotSize / 2;
    const y = cam.height - 155;

    for (let i = 0; i < 5; i++) {
      const x = startX + i * (slotSize + gap);
      const bg = this.add.rectangle(x, y, slotSize, slotSize, 0x1e293b)
        .setScrollFactor(0).setDepth(2000);
      bg.setStrokeStyle(2, 0x334155);

      const nameText = this.add.text(x, y, '', {
        fontSize: '9px', color: '#e2e8f0',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

      const keyText = this.add.text(x + slotSize / 2 - 4, y - slotSize / 2 + 2, String(i + 1), {
        fontSize: '10px', color: '#94a3b8',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(2002);

      this.consumableSlots.push({ bg, nameText, keyText, index: i });
    }
  }

  private createSkillIcon(skillId: string, x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setScrollFactor(0).setDepth(2001);
    const g = this.add.graphics();
    container.add(g);

    switch (skillId) {
      case 'slash': {
        // 重斩：银色斜剑
        g.fillStyle(0xc0c0c0, 1);
        g.fillRect(-3, -12, 6, 20);
        g.fillStyle(0x8b4513, 1);
        g.fillRect(-2, 8, 4, 8);
        g.fillStyle(0xc0c0c0, 1);
        g.fillRect(-8, 6, 16, 3);
        container.setRotation(Math.PI / 4);
        break;
      }
      case 'whirlwind': {
        // 旋风斩：绿色螺旋弧线
        g.lineStyle(2.5, 0x4ade80, 1);
        for (let i = 0; i < 3; i++) {
          const r = 5 + i * 5;
          g.beginPath();
          g.arc(0, 0, r, i * 0.8, i * 0.8 + Math.PI * 1.3);
          g.strokePath();
        }
        break;
      }
      case 'fireball': {
        // 火球术：橙红核心 + 火焰
        g.fillStyle(0xff4500, 1);
        g.fillCircle(0, 0, 10);
        g.fillStyle(0xffa500, 0.85);
        g.fillCircle(-4, -3, 6);
        g.fillStyle(0xffd700, 0.6);
        g.fillCircle(3, 3, 4);
        break;
      }
      case 'meteor': {
        // 星落：金色陨星 + 尾焰
        g.fillStyle(0xff4500, 1);
        g.fillCircle(0, 0, 8);
        g.fillStyle(0xffa500, 0.8);
        g.fillCircle(2, 2, 5);
        g.fillStyle(0xffd700, 0.5);
        g.fillTriangle(-4, 4, 0, 14, 4, 4);
        g.lineStyle(1.5, 0xff4500, 0.6);
        g.lineBetween(0, 8, 0, 14);
        break;
      }
      case 'heal': {
        // 治愈之光：绿色十字 + 光芒
        g.fillStyle(0x4ade80, 1);
        g.fillRect(-2.5, -12, 5, 24);
        g.fillRect(-12, -2.5, 24, 5);
        g.lineStyle(1.5, 0x4ade80, 0.6);
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI / 2) * i + Math.PI / 4;
          g.lineBetween(Math.cos(angle) * 8, Math.sin(angle) * 8, Math.cos(angle) * 14, Math.sin(angle) * 14);
        }
        break;
      }
      case 'curse': {
        // 衰弱诅咒：紫色符文（圆环 + 倒三角 + 眼）
        g.lineStyle(2, 0xa855f7, 1);
        g.strokeCircle(0, 0, 12);
        g.fillStyle(0xa855f7, 1);
        g.fillTriangle(0, 6, -6, -4, 6, -4);
        g.fillStyle(0x000000, 1);
        g.fillCircle(-3, -2, 2);
        g.fillCircle(3, -2, 2);
        break;
      }
      case 'manaOverflow': {
        // 法力流溢：蓝色光环 + 光芒
        g.lineStyle(2, 0x22d3ee, 1);
        g.strokeCircle(0, 0, 12);
        g.fillStyle(0x22d3ee, 0.5);
        g.fillCircle(0, 0, 6);
        g.lineStyle(1, 0x93c5fd, 0.6);
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI / 4) * i;
          g.lineBetween(Math.cos(angle) * 8, Math.sin(angle) * 8, Math.cos(angle) * 14, Math.sin(angle) * 14);
        }
        break;
      }
      default: {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(0, 0, 3);
      }
    }

    return container;
  }

  private setupInput() {
    this.keys = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
      Q: Phaser.Input.Keyboard.KeyCodes.Q,
      E: Phaser.Input.Keyboard.KeyCodes.E,
      T: Phaser.Input.Keyboard.KeyCodes.T,
      Y: Phaser.Input.Keyboard.KeyCodes.Y,
      U: Phaser.Input.Keyboard.KeyCodes.U,
      I: Phaser.Input.Keyboard.KeyCodes.I,
      O: Phaser.Input.Keyboard.KeyCodes.O,
      B: Phaser.Input.Keyboard.KeyCodes.B,
      N: Phaser.Input.Keyboard.KeyCodes.N,
      C: Phaser.Input.Keyboard.KeyCodes.C,
      V: Phaser.Input.Keyboard.KeyCodes.V,
      ONE: Phaser.Input.Keyboard.KeyCodes.ONE,
      TWO: Phaser.Input.Keyboard.KeyCodes.TWO,
      THREE: Phaser.Input.Keyboard.KeyCodes.THREE,
      FOUR: Phaser.Input.Keyboard.KeyCodes.FOUR,
      FIVE: Phaser.Input.Keyboard.KeyCodes.FIVE,
      ESC: Phaser.Input.Keyboard.KeyCodes.ESC,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private errorText?: Phaser.GameObjects.Text;

  update(_time: number, delta: number) {
    try {
      if (!this.player) return;

      const state = GameState.getInstance();
      if (!state.run) return;

      // 每帧最开始就更新角色朝向
      try {
        const mp = this.getMouseWorldPoint();
        this.player.faceTo(mp.x, mp.y);
      } catch {
        // 朝向计算失败不应阻塞游戏主逻辑
      }

      // 清理已销毁的敌人引用，防止数组污染导致异常
      this.enemies = this.enemies.filter((e) => e && e.container?.active);

      this.handleMovement();
      this.handleCombat(delta);
      this.handleDodge(delta);
      this.handleSkills();
      this.handleChanneling();
      this.handleConsumables();
      this.handleBagInput();
      this.handleEscInput();
      this.handleSkillPage();
      this.handleCharacterPage();
      this.handleBestiaryPage();
      this.handlePortal();
      this.updateProjectiles(delta);
      this.updateLightOrbs(delta);
      this.updateEnemies(delta);
      this.updateFog(delta);
      this.updateHUD();
      this.checkDeath();
    } catch (err: any) {
      if (!this.errorText) {
        this.errorText = this.add.text(20, this.scale.height / 2, '', {
          fontSize: '14px',
          color: '#ff4444',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 6 },
          lineSpacing: 4,
        }).setScrollFactor(0).setDepth(9999);
      }
      this.errorText.setText(`ERROR: ${err?.message ?? String(err)}\n${err?.stack?.slice(0, 300) ?? ''}`);
      console.error(err);
    }
  }

  private handleMovement() {
    let vx = 0, vy = 0;
    if (this.keys.W.isDown) vy = -1;
    if (this.keys.S.isDown) vy = 1;
    if (this.keys.A.isDown) vx = -1;
    if (this.keys.D.isDown) vx = 1;
    this.player.move(vx, vy);
  }

  private handleCombat(_delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      if (this.player.attackCooldown > 0) return;
      this.player.attackCooldown = this.player.getAttackInterval();

      const cls = this.player.getClassType();
      if (cls === 'mage') {
        this.mageAttack();
      } else if (cls === 'warrior') {
        this.warriorAttack();
      } else if (cls === 'sage') {
        this.sageAttack();
      }

      // 法力流溢：普通攻击附带追踪光球
      if (this.player.isManaOverflowActive()) {
        this.spawnLightOrb();
      }
    }

    // 敌人攻击玩家
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      enemy.tryAttack(this.player);
    }
  }

  private mageAttack() {
    const px = this.player.container.x;
    const py = this.player.container.y;
    const angle = this.player.getFacingAngle();
    const speed = 350;
    const directDmg = this.player.attack;
    const splashDmg = Math.floor(this.player.attack * 0.5);

    const container = this.add.container(px, py);
    const glow = this.add.ellipse(0, 0, 16, 16, 0x22d3ee, 0.35);
    const core = this.add.ellipse(0, 0, 8, 8, 0x93c5fd, 0.9);
    container.add([glow, core]);
    container.setDepth(998);

    this.projectiles.push({
      container,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: splashDmg,
      directHitDamage: directDmg,
      splashDamage: splashDmg,
      range: 250,
      traveled: 0,
      aoeRange: 35,
    });
  }

  private warriorAttack() {
    const px = this.player.container.x;
    const py = this.player.container.y;
    const angle = this.player.getFacingAngle();
    const range = 55;
    const halfCone = Math.PI / 6;
    const dmg = Math.floor(this.player.attack * 1.1);

    // 扇形挥砍动画
    const arc = this.add.graphics();
    arc.fillStyle(0xc0c0c0, 0.4);
    arc.slice(px, py, range, angle - halfCone, angle + halfCone);
    arc.fillPath();
    arc.setDepth(999);
    this.tweens.add({
      targets: arc,
      alpha: 0,
      duration: 200,
      onComplete: () => arc.destroy(),
    });

    // 扇形内伤害判定
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      const dist = Phaser.Math.Distance.Between(px, py, enemy.container.x, enemy.container.y);
      if (dist > range) continue;
      const angleToEnemy = Phaser.Math.Angle.Between(px, py, enemy.container.x, enemy.container.y);
      let angleDiff = Math.abs(Phaser.Math.Angle.Wrap(angleToEnemy - angle));
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff <= halfCone) {
        enemy.takeDamage(dmg);
        if (!enemy.isDead()) {
          enemy.knockBack(px, py);
        } else {
          this.handleEnemyDeath(enemy);
        }
      }
    }
  }

  private sageAttack() {
    const px = this.player.container.x;
    const py = this.player.container.y;
    const range = 200;
    const dmg = Math.floor(this.player.attack * 0.8);

    const targets = this.enemies
      .filter((e) => e && !e.isDead() && e.container?.active)
      .map((e) => ({
        enemy: e,
        dist: Phaser.Math.Distance.Between(px, py, e.container.x, e.container.y),
      }))
      .filter((t) => t.dist <= range)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map((t) => t.enemy);

    if (targets.length === 0) return;

    for (const enemy of targets) {
      const container = this.add.container(px, py);
      const glow = this.add.ellipse(0, 0, 14, 14, 0xfef08a, 0.35);
      const core = this.add.ellipse(0, 0, 8, 8, 0xfbbf24, 0.9);
      container.add([glow, core]);
      container.setDepth(998);

      this.lightOrbs.push({
        container,
        damage: dmg,
        target: enemy,
        life: 2500,
      });

      const flash = this.add.ellipse(px, py, 10, 10, 0xfbbf24, 0.6);
      flash.setDepth(999);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        scaleX: 2,
        scaleY: 2,
        duration: 200,
        onComplete: () => flash.destroy(),
      });
    }
  }

  private spawnLightOrb() {
    const px = this.player.container.x;
    const py = this.player.container.y;

    // 寻找最近敌人
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      const dist = Phaser.Math.Distance.Between(px, py, enemy.container.x, enemy.container.y);
      if (dist < nearestDist) {
        nearest = enemy;
        nearestDist = dist;
      }
    }

    if (!nearest) return;

    const container = this.add.container(px, py);
    const core = this.add.ellipse(0, 0, 10, 10, 0x22d3ee, 0.9);
    const glow = this.add.ellipse(0, 0, 18, 18, 0x93c5fd, 0.4);
    container.add([glow, core]);
    container.setDepth(998);

    this.lightOrbs.push({
      container,
      damage: this.player.attack,
      target: nearest,
      life: 3000,
    });
  }

  private updateLightOrbs(delta: number) {
    const speed = 300;
    const dtSec = delta / 1000;

    for (let i = this.lightOrbs.length - 1; i >= 0; i--) {
      const orb = this.lightOrbs[i];
      if (!orb.container.active) {
        this.lightOrbs.splice(i, 1);
        continue;
      }

      orb.life -= delta;
      if (orb.life <= 0) {
        orb.container.destroy();
        this.lightOrbs.splice(i, 1);
        continue;
      }

      const target = orb.target;
      if (!target || target.isDead() || !target.container?.active) {
        orb.container.destroy();
        this.lightOrbs.splice(i, 1);
        continue;
      }

      const angle = Phaser.Math.Angle.Between(orb.container.x, orb.container.y, target.container.x, target.container.y);
      orb.container.x += Math.cos(angle) * speed * dtSec;
      orb.container.y += Math.sin(angle) * speed * dtSec;

      const dist = Phaser.Math.Distance.Between(orb.container.x, orb.container.y, target.container.x, target.container.y);
      if (dist < 15) {
        target.takeDamage(orb.damage);
        if (target.isDead()) {
          this.handleEnemyDeath(target);
        }

        // 命中特效
        const burst = this.add.ellipse(orb.container.x, orb.container.y, 20, 20, 0x22d3ee, 0.5);
        burst.setDepth(999);
        this.tweens.add({
          targets: burst, alpha: 0, scaleX: 2, scaleY: 2, duration: 200,
          onComplete: () => burst.destroy(),
        });

        orb.container.destroy();
        this.lightOrbs.splice(i, 1);
      }
    }
  }

  private handleDodge(delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
      this.player.dodge();
    }
    this.player.update(delta);
  }

  private handleSkills() {
    const skillKeys = ['T', 'Y', 'U', 'I', 'O'];
    const pointer = this.input.activePointer;

    // 蓄力技能：火球术(T) 和 星落(Y)
    this.handleSkillCharge('T', 0, 3000, pointer);
    this.handleSkillCharge('Y', 1, 1000, pointer);

    // 其他技能瞬发
    for (let i = 2; i < skillKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.keys[skillKeys[i]])) {
        const mp = this.getMouseWorldPoint();
        const result = this.player.castSkill(i, mp.x, mp.y);
        if (result) {
          this.castSkillEffect(result.skill, result.targetX, result.targetY);
        }
      }
    }
  }

  private handleSkillCharge(keyName: string, skillIndex: number, maxChargeTime: number, pointer: Phaser.Input.Pointer) {
    const key = this.keys[keyName];
    const skill = this.player.getSkills()[skillIndex];
    if (!skill) return;

    // 开始蓄力：按住键，且未在蓄力中，且技能可用
    if (key.isDown && !this.player.getIsCharging()) {
      if (this.player.getSkillCooldown(skill.id) <= 0 && this.player.mp >= skill.mpCost) {
        this.player.startCharge(skill.id, maxChargeTime);
      }
    }

    // 释放：松开键，且正在蓄力同一技能
    if (Phaser.Input.Keyboard.JustUp(key) && this.player.getIsCharging() && this.player.getChargeSkillId() === skill.id) {
      // 星落未满蓄力取消
      if (skill.id === 'meteor' && this.player.getChargeRatio() < 1) {
        this.player.cancelCharge();
        return;
      }
      const chargeRatio = this.player.releaseCharge();
      const mp = this.getMouseWorldPoint();
      const result = this.player.castSkill(skillIndex, mp.x, mp.y);
      if (result) {
        this.castSkillEffect(result.skill, result.targetX, result.targetY, chargeRatio);
      }
    }
  }

  private handleChanneling() {
    if (!this.player.getIsCharging()) return;
    const skillId = this.player.getChargeSkillId();
    const ratio = this.player.getChargeRatio();

    // 星落：蓄满1秒后自动释放
    if (skillId === 'meteor' && ratio >= 1) {
      const mp = this.getMouseWorldPoint();
      const chargeRatio = this.player.releaseCharge();
      const skill = this.player.getSkills().find((s) => s.id === 'meteor');
      if (skill) {
        const result = this.player.castSkill(1, mp.x, mp.y);
        if (result) {
          this.castSkillEffect(result.skill, result.targetX, result.targetY, chargeRatio);
        }
      }
    }
  }

  private handleConsumables() {
    const hotkeys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
    for (let i = 0; i < hotkeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.keys[hotkeys[i]])) {
        this.useConsumableAtIndex(i);
      }
    }
  }

  private useConsumableAtIndex(index: number) {
    const slot = this.runInventory.slots[index];
    const item = slot?.item;
    if (!item) {
      this.showFloatingText(this.player.container.x, this.player.container.y - 20, '空', 0x94a3b8);
      return;
    }
    if ('rarity' in item) {
      this.showFloatingText(this.player.container.x, this.player.container.y - 20, '不是消耗品', 0xef4444);
      return;
    }

    const consumable = item as import('../types').Consumable;
    const applied = this.player.applyConsumableEffect(consumable);
    if (!applied) {
      if (consumable.type === 'instantHp' || consumable.type === 'slowHp') {
        this.showFloatingText(this.player.container.x, this.player.container.y - 20, '生命已满', 0xef4444);
      } else if (consumable.type === 'instantMp' || consumable.type === 'slowMp') {
        this.showFloatingText(this.player.container.x, this.player.container.y - 20, '法力已满', 0xef4444);
      }
      return;
    }

    this.runInventory.removeItem(index);

    const px = this.player.container.x;
    const py = this.player.container.y;
    this.showFloatingText(px, py - 20, `使用 ${consumable.name}`, 0x22c55e);

    logConsumableUse({
      itemName: consumable.name,
      itemId: consumable.id,
      effectType: consumable.type,
      depth: GameState.getInstance().run?.forestDepth,
      slotIndex: index,
    });

    const burst = this.add.ellipse(px, py, 30, 30, 0x22c55e, 0.5);
    burst.setDepth(999);
    this.tweens.add({
      targets: burst,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 300,
      onComplete: () => burst.destroy(),
    });
  }

  private castSkillEffect(skill: import('../types').Skill, targetX: number, targetY: number, chargeRatio: number = 0) {
    const px = this.player.container.x;
    const py = this.player.container.y;

    // 技能特效
    if (skill.id === 'heal') {
      // 治愈之光：恢复生命
      this.player.heal(40);
      const glow = this.add.ellipse(px, py, 80, 80, 0x4ade80, 0.5);
      glow.setDepth(999);
      this.tweens.add({
        targets: glow, alpha: 0, scaleX: 2, scaleY: 2, duration: 400,
        onComplete: () => glow.destroy(),
      });
      return;
    }

    if (skill.id === 'curse') {
      // 衰弱诅咒：AOE 伤害并降低攻击（简化：AOE 伤害）
      const range = skill.range ?? 100;
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(px, py, enemy.container.x, enemy.container.y);
        if (dist <= range) {
          enemy.takeDamage(skill.damage ?? 15);
          if (enemy.isDead()) {
            this.handleEnemyDeath(enemy);
          }
        }
      }
      const ring = this.add.ellipse(px, py, range * 2, range * 2, 0xa855f7, 0.3);
      ring.setDepth(999);
      this.tweens.add({
        targets: ring, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 400,
        onComplete: () => ring.destroy(),
      });
      return;
    }

    if (skill.id === 'manaOverflow') {
      // 法力流溢：开启增益状态
      this.player.activateManaOverflow();
      // 蓝色光环扩散特效
      const ring = this.add.ellipse(px, py, 60, 60, 0x22d3ee, 0.5);
      ring.setDepth(999);
      this.tweens.add({
        targets: ring, alpha: 0, scaleX: 3, scaleY: 3, duration: 500,
        onComplete: () => ring.destroy(),
      });
      // 内部闪光
      const flash = this.add.ellipse(px, py, 40, 40, 0x93c5fd, 0.7);
      flash.setDepth(999);
      this.tweens.add({
        targets: flash, alpha: 0, scaleX: 2, scaleY: 2, duration: 400,
        onComplete: () => flash.destroy(),
      });
      return;
    }

    if (skill.id === 'meteor') {
      // 星落：陨星从天而降
      const range = skill.range ?? 120;
      const damage = Math.floor(this.player.attack * ((skill.damagePercent ?? 500) / 100));

      // 预警圈
      const warning = this.add.ellipse(targetX, targetY, range * 2, range * 2, 0xff4500, 0.25);
      warning.setDepth(998);

      // 陨星本体（从上方落下）
      const meteor = this.add.ellipse(targetX, targetY - 300, 50, 70, 0xff4500);
      meteor.setDepth(999);

      this.tweens.add({
        targets: warning,
        alpha: 0,
        scaleX: 0.5,
        scaleY: 0.5,
        duration: 200,
        ease: 'Quad.easeIn',
        onComplete: () => warning.destroy(),
      });

      this.tweens.add({
        targets: meteor,
        y: targetY,
        duration: 200,
        ease: 'Quad.easeIn',
        onComplete: () => {
          // 伤害结算
          for (const enemy of this.enemies) {
            if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
            const dist = Phaser.Math.Distance.Between(targetX, targetY, enemy.container.x, enemy.container.y);
            if (dist <= range) {
              enemy.takeDamage(damage);
              if (enemy.isDead()) {
                this.handleEnemyDeath(enemy);
              }
            }
          }

          // 爆炸特效
          const burst = this.add.ellipse(targetX, targetY, range * 2.5, range * 2.5, 0xff4500, 0.5);
          burst.setDepth(999);
          this.tweens.add({
            targets: burst, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 400,
            onComplete: () => burst.destroy(),
          });

          const flash = this.add.ellipse(targetX, targetY, 60, 60, 0xffaa00, 0.8);
          flash.setDepth(999);
          this.tweens.add({
            targets: flash, alpha: 0, scaleX: 3, scaleY: 3, duration: 250,
            onComplete: () => flash.destroy(),
          });

          meteor.destroy();
        },
      });
      return;
    }

    if (skill.id === 'fireball') {
      // 火球术：蓄力发射飞行投射物
      const angle = Phaser.Math.Angle.Between(px, py, targetX, targetY);
      const speed = 420;

      // 蓄力影响：大小 1x~2.5x，伤害 200%~400%，AOE范围 60~140
      const scale = 1 + chargeRatio * 1.5;
      const basePercent = skill.damagePercent ?? 200;
      const damage = Math.floor(this.player.attack * (basePercent / 100) * (1 + chargeRatio));
      const aoeRange = 60 + chargeRatio * 80;

      const container = this.add.container(px, py);
      const glow = this.add.ellipse(0, 0, 28 * scale, 28 * scale, 0xf97316, 0.35);
      const core = this.add.ellipse(0, 0, 14 * scale, 14 * scale, 0xff4500, 0.9);
      const trail = this.add.ellipse(-6 * scale, 0, 10 * scale, 6 * scale, 0xffa500, 0.4);
      container.add([glow, trail, core]);
      container.setDepth(998);

      container.setRotation(angle);

      this.projectiles.push({
        container,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        damage,
        range: skill.range ?? 200,
        traveled: 0,
        aoeRange,
      });
      return;
    }

    if (skill.aoe) {
      // AOE 技能：以目标点为中心的范围伤害
      const range = skill.range ?? 80;
      const dmg = skill.damagePercent
        ? Math.floor(this.player.attack * (skill.damagePercent / 100))
        : (skill.damage ?? this.player.attack);
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(targetX, targetY, enemy.container.x, enemy.container.y);
        if (dist <= range) {
          enemy.takeDamage(dmg);
          if (enemy.isDead()) {
            this.handleEnemyDeath(enemy);
          }
        }
      }
      const burst = this.add.ellipse(targetX, targetY, range * 2, range * 2, 0xf59e0b, 0.35);
      burst.setDepth(999);
      this.tweens.add({
        targets: burst, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 300,
        onComplete: () => burst.destroy(),
      });
    } else {
      // 单体技能：对最近敌人造成伤害
      let nearest: Enemy | null = null;
      let nearestDist = Infinity;
      const dmg = skill.damagePercent
        ? Math.floor(this.player.attack * (skill.damagePercent / 100))
        : (skill.damage ?? this.player.attack);
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(targetX, targetY, enemy.container.x, enemy.container.y);
        if (dist < 60 && dist < nearestDist) {
          nearest = enemy;
          nearestDist = dist;
        }
      }
      if (nearest) {
        nearest.takeDamage(dmg);
        if (nearest.isDead()) {
          this.handleEnemyDeath(nearest);
        }
      }
      // 投射物特效
      const bolt = this.add.ellipse(targetX, targetY, 20, 20, 0xf97316, 0.6);
      bolt.setDepth(999);
      this.tweens.add({
        targets: bolt, alpha: 0, scaleX: 2, scaleY: 2, duration: 250,
        onComplete: () => bolt.destroy(),
      });
    }
  }

  private updateProjectiles(delta: number) {
    const dtSec = delta / 1000;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj.container.active) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // 移动
      proj.container.x += proj.vx * dtSec;
      proj.container.y += proj.vy * dtSec;
      proj.traveled += Math.abs(proj.vx * dtSec) + Math.abs(proj.vy * dtSec);

      // 碰撞检测
      let hitEnemy: Enemy | null = null;
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(proj.container.x, proj.container.y, enemy.container.x, enemy.container.y);
        if (dist < 20) {
          hitEnemy = enemy;
          break;
        }
      }

      // 命中或超出最大距离则爆炸
      if (hitEnemy || proj.traveled >= proj.range) {
        this.explodeProjectile(proj, hitEnemy);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private explodeProjectile(proj: typeof this.projectiles[0], directHit?: Enemy | null) {
    const ex = proj.container.x;
    const ey = proj.container.y;

    // AOE 伤害：区分直接命中与溅射
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      const dist = Phaser.Math.Distance.Between(ex, ey, enemy.container.x, enemy.container.y);
      if (dist <= proj.aoeRange) {
        const dmg = (enemy === directHit && proj.directHitDamage !== undefined)
          ? proj.directHitDamage
          : (proj.splashDamage ?? proj.damage);
        enemy.takeDamage(dmg);
        if (enemy.isDead()) {
          this.handleEnemyDeath(enemy);
        }
      }
    }

    // 销毁投射物本体
    proj.container.destroy();

    // 爆炸特效
    const burst = this.add.ellipse(ex, ey, proj.aoeRange * 2, proj.aoeRange * 2, 0xff4500, 0.4);
    burst.setDepth(999);
    this.tweens.add({
      targets: burst, alpha: 0, scaleX: 1.6, scaleY: 1.6, duration: 300,
      onComplete: () => burst.destroy(),
    });

    // 中心亮光
    const flash = this.add.ellipse(ex, ey, 30, 30, 0xffaa00, 0.7);
    flash.setDepth(999);
    this.tweens.add({
      targets: flash, alpha: 0, scaleX: 2.5, scaleY: 2.5, duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  private async handleBagInput() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      await this.toggleBag();
    }
  }

  private handleEscInput() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      if (this.bagOpen) {
        this.closeBag();
      } else if (this.portalMenuUI.length > 0) {
        this.closePortalMenu();
      }
    }
  }

  private handleSkillPage() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)) {
      this.scene.start('SkillScene');
    }
  }

  private handleCharacterPage() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
      this.scene.start('CharacterScene');
    }
  }

  private handleBestiaryPage() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.V)) {
      this.scene.start('BestiaryScene');
    }
  }

  private async toggleBag() {
    if (this.bagOpen) {
      this.closeBag();
    } else {
      await this.openBag();
    }
  }

  private closeBag() {
    this.bagOpen = false;
    for (const obj of this.bagUI) {
      if (obj.active) obj.destroy();
    }
    this.bagUI = [];
  }

  private async openBag() {
    this.bagOpen = true;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    // 遮罩
    const overlay = this.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(4000).setInteractive();
    this.bagUI.push(overlay);

    // 面板
    const panel = this.add.rectangle(cx, cy, 540, 400, 0x1e293b)
      .setScrollFactor(0).setDepth(4001);
    this.bagUI.push(panel);

    // 标题
    const title = this.add.text(cx, cy - 170, '背 包', { fontSize: '24px', color: '#e2e8f0', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(title);

    // 关闭提示
    const closeHint = this.add.text(cx, cy + 175, '按 B 或点击空白处关闭', { fontSize: '12px', color: '#64748b' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(closeHint);

    // 加载指示器
    const loadingText = this.add.text(cx, cy, '加载中...', {
      fontSize: '16px', color: '#94a3b8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
    this.bagUI.push(loadingText);

    // 点击遮罩关闭
    overlay.on('pointerdown', () => this.closeBag());

    // 信息提示区
    this.bagInfoText = this.add.text(cx, cy + 140, '', {
      fontSize: '13px',
      color: '#e2e8f0',
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4004);
    this.bagUI.push(this.bagInfoText);

    // 向后端查询最新背包数据并同步到本地存档
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const data = await api.getCharacterInventory(characterId);
        if (data?.cityInventory) {
          GameState.getInstance().save.cityInventory = data.cityInventory;
        }
        if (data?.cityEquipment) {
          GameState.getInstance().save.cityEquipment = data.cityEquipment;
        }
      } catch (e) {
        console.warn('局内背包同步服务器数据失败:', e);
      }
    }

    // 清理加载指示器
    if (loadingText.active) {
      loadingText.destroy();
      this.bagUI = this.bagUI.filter((obj) => obj !== loadingText);
    }
    if (!this.bagOpen) return;

    this.renderBagContents(cx, cy);
  }

  private refreshBag() {
    this.closeBag();
    this.openBag();
  }

  private renderBagContents(cx: number, cy: number) {
    // 装备栏（左侧）
    const slots = ['weapon', 'helmet', 'armor', 'pants', 'shoes', 'accessory', 'offhand'] as const;
    const eqStartX = cx - 200;
    const eqStartY = cy - 120;

    const eqTitle = this.add.text(eqStartX + 50, eqStartY - 25, '装备', { fontSize: '14px', color: '#94a3b8', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(eqTitle);

    slots.forEach((slot, i) => {
      const x = eqStartX + 50;
      const y = eqStartY + i * 48;
      const item = this.runEquipment.getSlot(slot);

      const bg = this.add.rectangle(x, y, 100, 40, item ? 0x1e293b : 0x0f172a)
        .setScrollFactor(0).setDepth(4002);
      bg.setStrokeStyle(1, item ? RARITY_COLORS[item.rarity] : 0x334155);
      this.bagUI.push(bg);

      const label = this.add.text(x - 46, y - 14, SLOT_NAMES[slot] ?? slot, { fontSize: '10px', color: '#64748b' })
        .setScrollFactor(0).setDepth(4003);
      this.bagUI.push(label);

      if (item) {
        const nameText = this.add.text(x - 46, y - 2, item.name.slice(0, 5), {
          fontSize: '11px',
          color: '#' + RARITY_COLORS[item.rarity].toString(16).padStart(6, '0'),
        }).setScrollFactor(0).setDepth(4003);
        this.bagUI.push(nameText);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          this.showBagInfo(`${item.name} [${item.rarity}]\n${item.description}\n${this.formatStats(item.stats)}`);
        });
        bg.on('pointerout', () => this.showBagInfo(''));
        bg.on('pointerdown', () => {
          this.unequipItem(slot);
        });
      }
    });

    // 总属性
    const total = this.runEquipment.getTotalStats();
    const statsText = `攻击+${total.attack ?? 0}  防御+${total.defense ?? 0}  生命+${total.hp ?? 0}  法力+${total.mp ?? 0}  移速+${total.speed ?? 0}`;
    const statsLabel = this.add.text(eqStartX + 50, eqStartY + 7 * 48 + 10, statsText, {
      fontSize: '11px',
      color: '#60a5fa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
    this.bagUI.push(statsLabel);

    // 背包（右侧）
    const invStartX = cx - 50;
    const invStartY = cy - 120;
    const cellW = 72;
    const cellH = 50;

    const invTitle = this.add.text(invStartX + cellW * 2, invStartY - 25, '物品', {
      fontSize: '14px',
      color: '#94a3b8',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(invTitle);

    for (let i = 0; i < this.runInventory.capacity; i++) {
      const col = i % GAME_CONFIG.inventoryCols;
      const row = Math.floor(i / GAME_CONFIG.inventoryCols);
      const x = invStartX + col * cellW + cellW / 2;
      const y = invStartY + row * cellH + cellH / 2;
      const slotItem = this.runInventory.slots[i].item;

      const bg = this.add.rectangle(x, y, cellW - 4, cellH - 4, slotItem ? 0x1e293b : 0x0f172a)
        .setScrollFactor(0).setDepth(4002);
      bg.setStrokeStyle(1, slotItem && 'rarity' in slotItem ? RARITY_COLORS[(slotItem as Item).rarity] : 0x334155);
      this.bagUI.push(bg);

      if (slotItem) {
        const color = 'rarity' in slotItem ? RARITY_COLORS[(slotItem as Item).rarity] : 0x22c55e;
        const nameText = this.add.text(x, y, slotItem.name.slice(0, 4), {
          fontSize: '10px',
          color: '#' + color.toString(16).padStart(6, '0'),
        }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
        this.bagUI.push(nameText);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          const desc = 'rarity' in slotItem
            ? `${slotItem.name} [${(slotItem as Item).rarity}]\n${slotItem.description}\n${this.formatStats((slotItem as Item).stats)}`
            : `${slotItem.name}\n${slotItem.description}`;
          this.showBagInfo(desc);
        });
        bg.on('pointerout', () => this.showBagInfo(''));

        if ('rarity' in slotItem) {
          bg.on('pointerdown', () => {
            this.equipFromInventory(i);
          });
        }
      }
    }
  }

  private async equipFromInventory(index: number) {
    const item = this.runInventory.slots[index].item;
    if (!item || !('rarity' in item)) return;

    // 先装备，获取被替换的旧装备
    const oldItem = this.runEquipment.equip(item as Item);

    // 从背包移除当前物品
    this.runInventory.removeItem(index);

    // 如果有旧装备，放回背包
    if (oldItem) {
      const added = this.runInventory.addItem(oldItem);
      if (!added) {
        // 极端情况：背包满了，把旧装备丢回原来位置
        this.runInventory.slots[index] = { item: oldItem };
      }
    }

    logEquipChange({
      operation: 'equip',
      slot: (item as Item).slot,
      itemName: item.name,
      itemId: item.id,
      itemRarity: (item as Item).rarity,
      oldItemName: oldItem?.name,
      oldItemId: oldItem?.id,
      oldItemRarity: oldItem?.rarity,
      depth: GameState.getInstance().run?.forestDepth,
      location: 'forest',
    });

    await this.applyEquipmentStats();
    this.refreshBag();
  }

  private async unequipItem(slot: string) {
    const oldItem = this.runEquipment.unequip(slot as any);
    if (!oldItem) return;

    const added = this.runInventory.addItem(oldItem);
    if (!added) {
      // 背包满了，重新穿上
      this.runEquipment.equip(oldItem);
      this.showBagInfo('背包已满，无法卸下');
      this.time.delayedCall(1200, () => this.showBagInfo(''));
      return;
    }

    logEquipChange({
      operation: 'unequip',
      slot,
      itemName: oldItem.name,
      itemId: oldItem.id,
      itemRarity: oldItem.rarity,
      depth: GameState.getInstance().run?.forestDepth,
      location: 'forest',
    });

    await this.applyEquipmentStats();
    this.refreshBag();
  }

  private async applyEquipmentStats() {
    const state = GameState.getInstance();
    const bonus = this.runEquipment.getTotalStats();

    let maxHp: number;
    let maxMp: number;
    let attack: number;
    let defense: number;
    let speed: number;

    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const eqData: Record<string, any | null> = {};
        for (const [slot, item] of Object.entries(this.runEquipment.equipment)) {
          eqData[slot] = item;
        }
        const res = await api.calculateCharacterStats(characterId, eqData);
        const fs = res.stats.finalStats;
        maxHp = fs.maxHp;
        maxMp = fs.maxMp;
        attack = fs.attack;
        defense = fs.defense;
        speed = fs.speed;
      } catch (e) {
        console.warn('从服务器计算属性失败，回退本地:', e);
        const local = this.calculateStatsLocally(state, bonus);
        maxHp = local.maxHp;
        maxMp = local.maxMp;
        attack = local.attack;
        defense = local.defense;
        speed = local.speed;
      }
    } else {
      const local = this.calculateStatsLocally(state, bonus);
      maxHp = local.maxHp;
      maxMp = local.maxMp;
      attack = local.attack;
      defense = local.defense;
      speed = local.speed;
    }

    this.player.maxHp = maxHp;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.player.maxMp = maxMp;
    this.player.mp = Math.min(this.player.mp, this.player.maxMp);
    this.player.attack = attack;
    this.player.defense = defense;
    this.player.speed = speed;
  }

  private calculateStatsLocally(state: ReturnType<typeof GameState.getInstance>, bonus: ReturnType<EquipmentSystem['getTotalStats']>) {
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass);
    const levelMultiplier = 1 + (state.save.level - 1) * 0.05;
    return {
      maxHp: Math.floor((cls?.baseStats.maxHp ?? 100) * levelMultiplier) + (bonus.maxHp ?? 0),
      maxMp: Math.floor((cls?.baseStats.maxMp ?? 50) * levelMultiplier) + (bonus.mp ?? 0),
      attack: Math.floor((cls?.baseStats.attack ?? 10) * levelMultiplier) + (bonus.attack ?? 0),
      defense: Math.floor((cls?.baseStats.defense ?? 5) * levelMultiplier) + (bonus.defense ?? 0),
      speed: Math.floor((cls?.baseStats.speed ?? 150) * levelMultiplier) + (bonus.speed ?? 0),
    };
  }

  private showBagInfo(text: string) {
    if (this.bagInfoText && this.bagInfoText.active) {
      this.bagInfoText.setText(text);
    }
  }

  private formatStats(stats: Partial<Record<string, number>>): string {
    return Object.entries(stats)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k === 'hp' ? '生命' : k === 'mp' ? '法力' : k === 'attack' ? '攻击' : k === 'defense' ? '防御' : k === 'speed' ? '移速' : k}: +${v}`)
      .join('  ');
  }

  private handlePortal() {
    if (!Phaser.Input.Keyboard.JustDown(this.keys.E)) return;
    const dist = Phaser.Math.Distance.Between(this.player.container.x, this.player.container.y, this.portal.x, this.portal.y);
    if (dist < 50) {
      this.showPortalMenu();
    }
  }

  private showPortalMenu() {
    if (this.portalMenuUI.length > 0) return;

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    const overlay = this.add.rectangle(cx, cy, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.7).setScrollFactor(0).setDepth(3000);
    const panel = this.add.rectangle(cx, cy, 300, 200, 0x1e293b).setScrollFactor(0).setDepth(3001);

    const title = this.add.text(cx, cy - 60, '发现传送门', { fontSize: '22px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(3002);

    const extractBtn = this.add.text(cx, cy - 10, '安全撤离', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#16a34a',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3002).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.extract());

    const deeperBtn = this.add.text(cx, cy + 50, '深入下一层', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#dc2626',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3002).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goDeeper());

    this.portalMenuUI.push(overlay, panel, title, extractBtn, deeperBtn);

    // 点击背景关闭
    overlay.setInteractive();
    overlay.once('pointerdown', () => this.closePortalMenu());
  }

  private closePortalMenu() {
    for (const obj of this.portalMenuUI) {
      if (obj.active) obj.destroy();
    }
    this.portalMenuUI = [];
  }

  private extract() {
    this.closePortalMenu();
    const state = GameState.getInstance();
    if (state.run) {
      const itemsCarried = this.runInventory.slots.filter((s) => s.item !== null).length;
      logExtract({
        depth: state.run.forestDepth,
        enemiesKilled: state.run.enemiesKilled,
        elapsedTimeSec: Math.floor(state.run.elapsedTime / 1000),
        itemsCarried,
      });
      state.extractRun();
      this.scene.start('GameOverScene', {
        survived: true,
        depth: state.run?.forestDepth ?? 1,
        kills: state.run?.enemiesKilled ?? 0,
        items: state.run?.itemsFound ?? [],
      });
    }
  }

  private goDeeper() {
    this.closePortalMenu();
    const state = GameState.getInstance();
    if (state.run) {
      const fromDepth = state.run.forestDepth;
      state.run.forestDepth++;
      logGoDeeper({
        fromDepth,
        toDepth: state.run.forestDepth,
        enemiesKilledSoFar: state.run.enemiesKilled,
      });
      // 重新生成敌人，保留当前状态
      this.enemies.forEach((e) => e.destroy());
      this.enemies = [];
      this.drops.forEach((d) => d.container.destroy());
      this.drops = [];
      this.loadAndCreateEnemies().catch(() => {});

      // 移动传送门
      this.portal.setPosition(
        Phaser.Math.Between(200, GAME_CONFIG.worldWidth - 200),
        Phaser.Math.Between(200, GAME_CONFIG.worldHeight - 200)
      );
    }
  }

  private handleEnemyDeath(enemy: Enemy) {
    const state = GameState.getInstance();
    const enemyConfig = enemy.container.getData('config');
    state.recordKill(enemyConfig.id);
    const depth = state.run?.forestDepth ?? 1;

    // 原有掉落表
    const table = enemy.getDropTable();
    for (const entry of table) {
      if (Math.random() < entry.chance) {
        const itemDef = ItemDataManager.findById(entry.itemId);
        if (itemDef && 'rarity' in itemDef) {
          this.spawnDrop(enemy.container.x, enemy.container.y, itemDef);
          logItemDrop({
            itemName: itemDef.name,
            itemId: itemDef.id,
            itemRarity: itemDef.rarity,
            enemyName: enemyConfig.name,
            enemyId: enemyConfig.id,
            isBoss: enemyConfig.isBoss,
            depth,
            x: Math.round(enemy.container.x),
            y: Math.round(enemy.container.y),
            dropSource: 'dropTable',
          });
        }
      }
    }

    // 新增独立概率掉落
    if (Math.random() < 0.10) {
      this.spawnHpDrop(enemy.container.x, enemy.container.y);
    }
    if (Math.random() < 0.10) {
      this.spawnMpDrop(enemy.container.x, enemy.container.y);
    }
    if (Math.random() < 0.10) {
      const pool = ItemDataManager.getItemsByRarity('C');
      if (pool.length > 0) {
        const item = Phaser.Utils.Array.GetRandom(pool);
        this.spawnDrop(enemy.container.x, enemy.container.y, item);
        logItemDrop({
          itemName: item.name,
          itemId: item.id,
          itemRarity: item.rarity,
          enemyName: enemyConfig.name,
          enemyId: enemyConfig.id,
          isBoss: enemyConfig.isBoss,
          depth,
          x: Math.round(enemy.container.x),
          y: Math.round(enemy.container.y),
          dropSource: 'bonusC',
        });
      }
    }
    if (Math.random() < 0.05) {
      const pool = ItemDataManager.getItemsByRarity('B');
      if (pool.length > 0) {
        const item = Phaser.Utils.Array.GetRandom(pool);
        this.spawnDrop(enemy.container.x, enemy.container.y, item);
        logItemDrop({
          itemName: item.name,
          itemId: item.id,
          itemRarity: item.rarity,
          enemyName: enemyConfig.name,
          enemyId: enemyConfig.id,
          isBoss: enemyConfig.isBoss,
          depth,
          x: Math.round(enemy.container.x),
          y: Math.round(enemy.container.y),
          dropSource: 'bonusB',
        });
      }
    }

    enemy.destroy();
    this.enemies = this.enemies.filter((e) => e !== enemy);
  }

  private spawnDrop(x: number, y: number, item: Item) {
    const container = this.add.container(x, y);
    const box = this.add.rectangle(0, 0, 20, 20, 0xfbbf24);
    const label = this.add.text(0, -16, item.name.slice(0, 4), { fontSize: '10px', color: '#ffffff' }).setOrigin(0.5);
    container.add([box, label]);
    container.setDepth(y);

    this.drops.push({ container, item });

    // 拾取检测
    this.physics.world.enable(container);
  }

  private spawnHpDrop(x: number, y: number) {
    const container = this.add.container(x, y);
    const glow = this.add.ellipse(0, 0, 18, 18, 0x22c55e, 0.4);
    const core = this.add.ellipse(0, 0, 10, 10, 0x4ade80, 0.9);
    const label = this.add.text(0, -14, '生命', { fontSize: '10px', color: '#4ade80' }).setOrigin(0.5);
    container.add([glow, core, label]);
    container.setDepth(y);

    // 轻微上下浮动动画
    this.tweens.add({
      targets: container,
      y: y - 6,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.drops.push({ container, effect: 'hp' });
  }

  private spawnMpDrop(x: number, y: number) {
    const container = this.add.container(x, y);
    const glow = this.add.ellipse(0, 0, 18, 18, 0x3b82f6, 0.4);
    const core = this.add.ellipse(0, 0, 10, 10, 0x60a5fa, 0.9);
    const label = this.add.text(0, -14, '魔法', { fontSize: '10px', color: '#60a5fa' }).setOrigin(0.5);
    container.add([glow, core, label]);
    container.setDepth(y);

    this.tweens.add({
      targets: container,
      y: y - 6,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.drops.push({ container, effect: 'mp' });
  }

  private updateEnemies(delta: number) {
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      enemy.update(this.player.container.x, this.player.container.y, delta);
    }

    // 拾取掉落
    const depth = GameState.getInstance().run?.forestDepth ?? 1;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      if (!drop || !drop.container?.active) {
        this.drops.splice(i, 1);
        continue;
      }
      const dist = Phaser.Math.Distance.Between(this.player.container.x, this.player.container.y, drop.container.x, drop.container.y);
      if (dist < 30) {
        if (drop.effect === 'hp') {
          const healAmount = Math.floor(this.player.maxHp * 0.2);
          this.player.heal(healAmount);
          this.showFloatingText(drop.container.x, drop.container.y, `+${healAmount} 生命`, 0x4ade80);
          logItemPickup({
            itemName: '生命球',
            itemId: 'hp_orb',
            depth,
            x: Math.round(drop.container.x),
            y: Math.round(drop.container.y),
            slotIndex: -1,
            source: 'hp_orb',
          });
          if (drop.container.active) drop.container.destroy();
          this.drops.splice(i, 1);
        } else if (drop.effect === 'mp') {
          const restoreAmount = Math.floor(this.player.maxMp * 0.2);
          this.player.restoreMp(restoreAmount);
          this.showFloatingText(drop.container.x, drop.container.y, `+${restoreAmount} 魔法`, 0x60a5fa);
          logItemPickup({
            itemName: '魔法球',
            itemId: 'mp_orb',
            depth,
            x: Math.round(drop.container.x),
            y: Math.round(drop.container.y),
            slotIndex: -1,
            source: 'mp_orb',
          });
          if (drop.container.active) drop.container.destroy();
          this.drops.splice(i, 1);
        } else if (drop.item && this.runInventory.addItem(drop.item)) {
          GameState.getInstance().recordItemFound(drop.item.id);
          const slotIdx = this.runInventory.slots.findIndex((s) => s.item === drop.item);
          logItemPickup({
            itemName: drop.item.name,
            itemId: drop.item.id,
            itemRarity: drop.item.rarity,
            depth,
            x: Math.round(drop.container.x),
            y: Math.round(drop.container.y),
            slotIndex: slotIdx >= 0 ? slotIdx : -1,
            source: 'ground_drop',
          });
          if (drop.container.active) drop.container.destroy();
          this.drops.splice(i, 1);
        }
      }
    }
  }

  private showFloatingText(x: number, y: number, text: string, color: number) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    const label = this.add.text(x, y - 10, text, {
      fontSize: '12px',
      color: hex,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(2000);
    this.tweens.add({
      targets: label,
      y: y - 40,
      alpha: 0,
      duration: 800,
      onComplete: () => label.destroy(),
    });
  }

  private updateFog(delta: number) {
    const state = GameState.getInstance();
    if (state.run) {
      state.run.elapsedTime += delta;
      state.run.fogValue = Math.min(GAME_CONFIG.maxFog, state.run.elapsedTime * GAME_CONFIG.fogGrowthRate * 0.001);
    }
    this.fogSystem.update(this.player.container.x, this.player.container.y, this.player.getCurrentVisionRadius(GAME_CONFIG.visionRadius));
  }

  private updateHUD() {
    const p = this.player;
    const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    const mpRatio = p.maxMp > 0 ? p.mp / p.maxMp : 0;
    this.hpBar.setScale(Math.max(0, hpRatio), 1);
    this.mpBar.setScale(Math.max(0, mpRatio), 1);
    this.hpText.setText(`${Math.round(p.hp)} / ${p.maxHp}`);
    this.mpText.setText(`${Math.round(p.mp)} / ${p.maxMp}`);

    const state = GameState.getInstance();
    if (state.run) {
      this.fogText.setText(`迷雾: ${Math.floor(state.run.fogValue)}%`);
      this.depthText.setText(`层数: ${state.run.forestDepth}`);
      this.killText.setText(`击杀: ${state.run.enemiesKilled}`);

      const expRequired = getExpToNextLevel(state.save.level);
      const expRatio = state.save.exp / expRequired;
      this.expBar.setScale(Math.max(0, expRatio), 1);
      this.levelText.setText(`等级: ${state.save.level}`);

      if (state.save.level > this.lastLevel) {
        this.lastLevel = state.save.level;
        this.applyEquipmentStats().catch(() => {});
        this.showFloatingText(this.player.container.x, this.player.container.y - 30, `升级！Lv.${state.save.level}`, 0xfbbf24);
      }
    }

    // 更新技能冷却显示
    const skills = this.player.getSkills();
    for (const slot of this.skillSlots) {
      if (slot.skillIndex >= skills.length) continue;
      const skill = skills[slot.skillIndex];
      const cd = this.player.getSkillCooldown(skill.id);
      if (cd > 0) {
        slot.cooldownOverlay.setVisible(true);
        const ratio = cd / skill.cooldown;
        slot.cooldownOverlay.setScale(1, ratio);
        slot.cooldownOverlay.setY(slot.bg.y - (1 - ratio) * 44 / 2);
      } else {
        slot.cooldownOverlay.setVisible(false);
      }
    }

    // 更新消耗品快捷栏
    for (const slot of this.consumableSlots) {
      const invItem = this.runInventory.slots[slot.index]?.item;
      if (invItem && !('rarity' in invItem)) {
        slot.nameText.setText(invItem.name.slice(0, 4));
        slot.bg.setStrokeStyle(2, 0x22c55e);
      } else {
        slot.nameText.setText('');
        slot.bg.setStrokeStyle(2, 0x334155);
      }
    }
  }

  private checkDeath() {
    if (this.player.isDead()) {
      const state = GameState.getInstance();
      const run = state.run;
      logDeath({
        depth: run?.forestDepth ?? 1,
        enemiesKilled: run?.enemiesKilled ?? 0,
        elapsedTimeSec: Math.floor((run?.elapsedTime ?? 0) / 1000),
        cause: 'enemy_attack',
      });
      state.dieInRun();
      this.scene.start('GameOverScene', {
        survived: false,
        depth: run?.forestDepth ?? 1,
        kills: run?.enemiesKilled ?? 0,
        items: [],
      });
    }
  }
}
