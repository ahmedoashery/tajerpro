import { PaymentMethod } from '@prisma/client';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

const paySchema = z.object({
  amount: z.number().positive(),
  treasuryId: z.string().nullable().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  referenceCode: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_partners');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف المورد مطلوب' });
  const body = paySchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id } });
    if (!supplier) throw createError({ statusCode: 404, statusMessage: 'المورد غير موجود' });

    const paid = Math.min(num(supplier.balanceOwed), body.amount);
    const updatedSupplier = await tx.supplier.update({
      where: { id: supplier.id },
      data: { balanceOwed: Number(Math.max(0, num(supplier.balanceOwed) - paid).toFixed(2)) },
    });

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });
    if (treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { decrement: paid } },
      });
    }

    await tx.paymentTransaction.create({
      data: {
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        gateway: body.paymentMethod,
        referenceCode: body.referenceCode || `SUP-${Date.now()}`,
        amount: paid,
        netAmount: paid,
        status: 'CONFIRMED',
      },
    });

    return { supplier: updatedSupplier, paid };
  });
});
