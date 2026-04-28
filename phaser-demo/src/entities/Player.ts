import Phaser from 'phaser';
import type { ClassType, Skill, Consumable, ActiveConsumableEffect } from '../types';
import { CLASSES } from '../data/classes';
import { GAME_CONFIG } from '../config/gameConfig';

export class Player {
  container: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  private scene: Phaser.Scene;
  private classType: ClassType;
  private isInvincible = false;
  private dodgeCooldown = 0;
  private skills: Skill[] = [];
  private skillCooldowns: Record<string, number> = {};
  private facingAngle = 0;
  private animTime = 0;
  private isMoving = false;
  private activeEffects: Map<string, ActiveConsumableEffect> = new Map();

  // 技能蓄力（火球术 / 星落等）
  private isCharging = false;
  private chargeSkillId: string | null = null;
  private chargeTime = 0;
  private chargeMaxTime = 3000;
  private chargeBarBg?: Phaser.GameObjects.Rectangle;
  private chargeBar?: Phaser.GameObjects.Rectangle;

  // 法力流溢
  private manaOverflowActive = false;
  private manaOverflowTime = 0;
  private manaOverflowAura?: Phaser.GameObjects.Ellipse;

  // 职业装扮装饰
  private decoHelmet?: Phaser.GameObjects.Ellipse;
  private decoHelmetFront?: Phaser.GameObjects.Rectangle;
  private decoShoulderL?: Phaser.GameObjects.Rectangle;
  private decoShoulderR?: Phaser.GameObjects.Rectangle;
  private decoHood?: Phaser.GameObjects.Ellipse;
  private decoTrim?: Phaser.GameObjects.Rectangle;
  private decoBeard?: Phaser.GameObjects.Ellipse;
  private decoOrb?: Phaser.GameObjects.Ellipse;
  private decoGem?: Phaser.GameObjects.Ellipse;
  private decoHairL?: Phaser.GameObjects.Ellipse;
  private decoHairR?: Phaser.GameObjects.Ellipse;
  private decoStaffGem?: Phaser.GameObjects.Ellipse;

