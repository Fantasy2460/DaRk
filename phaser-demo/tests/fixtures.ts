import { Page, expect } from '@playwright/test';

/**
 * 等待 Phaser 游戏初始化完成
 */
export async function waitForPhaserReady(page: Page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return canvas !== null && (window as any).game !== undefined;
    },
    { timeout }
  );
}

/**
 * 获取 Phaser 游戏实例（需在浏览器中执行）
 */
export function getPhaserGame(page: Page) {
  return page.evaluate(() => (window as any).game);
}

/**
 * 获取当前活跃场景
 */
export async function getCurrentScene(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const game = (window as any).game;
    if (!game) return null;
    const scene = game.scene.getScenes(true)[0];
    return scene?.scene?.key ?? null;
  });
}

/**
 * 等待场景切换
 */
export async function waitForScene(page: Page, sceneKey: string, timeout = 15000) {
  await page.waitForFunction(
    (key) => {
      const game = (window as any).game;
      if (!game) return false;
      const scenes = game.scene.getScenes(true);
      return scenes.some((s: any) => s.scene.key === key);
    },
    sceneKey,
    { timeout }
  );
}

/**
 * 通过 evaluate 在浏览器端操作 Phaser 场景
 * 用于绕过 Canvas 渲染限制
 */
export async function evaluateInPhaser<T>(page: Page, fn: () => T): Promise<T> {
  return page.evaluate(fn);
}

/**
 * 模拟键盘按键
 */
export async function pressKey(page: Page, key: string) {
  await page.keyboard.press(key);
}

/**
 * 模拟在 Canvas 上点击（屏幕坐标）
 */
export async function clickCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x, y } });
}

/**
 * 模拟在 Canvas 上右键点击
 */
export async function rightClickCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x, y }, button: 'right' });
}

/**
 * 等待指定时间
 */
export async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 游客模式快速进入主城：
 * 1. 点击 BootScene 任意键开始
 * 2. 点击游客模式
 * 3. 选择职业
 * 4. 开始游戏
 */
export async function enterMainCityAsGuest(page: Page) {
  await page.goto('/');
  await waitForPhaserReady(page);
  await wait(500);

  // BootScene：按任意键开始
  await pressKey(page, 'Space');
  await wait(600);

  // 等待 LoginScene
  await waitForScene(page, 'LoginScene', 10000);
  await wait(500);

  // 点击「游客模式（离线）」按钮（LoginScene 中 y=420 附近）
  await clickCanvas(page, 480, 390);
  await wait(800);

  // 等待 MainMenuScene
  await waitForScene(page, 'MainMenuScene', 10000);
  await wait(500);

  // 选择战士职业（x=260, y=260）
  await clickCanvas(page, 260, 260);
  await wait(300);

  // 点击开始游戏（x=480, y=540）
  await clickCanvas(page, 480, 540);
  await waitForScene(page, 'MainCityScene', 10000);

  await wait(1000);
}

/**
 * 获取 GameState 的当前状态（用于断言）
 */
export async function getGameState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const game = (window as any).game;
    if (!game) return null;
    // 通过全局暴露的 GameState 获取
    const GameState = (window as any).GameState;
    if (GameState) {
      const instance = GameState.getInstance();
      return {
        save: instance.save,
        run: instance.run,
      };
    }
    return null;
  });
}

/**
 * 在浏览器端直接修改 GameState（用于测试前置条件）
 */
export async function setGameStateForTest(page: Page, patch: any) {
  await page.evaluate((patchData) => {
    const GameState = (window as any).GameState;
    if (!GameState) return;
    const instance = GameState.getInstance();
    if (patchData.save) {
      Object.assign(instance.save, patchData.save);
    }
    if (patchData.run) {
      Object.assign(instance.run, patchData.run);
    }
  }, patch);
}
