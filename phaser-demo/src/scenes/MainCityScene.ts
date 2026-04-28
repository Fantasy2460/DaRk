import Phaser from 'phaser';
import { GameState } from '../managers/GameState';
import { EquipmentSystem } from '../systems/EquipmentSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { CLASSES } from '../data/classes';
import { RARITY_COLORS, SLOT_NAMES } from '../config/gameConfig';
import type { Item, Consumable } from '../types';

export class MainCityScene extends Phaser.Scene {
  private equipmentSystem!: EquipmentSystem;
  private inventorySystem!: InventorySystem;
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MainCityScene' });
  }

  create() {
    const state = GameState.getInstance();
    const cls = CLASSES.find((c) => c.id === state.save.selectedClass)!;

    this.equipmentSystem = new EquipmentSystem(state.save.cityEquipment);
    this.inventorySystem = new InventorySystem(state.save.cityInventory);

    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f172a).setOrigin(0);

    this.add.text(30, 20, `主城 - ${cls.name}`, {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    });

    this.add.text(30, 60, `金币: ${state.save.gold}`, {
      fontSize: '16px',
      color: '#fbbf24',
    });

    // 装备栏
    this.add.text(30, 100, '装备', {
      fontSize: '18px',
      color: '#94a3b8',
      fontStyle: 'bold',
    });

    const slots = ['weapon', 'helmet', 'armor', 'pants', 'shoes', 'accessory', 'offhand'] as const;
    slots.forEach((slot, i) => {
      const x = 30 + (i % 4) * 110;
      const y = 135 + Math.floor(i / 4) * 70;
      this.createSlotBox(x, y, slot, this.equipmentSystem.getSlot(slot));
    });

    // 总属性
    const total = this.equipmentSystem.getTotalStats();
    const statsText = `攻击+${total.attack ?? 0}  防御+${total.defense ?? 0}  生命+${total.hp ?? 0}  法力+${total.mp ?? 0}  移速+${total.speed ?? 0}`;
    this.add.text(30, 290, statsText, {
      fontSize: '14px',
      color: '#60a5fa',
    });

    // 背包
    this.add.text(30, 320, `背包 (${this.inventorySystem.slots.filter((s) => s.item).length}/${this.inventorySystem.capacity})`, {
      fontSize: '18px',
      color: '#94a3b8',
      fontStyle: 'bold',
    });

    for (let i = 0; i < 18; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = 30 + col * 70;
      const y = 355 + row * 55;
      const item = this.inventorySystem.slots[i].item;
      this.createInventorySlot(x, y, i, item);
    }

    // 图鉴按钮
    this.add.text(30, 540, `怪物图鉴: ${state.save.bestiary.length} / ?`, {
      fontSize: '14px',
      color: '#a78bfa',
    });
    this.add.text(30, 565, `装备图鉴: ${state.save.equipmentCodex.length} / ?`, {
      fontSize: '14px',
      color: '#a78bfa',
    });

    // 进入森林按钮
    const enterBtn = this.add.text(this.scale.width - 30, this.scale.height - 30, '进入黑暗森林', {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#dc2626',
      padding: { x: 24, y: 12 },
    })
      .setOrigin(1, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => enterBtn.setStyle({ backgroundColor: '#ef4444' }))
      .on('pointerout', () => enterBtn.setStyle({ backgroundColor: '#dc2626' }))
      .on('pointerdown', () => {
        state.startRun();
        this.scene.start('ForestScene');
      });

    // 信息提示区
    this.infoText = this.add.text(this.scale.width / 2, this.scale.height - 80, '', {
      fontSize: '14px',
      color: '#e2e8f0',
      backgroundColor: '#1e293b',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5);
  }

  private createSlotBox(x: number, y: number, slotKey: string, item: Item | null) {
    const bg = this.add.rectangle(x + 40, y + 25, 90, 50, item ? 0x1e293b : 0x0f172a);
    bg.setStrokeStyle(1, item ? RARITY_COLORS[item.rarity] : 0x334155);

    this.add.text(x + 5, y + 2, SLOT_NAMES[slotKey] ?? slotKey, {
      fontSize: '10px',
      color: '#64748b',
    });

    if (item) {
      this.add.text(x + 5, y + 18, item.name, {
        fontSize: '11px',
        color: '#' + RARITY_COLORS[item.rarity].toString(16).padStart(6, '0'),
      });

      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => {
        this.showInfo(`${item.name} [${item.rarity}]\n${item.description}\n${this.formatStats(item.stats)}`);
      });
      bg.on('pointerout', () => this.showInfo(''));
    }
  }

  private createInventorySlot(x: number, y: number, index: number, item: Item | Consumable | null) {
    const bg = this.add.rectangle(x + 30, y + 22, 55, 40, item ? 0x1e293b : 0x0f172a);
    bg.setStrokeStyle(1, item && 'rarity' in item ? RARITY_COLORS[item.rarity] : 0x334155);

    if (item) {
      const name = 'rarity' in item ? item.name : (item as Consumable).name;
      const color = 'rarity' in item ? RARITY_COLORS[(item as Item).rarity] : 0x22c55e;
      this.add.text(x + 4, y + 12, name.slice(0, 4), {
        fontSize: '10px',
        color: '#' + color.toString(16).padStart(6, '0'),
      });

      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => {
        const desc = 'rarity' in item
          ? `${item.name} [${(item as Item).rarity}]\n${item.description}\n${this.formatStats((item as Item).stats)}`
          : `${item.name}\n${(item as Consumable).description}`;
        this.showInfo(desc);
      });
      bg.on('pointerout', () => this.showInfo(''));
    }
  }

  private formatStats(stats: Partial<Record<string, number>>): string {
    return Object.entries(stats)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k === 'hp' ? '生命' : k === 'mp' ? '法力' : k === 'attack' ? '攻击' : k === 'defense' ? '防御' : k === 'speed' ? '移速' : k}: +${v}`)
      .join('  ');
  }

  private showInfo(text: string) {
    this.infoText.setText(text);
  }
}
