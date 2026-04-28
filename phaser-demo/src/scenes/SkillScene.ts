import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { CLASSES } from '../data/classes';
import { getExpToNextLevel, MAX_PLAYER_LEVEL } from '../config/gameConfig';
import type { Skill, SkillType } from '../types';

const TAB_LEVELS = [1, 3, 5, 7, 9];
const TAB_COLORS = {
  active: 0x475569,
  activeStroke: 0xfbbf24,
  inactive: 0x1e293b,
  inactiveStroke: 0x334155,
  locked: 0x0f172a,
  lockedStroke: 0x1e293b,
};

const TYPE_COLORS: Record<SkillType, { bg: number; text: string }> = {
  active: { bg: 0x3b82f6, text: '#3b82f6' },
  passive: { bg: 0x22c55e, text: '#22c55e' },
};

export class SkillScene extends Phaser.Scene {
  private selectedTab = 0;
  private uiObjects: Phaser.GameObjects.GameObject[] = [];
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'SkillScene' });
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    const state = GameState.getInstance();
    const level = state.save.level;

    // 标题
    this.add.text(this.scale.width / 2, 28, '技 能', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 等级与经验
    this.renderLevelInfo(level, state.save.exp);

    // 页签
    this.renderTabs(level);

    // 技能卡片
    this.renderSkills(level);

    // 返回按钮：局内回森林，局外回主城
    const returnScene = GameState.getInstance().run ? 'ForestScene' : 'MainCityScene';
    const backLabel = returnScene === 'ForestScene' ? '返回游戏' : '返回主城';
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

    // ESC 返回：局内回森林，局外回主城
    this.input.keyboard!.on('keydown-ESC', () => {
      this.scene.start(returnScene);
    });
  }

  private renderLevelInfo(level: number, exp: number) {
    const cx = this.scale.width / 2;
    const y = 66;

    const isMax = level >= MAX_PLAYER_LEVEL;
    const required = isMax ? 1 : getExpToNextLevel(level);
    const ratio = isMax ? 1 : Math.min(1, exp / required);

    // Lv. 文字
    const lvText = this.add.text(cx - 110, y, `Lv.${level}`, {
      fontSize: '14px',
      color: '#fbbf24',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.uiObjects.push(lvText);

    // 经验条背景
    const barBg = this.add.rectangle(cx + 10, y, 180, 10, 0x1e293b).setOrigin(0, 0.5);
    this.uiObjects.push(barBg);

    // 经验条前景
    const barFill = this.add.rectangle(cx + 10, y, 180 * ratio, 10, 0xfbbf24).setOrigin(0, 0.5);
    this.uiObjects.push(barFill);

    // 经验数值
    const expLabel = isMax ? '已满级' : `${exp} / ${required}`;
    const expText = this.add.text(cx + 200, y, expLabel, {
      fontSize: '11px',
      color: '#94a3b8',
    }).setOrigin(0, 0.5);
    this.uiObjects.push(expText);
  }

  private renderTabs(playerLevel: number) {
    const totalWidth = TAB_LEVELS.length * 80 + (TAB_LEVELS.length - 1) * 12;
    const startX = (this.scale.width - totalWidth) / 2 + 40;
    const y = 100;

    TAB_LEVELS.forEach((lvl, i) => {
      const x = startX + i * 92;
      const unlocked = playerLevel >= lvl;
      const selected = i === this.selectedTab;

      const bgColor = selected ? TAB_COLORS.active : unlocked ? TAB_COLORS.inactive : TAB_COLORS.locked;
      const strokeColor = selected ? TAB_COLORS.activeStroke : unlocked ? TAB_COLORS.inactiveStroke : TAB_COLORS.lockedStroke;

      const bg = this.add.rectangle(x, y, 80, 32, bgColor);
      bg.setStrokeStyle(2, strokeColor);
      this.uiObjects.push(bg);

      const label = this.add.text(x, y, `Lv.${lvl}`, {
        fontSize: '13px',
        color: unlocked ? (selected ? '#fbbf24' : '#e2e8f0') : '#475569',
      }).setOrigin(0.5);
      this.uiObjects.push(label);

      if (unlocked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => {
          this.selectedTab = i;
          this.clearContentUI();
          this.renderTabs(playerLevel);
          this.renderSkills(playerLevel);
        });
      }
    });
  }

  private renderSkills(playerLevel: number) {
    const state = GameState.getInstance();
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass);
    if (!cls) return;

    const tabLevel = TAB_LEVELS[this.selectedTab];
    const skills = cls.skills.filter((s) => (s.requiredLevel ?? 1) === tabLevel);

    const cx = this.scale.width / 2;
    const startY = 160;
    const cardWidth = 280;
    const cardHeight = 220;
    const gap = 24;

    if (skills.length === 0) {
      const hint = this.add.text(cx, startY + 60, '该等级暂无技能', {
        fontSize: '16px',
        color: '#475569',
      }).setOrigin(0.5);
      this.uiObjects.push(hint);
      return;
    }

    const totalWidth = skills.length * cardWidth + (skills.length - 1) * gap;
    const startX = cx - totalWidth / 2 + cardWidth / 2;

    skills.forEach((skill, i) => {
      const x = startX + i * (cardWidth + gap);
      const y = startY + cardHeight / 2;
      const unlocked = playerLevel >= (skill.requiredLevel ?? 1);

      this.createSkillCard(x, y, cardWidth, cardHeight, skill, unlocked);
    });
  }

  private createSkillCard(
    x: number,
    y: number,
    w: number,
    h: number,
    skill: Skill,
    unlocked: boolean
  ) {
    const alpha = unlocked ? 1 : 0.5;
    const bgColor = unlocked ? 0x1e293b : 0x0f172a;
    const strokeColor = unlocked ? 0x475569 : 0x334155;

    const bg = this.add.rectangle(x, y, w, h, bgColor);
    bg.setStrokeStyle(2, strokeColor);
    bg.setAlpha(alpha);
    this.uiObjects.push(bg);

    // 名称
    const nameText = this.add.text(x - w / 2 + 14, y - h / 2 + 14, skill.name, {
      fontSize: '16px',
      color: unlocked ? '#e2e8f0' : '#64748b',
      fontStyle: 'bold',
    }).setOrigin(0);
    this.uiObjects.push(nameText);

    // 类型标签
    const typeLabel = skill.type === 'passive' ? '被动' : '主动';
    const typeColor = skill.type ? TYPE_COLORS[skill.type].text : '#94a3b8';
    const typeText = this.add.text(x + w / 2 - 14, y - h / 2 + 16, typeLabel, {
      fontSize: '11px',
      color: typeColor,
    }).setOrigin(1, 0);
    this.uiObjects.push(typeText);

    // 描述（启用 advanced wrap 以支持中文在任意字符处换行）
    const descText = this.add.text(x - w / 2 + 14, y - h / 2 + 42, skill.description, {
      fontSize: '12px',
      color: unlocked ? '#94a3b8' : '#475569',
      wordWrap: { width: w - 32, useAdvancedWrap: true },
      lineSpacing: 2,
    }).setOrigin(0);
    this.uiObjects.push(descText);

    // 数值详情行
    const details: string[] = [];
    if (skill.cooldown > 0) details.push(`冷却 ${(skill.cooldown / 1000).toFixed(1)}s`);
    if (skill.mpCost > 0) details.push(`消耗 ${skill.mpCost} MP`);
    if (skill.damage !== undefined && skill.damage > 0) details.push(`伤害 ${skill.damage}`);
    if (skill.damagePercent !== undefined && skill.damagePercent > 0) details.push(`倍率 ${skill.damagePercent}%`);
    if (skill.range !== undefined && skill.range > 0) details.push(`射程 ${skill.range}`);
    if (skill.aoe) details.push('范围效果');

    const detailText = this.add.text(
      x - w / 2 + 14,
      y + h / 2 - 44,
      details.join('  |  '),
      { fontSize: '11px', color: '#64748b', wordWrap: { width: w - 32, useAdvancedWrap: true } }
    ).setOrigin(0);
    this.uiObjects.push(detailText);

    // 解锁状态标签
    const statusText = this.add.text(x + w / 2 - 14, y + h / 2 - 28, unlocked ? '已解锁' : '未解锁', {
      fontSize: '11px',
      color: unlocked ? '#22c55e' : '#ef4444',
    }).setOrigin(1, 0);
    this.uiObjects.push(statusText);

    // 等级要求
    const reqText = this.add.text(x, y + h / 2 - 10, `需要 Lv.${skill.requiredLevel ?? 1}`, {
      fontSize: '10px',
      color: '#64748b',
    }).setOrigin(0.5, 1);
    this.uiObjects.push(reqText);
  }

  private clearContentUI() {
    for (const obj of this.uiObjects) {
      if (obj.active) obj.destroy();
    }
    this.uiObjects = [];
  }
}
