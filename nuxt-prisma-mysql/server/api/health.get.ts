import { defineEventHandler } from 'h3';
import { getPrisma } from '../utils/prisma';

export default defineEventHandler(async () => {
  const prisma = getPrisma();
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    return {
      ok: true,
      dbEngine: 'mysql',
      orm: 'prisma',
      storeName: settings?.storeName || 'تاجر برو',
      latencyMs: Math.max(1, Date.now() - started),
      serverTime: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      dbEngine: 'mysql',
      orm: 'prisma',
      error: err instanceof Error ? err.message : 'MySQL connection unavailable',
      latencyMs: Math.max(1, Date.now() - started),
    };
  }
});
