import { ExpenseCategory, ExpensePaymentSource } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const expenseSchema = z.object({
  title: z.string().min(1),
  category: z.nativeEnum(ExpenseCategory),
  amount: z.number().positive(),
  paymentSource: z.nativeEnum(ExpensePaymentSource).default(ExpensePaymentSource.CASH_DRAWER),
  treasuryId: z.string().nullable().optional(),
  receiptRef: z.string().default(''),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_expenses');
  const body = expenseSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });

    if (treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { decrement: body.amount } },
      });
    }

    const expense = await tx.storeExpense.create({
      data: {
        title: body.title.trim(),
        category: body.category,
        amount: body.amount,
        paymentSource: body.paymentSource,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        receiptRef: body.receiptRef,
        actorName: actor.name,
        notes: body.notes,
      },
    });

    return { expense };
  });
});
