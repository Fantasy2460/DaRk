import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { FogSystem } from '../systems/FogSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { EquipmentSystem } from '../systems/EquipmentSystem';
import { ENEMIES } from '../data/enemies';
import { ITEMS, CONSUMABLES } from '../data/items';
import { GAME_CONFIG, RARITY_COLORS, SLOT_NAMES } from '../config/gameConfig';
import { CLASSES } from '../data/classes';
import type { Item } from '../types';

export class ForestScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private trees: Phaser.GameObjects.Container[] = [];
  private fogSystem!: FogSystem;
  private runInventory!: InventorySystem;
  private runEquipment!: EquipmentSystem;
  private portal!: Phaser.GameObjects.Container;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

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

  // 掉落物（装备 / 即时生效药水）
  private drops: { container: Phaser.GameObjects.Container; item?: Item; effect?: 'hp' | 'mp' }[] = [];

  // 飞行投射物
  private projectiles: {
    container: Phaser.GameObjects.Container;
    vx: number;
    vy: number;
    damage: number;
    range: number;
    traveled: number;
    aoeRange: number;
  }[] = [];

  // 技能 HUD
  private skillSlots: {
    bg: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Container;
    keyText: Phaser.GameObjects.Text;
    cooldownOverlay: Phaser.GameObjects.Rectangle;
    skillIndex: number;
  }[] = [];

  // 背包 UI
  private bagOpen = false;
  private bagUI: Phaser.GameObjects.GameObject[] = [];
  private bagInfoText!: Phaser.GameObjects.Text;

  // 传送门菜单 UI
  private portalMenuUI: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'ForestScene' });
  }

  create() {
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
    this.createEnemies();
    this.createPortal();
    this.createHUD();
    this.setupInput();

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
    this.player = new Player(this, startX, startY, state.save.selectedClass!);
  }

  private createEnemies() {
    const count = Phaser.Math.Between(GAME_CONFIG.enemySpawnCount.min, GAME_CONFIG.enemySpawnCount.max);
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(100, GAME_CONFIG.worldWidth - 100);
      const y = Phaser.Math.Between(100, GAME_CONFIG.worldHeight - 100);
      const isBoss = Math.random() < GAME_CONFIG.bossSpawnChance;
      const pool = isBoss ? ENEMIES.filter((e) => e.isBoss) : ENEMIES.filter((e) => !e.isBoss);
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

    // 技能栏上方的生命条与法力条（带具体数值）
    const barY = cam.height - 125;
    this.hpBg = this.add.rectangle(cam.width / 2, barY, 200, 14, 0x000000).setScrollFactor(0).setDepth(2000);
    this.hpBar = this.add.rectangle(cam.width / 2 - 100, barY, 200, 14, 0xef4444).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2000);
    this.hpText = this.add.text(cam.width / 2, barY, '', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const mpY = barY + 20;
    this.mpBg = this.add.rectangle(cam.width / 2, mpY, 200, 10, 0x000000).setScrollFactor(0).setDepth(2000);
    this.mpBar = this.add.rectangle(cam.width / 2 - 100, mpY, 200, 10, 0x3b82f6).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2000);
    this.mpText = this.add.text(cam.width / 2, mpY, '', { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    this.createSkillHUD();

    // 操作提示
    this.add.text(cam.width - 20, cam.height - 20, 'WASD移动 | 鼠标指向朝向 | 空格攻击 | Q闪避 | B背包 | T/Y/U/I/O技能 | 靠近传送门按E撤离/深入', {
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
      case 'frostNova': {
        // 霜冻新星：蓝色六角雪花
        g.lineStyle(2, 0x60a5fa, 1);
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          g.lineBetween(Math.cos(angle) * 3, Math.sin(angle) * 3, Math.cos(angle) * 14, Math.sin(angle) * 14);
          g.lineBetween(Math.cos(angle) * 14, Math.sin(angle) * 14, Math.cos(angle - 0.5) * 9, Math.sin(angle - 0.5) * 9);
          g.lineBetween(Math.cos(angle) * 14, Math.sin(angle) * 14, Math.cos(angle + 0.5) * 9, Math.sin(angle + 0.5) * 9);
        }
        g.fillStyle(0x93c5fd, 0.35);
        g.fillCircle(0, 0, 5);
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
    }) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private errorText?: Phaser.GameObjects.Text;

  update(_time: number, delta: number) {
    try {
      if (!this.player) return;

      const state = GameState.getInstance();
      if (!state.run) return;

      // 清理已销毁的敌人引用，防止数组污染导致异常
      this.enemies = this.enemies.filter((e) => e && e.container?.active);

      this.handleMovement();
      this.handleCombat(delta);
      this.handleDodge(delta);
      this.handleSkills();
      this.handleBagInput();
      this.handlePortal();
      this.updateProjectiles(delta);
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

    // 武器始终朝向鼠标位置
    const pointer = this.input.activePointer;
    this.player.faceTo(pointer.worldX, pointer.worldY);
  }

  private handleCombat(_delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      // 只传入还活着且 container 有效的敌人
      const validEnemies = this.enemies
        .filter((e) => e && e.container?.active && !e.isDead())
        .map((e) => e.container);
      const target = this.player.attackNearest(validEnemies);
      if (target && target.active) {
        const enemy = this.enemies.find((e) => e.container === target);
        if (enemy && !enemy.isDead()) {
          enemy.takeDamage(this.player.attack);
          if (!enemy.isDead()) {
            enemy.knockBack(this.player.container.x, this.player.container.y);
          } else {
            this.handleEnemyDeath(enemy);
          }
        }
      }
    }

    // 敌人攻击玩家
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      enemy.tryAttack(this.player);
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
    for (let i = 0; i < skillKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.keys[skillKeys[i]])) {
        const result = this.player.castSkill(i, pointer.worldX, pointer.worldY);
        if (result) {
          this.castSkillEffect(result.skill, result.targetX, result.targetY);
        }
      }
    }
  }

  private castSkillEffect(skill: import('../types').Skill, targetX: number, targetY: number) {
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

    if (skill.id === 'fireball') {
      // 火球术：发射飞行投射物
      const angle = Phaser.Math.Angle.Between(px, py, targetX, targetY);
      const speed = 420;
      const container = this.add.container(px, py);
      const glow = this.add.ellipse(0, 0, 28, 28, 0xf97316, 0.35);
      const core = this.add.ellipse(0, 0, 14, 14, 0xff4500, 0.9);
      const trail = this.add.ellipse(-6, 0, 10, 6, 0xffa500, 0.4);
      container.add([glow, trail, core]);
      container.setDepth(998);

      // 旋转火球使其朝向飞行方向
      container.setRotation(angle);

      this.projectiles.push({
        container,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        damage: skill.damage ?? this.player.attack,
        range: skill.range ?? 200,
        traveled: 0,
        aoeRange: 60,
      });
      return;
    }

    if (skill.aoe) {
      // AOE 技能：以目标点为中心的范围伤害
      const range = skill.range ?? 80;
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(targetX, targetY, enemy.container.x, enemy.container.y);
        if (dist <= range) {
          enemy.takeDamage(skill.damage ?? this.player.attack);
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
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(targetX, targetY, enemy.container.x, enemy.container.y);
        if (dist < 60 && dist < nearestDist) {
          nearest = enemy;
          nearestDist = dist;
        }
      }
      if (nearest) {
        nearest.takeDamage(skill.damage ?? this.player.attack);
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
      let hit = false;
      for (const enemy of this.enemies) {
        if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
        const dist = Phaser.Math.Distance.Between(proj.container.x, proj.container.y, enemy.container.x, enemy.container.y);
        if (dist < 20) {
          hit = true;
          break;
        }
      }

      // 命中或超出最大距离则爆炸
      if (hit || proj.traveled >= proj.range) {
        this.explodeProjectile(proj);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private explodeProjectile(proj: typeof this.projectiles[0]) {
    const ex = proj.container.x;
    const ey = proj.container.y;

    // AOE 伤害
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead() || !enemy.container?.active) continue;
      const dist = Phaser.Math.Distance.Between(ex, ey, enemy.container.x, enemy.container.y);
      if (dist <= proj.aoeRange) {
        enemy.takeDamage(proj.damage);
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

  private handleBagInput() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      this.toggleBag();
    }
  }

  private toggleBag() {
    if (this.bagOpen) {
      this.closeBag();
    } else {
      this.openBag();
    }
  }

  private closeBag() {
    this.bagOpen = false;
    for (const obj of this.bagUI) {
      if (obj.active) obj.destroy();
    }
    this.bagUI = [];
  }

  private openBag() {
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

    // 点击遮罩关闭
    overlay.on('pointerdown', () => this.closeBag());

    // 信息提示区
    this.bagInfoText = this.add.text(cx, cy + 140, '', {
      fontSize: '13px',
      color: '#e2e8f0',
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(this.bagInfoText);

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

    const invTitle = this.add.text(invStartX + cellW * 3 - 20, invStartY - 25, '物品', {
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

  private equipFromInventory(index: number) {
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

    this.applyEquipmentStats();
    this.refreshBag();
  }

  private unequipItem(slot: string) {
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

    this.applyEquipmentStats();
    this.refreshBag();
  }

  private applyEquipmentStats() {
    const bonus = this.runEquipment.getTotalStats();
    const state = GameState.getInstance();
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass);
    if (!cls) return;

    this.player.maxHp = cls.baseStats.maxHp + (bonus.maxHp ?? 0);
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.player.maxMp = cls.baseStats.maxMp + (bonus.mp ?? 0);
    this.player.mp = Math.min(this.player.mp, this.player.maxMp);
    this.player.attack = cls.baseStats.attack + (bonus.attack ?? 0);
    this.player.defense = cls.baseStats.defense + (bonus.defense ?? 0);
    this.player.speed = cls.baseStats.speed + (bonus.speed ?? 0);
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
      state.run.forestDepth++;
      // 重新生成敌人，保留当前状态
      this.enemies.forEach((e) => e.destroy());
      this.enemies = [];
      this.drops.forEach((d) => d.container.destroy());
      this.drops = [];
      this.createEnemies();

      // 移动传送门
      this.portal.setPosition(
        Phaser.Math.Between(200, GAME_CONFIG.worldWidth - 200),
        Phaser.Math.Between(200, GAME_CONFIG.worldHeight - 200)
      );
    }
  }

  private handleEnemyDeath(enemy: Enemy) {
    const state = GameState.getInstance();
    state.recordKill(enemy.container.getData('config').id);

    // 原有掉落表
    const table = enemy.getDropTable();
    for (const entry of table) {
      if (Math.random() < entry.chance) {
        const itemDef = ITEMS.find((i) => i.id === entry.itemId) ?? CONSUMABLES.find((c) => c.id === entry.itemId);
        if (itemDef && 'rarity' in itemDef) {
          this.spawnDrop(enemy.container.x, enemy.container.y, itemDef);
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
      const pool = ITEMS.filter((i) => i.rarity === 'C');
      if (pool.length > 0) {
        const item = Phaser.Utils.Array.GetRandom(pool);
        this.spawnDrop(enemy.container.x, enemy.container.y, item);
      }
    }
    if (Math.random() < 0.05) {
      const pool = ITEMS.filter((i) => i.rarity === 'B');
      if (pool.length > 0) {
        const item = Phaser.Utils.Array.GetRandom(pool);
        this.spawnDrop(enemy.container.x, enemy.container.y, item);
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
          if (drop.container.active) drop.container.destroy();
          this.drops.splice(i, 1);
        } else if (drop.effect === 'mp') {
          const restoreAmount = Math.floor(this.player.maxMp * 0.2);
          this.player.restoreMp(restoreAmount);
          this.showFloatingText(drop.container.x, drop.container.y, `+${restoreAmount} 魔法`, 0x60a5fa);
          if (drop.container.active) drop.container.destroy();
          this.drops.splice(i, 1);
        } else if (drop.item && this.runInventory.addItem(drop.item)) {
          GameState.getInstance().recordItemFound(drop.item.id);
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
    this.fogSystem.update(this.player.container.x, this.player.container.y);
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
  }

  private checkDeath() {
    if (this.player.isDead()) {
      const state = GameState.getInstance();
      const run = state.run;
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
