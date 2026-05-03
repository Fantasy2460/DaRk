import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { SaveManager } from '../managers/SaveManager';
import { api } from '../network/ApiClient';
import { CLASSES } from '../data/classes';
import { getExpToNextLevel, MAX_PLAYER_LEVEL } from '../config/gameConfig';
import { Scrollable } from '../components/Scrollable';
import type { Skill, SkillType } from '../types';

// 行布局参数
const ROW_LEVELS = [1, 3, 5, 7, 9];
const ROW_HEIGHT = 200;
const ROW_GAP = 10;
const CARD_WIDTH = 280;
const CARD_HEIGHT = 180;
const CARD_GAP = 16;
const LEVEL_LABEL_WIDTH = 80;

// 视口
const VIEWPORT_TOP = 130;
const VIEWPORT_BOTTOM = 660;

// 颜色规范
const COLOR_TEXT_PRIMARY = '#e2e8f0';
const COLOR_TEXT_DIM = '#94a3b8';
const COLOR_TEXT_MUTE = '#64748b';
const COLOR_TEXT_GOLD = '#fbbf24';
const COLOR_TEXT_DISABLED = '#475569';
const COLOR_TEXT_WHITE = '#ffffff';
const COLOR_TEXT_DANGER = '#ef4444';

const STROKE_UNLEARNED = 0x475569;
const STROKE_LEARNED = 0x22c55e;
const STROKE_MAXED = 0xfbbf24;
const STROKE_LOCKED = 0x334155;

const BG_CARD = 0x1e293b;
const BG_CARD_LOCKED = 0x0f172a;

const BTN_LEARN = 0x22c55e;
const BTN_UPGRADE = 0x3b82f6;
const BTN_DISABLED = 0x475569;
const BTN_DANGER = 0xef4444;

// 错误码 → 中文映射
const ERROR_MESSAGES: Record<string, string> = {
  OFFLINE: '离线模式不可学习',
  NETWORK_ERROR: '网络异常，请稍后重试',
  SKILL_UPGRADE_LEVEL_LOCKED: '等级不足',
  SKILL_UPGRADE_INSUFFICIENT_SP: '技能点不足',
  SKILL_UPGRADE_MAXED: '该技能已满级',
  SKILL_UPGRADE_CLASS_MISMATCH: '职业不匹配',
  CHARACTER_NOT_FOUND: '数据异常，请刷新',
  SKILL_TEMPLATE_NOT_FOUND: '数据异常，请刷新',
};

interface SkillItem extends Skill {
  unlocked: boolean;
}

interface ButtonState {
  label: string;
  bgColor: number;
  textColor: string;
  enabled: boolean;
  action: 'learn' | 'upgrade' | 'none';
}

export class SkillScene extends Phaser.Scene {
  private skills: SkillItem[] = [];
  private scroll: Scrollable | null = null;

  // header refs
  private spText: Phaser.GameObjects.Text | null = null;
  private headerObjects: Phaser.GameObjects.GameObject[] = [];
  private footerObjects: Phaser.GameObjects.GameObject[] = [];

  private isUpgrading = false;

  constructor() {
    super({ key: 'SkillScene' });
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    const state = GameState.getInstance();
    const level = state.save.level;

    // 加载提示
    const loadingText = this.add.text(this.scale.width / 2, this.scale.height / 2, '加载技能数据...', {
      fontSize: '16px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(0.5);

    // 异步加载然后渲染三段
    this.loadSkills(level).then(() => {
      loadingText.destroy();
      this.renderHeader();
      this.renderContent();
      this.renderFooter();
    });

    // ESC / N 关闭当前 UI 场景（ForestScene / MainCityScene 保持运行）
    this.input.keyboard!.on('keydown-ESC', () => this.closeScene());
    this.input.keyboard!.on('keydown-N', () => this.closeScene());

    // shutdown 释放
    this.events.once('shutdown', () => this.cleanup());
    this.events.once('destroy', () => this.cleanup());
  }

  private cleanup() {
    if (this.scroll) {
      this.scroll.destroy();
      this.scroll = null;
    }
    this.input.keyboard?.off('keydown-ESC');
    this.input.keyboard?.off('keydown-N');
  }

  private closeScene() {
    this.cleanup();
    this.scene.stop();
  }

  private async loadSkills(playerLevel: number) {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken() && !SaveManager.isOffline()) {
      try {
        const { skills } = await api.getCharacterSkills(characterId, playerLevel);
        this.skills = (skills as any[]).map((s) => ({
          id: s.skillId,
          name: s.name,
          description: s.description,
          type: s.type as SkillType,
          requiredLevel: s.requiredLevel,
          cooldown: s.cooldown,
          mpCost: s.mpCost,
          damage: s.damage ?? undefined,
          damagePercent: s.damagePercent ?? undefined,
          range: s.range ?? undefined,
          aoe: s.aoe,
          maxLevel: s.maxLevel ?? undefined,
          unlocked: !!s.unlocked,
        }));
        return;
      } catch (e) {
        console.warn('从服务器加载技能失败，回退本地:', e);
      }
    }

    // 回退到本地 CLASSES 数据（游客模式或离线）
    const state = GameState.getInstance();
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass);
    const localSkills = cls?.skills ?? [];
    this.skills = localSkills.map((s) => ({
      ...s,
      unlocked: playerLevel >= (s.requiredLevel ?? 1),
    }));
  }

