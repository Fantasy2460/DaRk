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

test.describe('ForestScene Combat', () => {
  test.beforeEach(async ({ page }) => {
    await enterMainCityAsGuest(page);
    const scene = await getCurrentScene(page);
    expect(scene).toBe('MainCityScene');
  });

  async function enterForest(page: any) {
    // 将玩家移动到传送门附近 (800,1100) 然后按 E
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('MainCityScene');
      const player = scene['player'];
      player.container.x = 800;
      player.container.y = 1050;
    });
    await wait(300);
    await pressKey(page, 'e');
    await waitForScene(page, 'ForestScene', 15000);
    await wait(800);
  }

  test('进入森林场景', async ({ page }) => {
    await enterForest(page);
    const scene = await getCurrentScene(page);
    expect(scene).toBe('ForestScene');
  });

  test('WASD 移动改变玩家坐标', async ({ page }) => {
    await enterForest(page);

    const posBefore = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      return { x: scene['player'].container.x, y: scene['player'].container.y };
    });

    // 按住 D 向右移动一段时间
    await page.keyboard.down('d');
    await wait(800);
    await page.keyboard.up('d');
    await wait(200);

    const posAfter = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      return { x: scene['player'].container.x, y: scene['player'].container.y };
    });

    expect(posAfter.x).toBeGreaterThan(posBefore.x);
  });

  test('空格攻击减少敌人 HP', async ({ page }) => {
    await enterForest(page);

    // 在玩家身边生成一个测试敌人（通过 evaluate 直接操作场景）
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];

      // 使用本地 fallback 模板生成一个哥布林在玩家正前方
      const Enemy = (window as any).Enemy;
      const enemy = new Enemy(
        scene,
        player.container.x + 40,
        player.container.y,
        {
          id: 'goblin',
          name: '哥布林',
          hp: 40,
          attack: 5,
          defense: 2,
          speed: 60,
          aggroRange: 200,
          attackRange: 40,
          color: 0x4ade80,
          isBoss: false,
          dropTable: [],
          expValue: 10,
        }
      );
      scene['enemies'].push(enemy);
    });
    await wait(500);

    // 让敌人进入玩家攻击范围并面向敌人
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      const enemy = scene['enemies'][scene['enemies'].length - 1];
      player.container.x = enemy.container.x - 35;
      player.container.y = enemy.container.y;
      player.faceTo(enemy.container.x, enemy.container.y);
    });
    await wait(200);

    const hpBefore = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const enemy = scene['enemies'][scene['enemies'].length - 1];
      return enemy.container.getData('hp');
    });

    await pressKey(page, ' ');
    await wait(300);

    const hpAfter = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const enemy = scene['enemies'][scene['enemies'].length - 1];
      return enemy.container.getData('hp');
    });

    expect(hpAfter).toBeLessThan(hpBefore);
  });

  test('击杀敌人后掉落物品并增加击杀数', async ({ page }) => {
    await enterForest(page);

    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      player.attack = 999; // 一击必杀

      const Enemy = (window as any).Enemy;
      const enemy = new Enemy(
        scene,
        player.container.x + 35,
        player.container.y,
        {
          id: 'goblin',
          name: '哥布林',
          hp: 1,
          attack: 5,
          defense: 0,
          speed: 60,
          aggroRange: 200,
          attackRange: 40,
          color: 0x4ade80,
          isBoss: false,
          dropTable: [{ itemId: 'rusty_sword', chance: 1.0 }],
          expValue: 10,
        }
      );
      scene['enemies'].push(enemy);
    });
    await wait(500);

    const killsBefore = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      return scene['player'].attack; // 占位，实际在下面取 runState
    });

    const stateBefore = await getGameState(page);
    const killedBefore = stateBefore.run?.enemiesKilled ?? 0;

    // 面向并攻击
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      const enemy = scene['enemies'][scene['enemies'].length - 1];
      player.faceTo(enemy.container.x, enemy.container.y);
    });
    await pressKey(page, ' ');
    await wait(600);

    const stateAfter = await getGameState(page);
    const killedAfter = stateAfter.run?.enemiesKilled ?? 0;
    expect(killedAfter).toBeGreaterThan(killedBefore);

    // 检查是否有掉落物生成
    const dropCount = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      return scene['drops'].length;
    });
    expect(dropCount).toBeGreaterThan(0);
  });

  test('拾取掉落物后进入背包', async ({ page }) => {
    await enterForest(page);

    // 生成一个高攻击玩家和一个带掉落的敌人
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      player.attack = 999;

      const Enemy = (window as any).Enemy;
      const enemy = new Enemy(
        scene,
        player.container.x + 30,
        player.container.y,
        {
          id: 'goblin',
          name: '哥布林',
          hp: 1,
          attack: 5,
          defense: 0,
          speed: 60,
          aggroRange: 200,
          attackRange: 40,
          color: 0x4ade80,
          isBoss: false,
          dropTable: [{ itemId: 'rusty_sword', chance: 1.0 }],
          expValue: 10,
        }
      );
      scene['enemies'].push(enemy);
    });
    await wait(500);

    // 击杀
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      const enemy = scene['enemies'][scene['enemies'].length - 1];
      player.faceTo(enemy.container.x, enemy.container.y);
    });
    await pressKey(page, ' ');
    await wait(800);

    // 移动到掉落物位置（掉落物在敌人死亡位置）
    await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      const player = scene['player'];
      const drop = scene['drops'][scene['drops'].length - 1];
      if (drop) {
        player.container.x = drop.container.x;
        player.container.y = drop.container.y;
      }
    });
    await wait(400);

    const hasItem = await evaluateInPhaser(page, () => {
      const game = (window as any).game;
      const scene = game.scene.getScene('ForestScene');
      return scene['runInventory'].slots.some((s: any) => s.item !== null);
    });
    expect(hasItem).toBe(true);
  });
});
