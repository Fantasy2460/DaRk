import { Router } from 'express';
import { PUBLIC_GAME_CONFIG, CONFIG_VERSION } from '../config/gameConfig';

const router = Router();

/**
 * GET /api/config/game
 * 公开端点（无需 JWT），返回客户端可见的游戏配置常量。
 * 仅暴露 PUBLIC_GAME_CONFIG，INTERNAL_GAME_CONFIG 永远不会出现在响应体里。
 *
 * 响应体形如：{ config: {...}, version: "2026-05-01.1" }
 *
 * 缓存策略：
 *  - Cache-Control: public, max-age=60（1 分钟）
 *  - ETag 基于 CONFIG_VERSION，客户端可携带 If-None-Match 触发 304
 */
router.get('/game', (req, res) => {
  try {
    const etag = `"cfg-${CONFIG_VERSION}"`;

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({
      config: PUBLIC_GAME_CONFIG,
      version: CONFIG_VERSION,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'config fetch failed' });
  }
});

export default router;
