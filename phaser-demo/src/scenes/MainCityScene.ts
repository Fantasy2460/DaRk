import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { SaveManager } from '../managers/SaveManager';
import { api } from '../network/ApiClient';
import { Player } from '../entities/Player';
import { EquipmentSystem } from '../systems/EquipmentSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { CLASSES } from '../data/classes';
import { ITEMS, CONSUMABLES } from '../data/items';
import { GAME_CONFIG, RARITY_COLORS, SLOT_NAMES } from '../config/gameConfig';
import type { Item, Consumable } from '../types';

interface NPCConfig {
  id: string;
  name: string;
  x: number;
  y: number;
  color: number;
  shopType: 'weapon' | 'armor' | 'potion';
  greeting: string;
}

const NPCS: NPCConfig[] = [
  {
    id: 'blacksmith',
    name: '铁匠格雷',
    x: 300,
    y: 440,
    color: 0x8b4513,
    shopType: 'weapon',
    greeting: '想要一把好武器吗？',
  },
  {
    id: 'armorer',
    name: '防具师艾拉',
    x: 1100,
    y: 440,
    color: 0x475569,
    shopType: 'armor',
    greeting: '防护是最好的进攻。',
  },
  {
    id: 'alchemist',
    name: '炼金术士摩恩',
    x: 300,
    y: 1040,
    color: 0x16a34a,
    shopType: 'potion',
    greeting: '药水能救你的命。',
  },
];

const SHOP_ITEMS: Record<string, (Item | Consumable)[]> = {
  weapon: [
    ITEMS.find((i) => i.id === 'rusty_sword')!,
    ITEMS.find((i) => i.id === 'wooden_staff')!,
    ITEMS.find((i) => i.id === 'cracked_wand')!,
    ITEMS.find((i) => i.id === 'iron_sword')!,
    ITEMS.find((i) => i.id === 'shadow_dagger')!,
  ],
  armor: [
    ITEMS.find((i) => i.id === 'cloth_helm')!,
    ITEMS.find((i) => i.id === 'leather_armor')!,
    ITEMS.find((i) => i.id === 'cloth_pants')!,
    ITEMS.find((i) => i.id === 'old_boots')!,
    ITEMS.find((i) => i.id === 'iron_helm')!,
    ITEMS.find((i) => i.id === 'chain_armor')!,
    ITEMS.find((i) => i.id === 'leather_boots')!,
    ITEMS.find((i) => i.id === 'wooden_shield')!,
    ITEMS.find((i) => i.id === 'iron_shield')!,
  ],
  potion: [
    CONSUMABLES.find((i) => i.id === 'hp_potion_small')!,
    CONSUMABLES.find((i) => i.id === 'hp_potion_large')!,
    CONSUMABLES.find((i) => i.id === 'mp_potion_small')!,
    CONSUMABLES.find((i) => i.id === 'mp_potion_large')!,
    CONSUMABLES.find((i) => i.id === 'regen_potion')!,
    CONSUMABLES.find((i) => i.id === 'mana_regen_potion')!,
    CONSUMABLES.find((i) => i.id === 'vision_potion')!,
  ],
};

const SHOP_PRICES: Record<string, number> = {
  rusty_sword: 50,
  wooden_staff: 50,
  cracked_wand: 50,
  cloth_helm: 40,
  leather_armor: 60,
  cloth_pants: 40,
  old_boots: 40,
  wooden_shield: 40,
  iron_sword: 150,
  shadow_dagger: 150,
  iron_helm: 120,
  chain_armor: 180,
  leather_boots: 100,
  iron_shield: 120,
  hp_potion_small: 30,
  hp_potion_large: 80,
  mp_potion_small: 30,
  mp_potion_large: 80,
  regen_potion: 60,
  mana_regen_potion: 60,
  vision_potion: 100,
};

