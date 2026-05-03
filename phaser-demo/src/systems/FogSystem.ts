import Phaser from 'phaser';

const TEXTURE_SIZE = 4000;
const TEXTURE_KEY = 'fogTexture_dynamic';
const RADIUS_QUANTIZE = 5;

export class FogSystem {
  private scene: Phaser.Scene;
  private fogImage: Phaser.GameObjects.Image | null = null;
  private lastQuantizedRadius = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(): void {
    this.regenerateTexture(160);
    this.fogImage = this.scene.add.image(0, 0, TEXTURE_KEY);
    this.fogImage.setAlpha(0);
    this.fogImage.setDepth(1000);
    this.fogImage.setOrigin(0.5);
  }

  update(playerX: number, playerY: number, currentRadius: number, opacity: number = 1): void {
    if (!this.fogImage) return;

    const quantized = Math.max(10, Math.round(currentRadius / RADIUS_QUANTIZE) * RADIUS_QUANTIZE);
    if (quantized !== this.lastQuantizedRadius) {
      this.lastQuantizedRadius = quantized;
      this.regenerateTexture(quantized);
      this.fogImage.setTexture(TEXTURE_KEY);
    }

    this.fogImage.setPosition(playerX, playerY);
    this.fogImage.setAlpha(1);
  }

  private regenerateTexture(radius: number) {
    const size = TEXTURE_SIZE;
    const center = size / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // 全屏纯白色硬遮罩（完全不透明）
    ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
    ctx.fillRect(0, 0, size, size);

    // 中心视野挖孔（锐利边缘）
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(
      center, center, radius * 0.85,
      center, center, radius
    );
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    if (this.scene.textures.exists(TEXTURE_KEY)) {
      this.scene.textures.remove(TEXTURE_KEY);
    }
    this.scene.textures.addCanvas(TEXTURE_KEY, canvas);
  }

  destroy(): void {
    this.fogImage?.destroy();
    this.fogImage = null;
    if (this.scene.textures.exists(TEXTURE_KEY)) {
      this.scene.textures.remove(TEXTURE_KEY);
    }
  }
}
