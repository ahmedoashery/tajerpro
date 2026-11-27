import { PaymentMethod } from '@prisma/client';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

const collectSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  treasuryId: z.string().nullable().optional(),
  referenceCode: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_partners');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف العميل مطلوب' });
  const body = collectSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id } });
    if (!customer) throw createError({ statusCode: 404, statusMessage: 'العميل غير موجود' });

    const applied = Math.min(num(customer.balanceDue), body.amount);
    const updatedCustomer = await tx.customer.update({
      where: { id: customer.id },
      data: { balanceDue: Number(Math.max(0, num(customer.balanceDue) - applied).toFixed(2)) },
    });

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });
    if (treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { increment: applied } },
      });
    }

    await tx.paymentTransaction.create({
      data: {
        customerId: customer.id,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        gateway: body.paymentMethod,
        referenceCode: body.referenceCode || `COL-${Date.now()}`,
        amount: applied,
        netAmount: applied,
        status: 'CONFIRMED',
      },
    });

    return { customer: updatedCustomer, collected: applied };
  });
});
