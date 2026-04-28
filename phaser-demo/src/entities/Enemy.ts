import Phaser from 'phaser';
import type { EnemyType } from '../types';

export class Enemy {
  container: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  private scene: Phaser.Scene;
  private config: EnemyType;
  private hp: number;
  private maxHp: number;
  private isAggro = false;
  private attackCooldown = 0;
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private hpBar!: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, config: EnemyType) {
    this.scene = scene;
    this.config = config;
    this.hp = config.hp;
    this.maxHp = config.hp;

    this.container = scene.add.container(x, y);

    const shadow = scene.add.ellipse(2, 10, 28, 12, 0x000000, 0.35);
    const body = scene.add.ellipse(0, 0, 26, 34, config.color);
    const eyeWhiteL = scene.add.ellipse(-5, -5, 7, 9, 0xffffff);
    const pupilL = scene.add.circle(-5, -5, 2.5, 0x000000);
    const eyeWhiteR = scene.add.ellipse(5, -5, 7, 9, 0xffffff);
    const pupilR = scene.add.circle(5, -5, 2.5, 0x000000);

    // 头顶名称
    const nameColor = config.isBoss ? '#fbbf24' : '#e2e8f0';
    const nameText = scene.add.text(0, -36, config.name, { fontSize: '10px', color: nameColor }).setOrigin(0.5);

    // 头顶血条
    this.hpBarBg = scene.add.rectangle(0, -26, 30, 4, 0x333333);
    this.hpBar = scene.add.rectangle(-15, -26, 30, 4, 0xef4444).setOrigin(0, 0.5);

    this.container.add([shadow, body, eyeWhiteL, pupilL, eyeWhiteR, pupilR, nameText, this.hpBarBg, this.hpBar]);
    this.container.setSize(26, 36);
    this.container.setData('config', config);
    this.container.setData('hp', this.hp);
    this.container.setData('enemyRef', this);

    scene.physics.world.enable(this.container);
    this.body = this.container.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setBoundsRectangle(new Phaser.Geom.Rectangle(32, 32, 1856, 1216));

    this.updateDepth();
  }

  update(playerX: number, playerY: number, delta: number): void {
    const dist = Phaser.Math.Distance.Between(this.container.x, this.container.y, playerX, playerY);

    if (!this.isAggro && dist < this.config.aggroRange) {
      this.isAggro = true;
    }

    if (this.isAggro) {
      if (dist < this.config.attackRange) {
        // 在攻击范围内，停止移动并攻击
        this.body.setVelocity(0);
      } else if (dist < this.config.aggroRange * 1.5) {
        // 追击
        const angle = Phaser.Math.Angle.Between(this.container.x, this.container.y, playerX, playerY);
        this.body.setVelocity(Math.cos(angle) * this.config.speed, Math.sin(angle) * this.config.speed);

        // 翻转朝向
        const eyeWhiteL = this.container.list[2] as Phaser.GameObjects.Ellipse;
        const pupilL = this.container.list[3] as Phaser.GameObjects.Arc;
        const eyeWhiteR = this.container.list[4] as Phaser.GameObjects.Ellipse;
        const pupilR = this.container.list[5] as Phaser.GameObjects.Arc;
        if (playerX < this.container.x) {
          eyeWhiteL.setX(-5); pupilL.setX(-5); eyeWhiteR.setX(5); pupilR.setX(5);
        } else {
          eyeWhiteL.setX(5); pupilL.setX(5); eyeWhiteR.setX(-5); pupilR.setX(-5);
        }
      } else {
        // 脱离仇恨范围
        this.isAggro = false;
        this.body.setVelocity(0);
      }
    }

    if (this.attackCooldown > 0) this.attackCooldown -= delta;
    this.updateDepth();
  }

  tryAttack(player: { getPosition: () => { x: number; y: number }; takeDamage: (amount: number) => boolean }): boolean {
    if (this.attackCooldown > 0) return false;
    const dist = Phaser.Math.Distance.Between(this.container.x, this.container.y, player.getPosition().x, player.getPosition().y);
    if (dist > this.config.attackRange) return false;

    this.attackCooldown = 1200;
    return player.takeDamage(this.config.attack);
  }

  takeDamage(amount: number): boolean {
    if (!this.container.active) return false;
    const dmg = Math.max(1, amount - this.config.defense * 0.5);
    this.hp -= dmg;
    this.container.setData('hp', this.hp);

    // 更新血条
    const ratio = this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
    this.hpBar.setScale(ratio, 1);

    // 受击闪烁（排除矩形/血条）
    for (const child of this.container.list) {
      if (!child || !child.active) continue;
      if (child instanceof Phaser.GameObjects.Rectangle) continue;
      this.scene.tweens.add({ targets: child, alpha: 0.3, duration: 50, yoyo: true });
    }

    return true;
  }

  knockBack(fromX: number, fromY: number): void {
    const angle = Phaser.Math.Angle.Between(fromX, fromY, this.container.x, this.container.y);
    this.body.setVelocity(Math.cos(angle) * 200, Math.sin(angle) * 200);
    this.scene.time.delayedCall(200, () => {
      if (this.body && this.body.gameObject?.active) {
        this.body.setVelocity(0);
      }
    });
  }

  isDead(): boolean {
    return this.hp <= 0;
  }

  getDropTable(): { itemId: string; chance: number }[] {
    return this.config.dropTable;
  }

  private _destroyed = false;

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.container.destroy();
  }

  private updateDepth(): void {
    this.container.setDepth(this.container.y);
  }
}