  // 像素身体部位（元气骑士风格俯视角）
  private head!: Phaser.GameObjects.Ellipse;
  private bodyGfx!: Phaser.GameObjects.Rectangle;
  private leftArm!: Phaser.GameObjects.Rectangle;
  private rightArm!: Phaser.GameObjects.Rectangle;
  private leftLeg!: Phaser.GameObjects.Rectangle;
  private rightLeg!: Phaser.GameObjects.Rectangle;
  private weaponGfx!: Phaser.GameObjects.Rectangle;

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  attackCooldown = 0;
  attackSpeed = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, classType: ClassType, level: number = 1) {
    this.scene = scene;
    this.classType = classType;

    const cls = CLASSES.find((c) => c.id === classType)!;
    this.skills = cls.skills;
    this.level = level;
    const multiplier = 1 + (level - 1) * 0.05;
    this.hp = Math.floor(cls.baseStats.hp * multiplier);
    this.maxHp = Math.floor(cls.baseStats.maxHp * multiplier);
    this.mp = Math.floor(cls.baseStats.mp * multiplier);
    this.maxMp = Math.floor(cls.baseStats.maxMp * multiplier);
    this.attack = Math.floor(cls.baseStats.attack * multiplier);
    this.defense = Math.floor(cls.baseStats.defense * multiplier);
    this.speed = Math.floor(cls.baseStats.speed * multiplier);

    this.container = scene.add.container(x, y);

    const c = this.getClassColors();

    // 绘制顺序：腿 → [法师斗篷] → 身体 → [战士肩甲/法师纹饰] → 手臂 → [贤者胡子] → 头 → 眼睛 → [战士头盔] → 武器 → [贤者宝珠]
    this.leftLeg = scene.add.rectangle(-4, 8, 5, 10, c.limb).setOrigin(0.5, 0);
    this.rightLeg = scene.add.rectangle(4, 8, 5, 10, c.limb).setOrigin(0.5, 0);

    this.bodyGfx = scene.add.rectangle(0, 2, 14, 12, c.body);

    this.leftArm = scene.add.rectangle(-9, 2, 4, 10, c.limb).setOrigin(0.5, 0);
    this.rightArm = scene.add.rectangle(9, 2, 4, 10, c.limb).setOrigin(0.5, 0);

    this.head = scene.add.ellipse(0, -10, 18, 16, c.head);

    // 眼睛：法师为青色发光，其他为黑色
    const eyeColor = this.classType === 'mage' ? 0x22d3ee : 0x000000;
    const eyeL = scene.add.ellipse(-3, -10, 2, 3, eyeColor);
    const eyeR = scene.add.ellipse(3, -10, 2, 3, eyeColor);

    // 武器：竖直矩形，origin 在底部中心，向上延伸
    this.weaponGfx = scene.add.rectangle(0, 0, 4, 16, c.weapon).setOrigin(0.5, 1);

    const children: Phaser.GameObjects.GameObject[] = [
      this.leftLeg, this.rightLeg,
    ];

    if (this.classType === 'mage') {
      // 法师：深色连帽斗篷底层 + 边缘高光层
      this.decoHood = scene.add.ellipse(0, -10, 28, 24, 0x2e1065);
      const hoodEdge = scene.add.ellipse(0, -10, 26, 22, 0x4c1d95);
      children.push(this.decoHood, hoodEdge);
    }

    children.push(this.bodyGfx);

    if (this.classType === 'warrior') {
      this.decoShoulderL = scene.add.rectangle(-10, 0, 8, 8, 0x8899a6);
      this.decoShoulderR = scene.add.rectangle(10, 0, 8, 8, 0x8899a6);
      children.push(this.decoShoulderL, this.decoShoulderR);
    }

    if (this.classType === 'mage') {
      // 法师：亮粉色法袍纹饰 + 胸前青色宝石
      this.decoTrim = scene.add.rectangle(0, 2, 14, 3, 0xd946ef);
      this.decoGem = scene.add.ellipse(0, -2, 6, 6, 0x22d3ee);
      children.push(this.decoTrim, this.decoGem);
    }

    children.push(this.leftArm, this.rightArm);

    if (this.classType === 'sage') {
      this.decoBeard = scene.add.ellipse(0, -4, 10, 8, 0xffffff);
      children.push(this.decoBeard);
    }

    if (this.classType === 'mage') {
      // 法师：深色长发在头部两侧
      this.decoHairL = scene.add.ellipse(-10, -10, 6, 12, 0x1e1b4b);
      this.decoHairR = scene.add.ellipse(10, -10, 6, 12, 0x1e1b4b);
      children.push(this.decoHairL, this.decoHairR);
    }

    children.push(this.head, eyeL, eyeR);

    if (this.classType === 'warrior') {
      this.decoHelmet = scene.add.ellipse(0, -15, 20, 10, 0x8899a6);
      this.decoHelmetFront = scene.add.rectangle(0, -11, 22, 4, 0x8899a6);
      children.push(this.decoHelmet, this.decoHelmetFront);
    }

    children.push(this.weaponGfx);

    if (this.classType === 'mage') {
      // 法师：法杖顶端青色发光宝石
      this.decoStaffGem = scene.add.ellipse(0, -16, 8, 8, 0x22d3ee);
      children.push(this.decoStaffGem);
    }

    if (this.classType === 'sage') {
      this.decoOrb = scene.add.ellipse(0, 0, 8, 8, 0xfef08a);
      children.push(this.decoOrb);
    }

    this.container.add(children);
    this.container.setSize(20, 32);

    // 火球术蓄力进度条（头部上方，初始隐藏）
    this.chargeBarBg = scene.add.rectangle(-15, -32, 30, 4, 0x000000).setOrigin(0, 0.5).setVisible(false);
    this.chargeBar = scene.add.rectangle(-15, -32, 30, 4, 0xff4500).setOrigin(0, 0.5).setVisible(false);
    this.container.add([this.chargeBarBg, this.chargeBar]);

    // 法力流溢光环（初始隐藏）
    this.manaOverflowAura = scene.add.ellipse(0, 0, 50, 50, 0x22d3ee, 0.25).setVisible(false);
    this.container.add(this.manaOverflowAura);

    scene.physics.world.enable(this.container);
    this.body = this.container.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setBoundsRectangle(new Phaser.Geom.Rectangle(32, 32, 1856, 1216));

    this.updateDepth();
  }

  private getClassColors() {
    switch (this.classType) {
      case 'warrior':
        return { head: 0xffd6a5, body: 0x3a86ff, limb: 0x1e3a5f, weapon: 0xc0c0c0 };
      case 'mage':
        return { head: 0xffd6a5, body: 0x6b21a8, limb: 0x3b0764, weapon: 0x8b5a2b };
      case 'sage':
        return { head: 0xffd6a5, body: 0x22c55e, limb: 0x14532d, weapon: 0xfbbf24 };
      default:
        return { head: 0xffd6a5, body: 0x3a86ff, limb: 0x1e3a5f, weapon: 0xc0c0c0 };
    }
  }

  move(vx: number, vy: number): void {
    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len;
      vy /= len;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
    this.body.setVelocity(vx * this.speed, vy * this.speed);
  }

  faceTo(worldX: number, worldY: number): void {
    const cx = this.body?.center?.x ?? this.container.x;
    const cy = this.body?.center?.y ?? this.container.y;
    this.facingAngle = Phaser.Math.Angle.Between(cx, cy, worldX, worldY);
  }

  dodge(): boolean {
    if (this.dodgeCooldown > 0) return false;

    this.dodgeCooldown = GAME_CONFIG.dodgeCooldown;
    this.isInvincible = true;

    const vx = this.body.velocity.x;
    const vy = this.body.velocity.y;
    if (vx !== 0 || vy !== 0) {
      this.body.setVelocity(vx * 2.5, vy * 2.5);
    }

    this.scene.time.delayedCall(GAME_CONFIG.dodgeInvincibleTime, () => {
      this.isInvincible = false;
    });

    this.scene.tweens.add({
      targets: this.container.list,
      alpha: 0.4,
      duration: 100,
      yoyo: true,
      repeat: 2,
    });

    return true;
  }

  attackNearest(enemies: Phaser.GameObjects.Container[]): Phaser.GameObjects.Container | null {
    const hitX = this.container.x + Math.cos(this.facingAngle) * 35;
    const hitY = this.container.y + Math.sin(this.facingAngle) * 35;

    let nearest: Phaser.GameObjects.Container | null = null;
    let nearestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy || !enemy.active) continue;
      const dist = Phaser.Math.Distance.Between(hitX, hitY, enemy.x, enemy.y);
      if (dist < 55 && dist < nearestDist) {
        nearest = enemy;
        nearestDist = dist;
      }
    }

    try {
      const slash = this.scene.add.ellipse(hitX, hitY, 80, 80, 0xffffaa, 0.4);
      slash.setDepth(999);
      this.scene.tweens.add({
        targets: slash,
        alpha: 0,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 200,
        onComplete: () => {
          if (slash.active) slash.destroy();
        },
      });
    } catch (e) {
      // 特效失败不影响攻击判定
    }

    return nearest;
  }

  castSkill(index: number, targetWorldX: number, targetWorldY: number): { skill: Skill; targetX: number; targetY: number } | null {
    const skill = this.skills[index];
    if (!skill) return null;

    const cd = this.skillCooldowns[skill.id] ?? 0;
    if (cd > 0) return null;
    if (this.mp < skill.mpCost) return null;

    this.mp -= skill.mpCost;
    // 法力流溢减CD（自身不受影响）
    const actualCd = (this.manaOverflowActive && skill.id !== 'manaOverflow')
      ? Math.floor(skill.cooldown * 0.5)
      : skill.cooldown;
    this.skillCooldowns[skill.id] = actualCd;

    return {
      skill,
      targetX: targetWorldX,
      targetY: targetWorldY,
    };
  }

  takeDamage(amount: number): boolean {
    if (this.isInvincible) return false;
    const dmg = Math.max(1, amount - this.defense * 0.5);
    this.hp = Math.max(0, this.hp - dmg);

    this.scene.tweens.add({
      targets: this.container.list,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
    });

    return true;
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  restoreMp(amount: number): void {
    this.mp = Math.min(this.maxMp, this.mp + amount);
  }

  applyConsumableEffect(consumable: Consumable): boolean {
    switch (consumable.type) {
      case 'instantHp': {
        if (this.hp >= this.maxHp) return false;
        this.heal(consumable.value);
        return true;
      }
      case 'instantMp': {
        if (this.mp >= this.maxMp) return false;
        this.restoreMp(consumable.value);
        return true;
      }
      case 'slowHp': {
        if (this.hp >= this.maxHp) return false;
        this.activeEffects.set('slowHp', {
          type: 'slowHp',
          value: consumable.value,
          remainingMs: consumable.duration ?? 10000,
          tickIntervalMs: 2000,
          lastTickMs: 0,
        });
        return true;
      }
      case 'slowMp': {
        if (this.mp >= this.maxMp) return false;
        this.activeEffects.set('slowMp', {
          type: 'slowMp',
          value: consumable.value,
          remainingMs: consumable.duration ?? 10000,
          tickIntervalMs: 2000,
          lastTickMs: 0,
        });
        return true;
      }
      case 'vision': {
        this.activeEffects.set('vision', {
          type: 'vision',
          value: consumable.value,
          remainingMs: consumable.duration ?? 15000,
          tickIntervalMs: 0,
          lastTickMs: 0,
        });
        return true;
      }
      default:
        return false;
    }
  }

  getCurrentVisionRadius(baseRadius: number): number {
    const vision = this.activeEffects.get('vision');
    return vision ? baseRadius + vision.value : baseRadius;
  }

  getAttackInterval(): number {
    return GAME_CONFIG.attackCooldown / Math.max(0.1, this.attackSpeed);
  }

  getClassType(): ClassType {
    return this.classType;
  }

  getFacingAngle(): number {
    return this.facingAngle;
  }

  getSkills(): Skill[] {
    return this.skills;
  }

  getSkillCooldown(skillId: string): number {
    return this.skillCooldowns[skillId] ?? 0;
  }

  update(delta: number): void {
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= delta;
    if (this.attackCooldown > 0) this.attackCooldown -= delta;

    for (const skill of this.skills) {
      if ((this.skillCooldowns[skill.id] ?? 0) > 0) {
        this.skillCooldowns[skill.id] -= delta;
      }
    }

    // 处理持续类消耗品效果
    for (const [key, effect] of this.activeEffects) {
      effect.remainingMs -= delta;
      if (effect.remainingMs <= 0) {
        this.activeEffects.delete(key);
        continue;
      }
      if (effect.tickIntervalMs > 0) {
        effect.lastTickMs += delta;
        if (effect.lastTickMs >= effect.tickIntervalMs) {
          effect.lastTickMs -= effect.tickIntervalMs;
          if (effect.type === 'slowHp') this.heal(effect.value);
          if (effect.type === 'slowMp') this.restoreMp(effect.value);
        }
      }
    }

    // 法力流溢计时
    if (this.manaOverflowActive) {
      this.manaOverflowTime -= delta;
      if (this.manaOverflowTime <= 0) {
        this.deactivateManaOverflow();
      }
    }

    const dtSec = delta / 1000;
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.01 * dtSec);
    }
    if (this.mp < this.maxMp) {
      this.mp = Math.min(this.maxMp, this.mp + this.maxMp * 0.01 * dtSec);
    }

    // 技能蓄力进度
    if (this.isCharging) {
      this.chargeTime += delta;
      const ratio = Math.min(1, this.chargeTime / this.chargeMaxTime);
      if (this.chargeBar) this.chargeBar.setScale(ratio, 1);
    }

    this.animTime += delta;
    this.updateAnimation();

    this.updateDepth();
  }

  private updateAnimation() {
    const t = this.animTime * 0.012;

    // 武器从角色中心出发，始终指向鼠标方向（两点连成一条直线）
    // weaponGfx origin(0.5,1) 默认向上，+ PI/2 后尖端指向 facingAngle
    this.weaponGfx.setPosition(0, 2);
    this.weaponGfx.setRotation(this.facingAngle + Math.PI / 2);

    // rightArm 根据武器方向切换左右，保持自然下垂
    const isRight = Math.cos(this.facingAngle) >= 0;
    this.rightArm.setPosition(isRight ? 9 : -9, 2);

    if (this.isMoving) {
      // 走路：腿部交替摆动
      const legSwing = Math.sin(t) * 25;
      this.leftLeg.setRotation(Phaser.Math.DegToRad(legSwing));
      this.rightLeg.setRotation(Phaser.Math.DegToRad(-legSwing));

      // 头部和身体轻微上下弹跳
      const bounce = Math.abs(Math.sin(t)) * 1.5;
      this.head.setY(-10 - bounce);
      this.bodyGfx.setY(2 - bounce * 0.5);

      // 手臂轻微摆动
      const armSwing = Math.sin(t) * 15;
      this.leftArm.setRotation(Phaser.Math.DegToRad(armSwing));
      this.rightArm.setRotation(Phaser.Math.DegToRad(isRight ? -armSwing : armSwing));
    } else {
      // 待机：呼吸
      const breath = Math.sin(this.animTime * 0.004) * 1.5;
      this.head.setY(-10 + breath);
      this.bodyGfx.setScale(1, 1 + breath * 0.02);
      this.bodyGfx.setY(2);

      // 复位腿部和手臂
      this.leftLeg.setRotation(0);
      this.rightLeg.setRotation(0);
      this.leftArm.setRotation(0);
      this.rightArm.setRotation(0);
    }

    // 同步装饰部件位置
    const headY = this.head.y;
    const bodyY = this.bodyGfx.y;

    if (this.decoHood) this.decoHood.setPosition(0, headY);
    if (this.decoShoulderL) {
      this.decoShoulderL.setPosition(-10, bodyY - 2);
      this.decoShoulderR!.setPosition(10, bodyY - 2);
    }
    if (this.decoTrim) this.decoTrim.setPosition(0, bodyY);
    if (this.decoGem) this.decoGem.setPosition(0, bodyY - 4);
    if (this.decoBeard) this.decoBeard.setPosition(0, headY + 6);
    if (this.decoHairL) {
      this.decoHairL.setPosition(-10, headY);
      this.decoHairR!.setPosition(10, headY);
    }
    if (this.decoHelmet) {
      this.decoHelmet.setPosition(0, headY - 5);
      this.decoHelmetFront!.setPosition(0, headY - 1);
    }
    if (this.decoOrb) {
      const hx = this.weaponGfx.x;
      const hy = this.weaponGfx.y;
      this.decoOrb.setPosition(
        hx + 16 * Math.cos(this.facingAngle),
        hy + 16 * Math.sin(this.facingAngle)
      );
    }
    if (this.decoStaffGem) {
      const hx = this.weaponGfx.x;
      const hy = this.weaponGfx.y;
      this.decoStaffGem.setPosition(
        hx + 16 * Math.cos(this.facingAngle),
        hy + 16 * Math.sin(this.facingAngle)
      );
    }

    // 同步蓄力条到头部位置
    if (this.chargeBarBg) this.chargeBarBg.setPosition(-15, headY - 22);
    if (this.chargeBar) this.chargeBar.setPosition(-15, headY - 22);
  }

  updateDepth(): void {
    this.container.setDepth(this.container.y);
  }

  isDead(): boolean {
    return this.hp <= 0;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  // ========== 技能蓄力 ==========

  startCharge(skillId: string, maxTime: number): void {
    if (this.isCharging) return;
    this.isCharging = true;
    this.chargeSkillId = skillId;
    this.chargeTime = 0;
    // 法力流溢：蓄力速度翻倍（时间减半）
    this.chargeMaxTime = this.manaOverflowActive ? maxTime / 2 : maxTime;
    if (this.chargeBarBg) this.chargeBarBg.setVisible(true);
    if (this.chargeBar) this.chargeBar.setVisible(true);
  }

  getChargeRatio(): number {
    if (!this.isCharging) return 0;
    return Math.min(1, this.chargeTime / this.chargeMaxTime);
  }

  getChargeSkillId(): string | null {
    return this.chargeSkillId;
  }

  releaseCharge(): number {
    const ratio = this.getChargeRatio();
    this.isCharging = false;
    this.chargeSkillId = null;
    this.chargeTime = 0;
    if (this.chargeBarBg) this.chargeBarBg.setVisible(false);
    if (this.chargeBar) this.chargeBar.setVisible(false);
    if (this.chargeBar) this.chargeBar.setScale(0, 1);
    return ratio;
  }

  cancelCharge(): void {
    this.isCharging = false;
    this.chargeSkillId = null;
    this.chargeTime = 0;
    if (this.chargeBarBg) this.chargeBarBg.setVisible(false);
    if (this.chargeBar) this.chargeBar.setVisible(false);
    if (this.chargeBar) this.chargeBar.setScale(0, 1);
  }

  getIsCharging(): boolean {
    return this.isCharging;
  }

  // ========== 法力流溢 ==========

  activateManaOverflow(): void {
    this.manaOverflowActive = true;
    this.manaOverflowTime = 10000;
    if (this.manaOverflowAura) {
      this.manaOverflowAura.setVisible(true);
      this.scene.tweens.add({
        targets: this.manaOverflowAura,
        scaleX: 1.3,
        scaleY: 1.3,
        alpha: 0.15,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  deactivateManaOverflow(): void {
    this.manaOverflowActive = false;
    this.manaOverflowTime = 0;
    if (this.manaOverflowAura) {
      this.manaOverflowAura.setVisible(false);
      this.scene.tweens.killTweensOf(this.manaOverflowAura);
      this.manaOverflowAura.setScale(1, 1);
      this.manaOverflowAura.setAlpha(0.25);
    }
  }

  isManaOverflowActive(): boolean {
    return this.manaOverflowActive;
  }
}
