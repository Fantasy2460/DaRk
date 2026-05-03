import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createCharacter, getCharactersByUser, getCharacterWithSave, saveCharacterData, getCharacterInventory, getCharacterSkills, getCharacterStats, calculateCharacterStats, getCharacterSnapshot, getCharacterOwner, handleKillEnemy, handleScenarioLoot, handleEquip, handleUnequip, handleMove, handleSort, handleDiscard, handleUseItem } from '../services/CharacterService';
import { prisma } from '../config/database';
import { gainExp, isAllowedSource } from '../services/ExpService';
import { flagAnomaly } from '../services/AntiCheatService';

const router = Router();

// 获取当前用户的所有角色
router.get('/list', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const characters = await getCharactersByUser(req.userId!);
    res.json({ characters });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 创建角色
router.post('/create', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, classType } = req.body;
    if (!name || !classType) {
      res.status(400).json({ error: '缺少角色名或职业' });
      return;
    }
    const character = await createCharacter(req.userId!, name, classType);
    res.json({ character });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 获取角色存档（GameSave 格式）
router.get('/:id/save', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const save = await getCharacterWithSave(req.params.id);
    if (!save) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    res.json({ save });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 启动期快照：一次性返回完整 GameSave + 详细 character/stats/skills/bestiary/codex
// 用于前端登录后整体加载，替代旧 /:id/save（旧端点保留作为兼容）
router.get('/:id/snapshot', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const startTime = Date.now();

  try {
    // 归属校验
    const ownerId = await getCharacterOwner(characterId);
    if (ownerId === null) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerId !== userId) {
      console.warn(`[${new Date().toISOString()}] [快照请求] 用户=${userId} | 角色=${characterId} | 拒绝=非角色拥有者`);
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'GET /characters/:id/snapshot',
          actualOwner: ownerId,
          requestedBy: userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权访问该角色' });
      return;
    }

    const snapshot = await getCharacterSnapshot(characterId);
    if (!snapshot) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }

    const equipCount = Object.values(snapshot.cityEquipment).filter((i) => i !== null).length;
    const invCount = snapshot.cityInventory.filter((s) => s.item !== null).length;
    console.log(`[${new Date().toISOString()}] [快照请求] 用户=${userId} | 角色=${characterId} | 装备=${equipCount}/7 | 背包=${invCount}/24 | 技能=${snapshot.skills.length} | 图鉴=${snapshot.bestiary.length} | 耗时=${Date.now() - startTime}ms`);

    res.json({ snapshot });
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [快照请求] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - startTime}ms`);
    res.status(400).json({ error: err.message });
  }
});

// 获取角色背包与装备（用于打开背包时实时查询）
router.get('/:id/inventory', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const startTime = Date.now();

  try {
    console.log(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 开始查询`);

    const data = await getCharacterInventory(characterId);
    if (!data) {
      console.log(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 结果=角色不存在 | 耗时=${Date.now() - startTime}ms`);
      res.status(404).json({ error: '角色不存在' });
      return;
    }

    const equipCount = Object.values(data.cityEquipment).filter((i) => i !== null).length;
    const invCount = data.cityInventory.filter((s: any) => s.item !== null).length;

    console.log(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 装备=${equipCount}/7 | 背包物品=${invCount}/24 | 耗时=${Date.now() - startTime}ms`);
    const equipped = Object.keys(data.cityEquipment).filter((k) => data.cityEquipment[k] !== null);
    const invIds = data.cityInventory.filter((s: any) => s.item).map((s: any) => s.item.id);
    console.log(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 装备栏: [${equipped.join(', ')}]`);
    console.log(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 背包物品: [${invIds.join(', ')}]`);

    res.json(data);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [背包请求] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - startTime}ms`);
    res.status(400).json({ error: err.message });
  }
});

// 获取角色技能列表（已解锁 + 未解锁）
router.get('/:id/skills', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const playerLevel = parseInt(req.query.level as string) || 1;
    const skills = await getCharacterSkills(req.params.id, playerLevel);
    res.json({ skills });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 获取角色计算后的属性（基于数据库当前装备）
router.get('/:id/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const stats = await getCharacterStats(req.params.id);
    res.json({ stats });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 根据传入的装备计算属性（局内实时计算）
router.post('/:id/calculate-stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { equipment } = req.body;
    const stats = await calculateCharacterStats(req.params.id, equipment);
    res.json({ stats });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 保存角色存档
router.post('/:id/save', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await saveCharacterData(req.params.id, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 经验获取与升级（TASK-BE-003）
// 入参：{ source: 'KILL_ENEMY'|'EXTRACT'|'QUEST', amount?, enemyTemplateId?, runId?, questId? }
// 出参：{ exp, level, leveledUp, levelUps, statsAwarded, oldLevel, newLevel, source, legalAmount }
router.post('/:id/exp', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const startTime = Date.now();

  try {
    // 归属校验
    const ownerId = await getCharacterOwner(characterId);
    if (ownerId === null) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerId !== userId) {
      console.warn(
        `[${new Date().toISOString()}] [经验请求] 用户=${userId} | 角色=${characterId} | 拒绝=非角色拥有者`
      );
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'POST /characters/:id/exp',
          actualOwner: ownerId,
          requestedBy: userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权操作该角色' });
      return;
    }

    const { source, amount, enemyTemplateId, runId, questId } = req.body ?? {};
    if (!isAllowedSource(source)) {
      res.status(400).json({ error: `非法经验来源: ${source}` });
      return;
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined;

    const result = await gainExp(
      userId,
      characterId,
      {
        source,
        amount: typeof amount === 'number' ? amount : undefined,
        enemyTemplateId,
        runId,
        questId,
      },
      clientIp
    );

    console.log(
      `[${new Date().toISOString()}] [经验请求] 用户=${userId} | 角色=${characterId} | source=${result.source} | legalAmount=${result.legalAmount} | exp=${result.exp} | lv=${result.oldLevel}→${result.newLevel} | statPts+${result.statsAwarded} | 耗时=${Date.now() - startTime}ms`
    );

    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [经验请求] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - startTime}ms`
    );
    res.status(status).json({ error: err.message });
  }
});

