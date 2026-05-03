import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  startRun,
  descendRun,
  extractRun,
  reportDeath,
} from '../services/RunService';

const router = Router();

function getClientIp(req: AuthRequest): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0];
  return req.socket?.remoteAddress;
}

/**
 * POST /api/runs/start
 * Body: { characterId, sceneKey?, partyId? }
 */
router.post('/start', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { characterId, sceneKey, partyId } = req.body || {};
    if (!characterId) {
      res.status(400).json({ error: '缺少 characterId' });
      return;
    }
    const result = await startRun(
      req.userId!,
      { characterId, sceneKey, partyId },
      getClientIp(req)
    );
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/runs/:runId/descend
 * Body: { sceneKey? }
 */
router.post('/:runId/descend', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { runId } = req.params;
    const sceneKey = (req.body && req.body.sceneKey) || 'forest';
    const result = await descendRun(req.userId!, runId, sceneKey, getClientIp(req));
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/runs/:runId/extract
 */
router.post('/:runId/extract', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { runId } = req.params;
    const result = await extractRun(req.userId!, runId, getClientIp(req));
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    res.status(status).json({
      error: err.message,
      code: err.code,
      context: err.context,
    });
  }
});

/**
 * POST /api/runs/:runId/death
 * Body: { cause? }
 */
router.post('/:runId/death', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { runId } = req.params;
    const cause = req.body?.cause;
    const result = await reportDeath(req.userId!, runId, cause, getClientIp(req));
    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

export default router;
