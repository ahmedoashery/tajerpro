import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_expenses');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف المصروف مطلوب' });
  const prisma = getPrisma();
  await prisma.recurringExpense.delete({ where: { id } });
  return { ok: true };
});
