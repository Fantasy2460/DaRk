/**
 * 一次性补发脚本：把所有现有角色的 character_stats.skill_points
 * 覆盖（非追加）为 character.level * 2。
 *
 * 触发原因：TASK-SKILL-BE-RATE-X2 将升级 SP 奖励从 1 SP/级 改为 2 SP/级，
 * 历史角色按新规则进行回溯：skill_points = level * 2。
 *
 * 行为：
 *   - 已有 character_stats 行：update skillPoints
 *   - 缺失 character_stats 行：upsert（仅显式写 skillPoints，其它字段走 schema default）
 *   - 单条角色失败不阻断后续（不在事务中执行）
 *   - 每条变更打印 id / level / oldSP / newSP
 *   - 完成后写一条审计日志（每个角色一条 SKILL_POINTS_BACKFILL）
 *
 * 运行：
 *   npx tsx src/scripts/backfillSkillPoints.ts
 */

import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/AuditService';

const prisma = new PrismaClient();

interface BackfillRow {
  id: string;
  userId: string;
  level: number;
  oldSP: number | null;
  newSP: number;
  status: 'updated' | 'created' | 'failed';
  error?: string;
}

async function main(): Promise<void> {
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      userId: true,
      level: true,
      stats: { select: { characterId: true, skillPoints: true } },
    },
  });

  console.log(`[backfillSkillPoints] 共扫描到 ${characters.length} 个角色，开始覆盖式补发...`);

  const results: BackfillRow[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const c of characters) {
    const newSP = c.level * 2;
    const oldSP = c.stats?.skillPoints ?? null;
    let status: BackfillRow['status'] = 'updated';

    try {
      if (!c.stats) {
        // 极旧数据无 stats 行，upsert 兜底；其余字段走 schema default。
        await prisma.characterStats.upsert({
          where: { characterId: c.id },
          create: {
            characterId: c.id,
            skillPoints: newSP,
          },
          update: {
            skillPoints: newSP,
          },
        });
        status = 'created';
      } else {
        await prisma.characterStats.update({
          where: { characterId: c.id },
          data: { skillPoints: newSP },
        });
      }

      // 审计日志（每角色一条）。失败不阻断业务。
      await createAuditLog({
        userId: c.userId,
        characterId: c.id,
        action: 'SKILL_POINTS_BACKFILL',
        details: {
          reason: 'TASK-SKILL-BE-RATE-X2: SP 倍率从 1x 改为 2x，历史回溯',
          level: c.level,
          oldSP,
          newSP,
          formula: 'skillPoints = level * 2',
          mode: status === 'created' ? 'upsert-create' : 'update',
        },
      }).catch((err) => {
        console.warn(`  [审计写入失败] character=${c.id}: ${(err as Error).message}`);
      });

      successCount += 1;
      results.push({ id: c.id, userId: c.userId, level: c.level, oldSP, newSP, status });
      console.log(
        `  [OK] id=${c.id} level=${c.level} oldSP=${oldSP ?? 'null'} -> newSP=${newSP} (${status})`
      );
    } catch (err) {
      failCount += 1;
      const errMsg = (err as Error).message;
      results.push({
        id: c.id,
        userId: c.userId,
        level: c.level,
        oldSP,
        newSP,
        status: 'failed',
        error: errMsg,
      });
      console.error(`  [FAIL] id=${c.id} level=${c.level}: ${errMsg}`);
    }
  }

  console.log('---');
  console.log(`[backfillSkillPoints] 完成。`);
  console.log(`  成功: ${successCount}`);
  console.log(`  失败: ${failCount}`);
  console.log(`  总计: ${characters.length}`);

  if (results.length > 0) {
    console.log('---');
    console.log('抽样（前 5 行）:');
    for (const r of results.slice(0, 5)) {
      console.log(
        `  id=${r.id} level=${r.level} oldSP=${r.oldSP ?? 'null'} newSP=${r.newSP} status=${r.status}`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error('[backfillSkillPoints] 致命错误:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
