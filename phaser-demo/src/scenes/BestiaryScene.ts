import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { SaveManager } from '../managers/SaveManager';
import { api } from '../network/ApiClient';
import { ENEMIES } from '../data/enemies';
import { ItemDataManager } from '../managers/ItemDataManager';

interface BestiaryEntry {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  colorHex: string;
  isBoss: boolean;
  dropTableJson: string | null;
  expValue: number;
  unlocked: boolean;
  killCount: number;
  firstKillAt: string | null;
  lastKillAt: string | null;
}

export class BestiaryScene extends Phaser.Scene {
  private contentObjects: Phaser.GameObjects.GameObject[] = [];
  private entries: BestiaryEntry[] = [];
  private selectedIndex = 0;
  private loadingText!: Phaser.GameObjects.Text;
  private detailObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'BestiaryScene' });
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    // 标题
    this.add.text(this.scale.width / 2, 28, '怪物图鉴', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 加载提示
    this.loadingText = this.add.text(this.scale.width / 2, 200, '加载图鉴数据...', {
      fontSize: '16px',
      color: '#94a3b8',
    }).setOrigin(0.5);

    // 返回按钮
    const backLabel = GameState.getInstance().run ? '返回游戏' : '返回主城';
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
      .on('pointerdown', () => this.closeScene());

    // ESC / V 返回
    this.input.keyboard!.on('keydown-ESC', () => {
      this.closeScene();
    });
    this.input.keyboard!.on('keydown-V', () => {
      this.closeScene();
    });

    this.loadBestiary();
  }

  private async loadBestiary() {
    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const { bestiary } = await api.getCharacterBestiary(characterId);
        this.entries = bestiary;
        this.loadingText.destroy();
        this.renderList();
        this.renderDetail();
        return;
      } catch (e) {
        console.warn('从服务器加载图鉴失败，回退本地:', e);
      }
    }

    // 回退到本地 ENEMIES 数据（游客模式或离线）
    const state = GameState.getInstance();
    const unlockedSet = new Set(state.save.bestiary);
    this.entries = ENEMIES.map((e) => {
      const unlocked = unlockedSet.has(e.id);
      return {
        id: e.id,
        name: e.name,
        hp: e.hp,
        attack: e.attack,
        defense: e.defense,
        speed: e.speed,
        aggroRange: e.aggroRange,
        attackRange: e.attackRange,
        colorHex: e.color.toString(16).padStart(6, '0'),
        isBoss: e.isBoss,
        dropTableJson: JSON.stringify(e.dropTable),
        expValue: e.expValue,
        unlocked,
        killCount: unlocked ? 1 : 0,
        firstKillAt: null,
        lastKillAt: null,
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

      // 颜色圆点
      const colorNum = parseInt(entry.colorHex, 16);
      const dot = this.add.circle(x + 16, y + 20, 10, colorNum);
      dot.setAlpha(alpha);
      this.contentObjects.push(dot);

      // 名称
      const nameColor = entry.isBoss ? '#fbbf24' : '#e2e8f0';
      const nameText = this.add.text(x + 34, y + 12, entry.unlocked ? entry.name : '???', {
        fontSize: '14px',
        color: isSelected ? '#fbbf24' : nameColor,
        fontStyle: 'bold',
      }).setOrigin(0);
      nameText.setAlpha(alpha);
      this.contentObjects.push(nameText);

      // Boss 标签
      if (entry.isBoss && entry.unlocked) {
        const bossText = this.add.text(x + cardW - 10, y + 14, 'BOSS', {
          fontSize: '10px',
          color: '#fbbf24',
        }).setOrigin(1, 0);
        this.contentObjects.push(bossText);
      }

      // 击杀次数
      if (entry.unlocked) {
        const killText = this.add.text(x + 34, y + 34, `击杀: ${entry.killCount}`, {
          fontSize: '11px',
          color: '#94a3b8',
        }).setOrigin(0);
        this.contentObjects.push(killText);
      } else {
        const lockText = this.add.text(x + 34, y + 34, '未解锁', {
          fontSize: '11px',
          color: '#64748b',
        }).setOrigin(0);
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
      const hint = this.add.text(panelX + panelW / 2, panelY + panelH / 2, '???\n击败该怪物后解锁', {
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
    const nameColor = entry.isBoss ? '#fbbf24' : '#e2e8f0';
    const nameText = this.add.text(cx, cy, entry.name, {
      fontSize: '22px',
      color: nameColor,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.detailObjects.push(nameText);
    cy += 36;

    // 怪物预览图形
    this.renderEnemyPreview(cx, cy + 30, entry);
    cy += 80;

    // 属性列表
    const stats = [
      { label: '生命', value: entry.hp },
      { label: '攻击', value: entry.attack },
      { label: '防御', value: entry.defense },
      { label: '移速', value: entry.speed },
      { label: '仇恨范围', value: entry.aggroRange },
      { label: '攻击范围', value: entry.attackRange },
      { label: '经验值', value: entry.expValue },
    ];

    const col1X = panelX + 40;
    const col2X = panelX + 180;
    const col3X = panelX + 320;

    stats.forEach((s, i) => {
      const sx = i < 3 ? col1X : i < 5 ? col2X : col3X;
      const sy = cy + (i % 3) * 28;
      const label = this.add.text(sx, sy, `${s.label}:`, { fontSize: '13px', color: '#94a3b8' }).setOrigin(0);
      const value = this.add.text(sx + 56, sy, String(s.value), { fontSize: '13px', color: '#e2e8f0' }).setOrigin(0);
      this.detailObjects.push(label, value);
    });
    cy += 100;

    // 掉落表
    const dropLabel = this.add.text(col1X, cy, '掉落物品:', { fontSize: '13px', color: '#94a3b8', fontStyle: 'bold' }).setOrigin(0);
    this.detailObjects.push(dropLabel);
    cy += 24;

    if (entry.dropTableJson) {
      try {
        const drops = JSON.parse(entry.dropTableJson) as { itemId: string; chance: number }[];
        drops.forEach((d, i) => {
          const itemName = ItemDataManager.findById(d.itemId)?.name ?? d.itemId;
          const dropText = this.add.text(col1X + 10, cy + i * 22, `• ${itemName}  (${Math.round(d.chance * 100)}%)`, {
            fontSize: '12px',
            color: '#cbd5e1',
          }).setOrigin(0);
          this.detailObjects.push(dropText);
        });
        cy += drops.length * 22 + 12;
      } catch {
        cy += 4;
      }
    }

    // 击杀记录
    if (entry.firstKillAt) {
      const firstKill = this.add.text(col1X, cy, `首次击杀: ${entry.firstKillAt.slice(0, 10)}`, {
        fontSize: '11px',
        color: '#64748b',
      }).setOrigin(0);
      this.detailObjects.push(firstKill);
      cy += 20;
    }
    if (entry.lastKillAt) {
      const lastKill = this.add.text(col1X, cy, `最近击杀: ${entry.lastKillAt.slice(0, 10)}`, {
        fontSize: '11px',
        color: '#64748b',
      }).setOrigin(0);
      this.detailObjects.push(lastKill);
    }
  }

  private renderEnemyPreview(x: number, y: number, entry: BestiaryEntry) {
    const color = parseInt(entry.colorHex, 16);
    const scale = 1.2;

    const shadow = this.add.ellipse(x + 2 * scale, y + 10 * scale, 28 * scale, 12 * scale, 0x000000, 0.35);
    const body = this.add.ellipse(x, y, 26 * scale, 34 * scale, color);
    const eyeWhiteL = this.add.ellipse(x - 5 * scale, y - 5 * scale, 7 * scale, 9 * scale, 0xffffff);
    const pupilL = this.add.circle(x - 5 * scale, y - 5 * scale, 2.5 * scale, 0x000000);
    const eyeWhiteR = this.add.ellipse(x + 5 * scale, y - 5 * scale, 7 * scale, 9 * scale, 0xffffff);
    const pupilR = this.add.circle(x + 5 * scale, y - 5 * scale, 2.5 * scale, 0x000000);

    this.detailObjects.push(shadow, body, eyeWhiteL, pupilL, eyeWhiteR, pupilR);
  }

  private clearContentUI() {
    for (const obj of this.contentObjects) {
      if (obj.active) obj.destroy();
    }
    this.contentObjects = [];
  }

  private closeScene() {
    // 清理键盘事件（避免重复注册）
    this.input.keyboard!.off('keydown-ESC');
    this.input.keyboard!.off('keydown-V');
    // 清理详情面板
    for (const obj of this.detailObjects) {
      if (obj.active) obj.destroy();
    }
    this.detailObjects = [];
    this.clearContentUI();
    this.scene.stop();
  }
}
