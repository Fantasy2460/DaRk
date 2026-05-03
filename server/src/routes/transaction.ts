import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createTransaction, getTransactionsByCharacter } from '../services/TransactionService';
import { getCharacterOwner } from '../services/CharacterService';
import { flagAnomaly } from '../services/AntiCheatService';

const router = Router();

/** 内存级最近一次写入时间戳（按 character 维度），用于 TRANSACTION_RATE 简易判定 */
const lastTxAtMap = new Map<string, number>();
const TX_RATE_LIMIT_MS = 200;

// 写入金币交易记录
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, type, amount, balanceAfter, relatedItemId, relatedRunId } = req.body;
    if (!characterId || !type || amount === undefined || balanceAfter === undefined) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    // 归属校验：character 必须属于当前 user
    const ownerUserId = await getCharacterOwner(characterId);
    if (!ownerUserId) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerUserId !== req.userId) {
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'POST /transactions',
          type,
          amount,
          actualOwner: ownerUserId,
          requestedBy: req.userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权操作该角色' });
      return;
    }

    // 高频写入检测（仅记录 flag，不阻断）
    const now = Date.now();
    const last = lastTxAtMap.get(characterId);
    if (last && now - last < TX_RATE_LIMIT_MS) {
      await flagAnomaly({
        reason: 'TRANSACTION_RATE',
        characterId,
        details: {
          type,
          amount,
          deltaMs: now - last,
          thresholdMs: TX_RATE_LIMIT_MS,
        },
        confidence: 30,
      });
    }
    lastTxAtMap.set(characterId, now);

    const tx = await createTransaction({
      characterId,
      type,
      amount,
      balanceAfter,
      relatedItemId,
      relatedRunId,
    });
    res.json({ success: true, id: tx.id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 查询某角色的交易记录
router.get('/character/:characterId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const characterId = req.params.characterId;

    // 归属校验
    const ownerUserId = await getCharacterOwner(characterId);
    if (!ownerUserId) {
      res.status(404).json({ error: '角色不存在' });
      return;
    }
    if (ownerUserId !== req.userId) {
      await flagAnomaly({
        reason: 'CHARACTER_OWNERSHIP_VIOLATION',
        characterId,
        details: {
          endpoint: 'GET /transactions/character/:characterId',
          actualOwner: ownerUserId,
          requestedBy: req.userId,
        },
        confidence: 90,
      });
      res.status(403).json({ error: '无权查看该角色' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const transactions = await getTransactionsByCharacter(characterId, limit);
    res.json({ transactions });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
