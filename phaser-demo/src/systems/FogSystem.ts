import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/gameConfig';

export class FogSystem {
  private scene: Phaser.Scene;
  private fogImage: Phaser.GameObjects.Image | null = null;
  private visionRadius: number;

  constructor(scene: Phaser.Scene, visionRadius = GAME_CONFIG.visionRadius) {
    this.scene = scene;
    this.visionRadius = visionRadius;
  }

  create(): void {
    const size = 4000;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // 边缘迷雾
    ctx.fillStyle = 'rgba(5, 5, 16, 0.72)';
    ctx.fillRect(0, 0, size, size);

    // 中心视野挖孔
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(
      size / 2, size / 2, this.visionRadius * 0.3,
      size / 2, size / 2, this.visionRadius
    );
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, this.visionRadius, 0, Math.PI * 2);
    ctx.fill();

    this.scene.textures.addCanvas('fogTexture', canvas);

    this.fogImage = this.scene.add.image(0, 0, 'fogTexture');
    this.fogImage.setDepth(1000);
    this.fogImage.setOrigin(0.5);
  }

  update(playerX: number, playerY: number): void {
    if (this.fogImage) {
      this.fogImage.setPosition(playerX, playerY);
    }
  }

  setVisionRadius(radius: number): void {
    this.visionRadius = radius;
    // 如需动态改变视野，可重新生成纹理
  }

  destroy(): void {
    this.fogImage?.destroy();
    this.fogImage = null;
  }
}
