import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { SaveManager } from '../managers/SaveManager';
import { api } from '../network/ApiClient';
import { ITEMS } from '../data/items';
import type { EquipmentCodexEntry } from '../network/ApiTypes';

const RARITY_COLORS: Record<string, string> = {
  C: '#94a3b8',
  B: '#4ade80',
  A: '#60a5fa',
  S: '#fbbf24',
};

const RARITY_LABELS: Record<string, string> = {
  C: '普通',
  B: '稀有',
  A: '史诗',
  S: '传说',
};

const SLOT_LABELS: Record<string, string> = {
  weapon: '武器',
  helmet: '头盔',
  armor: '护甲',
  pants: '裤子',
  shoes: '鞋子',
  accessory: '首饰',
  offhand: '副手',
};

export class EquipmentCodexScene extends Phaser.Scene {
  private contentObjects: Phaser.GameObjects.GameObject[] = [];
  private entries: EquipmentCodexEntry[] = [];
  private selectedIndex = 0;
  private loadingText!: Phaser.GameObjects.Text;
  private detailObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'EquipmentCodexScene' });
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    // 标题
    this.add.text(this.scale.width / 2, 28, '装备图鉴', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 加载提示
    this.loadingText = this.add.text(this.scale.width / 2, 200, '加载装备图鉴...', {
      fontSize: '16px',
      color: '#94a3b8',
    }).setOrigin(0.5);

    // 返回按钮
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

    // ESC / V 返回
    this.input.keyboard!.on('keydown-ESC', () => {
      this.scene.start(returnScene);
    });
    this.input.keyboard!.on('keydown-V', () => {
      this.scene.start(returnScene);
    });

    this.loadCodex();
  }

  private async loadCodex() {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const { codex } = await api.getEquipmentCodex(characterId);
        this.entries = codex;
        this.loadingText.destroy();
        this.renderList();
        this.renderDetail();
        return;
      } catch (e) {
        console.warn('从服务器加载装备图鉴失败，回退本地:', e);
      }
    }

    // 回退到本地 ITEMS 数据（游客模式或离线）
    const state = GameState.getInstance();
    const unlockedSet = new Set(state.save.equipmentCodex);
    this.entries = ITEMS.map((it) => {
      const unlocked = unlockedSet.has(it.id);
      return {
        templateId: it.id,
        name: it.name,
        slot: it.slot,
        rarity: it.rarity,
        description: it.description,
        unlocked,
        obtainCount: unlocked ? 1 : 0,
        firstObtainAt: null,
      };
    });

    this.loadingText.destroy();
    this.renderList();
    this.renderDetail();
  }

  private renderList() {
    this.clearContentUI();

    const startX = 40;
    const startY = 80;
    const cardW = 170;
    const cardH = 68;
    const gapX = 12;
    const gapY = 10;

    this.entries.forEach((entry, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);

      const isSelected = i === this.selectedIndex;
      const bgColor = isSelected ? 0x334155 : 0x1e293b;
      const strokeColor = isSelected ? 0xfbbf24 : entry.unlocked ? 0x475569 : 0x334155;
      const alpha = entry.unlocked ? 1 : 0.55;

      const bg = this.add.rectangle(x + cardW / 2, y + cardH / 2, cardW, cardH, bgColor);
      bg.setStrokeStyle(2, strokeColor);
      bg.setAlpha(alpha);
      this.contentObjects.push(bg);

      // 稀有度颜色条
      const rarityColor = RARITY_COLORS[entry.rarity] ?? '#94a3b8';
      const bar = this.add.rectangle(x + 4, y + cardH / 2, 6, cardH - 8, Phaser.Display.Color.HexStringToColor(rarityColor).color);
      bar.setAlpha(alpha);
      this.contentObjects.push(bar);

      // 名称
      const nameText = this.add.text(x + 18, y + 12, entry.unlocked ? entry.name : '???', {
        fontSize: '14px',
        color: isSelected ? '#fbbf24' : rarityColor,
        fontStyle: 'bold',
      }).setOrigin(0);
      nameText.setAlpha(alpha);
      this.contentObjects.push(nameText);

      // 部位 + 稀有度
      const slotLabel = SLOT_LABELS[entry.slot] ?? entry.slot;
      const rarityLabel = RARITY_LABELS[entry.rarity] ?? entry.rarity;
      const metaText = this.add.text(x + 18, y + 34, `${slotLabel} · ${rarityLabel}`, {
        fontSize: '11px',
        color: '#94a3b8',
      }).setOrigin(0);
      metaText.setAlpha(alpha);
      this.contentObjects.push(metaText);

      // 获取次数
      if (entry.unlocked) {
        const countText = this.add.text(x + cardW - 10, y + cardH - 18, `×${entry.obtainCount}`, {
          fontSize: '11px',
          color: '#64748b',
        }).setOrigin(1, 0);
        this.contentObjects.push(countText);
      } else {
        const lockText = this.add.text(x + cardW - 10, y + cardH - 18, '未解锁', {
          fontSize: '11px',
          color: '#64748b',
        }).setOrigin(1, 0);
        this.contentObjects.push(lockText);
      }

      // 交互
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        this.selectedIndex = i;
        this.clearContentUI();
        this.renderList();
        this.renderDetail();
      });
    });
  }

  private renderDetail() {
    for (const obj of this.detailObjects) {
      if (obj.active) obj.destroy();
    }
    this.detailObjects = [];

    const entry = this.entries[this.selectedIndex];
    if (!entry) return;

    const panelX = 420;
    const panelY = 80;
    const panelW = 500;
    const panelH = 480;

    // 背景
    const panelBg = this.add.rectangle(panelX + panelW / 2, panelY + panelH / 2, panelW, panelH, 0x1e293b);
    panelBg.setStrokeStyle(2, 0x475569);
    this.detailObjects.push(panelBg);

    if (!entry.unlocked) {
      const hint = this.add.text(panelX + panelW / 2, panelY + panelH / 2, '???\n获取该装备后解锁', {
        fontSize: '18px',
        color: '#64748b',
        align: 'center',
      }).setOrigin(0.5);
      this.detailObjects.push(hint);
      return;
    }

    let cy = panelY + 24;
    const cx = panelX + panelW / 2;

    // 名称
    const rarityColor = RARITY_COLORS[entry.rarity] ?? '#e2e8f0';
    const nameText = this.add.text(cx, cy, entry.name, {
      fontSize: '22px',
      color: rarityColor,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.detailObjects.push(nameText);
    cy += 36;

    // 稀有度标签
    const rarityLabel = RARITY_LABELS[entry.rarity] ?? entry.rarity;
    const rarityBadge = this.add.text(cx, cy, rarityLabel, {
      fontSize: '13px',
      color: '#0f172a',
      backgroundColor: rarityColor,
      padding: { x: 10, y: 3 },
    }).setOrigin(0.5);
    this.detailObjects.push(rarityBadge);
    cy += 36;

    // 部位
    const slotLabel = SLOT_LABELS[entry.slot] ?? entry.slot;
    const slotText = this.add.text(cx, cy, `部位: ${slotLabel}`, {
      fontSize: '14px',
      color: '#94a3b8',
    }).setOrigin(0.5);
    this.detailObjects.push(slotText);
    cy += 28;

    // 描述
    if (entry.description) {
      const descText = this.add.text(cx, cy, entry.description, {
        fontSize: '13px',
        color: '#cbd5e1',
        align: 'center',
        wordWrap: { width: panelW - 60 },
      }).setOrigin(0.5);
      this.detailObjects.push(descText);
      cy += 60;
    }

    // 获取记录
    if (entry.firstObtainAt) {
      const first = this.add.text(panelX + 30, cy, `首次获取: ${entry.firstObtainAt.slice(0, 10)}`, {
        fontSize: '12px',
        color: '#64748b',
      }).setOrigin(0);
      this.detailObjects.push(first);
      cy += 22;
    }

    const countText = this.add.text(panelX + 30, cy, `累计获取次数: ${entry.obtainCount}`, {
      fontSize: '12px',
      color: '#64748b',
    }).setOrigin(0);
    this.detailObjects.push(countText);
  }

  private clearContentUI() {
    for (const obj of this.contentObjects) {
      if (obj.active) obj.destroy();
    }
    this.contentObjects = [];
  }
}
