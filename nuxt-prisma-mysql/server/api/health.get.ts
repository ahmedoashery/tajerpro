import { defineEventHandler } from 'h3';
import { getPrisma, isDatabaseConfigured } from '../utils/prisma';

export default defineEventHandler(async () => {
  const started = Date.now();
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      configured: false,
      dbEngine: 'mysql',
      orm: 'prisma',
      error: 'لم يتم ضبط متغير DATABASE_URL لخادم MySQL 8.0 بعد.',
      latencyMs: Math.max(1, Date.now() - started),
      serverTime: new Date().toISOString(),
    };
  }
  const prisma = getPrisma();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    return {
      ok: true,
      configured: true,
      dbEngine: 'mysql',
      orm: 'prisma',
      storeName: settings?.storeName || 'تاجر برو',
      latencyMs: Math.max(1, Date.now() - started),
      serverTime: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      dbEngine: 'mysql',
      orm: 'prisma',
      error: err instanceof Error ? err.message : 'تعذر الاتصال بخادم MySQL',
      latencyMs: Math.max(1, Date.now() - started),
      serverTime: new Date().toISOString(),
    };
  }
});
