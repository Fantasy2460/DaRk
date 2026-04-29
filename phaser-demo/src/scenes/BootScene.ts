import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 无需加载外部资源，所有图形均为程序生成
  }

  create() {
    this.add.text(this.scale.width / 2, this.scale.height / 2, '黑暗之行', {
      fontSize: '48px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(this.scale.width / 2, this.scale.height / 2 + 60, '按任意键开始', {
      fontSize: '20px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this.input.keyboard?.once('keydown', () => {
      this.scene.start('LoginScene');
    });
    this.input.once('pointerdown', () => {
      this.scene.start('LoginScene');
    });
  }
}
