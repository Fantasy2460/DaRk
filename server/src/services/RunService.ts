import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { generateSpawns, generatePortal, SpawnPoint, PortalPoint } from './SpawnService';
import { createAuditLog } from './AuditService';
import { flagAnomaly } from './AntiCheatService';
import { randomUUID } from 'crypto';

/**
 * Run 生命周期服务（TASK-BE-007）。
 *
 * 当前 schema 设计说明（与 prisma/schema.prisma 对齐）：
 * - Run 表使用 `result`(string|null) 表示结果：null=进行中，'extracted'=撤离，'died'=死亡，'abandoned'=放弃
 * - `endDepth` 字段在本服务中复用为「当前所在层数」，每次 descend 时 +1
 * - `seed` 用于 SpawnService 的确定性刷怪
 * - `endedAt` 在 extract / death 时记录，用于计算 runDuration
 */

// 背包容量（与前端 inventoryRows*inventoryCols 对齐：6*4=24）
const INVENTORY_CAPACITY = 24;

export interface StartRunInput {
  characterId: string;
  sceneKey?: string;
  partyId?: string | null;
}

export interface StartRunResult {
  runId: string;
  seed: string;
  depth: number;
  spawns: SpawnPoint[];
  portal: PortalPoint;
  resumed: boolean;
}

export interface DescendResult {
  depth: number;
  seed: string;
  spawns: SpawnPoint[];
  portal: PortalPoint;
}

export interface ExtractResult {
  status: 'COMPLETED';
  mergedItems: number;
  expGained: number;
  runDuration: number;
}

export interface DeathResult {
  status: 'DEAD';
  itemsLost: number;
}

/** 校验 character 是否归属当前用户 */
export async function assertCharacterOwnership(userId: string, characterId: string) {
  const ch = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, userId: true },
  });
  if (!ch) throw new Error('角色不存在');
  if (ch.userId !== userId) {
    await flagAnomaly({
      reason: 'CHARACTER_OWNERSHIP_VIOLATION',
      characterId,
      details: {
        endpoint: 'RunService.assertCharacterOwnership',
        actualOwner: ch.userId,
        requestedBy: userId,
      },
      confidence: 90,
    });
    throw new Error('无权操作该角色');
  }
  return ch;
}

/**
 * 校验 run 是否归属当前用户的某个角色（通过 RunParticipant），
 * 返回参与者的 characterId（用于审计与物品操作）。
 */
export async function assertRunOwnership(userId: string, runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      participants: {
        include: {
          character: { select: { id: true, userId: true } },
        },
      },
    },
  });
  if (!run) throw new Error('Run 不存在');
  const me = run.participants.find((p) => p.character.userId === userId);
  if (!me) {
    // 跨用户访问 run → 写反作弊（用 run.characterId 作为关联角色）
    await flagAnomaly({
      reason: 'RUN_OWNERSHIP_VIOLATION',
      characterId: run.characterId,
      details: {
        endpoint: 'RunService.assertRunOwnership',
        runId,
        requestedBy: userId,
        participantCharacterIds: run.participants.map((p) => p.characterId),
      },
      confidence: 90,
    });
    throw new Error('无权操作该 Run');
  }
  return { run, characterId: me.characterId };
}

function isRunActive(result: string | null | undefined, endedAt: Date | null | undefined): boolean {
  return !result && !endedAt;
}

/**
 * POST /api/runs/start
 * 幂等：若已有进行中的 run，直接返回（按现 sceneKey/depth 重新计算 spawns/portal）。
 */
