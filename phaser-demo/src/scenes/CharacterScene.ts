import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { CLASSES } from '../data/classes';
import { EquipmentSystem } from '../systems/EquipmentSystem';
import { getExpToNextLevel, MAX_PLAYER_LEVEL, RARITY_COLORS, SLOT_NAMES } from '../config/gameConfig';
import type { Item, ItemSlot } from '../types';

const SLOT_ORDER: ItemSlot[] = ['weapon', 'helmet', 'armor', 'pants', 'shoes', 'accessory', 'offhand'];

export class CharacterScene extends Phaser.Scene {
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'CharacterScene' });
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    const state = GameState.getInstance();
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass);
    if (!cls) return;

    const level = state.save.level;
    const isInRun = state.run !== null;
    const eq = new EquipmentSystem(state.run !== null ? state.run.runEquipment : state.save.cityEquipment);
    const eqBonus = eq.getTotalStats();
    const multiplier = 1 + (level - 1) * 0.05;

    const baseHp = Math.floor(cls.baseStats.maxHp * multiplier);
    const baseMp = Math.floor(cls.baseStats.maxMp * multiplier);
    const baseAtk = Math.floor(cls.baseStats.attack * multiplier);
    const baseDef = Math.floor(cls.baseStats.defense * multiplier);
    const baseSpd = Math.floor(cls.baseStats.speed * multiplier);

    const finalMaxHp = baseHp + (eqBonus.maxHp ?? 0);
    const finalMaxMp = baseMp + (eqBonus.maxMp ?? 0);
    const finalAtk = baseAtk + (eqBonus.attack ?? 0);
    const finalDef = baseDef + (eqBonus.defense ?? 0);
    const finalSpd = baseSpd + (eqBonus.speed ?? 0);

    const currentHp = isInRun ? state.run!.currentHp : finalMaxHp;
    const currentMp = isInRun ? state.run!.currentMp : finalMaxMp;

    // 标题
    this.add.text(this.scale.width / 2, 28, '角色属性', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 左侧面板：职业与等级
    this.renderProfile(130, 100, cls.name, level, state.save.exp);

    // 右侧面板：属性数值
    this.renderStats(380, 100, {
      hp: { current: currentHp, max: finalMaxHp, base: baseHp, bonus: eqBonus.maxHp ?? 0 },
      mp: { current: currentMp, max: finalMaxMp, base: baseMp, bonus: eqBonus.maxMp ?? 0 },
      attack: { final: finalAtk, base: baseAtk, bonus: eqBonus.attack ?? 0 },
      defense: { final: finalDef, base: baseDef, bonus: eqBonus.defense ?? 0 },
      speed: { final: finalSpd, base: baseSpd, bonus: eqBonus.speed ?? 0 },
    });

    // 下方：装备栏
    this.renderEquipment(480, 380, eq);

    // 返回按钮
    const returnScene = isInRun ? 'ForestScene' : 'MainCityScene';
    const backLabel = isInRun ? '返回游戏' : '返回主城';
    const backBtn = this.add.text(this.scale.width / 2, this.scale.height - 30, backLabel, {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#475569',
      padding: { x: 20, y: 8 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setStyle({ backgroundColor: '#64748b' }))
      .on('pointerout', () => backBtn.setStyle({ backgroundColor: '#475569' }))
      .on('pointerdown', () => this.scene.start(returnScene));

    this.uiObjects.push(backBtn);

    this.input.keyboard!.on('keydown-ESC', () => {
      this.scene.start(returnScene);
    });
  }

  private renderProfile(x: number, y: number, className: string, level: number, exp: number) {
    const panelW = 240;
    const panelH = 160;

    const panel = this.add.rectangle(x + panelW / 2, y + panelH / 2, panelW, panelH, 0x1e293b);
    panel.setStrokeStyle(2, 0x334155);
    this.uiObjects.push(panel);

    // 职业名
    const nameText = this.add.text(x + panelW / 2, y + 20, className, {
      fontSize: '20px',
      color: '#fbbf24',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.uiObjects.push(nameText);

    // 等级
    const lvText = this.add.text(x + panelW / 2, y + 52, `Lv.${level}`, {
      fontSize: '16px',
      color: '#e2e8f0',
    }).setOrigin(0.5);
    this.uiObjects.push(lvText);

    // 经验条
    const isMax = level >= MAX_PLAYER_LEVEL;
    const required = isMax ? 1 : getExpToNextLevel(level);
    const ratio = isMax ? 1 : Math.min(1, exp / required);

    const barBg = this.add.rectangle(x + panelW / 2, y + 84, 200, 10, 0x0f172a).setOrigin(0.5);
    this.uiObjects.push(barBg);

    const barFill = this.add.rectangle(x + panelW / 2 - 100, y + 84, 200 * ratio, 10, 0xfbbf24).setOrigin(0, 0.5);
    this.uiObjects.push(barFill);

    const expLabel = isMax ? '已满级' : `${exp} / ${required}`;
    const expText = this.add.text(x + panelW / 2, y + 104, expLabel, {
      fontSize: '11px',
      color: '#94a3b8',
    }).setOrigin(0.5);
    this.uiObjects.push(expText);

    // 状态提示
    const state = GameState.getInstance();
    const statusLabel = state.run ? `森林第 ${state.run.forestDepth} 层` : '安全区 - 主城';
    const statusText = this.add.text(x + panelW / 2, y + 130, statusLabel, {
      fontSize: '12px',
      color: state.run ? '#ef4444' : '#22c55e',
    }).setOrigin(0.5);
    this.uiObjects.push(statusText);
  }

  private renderStats(
    x: number,
    y: number,
    stats: {
      hp: { current: number; max: number; base: number; bonus: number };
      mp: { current: number; max: number; base: number; bonus: number };
      attack: { final: number; base: number; bonus: number };
      defense: { final: number; base: number; bonus: number };
      speed: { final: number; base: number; bonus: number };
    }
  ) {
    const panelW = 520;
    const panelH = 240;

    const panel = this.add.rectangle(x + panelW / 2, y + panelH / 2, panelW, panelH, 0x1e293b);
    panel.setStrokeStyle(2, 0x334155);
    this.uiObjects.push(panel);

    const rows = [
      { label: '生命', value: `${stats.hp.current} / ${stats.hp.max}`, base: stats.hp.base, bonus: stats.hp.bonus, color: '#ef4444' },
      { label: '法力', value: `${stats.mp.current} / ${stats.mp.max}`, base: stats.mp.base, bonus: stats.mp.bonus, color: '#3b82f6' },
      { label: '攻击', value: `${stats.attack.final}`, base: stats.attack.base, bonus: stats.attack.bonus, color: '#fbbf24' },
      { label: '防御', value: `${stats.defense.final}`, base: stats.defense.base, bonus: stats.defense.bonus, color: '#22c55e' },
      { label: '移速', value: `${stats.speed.final}`, base: stats.speed.base, bonus: stats.speed.bonus, color: '#a78bfa' },
    ];

    rows.forEach((row, i) => {
      const ry = y + 24 + i * 42;
      const labelX = x + 20;
      const valueX = x + 160;
      const detailX = x + 280;

      // 属性名
      const labelText = this.add.text(labelX, ry, row.label, {
        fontSize: '14px',
        color: '#94a3b8',
      }).setOrigin(0, 0.5);
      this.uiObjects.push(labelText);

      // 当前数值
      const valueText = this.add.text(valueX, ry, row.value, {
        fontSize: '14px',
        color: row.color,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      this.uiObjects.push(valueText);

      // 基础 + 加成
      const detailText = this.add.text(detailX, ry, `基础 ${row.base}  +  装备 ${row.bonus}`, {
        fontSize: '11px',
        color: '#64748b',
      }).setOrigin(0, 0.5);
      this.uiObjects.push(detailText);
    });
  }

  private renderEquipment(cx: number, y: number, eq: EquipmentSystem) {
    const titleText = this.add.text(cx, y - 20, '当前装备', {
      fontSize: '14px',
      color: '#94a3b8',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.uiObjects.push(titleText);

    const cols = 4;
    const cellW = 100;
    const cellH = 80;
    const gapX = 16;
    const gapY = 16;

    const totalWidth = cols * cellW + (cols - 1) * gapX;
    const startX = cx - totalWidth / 2 + cellW / 2;

    SLOT_ORDER.forEach((slot, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (cellW + gapX);
      const cy = y + 30 + row * (cellH + gapY) + cellH / 2;

      const item = eq.getSlot(slot);
      const bgColor = item ? 0x1e293b : 0x0f172a;
      const strokeColor = item ? RARITY_COLORS[item.rarity] : 0x334155;

      const bg = this.add.rectangle(x, cy, cellW, cellH, bgColor);
      bg.setStrokeStyle(2, strokeColor);
      this.uiObjects.push(bg);

      // 部位名
      const slotLabel = this.add.text(x, cy - 22, SLOT_NAMES[slot] ?? slot, {
        fontSize: '11px',
        color: '#64748b',
      }).setOrigin(0.5);
      this.uiObjects.push(slotLabel);

      if (item) {
        // 装备名
        const nameText = this.add.text(x, cy - 2, this.truncate(item.name, 5), {
          fontSize: '12px',
          color: '#' + RARITY_COLORS[item.rarity].toString(16).padStart(6, '0'),
          fontStyle: 'bold',
        }).setOrigin(0.5);
        this.uiObjects.push(nameText);

        // 品质
        const rarityText = this.add.text(x, cy + 16, `[${item.rarity}]`, {
          fontSize: '10px',
          color: '#' + RARITY_COLORS[item.rarity].toString(16).padStart(6, '0'),
        }).setOrigin(0.5);
        this.uiObjects.push(rarityText);
      } else {
        const emptyText = this.add.text(x, cy - 2, '空', {
          fontSize: '12px',
          color: '#475569',
        }).setOrigin(0.5);
        this.uiObjects.push(emptyText);
      }
    });
  }

  private truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }
}
