import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/gameConfig';
import type { RunDamageStats, DamageSourceStat } from '../types';
import { getSortedSources, getDamagePercent } from '../utils/DamageTracker';

export class DamageDetailPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private visible = false;
  private rowObjects: Phaser.GameObjects.GameObject[] = [];

  private panelX: number;
  private panelY: number;
  private panelW = 200;
  private panelH = 320;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.panelX = (GAME_CONFIG.width - this.panelW) / 2;
    this.panelY = (GAME_CONFIG.height - this.panelH) / 2;
    // 限制在可视区域内，避免相机缩放导致超出画布
    this.panelX = Math.max(40, Math.min(this.panelX, GAME_CONFIG.width - this.panelW - 40));
    this.panelY = Math.max(40, Math.min(this.panelY, GAME_CONFIG.height - this.panelH - 40));

    this.bg = scene.add.rectangle(0, 0, this.panelW, this.panelH, 0x0f172a, 0.95)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x475569)
      .setDepth(10000);

    this.container = scene.add.container(this.panelX, this.panelY, [this.bg])
      .setDepth(10000)
      .setVisible(false);
  }

  setPosition(x: number, y: number) {
    this.panelX = x;
    this.panelY = y;
    this.container.setPosition(x, y);
  }

  getBounds() {
    return {
      x: this.panelX,
      y: this.panelY,
      width: this.panelW,
      height: this.bg.height,
    };
  }

  show(stats: RunDamageStats) {
    this.clearRows();
    const sources = getSortedSources(stats).slice(0, 8);
    const total = stats.totalDamage;
    const rowHeight = 38;
    const barMaxWidth = 180;

    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const y = 8 + i * rowHeight;
      const percent = getDamagePercent(s, total);

      // 图标色块
      const icon = this.scene.add.rectangle(10, y + 6, 20, 20, s.color)
        .setOrigin(0, 0)
        .setDepth(10001);

      // 技能名
      const nameText = this.scene.add.text(36, y + 2, s.name, {
        fontSize: '12px',
        color: '#ffffff',
      }).setOrigin(0, 0).setDepth(10001);
      if (nameText.width > 80) {
        nameText.setScale(80 / nameText.width);
      }

      // 伤害量
      const dmgText = this.scene.add.text(190, y + 2, s.totalDamage.toLocaleString('zh-CN'), {
        fontSize: '12px',
        color: '#fbbf24',
      }).setOrigin(1, 0).setDepth(10001);

      // 占比
      const pctText = this.scene.add.text(190, y + 18, `${percent}%`, {
        fontSize: '11px',
        color: '#9ca3af',
      }).setOrigin(1, 0).setDepth(10001);

      // 进度条
      const barWidth = Math.max(0, (percent / 100) * barMaxWidth);
      const bar = this.scene.add.rectangle(10, y + 32, barWidth, 4, s.color)
        .setOrigin(0, 0)
        .setDepth(10001);

      this.rowObjects.push(icon, nameText, dmgText, pctText, bar);
      this.container.add([icon, nameText, dmgText, pctText, bar]);
    }

    // 动态调整背景高度
    const contentHeight = Math.max(40, sources.length * rowHeight + 16);
    this.panelH = Math.min(320, contentHeight);
    this.bg.setSize(this.panelW, this.panelH);

    this.container.setVisible(true);
    this.visible = true;
  }

  hide() {
    this.container.setVisible(false);
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy() {
    this.container.destroy();
  }

  private clearRows() {
    for (const obj of this.rowObjects) {
      if (obj.active) obj.destroy();
    }
    this.rowObjects = [];
  }
}
