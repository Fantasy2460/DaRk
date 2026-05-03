import type { RunDamageStats, DamageSourceStat } from '../types';

export function recordDamage(
  stats: RunDamageStats,
  sourceId: string,
  sourceName: string,
  color: number,
  amount: number
): RunDamageStats {
  const next = { ...stats, sources: { ...stats.sources } };
  const existing = next.sources[sourceId];
  if (existing) {
    next.sources[sourceId] = { ...existing, totalDamage: existing.totalDamage + amount };
  } else {
    next.sources[sourceId] = { id: sourceId, name: sourceName, color, castCount: 0, totalDamage: amount };
  }
  next.totalDamage += amount;
  next.version += 1;
  return next;
}

export function recordCast(
  stats: RunDamageStats,
  sourceId: string,
  sourceName: string,
  color: number
): RunDamageStats {
  const next = { ...stats, sources: { ...stats.sources } };
  const existing = next.sources[sourceId];
  if (existing) {
    next.sources[sourceId] = { ...existing, castCount: existing.castCount + 1 };
  } else {
    next.sources[sourceId] = { id: sourceId, name: sourceName, color, castCount: 1, totalDamage: 0 };
  }
  return next;
}

export function getSortedSources(stats: RunDamageStats): DamageSourceStat[] {
  return Object.values(stats.sources).sort((a, b) => b.totalDamage - a.totalDamage);
}

export function getDamagePercent(stat: DamageSourceStat, total: number): number {
  if (total <= 0) return 0;
  return Math.round((stat.totalDamage / total) * 100);
}
