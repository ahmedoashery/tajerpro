import { ExpenseCategory, ExpensePaymentSource, RecurringFrequency } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const recSchema = z.object({
  title: z.string().min(1),
  category: z.nativeEnum(ExpenseCategory),
  amount: z.number().positive(),
  paymentSource: z.nativeEnum(ExpensePaymentSource).default(ExpensePaymentSource.CASH_DRAWER),
  treasuryId: z.string().nullable().optional(),
  frequency: z.nativeEnum(RecurringFrequency).default(RecurringFrequency.MONTHLY),
  nextDueDate: z.string().optional(),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_expenses');
  const body = recSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const treasury = body.treasuryId
    ? await prisma.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
    : await prisma.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });

  const recurring = await prisma.recurringExpense.create({
    data: {
      title: body.title.trim(),
      category: body.category,
      amount: body.amount,
      paymentSource: body.paymentSource,
      treasuryId: treasury?.id || null,
      treasuryName: treasury?.name || '',
      frequency: body.frequency,
      nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : new Date(),
      notes: body.notes,
    },
  });

  return { recurring };
});
