import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

/**
 * 获取当前生效的公告列表。
 * 真实可用：仅返回 isActive = true，且当前时间在 [startAt, endAt] 范围内的记录。
 * Announcement 表无 createdAt 字段，按 id 倒序（最新插入的在前）。
 */
router.get('/', async (_req, res) => {
  try {
    const now = new Date();
    const announcements = await prisma.announcement.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [{ startAt: null }, { startAt: { lte: now } }],
          },
          {
            OR: [{ endAt: null }, { endAt: { gt: now } }],
          },
        ],
      },
      orderBy: { id: 'desc' },
    });
    res.json({ announcements });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 创建公告（管理员功能占位）。
 */
router.post('/', authMiddleware, async (_req: AuthRequest, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    message: '公告管理功能开发中',
  });
});

export default router;