export class MainCityScene extends Phaser.Scene {
  private player!: Player;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private npcs: { config: NPCConfig; container: Phaser.GameObjects.Container; interactHint?: Phaser.GameObjects.Text }[] = [];
  private shopOpen = false;
  private shopUI: Phaser.GameObjects.GameObject[] = [];
  private bagOpen = false;
  private bagUI: Phaser.GameObjects.GameObject[] = [];
  private infoText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MainCityScene' });
  }

  create() {
    const state = GameState.getInstance();
    if (!state.save.selectedClass) {
      this.scene.start('MainMenuScene');
      return;
    }

    this.createGround();
    this.createBuildings();
    this.createFountain();
    this.createForestEntrance();
    this.createNPCs();
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.createHUD();
  }

  private createGround() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0xf5f5dc, 1);
    graphics.fillRect(0, 0, 1600, 1200);

    for (let x = 0; x < 1600; x += 80) {
      for (let y = 0; y < 1200; y += 80) {
        if ((x / 80 + y / 80) % 2 === 0) {
          graphics.fillStyle(0xeae6ca, 1);
          graphics.fillRect(x, y, 80, 80);
        }
      }
    }

    graphics.fillStyle(0x90ee90, 1);
    graphics.fillRect(0, 0, 1600, 40);
    graphics.fillRect(0, 1160, 1600, 40);
    graphics.fillRect(0, 0, 40, 1200);
    graphics.fillRect(1560, 0, 40, 1200);
  }

  private createBuildings() {
    this.createBuilding(200, 170, 200, 160, 0xdc2626, '武器店');
    this.createBuilding(1000, 170, 200, 160, 0x2563eb, '防具店');
    this.createBuilding(200, 770, 200, 160, 0x16a34a, '药水店');
  }

  private createBuilding(x: number, y: number, w: number, h: number, roofColor: number, label: string) {
    const container = this.add.container(x, y);

    const shadow = this.add.rectangle(8, 8, w, h, 0x000000, 0.15).setOrigin(0);
    const wall = this.add.rectangle(0, 40, w, h - 40, 0xf5e6d3).setOrigin(0);
    const roof = this.add.rectangle(0, 0, w, 50, roofColor).setOrigin(0);
    const door = this.add.rectangle(w / 2 - 20, h - 50, 40, 50, 0x8b4513).setOrigin(0);
    const sign = this.add.text(w / 2, 25, label, { fontSize: '16px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);

    container.add([shadow, wall, roof, door, sign]);
    container.setDepth(y + h);
  }

  private createFountain() {
    const container = this.add.container(800, 550);

    const base = this.add.ellipse(0, 0, 120, 40, 0x94a3b8);
    const rim = this.add.ellipse(0, -5, 100, 30, 0x64748b);
    const water = this.add.ellipse(0, -5, 90, 25, 0x3b82f6, 0.8);
    const pillar = this.add.rectangle(0, -25, 12, 30, 0x94a3b8);
    const spray = this.add.ellipse(0, -35, 8, 8, 0x93c5fd);

    container.add([base, rim, water, pillar, spray]);
    container.setDepth(550);

    this.tweens.add({
      targets: spray,
      y: -45,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: water,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createForestEntrance() {
    const container = this.add.container(800, 1100);

    const leftPillar = this.add.rectangle(-60, 0, 30, 80, 0x1e293b);
    const rightPillar = this.add.rectangle(60, 0, 30, 80, 0x1e293b);
    const topArch = this.add.ellipse(0, -30, 150, 60, 0x1e293b);
    const darkness = this.add.ellipse(0, 10, 100, 60, 0x0f0f23);
    const glow = this.add.ellipse(0, 0, 140, 90, 0xdc2626, 0.2);

    container.add([leftPillar, rightPillar, topArch, darkness, glow]);
    container.setDepth(1100);

    this.add.text(800, 1040, '黑暗森林入口', { fontSize: '14px', color: '#ef4444' }).setOrigin(0.5).setDepth(1101);

    this.tweens.add({
      targets: glow,
      alpha: 0.5,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 1500,
      yoyo: true,
      repeat: -1,
    });
  }

  private createNPCs() {
    for (const config of NPCS) {
      const container = this.add.container(config.x, config.y);

      const body = this.add.rectangle(0, 0, 20, 24, config.color);
      const head = this.add.ellipse(0, -14, 16, 14, 0xffd6a5);
      const nameTag = this.add.text(0, -32, config.name, { fontSize: '12px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 4, y: 2 } }).setOrigin(0.5);

      container.add([body, head, nameTag]);
      container.setDepth(config.y);

      const interactHint = this.add.text(config.x, config.y - 45, '按 E 交谈', {
        fontSize: '11px',
        color: '#fbbf24',
        backgroundColor: '#000000aa',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setVisible(false).setDepth(2000);

      this.npcs.push({ config, container, interactHint });
    }
  }

  private createPlayer() {
    const state = GameState.getInstance();
    this.player = new Player(this, 800, 700, state.save.selectedClass!, state.save.level);
    this.player.body.setBoundsRectangle(new Phaser.Geom.Rectangle(40, 40, 1520, 1120));
  }

  private setupCamera() {
    this.cameras.main.startFollow(this.player.container, true, 0.1, 0.1);
    this.cameras.main.setBounds(0, 0, 1600, 1200);
    this.cameras.main.setZoom(1.2);
  }

  private setupInput() {
    this.keys = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      E: Phaser.Input.Keyboard.KeyCodes.E,
      B: Phaser.Input.Keyboard.KeyCodes.B,
      ESC: Phaser.Input.Keyboard.KeyCodes.ESC,
      K: Phaser.Input.Keyboard.KeyCodes.K,
      N: Phaser.Input.Keyboard.KeyCodes.N,
      C: Phaser.Input.Keyboard.KeyCodes.C,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private createHUD() {
    const cam = this.cameras.main;

    this.goldText = this.add.text(20, 20, '', { fontSize: '16px', color: '#fbbf24' })
      .setScrollFactor(0).setDepth(2000);
    this.levelText = this.add.text(20, 44, '', { fontSize: '14px', color: '#fbbf24' })
      .setScrollFactor(0).setDepth(2000);

    this.add.text(20, cam.height - 30, 'WASD 移动 | E 交互 | B 背包 | K/N 技能 | C 属性 | 靠近红色入口按 E 进入森林', {
      fontSize: '12px', color: '#64748b',
    }).setScrollFactor(0).setDepth(2000);

    this.infoText = this.add.text(cam.width / 2, cam.height - 60, '', {
      fontSize: '14px', color: '#e2e8f0', backgroundColor: '#1e293b', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);
  }

  update(_time: number, delta: number) {
    if (this.shopOpen || this.bagOpen) return;

    this.handleMovement();
    this.handleInteraction();
    this.handleSpecialInput();
    this.player.update(delta);
    this.updateHUD();
  }

  private handleMovement() {
    let vx = 0, vy = 0;
    if (this.keys.W.isDown) vy = -1;
    if (this.keys.S.isDown) vy = 1;
    if (this.keys.A.isDown) vx = -1;
    if (this.keys.D.isDown) vx = 1;
    this.player.move(vx, vy);
  }

  private handleInteraction() {
    const px = this.player.container.x;
    const py = this.player.container.y;

    let nearNPC = false;
    for (const npc of this.npcs) {
      const dist = Phaser.Math.Distance.Between(px, py, npc.container.x, npc.container.y);
      if (dist < 60) {
        nearNPC = true;
        npc.interactHint?.setVisible(true);
        if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
          this.openShop(npc.config);
        }
      } else {
        npc.interactHint?.setVisible(false);
      }
    }

    const entranceDist = Phaser.Math.Distance.Between(px, py, 800, 1100);
    if (entranceDist < 80 && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      const state = GameState.getInstance();
      state.startRun();
      this.scene.start('ForestScene');
    }

    if (!nearNPC && entranceDist >= 80) {
      this.infoText.setText('');
    } else if (entranceDist < 80) {
      this.infoText.setText('按 E 进入黑暗森林');
    }
  }

  private async handleSpecialInput() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      await this.toggleBag();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.K) || Phaser.Input.Keyboard.JustDown(this.keys.N)) {
      this.scene.start('SkillScene');
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
      this.scene.start('CharacterScene');
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      if (this.shopOpen) this.closeShop();
      if (this.bagOpen) this.closeBag();
    }
  }

  private updateHUD() {
    const state = GameState.getInstance();
    this.goldText.setText(`金币: ${state.save.gold}`);
    this.levelText.setText(`等级: ${state.save.level}`);
  }

  // ========== 商店 ==========

  private openShop(npc: NPCConfig) {
    if (this.shopOpen) return;
    this.shopOpen = true;

    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    const overlay = this.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(3000).setInteractive();
    this.shopUI.push(overlay);

    const panel = this.add.rectangle(cx, cy, 520, 420, 0x1e293b)
      .setScrollFactor(0).setDepth(3001);
    this.shopUI.push(panel);

    const title = this.add.text(cx, cy - 185, `${npc.name} - ${npc.greeting}`, {
      fontSize: '18px', color: '#e2e8f0', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3002);
    this.shopUI.push(title);

    const closeHint = this.add.text(cx, cy + 190, '按 ESC 或点击空白处关闭', {
      fontSize: '12px', color: '#64748b',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3002);
    this.shopUI.push(closeHint);

    const items = SHOP_ITEMS[npc.shopType] ?? [];
    const startX = cx - 220;
    const startY = cy - 140;
    const colW = 220;
    const rowH = 55;

    for (let i = 0; i < items.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col * colW + colW / 2;
      const y = startY + row * rowH + rowH / 2;

      const item = items[i];
      const price = SHOP_PRICES[item.id] ?? 100;
      const isEquip = 'rarity' in item;
      const color = isEquip ? RARITY_COLORS[(item as Item).rarity] : 0x22c55e;

      const itemBg = this.add.rectangle(x, y, colW - 16, rowH - 8, 0x0f172a)
        .setScrollFactor(0).setDepth(3002).setStrokeStyle(1, color);
      this.shopUI.push(itemBg);

      const nameText = this.add.text(x - colW / 2 + 12, y - 10, item.name, {
        fontSize: '12px', color: '#' + color.toString(16).padStart(6, '0'),
      }).setScrollFactor(0).setDepth(3003);
      this.shopUI.push(nameText);

      const descText = this.add.text(x - colW / 2 + 12, y + 4, isEquip ? (item as Item).description.slice(0, 16) + '...' : (item as Consumable).description.slice(0, 16) + '...', {
        fontSize: '10px', color: '#94a3b8',
      }).setScrollFactor(0).setDepth(3003);
      this.shopUI.push(descText);

      const priceText = this.add.text(x + colW / 2 - 12, y, `${price}G`, {
        fontSize: '12px', color: '#fbbf24',
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(3003);
      this.shopUI.push(priceText);

      itemBg.setInteractive({ useHandCursor: true });
      itemBg.on('pointerover', () => {
        itemBg.setFillStyle(0x1e293b);
        this.showInfo(`${item.name} - ${isEquip ? (item as Item).description : (item as Consumable).description}\n价格: ${price} 金币`);
      });
      itemBg.on('pointerout', () => {
        itemBg.setFillStyle(0x0f172a);
        this.showInfo('');
      });
      itemBg.on('pointerdown', () => this.buyItem(item, price));
    }

    overlay.on('pointerdown', () => this.closeShop());
  }

  private buyItem(item: Item | Consumable, price: number) {
    const state = GameState.getInstance();
    if (state.save.gold < price) {
      this.showInfo('金币不足！');
      return;
    }

    const emptyIdx = state.save.cityInventory.findIndex((s) => !s.item);
    if (emptyIdx < 0) {
      this.showInfo('背包已满！');
      return;
    }

    state.save.gold -= price;
    state.save.cityInventory[emptyIdx] = { item: { ...item } };
    state.persist();
    this.showInfo(`购买成功: ${item.name}`);
  }

  private closeShop() {
    this.shopOpen = false;
    for (const obj of this.shopUI) {
      if (obj.active) obj.destroy();
    }
    this.shopUI = [];
    this.showInfo('');
  }

  // ========== 背包 ==========

  private async toggleBag() {
    if (this.bagOpen) {
      this.closeBag();
    } else {
      await this.openBag();
    }
  }

  private closeBag() {
    this.bagOpen = false;
    if (this.infoText && this.infoText.active) {
      const cam = this.cameras.main;
      this.infoText.setPosition(cam.width / 2, cam.height - 60).setDepth(2000).setText('');
    }
    for (const obj of this.bagUI) {
      if (obj.active) obj.destroy();
    }
    this.bagUI = [];
  }

  private async openBag() {
    if (this.bagOpen) return;
    this.bagOpen = true;

    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    if (this.infoText && this.infoText.active) {
      this.infoText.setPosition(cx, cy + 160).setDepth(4004).setText('');
    }

    const overlay = this.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(4000).setInteractive();
    this.bagUI.push(overlay);

    const panel = this.add.rectangle(cx, cy, 560, 420, 0x1e293b)
      .setScrollFactor(0).setDepth(4001);
    this.bagUI.push(panel);

    const title = this.add.text(cx, cy - 190, '背 包', { fontSize: '24px', color: '#e2e8f0', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(title);

    const closeHint = this.add.text(cx, cy + 195, '按 B 或 ESC 关闭', { fontSize: '12px', color: '#64748b' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(closeHint);

    // 加载指示器
    const loadingText = this.add.text(cx, cy, '加载中...', {
      fontSize: '16px', color: '#94a3b8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
    this.bagUI.push(loadingText);

    overlay.on('pointerdown', () => this.closeBag());

    // 从后端查询背包与装备数据
    let cityInventory = GameState.getInstance().save.cityInventory;
    let cityEquipment = GameState.getInstance().save.cityEquipment;

    const characterId = SaveManager.getCharacterId();
    if (characterId && api.getToken()) {
      try {
        const data = await api.getCharacterInventory(characterId);
        if (data?.cityInventory) cityInventory = data.cityInventory;
        if (data?.cityEquipment) cityEquipment = data.cityEquipment;
      } catch (e) {
        console.warn('从服务器获取背包失败，使用本地数据:', e);
      }
    }

    // 清理加载指示器
    if (loadingText.active) {
      loadingText.destroy();
      this.bagUI = this.bagUI.filter((obj) => obj !== loadingText);
    }
    if (!this.bagOpen) return; // 加载过程中用户已关闭背包

    const eq = new EquipmentSystem(cityEquipment);
    const inv = new InventorySystem(cityInventory);

    const slots = ['weapon', 'helmet', 'armor', 'pants', 'shoes', 'accessory', 'offhand'] as const;
    const eqStartX = cx - 240;
    const eqStartY = cy - 150;

    const eqTitle = this.add.text(eqStartX + 60, eqStartY - 25, '装备', { fontSize: '14px', color: '#94a3b8', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(eqTitle);

    slots.forEach((slot, i) => {
      const x = eqStartX + 60;
      const y = eqStartY + i * 48;
      const item = eq.getSlot(slot);

      const bg = this.add.rectangle(x, y, 120, 40, item ? 0x1e293b : 0x0f172a)
        .setScrollFactor(0).setDepth(4002);
      bg.setStrokeStyle(1, item ? RARITY_COLORS[item.rarity] : 0x334155);
      this.bagUI.push(bg);

      const label = this.add.text(x - 56, y - 14, SLOT_NAMES[slot] ?? slot, { fontSize: '10px', color: '#64748b' })
        .setScrollFactor(0).setDepth(4003);
      this.bagUI.push(label);

      if (item) {
        const nameText = this.add.text(x - 56, y - 2, item.name.slice(0, 6), {
          fontSize: '11px',
          color: '#' + RARITY_COLORS[item.rarity].toString(16).padStart(6, '0'),
        }).setScrollFactor(0).setDepth(4003);
        this.bagUI.push(nameText);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          this.showInfo(`${item.name} [${item.rarity}]\n${item.description}\n${this.formatStats(item.stats)}`);
        });
        bg.on('pointerout', () => this.showInfo(''));
      }
    });

    const total = eq.getTotalStats();
    const statsText = `攻击+${total.attack ?? 0}  防御+${total.defense ?? 0}  生命+${total.hp ?? 0}  法力+${total.mp ?? 0}  移速+${total.speed ?? 0}`;
    const statsLabel = this.add.text(eqStartX + 60, eqStartY + 7 * 48 + 10, statsText, {
      fontSize: '11px', color: '#60a5fa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
    this.bagUI.push(statsLabel);

    const invStartX = cx - 60;
    const invStartY = cy - 150;
    const cellW = 72;
    const cellH = 50;

    const invTitle = this.add.text(invStartX + cellW * 2, invStartY - 25, '物品', {
      fontSize: '14px', color: '#94a3b8', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    this.bagUI.push(invTitle);

    for (let i = 0; i < inv.capacity; i++) {
      const col = i % GAME_CONFIG.inventoryCols;
      const row = Math.floor(i / GAME_CONFIG.inventoryCols);
      const x = invStartX + col * cellW + cellW / 2;
      const y = invStartY + row * cellH + cellH / 2;
      const slotItem = inv.slots[i].item;

      const bg = this.add.rectangle(x, y, cellW - 4, cellH - 4, slotItem ? 0x1e293b : 0x0f172a)
        .setScrollFactor(0).setDepth(4002);
      bg.setStrokeStyle(1, slotItem && 'rarity' in slotItem ? RARITY_COLORS[(slotItem as Item).rarity] : 0x334155);
      this.bagUI.push(bg);

      if (slotItem) {
        const color = 'rarity' in slotItem ? RARITY_COLORS[(slotItem as Item).rarity] : 0x22c55e;
        const nameText = this.add.text(x, y, slotItem.name.slice(0, 4), {
          fontSize: '10px',
          color: '#' + color.toString(16).padStart(6, '0'),
        }).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
        this.bagUI.push(nameText);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          const desc = 'rarity' in slotItem
            ? `${slotItem.name} [${(slotItem as Item).rarity}]\n${slotItem.description}\n${this.formatStats((slotItem as Item).stats)}`
            : `${slotItem.name}\n${(slotItem as Consumable).description}`;
          this.showInfo(desc);
        });
        bg.on('pointerout', () => this.showInfo(''));
      }
    }
  }

  private showInfo(text: string) {
    if (this.infoText && this.infoText.active) {
      this.infoText.setText(text);
    }
  }

  private formatStats(stats: Partial<Record<string, number>>): string {
    return Object.entries(stats)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k === 'hp' ? '生命' : k === 'mp' ? '法力' : k === 'attack' ? '攻击' : k === 'defense' ? '防御' : k === 'speed' ? '移速' : k}: +${v}`)
      .join('  ');
  }
}
