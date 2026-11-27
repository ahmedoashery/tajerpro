import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_expenses');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف المصروف مطلوب' });
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const exp = await tx.storeExpense.findUnique({ where: { id } });
    if (!exp) throw createError({ statusCode: 404, statusMessage: 'المصروف غير موجود' });
    if (exp.treasuryId) {
      await tx.treasuryAccount
        .update({
          where: { id: exp.treasuryId },
          data: { currentBalance: { increment: num(exp.amount) } },
        })
        .catch(() => {});
    }
    await tx.storeExpense.delete({ where: { id } });
    return { ok: true };
  });
});
