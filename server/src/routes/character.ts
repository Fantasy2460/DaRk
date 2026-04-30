import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createCharacter, getCharactersByUser, getCharacterWithSave, saveCharacterData, getCharacterInventory, getCharacterSkills, getCharacterStats, calculateCharacterStats } from '../services/CharacterService';

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

export default router;