  // ============================================================
  // 顶部固定区
  // ============================================================
  private renderHeader() {
    const state = GameState.getInstance();
    const level = state.save.level;
    const exp = state.save.exp;
    const sp = state.save.skillPoints ?? 0;
    const cx = this.scale.width / 2;

    // 标题
    const title = this.add.text(cx, 28, '技 能', {
      fontSize: '28px',
      color: COLOR_TEXT_PRIMARY,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.headerObjects.push(title);

    // 等级与经验条
    const isMax = level >= MAX_PLAYER_LEVEL;
    const required = isMax ? 1 : getExpToNextLevel(level);
    const ratio = isMax ? 1 : Math.min(1, exp / required);

    const lvlLabel = this.add.text(cx - 220, 70, `Lv.${level}`, {
      fontSize: '14px',
      color: COLOR_TEXT_GOLD,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.headerObjects.push(lvlLabel);

    const barBg = this.add.rectangle(cx - 160, 70, 240, 10, 0x1e293b).setOrigin(0, 0.5);
    const barFg = this.add.rectangle(cx - 160, 70, 240 * ratio, 10, 0xfbbf24).setOrigin(0, 0.5);
    this.headerObjects.push(barBg);
    this.headerObjects.push(barFg);

    const expLabel = isMax ? '已满级' : `${exp} / ${required}`;
    const expText = this.add.text(cx + 90, 70, expLabel, {
      fontSize: '11px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(0, 0.5);
    this.headerObjects.push(expText);

    // 剩余技能点（金色高亮）
    this.spText = this.add.text(cx, 100, `剩余技能点：${sp}`, {
      fontSize: '16px',
      color: COLOR_TEXT_GOLD,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.headerObjects.push(this.spText);

    // 关闭按钮（右上角）
    const closeBtn = this.add.text(this.scale.width - 24, 28, '×', {
      fontSize: '32px',
      color: COLOR_TEXT_DIM,
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor(COLOR_TEXT_PRIMARY));
    closeBtn.on('pointerout', () => closeBtn.setColor(COLOR_TEXT_DIM));
    closeBtn.on('pointerdown', () => {
      this.closeScene();
    });
    this.headerObjects.push(closeBtn);
  }

  // ============================================================
  // 滚动内容区
  // ============================================================
  private renderContent() {
    const state = GameState.getInstance();
    const playerLevel = state.save.level;

    const viewportX = 0;
    const viewportY = VIEWPORT_TOP;
    const viewportW = this.scale.width;
    const viewportH = VIEWPORT_BOTTOM - VIEWPORT_TOP;

    const contentHeight = ROW_LEVELS.length * ROW_HEIGHT + (ROW_LEVELS.length - 1) * ROW_GAP;

    this.scroll = new Scrollable({
      scene: this,
      x: viewportX,
      y: viewportY,
      width: viewportW,
      height: viewportH,
      contentHeight,
      scrollSpeed: 60,
      showScrollbar: true,
    });

    ROW_LEVELS.forEach((rowLevel, idx) => {
      const rowY = idx * (ROW_HEIGHT + ROW_GAP);
      this.buildRow(rowLevel, rowY, playerLevel);
    });
  }

  private buildRow(rowLevel: number, rowY: number, playerLevel: number) {
    if (!this.scroll) return;
    const rowLocked = playerLevel < rowLevel;
    const rowAlpha = rowLocked ? 0.45 : 1;

    // 行 Lv.X 标签 (居中粗体)
    const labelX = LEVEL_LABEL_WIDTH / 2 + 16;
    const labelY = rowY + ROW_HEIGHT / 2;

    const lvlText = this.add.text(labelX, labelY, `Lv.${rowLevel}`, {
      fontSize: '28px',
      color: COLOR_TEXT_WHITE,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    lvlText.setAlpha(rowAlpha);
    this.scroll.content.add(lvlText);

    if (rowLocked) {
      const lockHint = this.add.text(labelX, labelY + 32, `需 Lv.${rowLevel} 解锁`, {
        fontSize: '11px',
        color: COLOR_TEXT_DISABLED,
      }).setOrigin(0.5);
      lockHint.setAlpha(rowAlpha);
      this.scroll.content.add(lockHint);
    }

    // Lv.7 / Lv.9 占位行
    if (rowLevel === 7 || rowLevel === 9) {
      this.buildPlaceholderCard(rowY, rowAlpha);
      return;
    }

    // 普通行：从 skills 中筛选 requiredLevel===rowLevel 的技能
    const rowSkills = this.skills.filter((s) => (s.requiredLevel ?? 1) === rowLevel);
    if (rowSkills.length === 0) {
      // 数据缺失也显示占位
      this.buildPlaceholderCard(rowY, rowAlpha);
      return;
    }

    // 卡片水平排布：从 LEVEL_LABEL_WIDTH + 32 开始
    const cardsStartX = LEVEL_LABEL_WIDTH + 32;
    rowSkills.forEach((skill, i) => {
      const cardCenterX = cardsStartX + CARD_WIDTH / 2 + i * (CARD_WIDTH + CARD_GAP);
      const cardCenterY = rowY + ROW_HEIGHT / 2;
      this.buildSkillCard(cardCenterX, cardCenterY, skill, rowLocked);
    });
  }

  private buildPlaceholderCard(rowY: number, rowAlpha: number) {
    if (!this.scroll) return;
    const cardsStartX = LEVEL_LABEL_WIDTH + 32;
    const cardW = this.scale.width - cardsStartX - 32;
    const cardX = cardsStartX + cardW / 2;
    const cardY = rowY + ROW_HEIGHT / 2;

    const bg = this.add.rectangle(cardX, cardY, cardW, CARD_HEIGHT, BG_CARD_LOCKED);
    bg.setStrokeStyle(2, STROKE_LOCKED);
    bg.setAlpha(rowAlpha);
    this.scroll.content.add(bg);

    const text = this.add.text(cardX, cardY, '开发中…', {
      fontSize: '24px',
      color: COLOR_TEXT_DIM,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    text.setAlpha(rowAlpha);
    this.scroll.content.add(text);
  }

  private buildSkillCard(cx: number, cy: number, skill: SkillItem, rowLocked: boolean) {
    if (!this.scroll) return;
    const state = GameState.getInstance();
    const playerLevel = state.save.level;
    const sp = state.save.skillPoints ?? 0;
    const currentLevel = state.save.skillLevels?.[skill.id] ?? 0;
    const maxLevel = skill.maxLevel ?? 1;
    const offline = SaveManager.isOffline() || !api.getToken() || !SaveManager.getCharacterId();

    // 卡片状态决定 stroke
    let strokeColor = STROKE_UNLEARNED;
    if (rowLocked) strokeColor = STROKE_LOCKED;
    else if (currentLevel >= maxLevel && currentLevel > 0) strokeColor = STROKE_MAXED;
    else if (currentLevel > 0) strokeColor = STROKE_LEARNED;

    const bgColor = rowLocked ? BG_CARD_LOCKED : BG_CARD;

    const bg = this.add.rectangle(cx, cy, CARD_WIDTH, CARD_HEIGHT, bgColor);
    bg.setStrokeStyle(2, strokeColor);
    if (rowLocked) bg.setAlpha(0.45);
    this.scroll.content.add(bg);

    // 技能名称（左上）
    const nameText = this.add.text(
      cx - CARD_WIDTH / 2 + 12,
      cy - CARD_HEIGHT / 2 + 12,
      skill.name,
      {
        fontSize: '16px',
        color: rowLocked ? COLOR_TEXT_DISABLED : COLOR_TEXT_PRIMARY,
        fontStyle: 'bold',
      }
    ).setOrigin(0);
    this.scroll.content.add(nameText);

    // 类型 tag（右上）
    const typeLabel = skill.type === 'passive' ? '被动' : '主动';
    const typeColor = skill.type === 'passive' ? '#22c55e' : '#3b82f6';
    const typeText = this.add.text(
      cx + CARD_WIDTH / 2 - 12,
      cy - CARD_HEIGHT / 2 + 14,
      typeLabel,
      { fontSize: '11px', color: typeColor, fontStyle: 'bold' }
    ).setOrigin(1, 0);
    this.scroll.content.add(typeText);

    // 描述
    const descText = this.add.text(
      cx - CARD_WIDTH / 2 + 12,
      cy - CARD_HEIGHT / 2 + 38,
      skill.description ?? '',
      {
        fontSize: '12px',
        color: rowLocked ? COLOR_TEXT_DISABLED : COLOR_TEXT_DIM,
        wordWrap: { width: CARD_WIDTH - 24, useAdvancedWrap: true },
        lineSpacing: 2,
      }
    ).setOrigin(0);
    this.scroll.content.add(descText);

    // 数值行
    const details: string[] = [];
    if (skill.cooldown > 0) details.push(`冷却 ${(skill.cooldown / 1000).toFixed(1)}s`);
    if (skill.mpCost > 0) details.push(`MP ${skill.mpCost}`);
    if (skill.damage !== undefined && skill.damage > 0) details.push(`伤害 ${skill.damage}`);
    if (skill.damagePercent !== undefined && skill.damagePercent > 0) details.push(`倍率 ${skill.damagePercent}%`);
    if (skill.range !== undefined && skill.range > 0) details.push(`射程 ${skill.range}`);
    if (skill.aoe) details.push('范围');

    const detailText = this.add.text(
      cx - CARD_WIDTH / 2 + 12,
      cy + CARD_HEIGHT / 2 - 64,
      details.join(' · '),
      {
        fontSize: '10px',
        color: COLOR_TEXT_MUTE,
        wordWrap: { width: CARD_WIDTH - 24, useAdvancedWrap: true },
      }
    ).setOrigin(0);
    this.scroll.content.add(detailText);

    // 当前等级（左下，金色）
    const levelText = this.add.text(
      cx - CARD_WIDTH / 2 + 12,
      cy + CARD_HEIGHT / 2 - 14,
      `Lv.${currentLevel}/${maxLevel}`,
      { fontSize: '14px', color: COLOR_TEXT_GOLD, fontStyle: 'bold' }
    ).setOrigin(0, 1);
    this.scroll.content.add(levelText);

    // 按钮
    const btnState = this.computeButtonState({
      currentLevel,
      maxLevel,
      requiredLevel: skill.requiredLevel ?? 1,
      playerLevel,
      sp,
      offline,
      rowLocked,
    });

    const btnY = cy + CARD_HEIGHT / 2 - 18;
    const btnX = cx + CARD_WIDTH / 2 - 56;
    const btnBg = this.add.rectangle(btnX, btnY, 88, 26, btnState.bgColor);
    btnBg.setOrigin(0.5);
    if (rowLocked) btnBg.setAlpha(0.45);
    this.scroll.content.add(btnBg);

    const btnText = this.add.text(btnX, btnY, btnState.label, {
      fontSize: '12px',
      color: btnState.textColor,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    if (rowLocked) btnText.setAlpha(0.45);
    this.scroll.content.add(btnText);

    if (btnState.enabled && btnState.action !== 'none') {
      btnBg.setInteractive({ useHandCursor: true });
      btnBg.on('pointerover', () => btnBg.setFillStyle(this.lightenColor(btnState.bgColor)));
      btnBg.on('pointerout', () => btnBg.setFillStyle(btnState.bgColor));
      btnBg.on('pointerdown', () => {
        if (this.isUpgrading) return;
        this.handleUpgradeClick(skill.id);
      });
    }
  }

  private computeButtonState(opts: {
    currentLevel: number;
    maxLevel: number;
    requiredLevel: number;
    playerLevel: number;
    sp: number;
    offline: boolean;
    rowLocked: boolean;
  }): ButtonState {
    const { currentLevel, maxLevel, requiredLevel, playerLevel, sp, offline, rowLocked } = opts;

    // 离线模式：所有按钮都禁用为灰色
    if (offline) {
      return {
        label: '离线模式',
        bgColor: BTN_DISABLED,
        textColor: COLOR_TEXT_DIM,
        enabled: false,
        action: 'none',
      };
    }

    // 行锁定（玩家等级低于该行）
    if (rowLocked || playerLevel < requiredLevel) {
      return {
        label: `需 Lv.${requiredLevel}`,
        bgColor: BTN_DISABLED,
        textColor: COLOR_TEXT_DIM,
        enabled: false,
        action: 'none',
      };
    }

    // 已满级
    if (currentLevel >= maxLevel && currentLevel > 0) {
      return {
        label: '已满级',
        bgColor: BTN_DISABLED,
        textColor: COLOR_TEXT_DIM,
        enabled: false,
        action: 'none',
      };
    }

    // 未学习（且条件满足）
    if (currentLevel === 0) {
      // 学习也消耗 SP？根据规范文字「学 习」，且 SP=0 仍可显示但无 SP 时弹错
      // 规范明确：「currentLevel===0 且条件满足」显示「学 习」
      // 「lv 满足但 SP=0 且未满级」显示「技能点不足」（红）
      if (sp <= 0) {
        return {
          label: '技能点不足',
          bgColor: BTN_DANGER,
          textColor: COLOR_TEXT_WHITE,
          enabled: false,
          action: 'none',
        };
      }
      return {
        label: '学 习',
        bgColor: BTN_LEARN,
        textColor: COLOR_TEXT_WHITE,
        enabled: true,
        action: 'learn',
      };
    }

    // 已学习且可升级
    if (currentLevel > 0 && currentLevel < maxLevel) {
      if (sp < 1) {
        return {
          label: '技能点不足',
          bgColor: BTN_DANGER,
          textColor: COLOR_TEXT_WHITE,
          enabled: false,
          action: 'none',
        };
      }
      return {
        label: '升 级 (1 SP)',
        bgColor: BTN_UPGRADE,
        textColor: COLOR_TEXT_WHITE,
        enabled: true,
        action: 'upgrade',
      };
    }

    // 兜底
    return {
      label: '不可用',
      bgColor: BTN_DISABLED,
      textColor: COLOR_TEXT_DIM,
      enabled: false,
      action: 'none',
    };
  }

  private lightenColor(color: number): number {
    // 简单地把颜色变亮 ~12%
    const r = Math.min(255, ((color >> 16) & 0xff) + 32);
    const g = Math.min(255, ((color >> 8) & 0xff) + 32);
    const b = Math.min(255, (color & 0xff) + 32);
    return (r << 16) | (g << 8) | b;
  }

  private async handleUpgradeClick(skillId: string) {
    if (this.isUpgrading) return;
    this.isUpgrading = true;
    try {
      const result = await GameState.getInstance().upgradeSkill(skillId);
      if (result.ok) {
        this.refresh();
      } else {
        const code = result.error ?? 'NETWORK_ERROR';
        const msg = ERROR_MESSAGES[code] ?? result.message ?? '操作失败';
        this.showToast(msg);
      }
    } catch (e) {
      console.warn('[SkillScene] upgradeSkill 异常:', e);
      this.showToast(ERROR_MESSAGES.NETWORK_ERROR);
    } finally {
      this.isUpgrading = false;
    }
  }

  /** 升级成功后整页刷新 SP 文本 + 重渲染滚动区 */
  private refresh() {
    const state = GameState.getInstance();
    const sp = state.save.skillPoints ?? 0;
    if (this.spText && this.spText.active) {
      this.spText.setText(`剩余技能点：${sp}`);
    }
    // 销毁旧滚动区，重新构建
    if (this.scroll) {
      this.scroll.destroy();
      this.scroll = null;
    }
    this.renderContent();
  }

  // ============================================================
  // 底部固定区
  // ============================================================
  private renderFooter() {
    const state = GameState.getInstance();
    const backLabel = state.run ? '返回游戏' : '返回主城';

    const backBtn = this.add.text(this.scale.width / 2, this.scale.height - 30, backLabel, {
      fontSize: '16px',
      color: COLOR_TEXT_WHITE,
      backgroundColor: '#475569',
      padding: { x: 20, y: 8 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setStyle({ backgroundColor: '#64748b' }))
      .on('pointerout', () => backBtn.setStyle({ backgroundColor: '#475569' }))
      .on('pointerdown', () => this.closeScene());
    this.footerObjects.push(backBtn);

    // 离线提示
    if (SaveManager.isOffline()) {
      const offlineHint = this.add.text(20, this.scale.height - 30, '当前离线模式，无法学习/升级技能', {
        fontSize: '12px',
        color: COLOR_TEXT_DANGER,
      }).setOrigin(0, 0.5);
      this.footerObjects.push(offlineHint);
    }
  }

  // ============================================================
  // toast 提示
  // ============================================================
  private showToast(message: string) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const bg = this.add.rectangle(cx, cy, 320, 56, 0x1e293b, 0.95);
    bg.setStrokeStyle(2, 0xef4444);

    const text = this.add.text(cx, cy, message, {
      fontSize: '16px',
      color: COLOR_TEXT_WHITE,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    bg.setDepth(1000);
    text.setDepth(1001);

    this.tweens.add({
      targets: [bg, text],
      alpha: 0,
      delay: 1500,
      duration: 500,
      onComplete: () => {
        bg.destroy();
        text.destroy();
      },
    });
  }
}
