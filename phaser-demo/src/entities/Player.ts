import Phaser from 'phaser';
import type { ClassType, Skill } from '../types';
import { CLASSES } from '../data/classes';
import { GAME_CONFIG } from '../config/gameConfig';

export class Player {
  container: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  private scene: Phaser.Scene;
  private classType: ClassType;
  private weapon: Phaser.GameObjects.Rectangle;
  private isInvincible = false;
  private dodgeCooldown = 0;
  private skills: Skill[] = [];
  private skillCooldowns: Record<string, number> = {};
  private facingAngle = 0;

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;

  constructor(scene: Phaser.Scene, x: number, y: number, classType: ClassType) {
    this.scene = scene;
    this.classType = classType;

    const cls = CLASSES.find((c) => c.id === classType)!;
    this.skills = cls.skills;
    this.hp = cls.baseStats.hp;
    this.maxHp = cls.baseStats.maxHp;
    this.mp = cls.baseStats.mp;
    this.maxMp = cls.baseStats.maxMp;
    this.attack = cls.baseStats.attack;
    this.defense = cls.baseStats.defense;
    this.speed = cls.baseStats.speed;

    this.container = scene.add.container(x, y);

    const shadow = scene.add.ellipse(2, 10, 28, 12, 0x000000, 0.35);
    const bodyGfx = scene.add.ellipse(0, 0, 24, 36, this.getClassColor());
    const highlight = scene.add.ellipse(-3, -4, 10, 16, 0xffffff, 0.25);
    const head = scene.add.circle(0, -22, 10, 0xffd6a5);
    this.weapon = scene.add.rectangle(14, -5, 6, 28, 0xc0c0c0);
    this.weapon.setOrigin(0.5, 1);
    this.weapon.setRotation(0.3);

    this.container.add([shadow, bodyGfx, highlight, head, this.weapon]);
    this.container.setSize(24, 40);

    scene.physics.world.enable(this.container);
    this.body = this.container.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setBoundsRectangle(new Phaser.Geom.Rectangle(32, 32, 1856, 1216));

    this.updateDepth();
  }

  private getClassColor(): number {
    switch (this.classType) {
      case 'warrior': return 0x3a86ff;
      case 'mage': return 0xa855f7;
      case 'sage': return 0x22c55e;
      default: return 0x3a86ff;
    }
  }

  move(vx: number, vy: number): void {
    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len;
      vy /= len;
    }
    this.body.setVelocity(vx * this.speed, vy * this.speed);
  }

  /** 面向鼠标方向 */
  faceTo(worldX: number, worldY: number): void {
    this.facingAngle = Phaser.Math.Angle.Between(this.container.x, this.container.y, worldX, worldY);

    const handDistance = 12;
    this.weapon.setPosition(
      Math.cos(this.facingAngle) * handDistance,
      Math.sin(this.facingAngle) * handDistance - 4
    );
    // 矩形默认竖直向上，需要 +90° 使其尖端朝向 facingAngle
    this.weapon.setRotation(this.facingAngle + Math.PI / 2);
  }

  /** 闪避 */
  dodge(): boolean {
    if (this.dodgeCooldown > 0) return false;

    this.dodgeCooldown = GAME_CONFIG.dodgeCooldown;
    this.isInvincible = true;

    // 闪避位移
    const vx = this.body.velocity.x;
    const vy = this.body.velocity.y;
    if (vx !== 0 || vy !== 0) {
      this.body.setVelocity(vx * 2.5, vy * 2.5);
    }

    // 无敌帧
    this.scene.time.delayedCall(GAME_CONFIG.dodgeInvincibleTime, () => {
      this.isInvincible = false;
    });

    // 闪烁效果
    this.scene.tweens.add({
      targets: this.container.list,
      alpha: 0.4,
      duration: 100,
      yoyo: true,
      repeat: 2,
    });

    return true;
  }

  /** 普通攻击 */
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

    // 攻击特效（简化版，避免 tween 在边界情况下导致问题）
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

  /** 使用技能 */
  castSkill(index: number, targetWorldX: number, targetWorldY: number): { skill: Skill; targetX: number; targetY: number } | null {
    const skill = this.skills[index];
    if (!skill) return null;

    const cd = this.skillCooldowns[skill.id] ?? 0;
    if (cd > 0) return null;
    if (this.mp < skill.mpCost) return null;

    this.mp -= skill.mpCost;
    this.skillCooldowns[skill.id] = skill.cooldown;

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

    // 受击闪烁
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

  getSkills(): Skill[] {
    return this.skills;
  }

  getSkillCooldown(skillId: string): number {
    return this.skillCooldowns[skillId] ?? 0;
  }

  update(delta: number): void {
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= delta;

    for (const skill of this.skills) {
      if ((this.skillCooldowns[skill.id] ?? 0) > 0) {
        this.skillCooldowns[skill.id] -= delta;
      }
    }

    // 自动回血回蓝（基于最大值的 1% / 秒）
    const dtSec = delta / 1000;
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.01 * dtSec);
    }
    if (this.mp < this.maxMp) {
      this.mp = Math.min(this.maxMp, this.mp + this.maxMp * 0.01 * dtSec);
    }

    this.updateDepth();
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
}
