import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/gameConfig';

export class DamageBar {
  private scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private expanded = false;
  private onToggle: (expanded: boolean) => void;

  constructor(scene: Phaser.Scene, _zoom: number, onToggle: (expanded: boolean) => void) {
    this.scene = scene;
    this.onToggle = onToggle;

    // 使用相机视口右上角坐标（scrollFactor=0 在 zoom 下坐标系仍为屏幕像素，无需除以 zoom）
    const x = GAME_CONFIG.width - 40;
    const y = 40;

    this.bg = scene.add.rectangle(0, 0, 180, 32, 0x1e293b, 0.9)
      .setOrigin(1, 0)
      .setStrokeStyle(2, 0xf59e0b)
      .setDepth(10000);

    // 火焰图标色块
    const icon = scene.add.rectangle(-166, 18, 18, 18, 0xf59e0b)
      .setDepth(10001);

    this.text = scene.add.text(-14, 18, '总伤害: 0', {
      fontSize: '14px',
      color: '#fbbf24',
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(10001);

    this.container = scene.add.container(x, y, [this.bg, icon, this.text])
      .setDepth(10000);

    // 初始脉冲动画，吸引玩家注意
    scene.tweens.add({
      targets: this.bg,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 400,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
    });

    this.bg.setInteractive({ useHandCursor: true });

    this.bg.on('pointerover', () => {
      this.bg.setFillStyle(0x334155, 0.95);
    });

    this.bg.on('pointerout', () => {
      this.bg.setFillStyle(0x1e293b, 0.9);
    });

    this.bg.on('pointerup', () => {
      this.expanded = !this.expanded;
      this.onToggle(this.expanded);
    });
  }

  update(totalDamage: number) {
    const formatted = totalDamage.toLocaleString('zh-CN');
    this.text.setText(`总伤害: ${formatted}`);
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
  }

  destroy() {
    this.container.destroy();
  }
}
