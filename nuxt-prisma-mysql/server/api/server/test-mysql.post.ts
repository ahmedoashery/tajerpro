import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { switchRuntimeMysqlUrl } from '../../utils/prisma';

const testSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(3306),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().default(''),
  applyRuntime: z.boolean().default(false),
});

export default defineEventHandler(async (event) => {
  const body = testSchema.parse(await readBody(event));
  const encodedUser = encodeURIComponent(body.user);
  const encodedPass = encodeURIComponent(body.password);
  const url = `mysql://${encodedUser}:${encodedPass}@${body.host}:${body.port}/${body.database}`;

  try {
    if (body.applyRuntime) {
      await switchRuntimeMysqlUrl(url);
      return { ok: true, message: 'تم الاتصال وتوجيه Prisma إلى خادم MySQL المحدد بنجاح' };
    }
    const { PrismaClient } = await import('@prisma/client');
    const probe = new PrismaClient({ datasources: { db: { url } } });
    await probe.$queryRaw`SELECT 1`;
    await probe.$disconnect();
    return { ok: true, message: 'نجح الاتصال بخادم MySQL 8.0 عبر Prisma' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'تعذر الاتصال بخادم MySQL المحدد',
    };
  }
});
