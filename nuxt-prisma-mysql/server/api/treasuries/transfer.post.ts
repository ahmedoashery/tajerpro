import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

const transferSchema = z.object({
  fromTreasuryId: z.string().min(1),
  toTreasuryId: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_payments');
  const body = transferSchema.parse(await readBody(event));
  if (body.fromTreasuryId === body.toTreasuryId) {
    throw createError({ statusCode: 400, statusMessage: 'اختر خزينتين مختلفتين للتحويل' });
  }
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const from = await tx.treasuryAccount.findUnique({ where: { id: body.fromTreasuryId } });
    const to = await tx.treasuryAccount.findUnique({ where: { id: body.toTreasuryId } });
    if (!from || !to) throw createError({ statusCode: 404, statusMessage: 'إحدى الخزائن غير موجودة' });
    if (num(from.currentBalance) < body.amount) {
      throw createError({ statusCode: 409, statusMessage: 'رصيد الخزينة المحوّل منها غير كافٍ' });
    }

    await tx.treasuryAccount.update({
      where: { id: from.id },
      data: { currentBalance: { decrement: body.amount } },
    });
    await tx.treasuryAccount.update({
      where: { id: to.id },
      data: { currentBalance: { increment: body.amount } },
    });

    const transfer = await tx.treasuryTransfer.create({
      data: {
        fromTreasuryId: from.id,
        toTreasuryId: to.id,
        amount: body.amount,
        notes: body.notes,
        actorName: actor.name,
      },
    });
    return { transfer };
  });
});
