import Phaser from 'phaser';
import { GameState } from '../managers/GameState';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  create(data: { survived: boolean; depth: number; kills: number; items: string[] }) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const title = data.survived ? '安全撤离' : '你阵亡了';
    const color = data.survived ? '#4ade80' : '#ef4444';

    this.add.text(cx, cy - 100, title, {
      fontSize: '48px',
      color,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 20, `深入层数: ${data.depth}`, {
      fontSize: '20px',
      color: '#cbd5e1',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 20, `击杀敌人: ${data.kills}`, {
      fontSize: '20px',
      color: '#cbd5e1',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 60, `获得物品: ${data.items.length} 件`, {
      fontSize: '20px',
      color: '#cbd5e1',
    }).setOrigin(0.5);

    if (!data.survived) {
      this.add.text(cx, cy + 110, '本次探险获得的所有物品已丢失', {
        fontSize: '16px',
        color: '#f87171',
      }).setOrigin(0.5);
    }

    const btn = this.add.text(cx, cy + 180, '返回主城', {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#1e40af',
      padding: { x: 24, y: 10 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.scene.start('MainCityScene');
      });
  }
}
