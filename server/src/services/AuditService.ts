import { prisma } from '../config/database';

export interface AuditLogInput {
  userId: string;
  characterId?: string;
  action: string;
  details?: Record<string, any>;
  clientIp?: string;
}

export async function createAuditLog(input: AuditLogInput) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId,
      characterId: input.characterId,
      action: input.action,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
      clientIp: input.clientIp,
    },
  });
}

export async function getAuditLogsByCharacter(characterId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { characterId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
