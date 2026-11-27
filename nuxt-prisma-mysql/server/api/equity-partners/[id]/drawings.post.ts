import { EquityDrawingType } from '@prisma/client';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

const drawingSchema = z.object({
  amount: z.number().positive(),
  type: z.nativeEnum(EquityDrawingType).default(EquityDrawingType.DRAW),
  treasuryId: z.string().nullable().optional(),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'view_reports');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الشريك مطلوب' });
  const body = drawingSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const partner = await tx.equityPartner.findUnique({ where: { id } });
    if (!partner) throw createError({ statusCode: 404, statusMessage: 'الشريك غير موجود' });

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });

    if (treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: {
          currentBalance:
            body.type === EquityDrawingType.CAPITAL_ADD
              ? { increment: body.amount }
              : { decrement: body.amount },
        },
      });
    }

    if (body.type === EquityDrawingType.CAPITAL_ADD) {
      await tx.equityPartner.update({
        where: { id: partner.id },
        data: { capitalContribution: { increment: body.amount } },
      });
    }

    const drawing = await tx.equityDrawing.create({
      data: {
        partnerId: partner.id,
        partnerName: partner.name,
        amount: body.amount,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        type: body.type,
        notes: body.notes,
        actorName: actor.name,
      },
    });

    return { drawing };
  });
});
