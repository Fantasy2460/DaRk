import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../config/database';

/**
 * 管理员判定中间件（阶段一简陋实现）。
 *
 * 风险点：
 *   - User 模型当前没有 role 字段，本判定基于「白名单 + 用户名」hard-coded 策略：
 *     1. 环境变量 ADMIN_USER_IDS（逗号分隔的 userId 列表）命中视为管理员
 *     2. 用户名为 'admin' 视为管理员（兜底）
 *   - 未来引入 User.role 字段后，此中间件应迁移为 role === 'admin' 判定
 *   - 简陋判定的安全性较弱，不应在生产环境长期保留；推荐尽快迁移到 RBAC
 *
 * 该中间件依赖 authMiddleware 已经写入 req.userId，因此使用顺序应为：
 *   router.get('/...', authMiddleware, requireAdmin, handler)
 */
export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: '未登录' });
    return;
  }

  try {
    const adminUserIds = (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (adminUserIds.includes(userId)) {
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) {
      res.status(401).json({ error: '用户不存在' });
      return;
    }

    if (user.username === 'admin') {
      next();
      return;
    }

    res.status(403).json({ error: '需要管理员权限' });
  } catch (err: any) {
    res.status(500).json({ error: 'admin 判定失败', detail: err?.message });
  }
}
