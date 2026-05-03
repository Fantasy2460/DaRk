import { prisma } from '../config/database';

export interface TransactionInput {
  characterId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  relatedItemId?: string;
  relatedRunId?: string;
}

export async function createTransaction(input: TransactionInput) {
  return prisma.characterTransaction.create({
    data: {
      characterId: input.characterId,
      type: input.type,
      amount: input.amount,
      balanceAfter: input.balanceAfter,
      relatedItemId: input.relatedItemId,
      relatedRunId: input.relatedRunId,
    },
  });
}

export async function getTransactionsByCharacter(characterId: string, limit = 100) {
  return prisma.characterTransaction.findMany({
    where: { characterId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
