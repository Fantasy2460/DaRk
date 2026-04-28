import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { CLASSES } from '../data/classes';
import type { ClassType } from '../types';

export class MainMenuScene extends Phaser.Scene {
  private selectedClass: ClassType | null = null;
  private classButtons: Phaser.GameObjects.Container[] = [];
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create() {
    this.classButtons = [];
    this.selectedClass = null;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.add.text(cx, 80, '黑暗之行', {
      fontSize: '56px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 职业选择
    this.add.text(cx, 160, '选择你的职业', {
      fontSize: '22px',
      color: '#94a3b8',
    }).setOrigin(0.5);

    const startX = cx - 220;
    const gap = 220;
    CLASSES.forEach((cls, i) => {
      const btn = this.createClassButton(startX + i * gap, 260, cls.id, cls.name, cls.description);
      this.classButtons.push(btn);
    });

    // 职业详情
    this.infoText = this.add.text(cx, 380, '', {
      fontSize: '16px',
      color: '#cbd5e1',
      align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5);

    // 检查是否有存档
    const state = GameState.getInstance();
    if (state.save.selectedClass) {
      this.selectedClass = state.save.selectedClass;
      this.highlightButton(this.selectedClass);
      this.updateInfo(state.save.selectedClass);

      this.add.text(cx, 480, `继续冒险 - ${this.getClassName(state.save.selectedClass)}`, {
        fontSize: '20px',
        color: '#4ade80',
        backgroundColor: '#064e3b',
        padding: { x: 20, y: 10 },
      })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.startGame());
    }

    // 开始按钮
    const startBtn = this.add.text(cx, 540, '开始游戏', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: '#1e40af',
      padding: { x: 30, y: 12 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => startBtn.setStyle({ backgroundColor: '#2563eb' }))
      .on('pointerout', () => startBtn.setStyle({ backgroundColor: '#1e40af' }))
      .on('pointerdown', () => this.startGame());

    // 重置存档
    this.add.text(cx, 600, '重置存档', {
      fontSize: '14px',
      color: '#ef4444',
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        GameState.getInstance().resetAll();
        this.scene.restart();
      });
  }

  private createClassButton(x: number, y: number, classId: ClassType, name: string, desc: string): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, 180, 80, 0x1e293b).setStrokeStyle(2, 0x475569);
    const label = this.add.text(0, -10, name, { fontSize: '22px', color: '#f1f5f9', fontStyle: 'bold' }).setOrigin(0.5);
    const sub = this.add.text(0, 18, desc, { fontSize: '12px', color: '#94a3b8' }).setOrigin(0.5);

    container.add([bg, label, sub]);

    // 直接在背景矩形上绑定交互，比 Container 更可靠
    bg.setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => {
      bg.setStrokeStyle(2, 0x60a5fa);
    });
    bg.on('pointerout', () => {
      if (this.selectedClass !== classId) {
        bg.setStrokeStyle(2, 0x475569);
      }
    });
    bg.on('pointerdown', () => {
      this.selectedClass = classId;
      this.highlightButton(classId);
      this.updateInfo(classId);
    });

    return container;
  }

  private highlightButton(classId: ClassType | null) {
    for (const btn of this.classButtons) {
      const bg = btn.list[0] as Phaser.GameObjects.Rectangle;
      const isSelected = (btn.list[1] as Phaser.GameObjects.Text).text === this.getClassName(classId);
      bg.setStrokeStyle(2, isSelected ? 0x3b82f6 : 0x475569);
      bg.setFillStyle(isSelected ? 0x1e3a5f : 0x1e293b);
    }
  }

  private getClassName(id: ClassType | null): string {
    if (!id) return '';
    return CLASSES.find((c) => c.id === id)?.name ?? '';
  }

  private updateInfo(classId: ClassType) {
    const cls = CLASSES.find((c) => c.id === classId)!;
    const stats = cls.baseStats;
    this.infoText.setText(
      `生命: ${stats.maxHp}  法力: ${stats.maxMp}  攻击: ${stats.attack}  防御: ${stats.defense}  移速: ${stats.speed}\n\n` +
      cls.skills.map((s) => `【${s.name}】${s.description} (CD: ${s.cooldown / 1000}s)`).join('\n')
    );
  }

  private startGame() {
    if (!this.selectedClass) {
      this.add.text(this.scale.width / 2, 580, '请先选择一个职业', {
        fontSize: '16px',
        color: '#ef4444',
      }).setOrigin(0.5);
      return;
    }
    GameState.getInstance().selectClass(this.selectedClass);
    this.scene.start('MainCityScene');
  }
}
