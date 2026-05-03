import { prisma } from '../config/database';
import { generateId } from '../utils/id';
import { flagAnomaly } from './AntiCheatService';

/**
 * 邮件附件结构定义。
 * 后端校验时仅识别 GOLD / ITEM 两种类型，其它类型在领取时会被忽略。
 */
export type MailAttachment =
  | { type: 'GOLD'; amount: number }
  | { type: 'ITEM'; templateId: string; quantity?: number };

export interface MailListEntry {
  id: number;
  senderName: string;
  title: string;
  content: string | null;
  attachments: MailAttachment[];
  claimed: boolean;
  sentAt: Date;
  expiresAt: Date | null;
}

/**
 * 列出指定角色的邮件。
 * 当前阶段 schema 的 Mail 表没有 deleted 字段，因此只过滤过期已领取的邮件不做软删；
 * 默认按 createdAt 倒序返回（schema 中 sentAt 字段名为 createdAt）。
 */
export async function listMails(characterId: string): Promise<MailListEntry[]> {
  const records = await prisma.mail.findMany({
    where: { characterId },
    orderBy: { createdAt: 'desc' },
  });

  return records.map((m) => {
    let attachments: MailAttachment[] = [];
    if (m.attachmentsJson) {
      try {
        const parsed = JSON.parse(m.attachmentsJson);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch {
        attachments = [];
      }
    }
    return {
      id: m.id,
      senderName: m.senderName,
      title: m.title,
      content: m.content,
      attachments,
      claimed: m.isClaimed,
      sentAt: m.createdAt,
      expiresAt: m.expiredAt,
    };
  });
}

export interface ClaimMailResult {
  goldGained: number;
  itemsGained: Array<{ templateId: string; playerItemId: string; slotPosition: number }>;
  mail: MailListEntry;
}

/**
 * 领取邮件附件（事务）。
 *
 * 业务校验：
 *   - 邮件存在
 *   - mail.characterId === characterId（不归属则视为跨角色领取，写 AntiCheatFlag）
 *   - 未过期（expiredAt 为 null 或大于 now）
 *   - 未领取
 *   - 背包剩余容量足够（runId=null && location='inventory' 的 PlayerItem 数量 + 新物品 ≤ 24）
 *
 * 错误码：
 *   - 404 邮件不存在
 *   - 403 跨角色领取（同时写反作弊）
 *   - 400 已领取 / 已过期 / 背包已满
 */
export async function claimMail(
  characterId: string,
  mailId: number,
  userId: string
): Promise<ClaimMailResult> {
  return prisma.$transaction(async (tx) => {
    const mail = await tx.mail.findUnique({ where: { id: mailId } });
    if (!mail) {
      const err: any = new Error('邮件不存在');
      err.statusCode = 404;
      throw err;
    }

    if (mail.characterId !== characterId) {
      // fire-and-forget 反作弊记录（事务外日志，不阻断回滚流程）
      flagAnomaly({
        reason: 'MAIL_CROSS_CHAR',
        characterId,
        details: {
          mailId,
          ownerCharacterId: mail.characterId,
        },
        confidence: 90,
      }).catch(() => {});
      const err: any = new Error('无权领取该邮件');
      err.statusCode = 403;
      throw err;
    }

    if (mail.isClaimed) {
      const err: any = new Error('邮件已领取');
      err.statusCode = 400;
      throw err;
    }

    if (mail.expiredAt && mail.expiredAt.getTime() < Date.now()) {
      const err: any = new Error('邮件已过期');
      err.statusCode = 400;
      throw err;
    }

    // 解析附件
    let attachments: MailAttachment[] = [];
    if (mail.attachmentsJson) {
      try {
        const parsed = JSON.parse(mail.attachmentsJson);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch {
        attachments = [];
      }
    }

    // 分类聚合
    let goldGained = 0;
    const itemAttachments: Array<{ templateId: string; quantity: number }> = [];
    for (const att of attachments) {
      if (!att || typeof att !== 'object') continue;
      if (att.type === 'GOLD' && typeof (att as any).amount === 'number') {
        goldGained += Math.max(0, Math.floor((att as any).amount));
      } else if (att.type === 'ITEM' && typeof (att as any).templateId === 'string') {
        const qty = Math.max(1, Math.floor(((att as any).quantity as number) ?? 1));
        itemAttachments.push({ templateId: (att as any).templateId, quantity: qty });
      }
    }

    // 校验背包容量（按总数量计算需要的格子数；不做堆叠合并）
    const totalNeeded = itemAttachments.reduce((sum, it) => sum + it.quantity, 0);
    if (totalNeeded > 0) {
      const existingItems = await tx.playerItem.findMany({
        where: { characterId, runId: null, location: 'inventory' },
        select: { slotPosition: true },
      });
      const occupied = new Set<number>();
      for (const it of existingItems) {
        if (typeof it.slotPosition === 'number') occupied.add(it.slotPosition);
      }
      // 计算空位
      const emptySlots: number[] = [];
      for (let i = 0; i < 24; i++) {
        if (!occupied.has(i)) emptySlots.push(i);
        if (emptySlots.length >= totalNeeded) break;
      }
      if (emptySlots.length < totalNeeded) {
        const err: any = new Error('背包已满，请先腾空');
        err.statusCode = 400;
        throw err;
      }
    }

    // 查询角色（领金币）
    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: { id: true, gold: true },
    });
    if (!character) {
      const err: any = new Error('角色不存在');
      err.statusCode = 404;
      throw err;
    }

    // 校验所有 ITEM 模板存在
    const uniqueTemplateIds = Array.from(new Set(itemAttachments.map((it) => it.templateId)));
    const templates = uniqueTemplateIds.length
      ? await tx.itemTemplate.findMany({
          where: { id: { in: uniqueTemplateIds } },
        })
      : [];
    const templateMap = new Map(templates.map((t) => [t.id, t]));
    for (const it of itemAttachments) {
      if (!templateMap.has(it.templateId)) {
        const err: any = new Error(`物品模板不存在: ${it.templateId}`);
        err.statusCode = 400;
        throw err;
      }
    }

    // 执行：发金币
    let newGold = character.gold;
    if (goldGained > 0) {
      newGold = character.gold + goldGained;
      await tx.character.update({
        where: { id: characterId },
        data: { gold: newGold },
      });
      await tx.characterTransaction.create({
        data: {
          characterId,
          type: 'MAIL_CLAIM',
          amount: goldGained,
          balanceAfter: newGold,
          relatedItemId: null,
        },
      });
    }

    // 重新计算空位（之前查询过的可重用）
    const itemsGained: Array<{ templateId: string; playerItemId: string; slotPosition: number }> =
      [];
    if (totalNeeded > 0) {
      const existingItems = await tx.playerItem.findMany({
        where: { characterId, runId: null, location: 'inventory' },
        select: { slotPosition: true },
      });
      const occupied = new Set<number>();
      for (const it of existingItems) {
        if (typeof it.slotPosition === 'number') occupied.add(it.slotPosition);
      }
      const emptySlots: number[] = [];
      for (let i = 0; i < 24; i++) {
        if (!occupied.has(i)) emptySlots.push(i);
        if (emptySlots.length >= totalNeeded) break;
      }

      let cursor = 0;
      for (const it of itemAttachments) {
        const tpl = templateMap.get(it.templateId)!;
        for (let q = 0; q < it.quantity; q++) {
          const slot = emptySlots[cursor++];
          const newItem = await tx.playerItem.create({
            data: {
              id: generateId(),
              characterId,
              templateId: it.templateId,
              rarity: tpl.rarity,
              location: 'inventory',
              slotPosition: slot,
              stackCount: 1,
              obtainedFrom: `mail:${mailId}`,
              runId: null,
            },
          });
          itemsGained.push({
            templateId: it.templateId,
            playerItemId: newItem.id,
            slotPosition: slot,
          });
        }
      }
    }

    // 标记邮件已领取
    const updatedMail = await tx.mail.update({
      where: { id: mailId },
      data: { isClaimed: true, isRead: true },
    });

    // 写审计日志
    await tx.auditLog.create({
      data: {
        userId,
        characterId,
        action: 'MAIL_CLAIM',
        detailsJson: JSON.stringify({
          mailId,
          goldGained,
          itemsGained: itemsGained.map((i) => ({
            templateId: i.templateId,
            slot: i.slotPosition,
          })),
        }),
      },
    });

    return {
      goldGained,
      itemsGained,
      mail: {
        id: updatedMail.id,
        senderName: updatedMail.senderName,
        title: updatedMail.title,
        content: updatedMail.content,
        attachments,
        claimed: updatedMail.isClaimed,
        sentAt: updatedMail.createdAt,
        expiresAt: updatedMail.expiredAt,
      },
    };
  });
}
