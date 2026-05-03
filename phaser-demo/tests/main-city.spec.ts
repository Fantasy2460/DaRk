import { test, expect } from '@playwright/test';
import {
  waitForPhaserReady,
  getCurrentScene,
  waitForScene,
  pressKey,
  clickCanvas,
  rightClickCanvas,
  wait,
  enterMainCityAsGuest,
  getGameState,
  setGameStateForTest,
  evaluateInPhaser,
} from './fixtures';

test.describe('MainCityScene', () => {
  test.beforeEach(async ({ page }) => {
    await enterMainCityAsGuest(page);
    const scene = await getCurrentScene(page);
    expect(scene).toBe('MainCityScene');
  });

  test('按 B 键打开/关闭背包', async ({ page }) => {
    // 打开背包
    await pressKey(page, 'b');
    await wait(600);

    const bagOpen = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return scene?.bagOpen ?? false;
    });
    expect(bagOpen).toBe(true);

    // 关闭背包（按 B）
    await pressKey(page, 'b');
    await wait(400);

    const bagClosed = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return scene?.bagOpen ?? false;
    });
    expect(bagClosed).toBe(false);
  });

  test('按 ESC 关闭背包', async ({ page }) => {
    await pressKey(page, 'b');
    await wait(600);

    const bagOpen1 = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return scene?.bagOpen ?? false;
    });
    expect(bagOpen1).toBe(true);

    await pressKey(page, 'Escape');
    await wait(400);

    const bagClosed = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return scene?.bagOpen ?? false;
    });
    expect(bagClosed).toBe(false);
  });

  test('穿戴装备后 cityEquipment 对应部位有物品', async ({ page }) => {
    // 前置：给玩家一把武器在背包第 0 格
    const testSword = {
      id: 'test_iron_sword',
      name: '测试铁剑',
      rarity: 'B',
      slot: 'weapon',
      stats: { attack: 10 },
      description: '测试用剑',
    };

    await setGameStateForTest(page, {
      save: {
        cityInventory: [{ item: testSword }, ...Array.from({ length: 23 }, () => ({ item: null }))],
      },
    });

    await pressKey(page, 'b');
    await wait(800);

    // 通过 evaluate 在浏览器端执行穿戴
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      // 模拟左键点击背包第 0 格（装备 → 穿戴）
      scene['equipFromCity'](0, {
        id: 'test_iron_sword',
        name: '测试铁剑',
        rarity: 'B',
        slot: 'weapon',
        stats: { attack: 10 },
        description: '测试用剑',
      });
    });
    await wait(600);

    const state = await getGameState(page);
    expect(state.save.cityEquipment.weapon).not.toBeNull();
    expect(state.save.cityEquipment.weapon.name).toBe('测试铁剑');
  });

  test('卸下装备后 cityEquipment 对应部位为空', async ({ page }) => {
    const testSword = {
      id: 'test_iron_sword',
      name: '测试铁剑',
      rarity: 'B',
      slot: 'weapon',
      stats: { attack: 10 },
      description: '测试用剑',
    };

    await setGameStateForTest(page, {
      save: {
        cityEquipment: { weapon: testSword, helmet: null, armor: null, pants: null, shoes: null, accessory: null, offhand: null },
        cityInventory: Array.from({ length: 24 }, () => ({ item: null })),
      },
    });

    await pressKey(page, 'b');
    await wait(800);

    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      scene['unequipFromCity']('weapon');
    });
    await wait(600);

    const state = await getGameState(page);
    expect(state.save.cityEquipment.weapon).toBeNull();
    // 卸下后应回到背包
    const hasInBag = state.save.cityInventory.some((s: any) => s.item && s.item.id === 'test_iron_sword');
    expect(hasInBag).toBe(true);
  });

  test('背包满时无法卸下装备', async ({ page }) => {
    const testSword = {
      id: 'test_iron_sword',
      name: '测试铁剑',
      rarity: 'B',
      slot: 'weapon',
      stats: { attack: 10 },
      description: '测试用剑',
    };

    // 塞满 24 格背包
    const fullInventory = Array.from({ length: 24 }, (_, i) => ({
      item: { id: `filler_${i}`, name: `填充${i}`, rarity: 'C', slot: 'accessory', stats: {}, description: '' },
    }));

    await setGameStateForTest(page, {
      save: {
        cityEquipment: { weapon: testSword, helmet: null, armor: null, pants: null, shoes: null, accessory: null, offhand: null },
        cityInventory: fullInventory,
      },
    });

    await pressKey(page, 'b');
    await wait(800);

    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      scene['unequipFromCity']('weapon');
    });
    await wait(600);

    const state = await getGameState(page);
    // 装备应仍在身上
    expect(state.save.cityEquipment.weapon).not.toBeNull();
    expect(state.save.cityEquipment.weapon.name).toBe('测试铁剑');
  });

  test('右键物品弹出菜单，点击空白处关闭', async ({ page }) => {
    const testItem = {
      id: 'test_item',
      name: '测试物品',
      rarity: 'C',
      slot: 'accessory',
      stats: {},
      description: '测试用',
    };

    await setGameStateForTest(page, {
      save: {
        cityInventory: [{ item: testItem }, ...Array.from({ length: 23 }, () => ({ item: null }))],
      },
    });

    await pressKey(page, 'b');
    await wait(800);

    // 右键点击背包第 0 格（屏幕坐标约 500,240）
    await rightClickCanvas(page, 500, 240);
    await wait(300);

    const menuVisible = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return (scene['contextMenuUI'] as any[]).length > 0;
    });
    expect(menuVisible).toBe(true);

    // 点击空白处关闭（背包 overlay 会关闭整个背包，但这里点击菜单外背包内区域）
    // 由于右键菜单通过 pointerdown 关闭，直接点另一个位置
    await clickCanvas(page, 200, 200);
    await wait(300);

    const menuClosed = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      return (scene['contextMenuUI'] as any[]).length === 0;
    });
    expect(menuClosed).toBe(true);
  });
});