export async function startRun(
  userId: string,
  input: StartRunInput,
  clientIp?: string
): Promise<StartRunResult> {
  const { characterId, sceneKey = 'forest', partyId = null } = input;
  await assertCharacterOwnership(userId, characterId);

  // 是否已有进行中的 run？
  const active = await prisma.run.findFirst({
    where: {
      characterId,
      result: null,
      endedAt: null,
    },
    orderBy: { startedAt: 'desc' },
  });

  if (active && active.seed) {
    const depth = Math.max(1, active.endDepth || 1);
    const [spawns, portal] = await Promise.all([
      generateSpawns(active.seed, depth, sceneKey),
      Promise.resolve(generatePortal(active.seed, depth, sceneKey)),
    ]);
    return {
      runId: active.id,
      seed: active.seed,
      depth,
      spawns,
      portal,
      resumed: true,
    };
  }

  // 新建 run
  const seed = randomUUID();
  const depth = 1;
  const runId = generateId();

  await prisma.$transaction([
    prisma.run.create({
      data: {
        id: runId,
        characterId,
        partyId,
        seed,
        startDepth: depth,
        endDepth: depth,
        elapsedTimeSec: 0,
        startedAt: new Date(),
      },
    }),
    prisma.runParticipant.create({
      data: {
        runId,
        characterId,
        isHost: true,
      },
    }),
  ]);

  const spawns = await generateSpawns(seed, depth, sceneKey);
  const portal = generatePortal(seed, depth, sceneKey);

  await createAuditLog({
    userId,
    characterId,
    action: 'RUN_START',
    details: { runId, seed, depth, sceneKey },
    clientIp,
  }).catch(() => {});

  return { runId, seed, depth, spawns, portal, resumed: false };
}

/**
 * POST /api/runs/:runId/descend
 */
export async function descendRun(
  userId: string,
  runId: string,
  sceneKey = 'forest',
  clientIp?: string
): Promise<DescendResult> {
  const { run, characterId } = await assertRunOwnership(userId, runId);
  if (!isRunActive(run.result, run.endedAt)) {
    throw new Error('该 Run 已结束，无法继续深入');
  }
  if (!run.seed) {
    throw new Error('Run 缺少 seed，无法生成下一层');
  }

  const newDepth = (run.endDepth || 1) + 1;

  await prisma.run.update({
    where: { id: runId },
    data: { endDepth: newDepth },
  });

  const spawns = await generateSpawns(run.seed, newDepth, sceneKey);
  const portal = generatePortal(run.seed, newDepth, sceneKey);

  await createAuditLog({
    userId,
    characterId,
    action: 'RUN_DESCEND',
    details: { runId, depth: newDepth },
    clientIp,
  }).catch(() => {});

  return { depth: newDepth, seed: run.seed, spawns, portal };
}

/**
 * POST /api/runs/:runId/extract
 *
 * 事务步骤：
 * 1) 检查并合并 PlayerItem.runId=runId 的物品到主城（runId 置 null）
 *    背包容量校验：现有空槽数量 < 待合并数量 → 返回 400「背包已满」
 * 2) Run.result='extracted'，endedAt=now()
 * 3) 写 AuditLog
 */
