import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { hashPin } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const schema = z.object({
  userId: z.string().min(1),
  pin: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const body = schema.parse(await readBody(event));
  const prisma = getPrisma();
  const user = await prisma.staffUser.findUnique({ where: { id: body.userId } });
  if (!user || !user.active || user.pinHash !== hashPin(body.pin)) {
    throw createError({ statusCode: 401, statusMessage: 'رمز الدخول (PIN) غير صحيح' });
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      active: user.active,
    },
  };
});
