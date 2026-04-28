import type { GameSave, RunState, ClassType, EquipmentSet, InventorySlot } from '../types';
import { SaveManager } from './SaveManager';
import { CLASSES } from '../data/classes';

export class GameState {
  private static instance: GameState;
  save: GameSave;
  run: RunState | null = null;

  private constructor() {
    this.save = SaveManager.load();
  }

  static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState();
    }
    return GameState.instance;
  }

  /** 选择职业 */
  selectClass(classId: ClassType): void {
    this.save.selectedClass = classId;
    this.persist();
  }

  /** 开始一次森林探险 */
  startRun(): void {
    const cls = CLASSES.find((c) => c.id === this.save.selectedClass);
    if (!cls) throw new Error('未选择职业');

    this.run = {
      forestDepth: 1,
      runInventory: Array.from({ length: 18 }, () => ({ item: null })),
      runEquipment: { ...this.save.cityEquipment },
      currentHp: cls.baseStats.maxHp,
      currentMp: cls.baseStats.maxMp,
      fogValue: 0,
      elapsedTime: 0,
      enemiesKilled: 0,
      itemsFound: [],
    };
  }

  /** 安全撤离，将局内收获带回主城 */
  extractRun(): void {
    if (!this.run) return;

    // 合并装备：局内穿戴的装备覆盖回主城
    this.save.cityEquipment = { ...this.run.runEquipment };

    // 合并背包：主城背包优先保留，空位填入局内收获
    for (const slot of this.run.runInventory) {
      if (!slot.item) continue;
      const emptyIdx = this.save.cityInventory.findIndex((s) => !s.item);
      if (emptyIdx >= 0) {
        this.save.cityInventory[emptyIdx] = { item: slot.item };
      }
    }

    // 记录图鉴
    for (const itemId of this.run.itemsFound) {
      if (!this.save.equipmentCodex.includes(itemId)) {
        this.save.equipmentCodex.push(itemId);
      }
    }

    this.run = null;
    this.persist();
  }

  /** 死亡，丢失本次局内所有物品 */
  dieInRun(): void {
    this.run = null;
    this.persist();
  }

  /** 记录击杀怪物 */
  recordKill(enemyId: string): void {
    if (!this.save.bestiary.includes(enemyId)) {
      this.save.bestiary.push(enemyId);
    }
    if (this.run) {
      this.run.enemiesKilled++;
    }
    this.persist();
  }

  /** 记录拾取装备 */
  recordItemFound(itemId: string): void {
    if (this.run) {
      this.run.itemsFound.push(itemId);
    }
  }

  persist(): void {
    SaveManager.save(this.save);
  }

  resetAll(): void {
    SaveManager.reset();
    this.save = SaveManager.load();
    this.run = null;
  }
}
