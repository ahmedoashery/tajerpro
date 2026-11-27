import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_expenses');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف المصروف المتكرر مطلوب' });
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const rec = await tx.recurringExpense.findUnique({ where: { id } });
    if (!rec) throw createError({ statusCode: 404, statusMessage: 'المصروف المتكرر غير موجود' });

    if (rec.treasuryId) {
      await tx.treasuryAccount
        .update({
          where: { id: rec.treasuryId },
          data: { currentBalance: { decrement: num(rec.amount) } },
        })
        .catch(() => {});
    }

    const expense = await tx.storeExpense.create({
      data: {
        title: rec.title,
        category: rec.category,
        amount: rec.amount,
        paymentSource: rec.paymentSource,
        treasuryId: rec.treasuryId,
        treasuryName: rec.treasuryName,
        actorName: actor.name,
        notes: `صرف مجدول تلقائياً (${rec.frequency})`,
      },
    });

    const next = new Date(rec.nextDueDate);
    if (rec.frequency === 'DAILY') next.setDate(next.getDate() + 1);
    else if (rec.frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);

    const updatedRec = await tx.recurringExpense.update({
      where: { id: rec.id },
      data: { lastPaidAt: new Date(), nextDueDate: next },
    });

    return { expense, recurring: updatedRec };
  });
});
