import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createCharacter, getCharactersByUser, getCharacterWithSave, saveCharacterData, getCharacterInventory } from '../services/CharacterService';

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
  try {
    const data = await getCharacterInventory(req.params.id);
    if (!data) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    res.json(data);
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
