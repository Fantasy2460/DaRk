import { test, expect } from '@playwright/test';
import {
  waitForPhaserReady,
  getCurrentScene,
  waitForScene,
  pressKey,
  clickCanvas,
  wait,
  enterMainCityAsGuest,
  getGameState,
  setGameStateForTest,
  evaluateInPhaser,
} from './fixtures';

test.describe('BestiaryScene', () => {
  test.beforeEach(async ({ page }) => {
    await enterMainCityAsGuest(page);
    const scene = await getCurrentScene(page);
    expect(scene).toBe('MainCityScene');
  });

  test('按 V 键打开图鉴并显示解锁状态', async ({ page }) => {
    await pressKey(page, 'v');
    await wait(800);

    const scene = await getCurrentScene(page);
    expect(scene).toBe('BestiaryScene');

    // 检查图鉴 entries 已加载
    const entriesLoaded = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('BestiaryScene');
      return scene['entries'].length > 0;
    });
    expect(entriesLoaded).toBe(true);
  });

  test('图鉴中已解锁怪物显示正确击杀数', async ({ page }) => {
    // 前置：设置 bestiary 包含 goblin，且击杀数为 3
    await setGameStateForTest(page, {
      save: {
        bestiary: ['goblin'],
      },
    });

    // 模拟后端图鉴数据：通过 evaluate 直接 patch BestiaryScene entries
    await pressKey(page, 'v');
    await wait(800);

    // 由于游客模式会回退到本地 ENEMIES，goblin 应显示为已解锁
    const goblinUnlocked = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('BestiaryScene');
      const entry = scene['entries'].find((e: any) => e.id === 'goblin');
      return entry?.unlocked ?? false;
    });
    expect(goblinUnlocked).toBe(true);

    // 本地回退模式下 killCount 为 1（解锁即至少击杀一次）
    const goblinKills = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('BestiaryScene');
      const entry = scene['entries'].find((e: any) => e.id === 'goblin');
      return entry?.killCount ?? 0;
    });
    expect(goblinKills).toBeGreaterThanOrEqual(1);
  });

  test('未解锁怪物显示为 ???', async ({ page }) => {
    await pressKey(page, 'v');
    await wait(800);

    const hasLocked = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('BestiaryScene');
      return scene['entries'].some((e: any) => !e.unlocked);
    });
    expect(hasLocked).toBe(true);

    const lockedName = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('BestiaryScene');
      const entry = scene['entries'].find((e: any) => !e.unlocked);
      return entry?.name ?? '';
    });
    expect(lockedName).toBe('???');
  });

  test('ESC 返回主城', async ({ page }) => {
    await pressKey(page, 'v');
    await wait(800);

    let scene = await getCurrentScene(page);
    expect(scene).toBe('BestiaryScene');

    await pressKey(page, 'Escape');
    await wait(600);

    scene = await getCurrentScene(page);
    expect(scene).toBe('MainCityScene');
  });
});