// ============================================================
// TASK-BE-004：击杀敌人 + 经验 + 图鉴 + 掉落
// POST /api/characters/:id/kill
// 入参：{ enemyTemplateId, runId }
// 出参：{ exp, level, oldLevel, newLevel, leveledUp, levelUps, statsAwarded, newItems[], bestiaryEntry }
// ============================================================
router.post('/:id/kill', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const startTime = Date.now();

  try {
    const { enemyTemplateId, runId } = req.body ?? {};
    if (!enemyTemplateId || !runId) {
      res.status(400).json({ error: '缺少 enemyTemplateId 或 runId' });
      return;
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined;

    const result = await handleKillEnemy(
      userId,
      characterId,
      { enemyTemplateId, runId },
      clientIp
    );

    console.log(
      `[${new Date().toISOString()}] [击杀请求] 用户=${userId} | 角色=${characterId} | 怪=${enemyTemplateId} | run=${runId} | exp=${result.exp} | lv=${result.oldLevel}→${result.newLevel}${result.leveledUp ? `(+${result.levelUps},statPts+${result.statsAwarded})` : ''} | drops=${result.newItems.length} | bestiaryKills=${result.bestiaryEntry.killCount} | 耗时=${Date.now() - startTime}ms`
    );

    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [击杀请求] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - startTime}ms`
    );
    res.status(status).json({ error: err.message });
  }
});

// ============================================================
// TASK-BE-004：场景随机掉落抽奖（HP 球 / MP 球 / 宝箱占位）
// POST /api/characters/:id/loot/roll
// 入参：{ runId, source, lootTableId?, x?, y? }
// 出参：{ items[] }
// ============================================================
router.post('/:id/loot/roll', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const startTime = Date.now();

  try {
    const { runId, source, lootTableId, x, y } = req.body ?? {};
    if (!runId || !source) {
      res.status(400).json({ error: '缺少 runId 或 source' });
      return;
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined;

    const result = await handleScenarioLoot(
      userId,
      characterId,
      { runId, source, lootTableId, x, y },
      clientIp
    );

    console.log(
      `[${new Date().toISOString()}] [场景掉落] 用户=${userId} | 角色=${characterId} | source=${source} | run=${runId} | drops=${result.items.length} | 耗时=${Date.now() - startTime}ms`
    );

    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [场景掉落] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - startTime}ms`
    );
    res.status(status).json({ error: err.message });
  }
});

// ============================================================
// TASK-BE-EQUIP-INVENTORY：装备穿脱 + 背包整理/移动/丢弃/消耗品
// ============================================================

function getClientIp(req: AuthRequest) {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    undefined
  );
}