export async function extractRun(
  userId: string,
  runId: string,
  clientIp?: string
): Promise<ExtractResult> {
  const { run, characterId } = await assertRunOwnership(userId, runId);
  if (!isRunActive(run.result, run.endedAt)) {
    throw new Error('该 Run 已结束');
  }

  const now = new Date();

  // 1) 容量校验 + 收集待合并物品（按 createdAt asc 保证拾取顺序稳定）
  const [pendingItems, currentInvItems] = await Promise.all([
    prisma.playerItem.findMany({
      where: { runId, characterId },
      select: { id: true, templateId: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.playerItem.findMany({
      where: {
        characterId,
        runId: null,
        location: 'inventory',
      },
      select: { slotPosition: true },
    }),
  ]);

  const pendingMergeCount = pendingItems.length;
  const currentInvCount = currentInvItems.length;

  if (currentInvCount + pendingMergeCount > INVENTORY_CAPACITY) {
    const err: any = new Error(
      `背包已满：当前 ${currentInvCount}/${INVENTORY_CAPACITY}，本次撤离需合并 ${pendingMergeCount} 件，请先丢弃部分物品再撤离`
    );
    err.statusCode = 400;
    err.code = 'INVENTORY_FULL';
    err.context = {
      currentInvCount,
      pendingMergeCount,
      capacity: INVENTORY_CAPACITY,
    };
    throw err;
  }

  // 2) 计算每个待合并物品分配到的 slotPosition（0..23 中最低未占用位）
  const occupied = new Set<number>();
  for (const it of currentInvItems) {
    if (typeof it.slotPosition === 'number' && it.slotPosition >= 0) {
      occupied.add(it.slotPosition);
    }
  }

  const assignments: { id: string; slotPosition: number }[] = [];
  let cursor = 0;
  for (const pending of pendingItems) {
    while (cursor < INVENTORY_CAPACITY && occupied.has(cursor)) {
      cursor++;
    }
    if (cursor >= INVENTORY_CAPACITY) {
      // 理论上 INVENTORY_FULL 校验已挡住，这里是双保险
      const err: any = new Error(
        `背包槽位分配失败：当前 ${occupied.size}/${INVENTORY_CAPACITY}，无法容纳 ${pendingMergeCount} 件`
      );
      err.statusCode = 400;
      err.code = 'INVENTORY_FULL';
      err.context = {
        currentInvCount: occupied.size,
        pendingMergeCount,
        capacity: INVENTORY_CAPACITY,
      };
      throw err;
    }
    occupied.add(cursor);
    assignments.push({ id: pending.id, slotPosition: cursor });
    cursor++;
  }

  // 3) 事务：逐条 update（带 slotPosition）+ 关 run
  const elapsedSec = Math.max(
    0,
    Math.floor((now.getTime() - new Date(run.startedAt).getTime()) / 1000)
  );

  const updateOps = assignments.map((a) =>
    prisma.playerItem.update({
      where: { id: a.id },
      data: {
        runId: null,
        location: 'inventory',
        equippedSlot: null,
        slotPosition: a.slotPosition,
      },
    })
  );

  await prisma.$transaction([
    ...updateOps,
    prisma.run.update({
      where: { id: runId },
      data: {
        result: 'extracted',
        endedAt: now,
        elapsedTimeSec: elapsedSec,
      },
    }),
  ]);

  const mergedItems = assignments.length;
  const expGained = 0; // 占位：BE-003/BE-004 接入后再计算
  const runDuration = now.getTime() - new Date(run.startedAt).getTime();

  await createAuditLog({
    userId,
    characterId,
    action: 'RUN_EXTRACT',
    details: { runId, mergedItems, expGained, runDuration },
    clientIp,
  }).catch(() => {});

  return {
    status: 'COMPLETED',
    mergedItems,
    expGained,
    runDuration,
  };
}

/**
 * POST /api/runs/:runId/death
 *
 * 事务步骤：
 * 1) 删除 PlayerItem.runId=runId 的全部物品
 * 2) Run.result='died'，endedAt=now()
 * 3) 写 AuditLog
 */
export async function reportDeath(
  userId: string,
  runId: string,
  cause?: string,
  clientIp?: string
): Promise<DeathResult> {
  const { run, characterId } = await assertRunOwnership(userId, runId);
  if (!isRunActive(run.result, run.endedAt)) {
    throw new Error('该 Run 已结束');
  }

  const now = new Date();
  const elapsedSec = Math.max(
    0,
    Math.floor((now.getTime() - new Date(run.startedAt).getTime()) / 1000)
  );

  // 先 count 一下要丢弃多少件，便于审计
  const lostCount = await prisma.playerItem.count({
    where: { runId, characterId },
  });

  await prisma.$transaction([
    prisma.playerItem.deleteMany({
      where: { runId, characterId },
    }),
    prisma.run.update({
      where: { id: runId },
      data: {
        result: 'died',
        endedAt: now,
        elapsedTimeSec: elapsedSec,
      },
    }),
  ]);

  await createAuditLog({
    userId,
    characterId,
    action: 'RUN_DEATH',
    details: { runId, cause: cause ?? 'unknown', itemsLost: lostCount },
    clientIp,
  }).catch(() => {});

  return {
    status: 'DEAD',
    itemsLost: lostCount,
  };
}

/**
 * 原子递增并返回 Run.enemiesKilled 作为击杀序号（killSequence）。
 *
 * 用途：LootService 使用 (seed + runId + enemyTemplateId + killSequence) 作为
 * PRNG 种子，确保确定性。
 *
 * 注意：当前 Run.enemiesKilled 是 Run 维度的全局击杀计数，每次任意怪物击杀都会 +1，
 * 这意味着同一 enemyTemplateId 在不同时刻击杀得到的 killSequence 不连续，但仍保证：
 * - 同一 (runId, enemyTemplateId, killSequence) 元组下种子稳定
 * - 不同击杀产生不同种子
 * - 全部基于数据库原子 increment，重连后续值不会回退
 */
export async function incrementKillSequence(runId: string): Promise<number> {
  const updated = await prisma.run.update({
    where: { id: runId },
    data: { enemiesKilled: { increment: 1 } },
    select: { enemiesKilled: true },
  });
  return updated.enemiesKilled;
}
