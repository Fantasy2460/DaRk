import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';
import { listMails, claimMail } from '../services/MailService';
import { flagAnomaly } from '../services/AntiCheatService';

/**
 * 邮件路由。
 * 由于路径是 `/api/characters/:id/mails/...`（与 character router 同前缀），
 * 在 index.ts 中以 `/api` 作为挂载前缀，路径在此处书写完整子路径。
 * 这种做法与 achievement.ts 一致。
 */
const router = Router();

/**
 * GET /api/characters/:id/mails
 * 列出某角色的邮件（按 sentAt 倒序）。
 * JWT + 归属校验。
 */
router.get(
  '/characters/:id/mails',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const characterId = req.params.id;
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { id: true, userId: true },
      });
      if (!character) {
        res.status(404).json({ error: '角色不存在' });
        return;
      }
      if (character.userId !== req.userId) {
        await flagAnomaly({
          reason: 'CHARACTER_OWNERSHIP_VIOLATION',
          characterId,
          details: {
            endpoint: 'GET /characters/:id/mails',
            actualOwner: character.userId,
            requestedBy: req.userId,
          },
          confidence: 90,
        });
        res.status(403).json({ error: '无权查看该角色的邮件' });
        return;
      }

      const mails = await listMails(characterId);
      res.json({ mails });
    } catch (err: any) {
      res.status(err?.statusCode ?? 400).json({ error: err.message });
    }
  }
);

/**
 * POST /api/characters/:id/mails/:mailId/claim
 * 领取邮件附件（事务）。
 * JWT + 归属校验 + 跨角色领取写反作弊。
 */
router.post(
  '/characters/:id/mails/:mailId/claim',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const characterId = req.params.id;
      const mailIdRaw = req.params.mailId;
      const mailId = Number.parseInt(mailIdRaw, 10);
      if (!Number.isFinite(mailId) || mailId <= 0) {
        res.status(400).json({ error: '邮件 ID 无效' });
        return;
      }

      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { id: true, userId: true },
      });
      if (!character) {
        res.status(404).json({ error: '角色不存在' });
        return;
      }
      if (character.userId !== req.userId) {
        await flagAnomaly({
          reason: 'CHARACTER_OWNERSHIP_VIOLATION',
          characterId,
          details: {
            endpoint: 'POST /characters/:id/mails/:mailId/claim',
            mailId,
            actualOwner: character.userId,
            requestedBy: req.userId,
          },
          confidence: 90,
        });
        res.status(403).json({ error: '无权操作该角色' });
        return;
      }

      const result = await claimMail(characterId, mailId, req.userId!);
      res.json(result);
    } catch (err: any) {
      res.status(err?.statusCode ?? 400).json({ error: err.message });
    }
  }
);

export default router;