// 穿装备
// POST /api/characters/:id/equip
// 入参：{ playerItemId, slot, runId? }
// 出参：{ stats, equipment, replacedItem }
router.post('/:id/equip', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleEquip(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [穿装备] 用户=${userId} | 角色=${characterId} | slot=${req.body?.slot} | 替换=${result.replacedItem?.instanceId ?? 'none'} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [穿装备] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// 卸装备
// POST /api/characters/:id/unequip
// 入参：{ slot, runId? }
// 出参：{ stats, equipment, unequippedItem }
router.post('/:id/unequip', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleUnequip(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [卸装备] 用户=${userId} | 角色=${characterId} | slot=${req.body?.slot} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [卸装备] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// 背包移动
// POST /api/characters/:id/inventory/move
// 入参：{ playerItemId?, toIndex? } 或 { fromSlot, toSlot }（兼容前端 ApiClient）
// 出参：{ success: true }
router.post('/:id/inventory/move', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleMove(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [背包移动] 用户=${userId} | 角色=${characterId} | body=${JSON.stringify(req.body ?? {})} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [背包移动] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// 背包整理
// POST /api/characters/:id/inventory/sort
// 入参：{ strategy?, runId? }
// 出参：{ sorted: true, strategy }
router.post('/:id/inventory/sort', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleSort(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [背包整理] 用户=${userId} | 角色=${characterId} | strategy=${result.strategy} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [背包整理] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// 丢弃物品
// POST /api/characters/:id/inventory/discard
// 入参：{ playerItemId?, quantity? } 或 { slot, count? }
// 出参：{ discarded: true, templateId }
router.post('/:id/inventory/discard', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleDiscard(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [丢弃物品] 用户=${userId} | 角色=${characterId} | templateId=${result.templateId} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [丢弃物品] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// 使用消耗品
// POST /api/characters/:id/items/use
// 入参：{ playerItemId?, runId? } 或 { slot, runId? }
// 出参：{ effect: { type, value, hp?, mp?, buffs? }, remainingStackCount, consumed, templateId }
router.post('/:id/items/use', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();
  try {
    const result = await handleUseItem(userId, characterId, req.body ?? {}, getClientIp(req));
    console.log(
      `[${new Date().toISOString()}] [使用消耗品] 用户=${userId} | 角色=${characterId} | templateId=${result.templateId} | type=${result.effect.type} | value=${result.effect.value} | remain=${result.remainingStackCount} | 耗时=${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    console.error(
      `[${new Date().toISOString()}] [使用消耗品] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`
    );
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// ============================================================
// 装备图鉴查询
// GET /api/characters/:id/codex/equipment
// ============================================================
router.get('/:id/codex/equipment', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const characterId = req.params.id;
  const start = Date.now();

  try {
    // 归属校验
    const ownerId = await getCharacterOwner(characterId);
    if (ownerId === null) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerId !== userId) {
      console.warn(`[${new Date().toISOString()}] [装备图鉴请求] 用户=${userId} | 角色=${characterId} | 拒绝=非角色拥有者`);
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'GET /characters/:id/codex/equipment',
          actualOwner: ownerId,
          requestedBy: userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权访问该角色' });
      return;
    }

    const [templates, codex] = await Promise.all([
      prisma.itemTemplate.findMany({
        where: {
          type: 'equipment',
          isDeleted: false,
        },
        orderBy: [{ rarity: 'asc' }, { slot: 'asc' }, { name: 'asc' }],
      }),
      prisma.playerEquipmentCodex.findMany({
        where: { characterId },
      }),
    ]);

    const codexMap = new Map(codex.map((c) => [c.templateId, c]));

    const result = templates.map((t) => {
      const c = codexMap.get(t.id);
      return {
        templateId: t.id,
        name: t.name,
        slot: t.slot,
        rarity: t.rarity,
        description: t.description,
        unlocked: !!c,
        obtainCount: c?.obtainCount ?? 0,
        firstObtainAt: c?.firstObtainAt?.toISOString() ?? null,
      };
    });

    console.log(`[${new Date().toISOString()}] [装备图鉴请求] 用户=${userId} | 角色=${characterId} | 模板=${templates.length} | 已解锁=${codex.length} | 耗时=${Date.now() - start}ms`);
    res.json({ codex: result });
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [装备图鉴请求] 用户=${userId} | 角色=${characterId} | 异常=${err.message} | 耗时=${Date.now() - start}ms`);
    res.status(400).json({ error: err.message });
  }
});

export default router;
