import { PrismaClient } from '@prisma/client';

let runtimeDatabaseUrl = process.env.DATABASE_URL || '';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getRuntimeDatabaseUrl(): string {
  if (runtimeDatabaseUrl) return runtimeDatabaseUrl;
  try {
    const cfg = useRuntimeConfig();
    if (cfg?.databaseUrl) return String(cfg.databaseUrl);
  } catch {
    // ignore outside nitro request lifecycle
  }
  return process.env.DATABASE_URL || '';
}

export function isDatabaseConfigured(): boolean {
  const url = getRuntimeDatabaseUrl();
  return Boolean(url && url.trim().startsWith('mysql://'));
}

export function getPrisma(): PrismaClient {
  const activeUrl = getRuntimeDatabaseUrl();
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient(
      activeUrl ? { datasources: { db: { url: activeUrl } } } : undefined
    );
  }
  return globalForPrisma.prisma;
}

export async function switchRuntimeMysqlUrl(nextUrl: string): Promise<void> {
  const testClient = new PrismaClient({
    datasources: { db: { url: nextUrl } },
  });
  await testClient.$queryRaw`SELECT 1`;
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect().catch(() => {});
  }
  runtimeDatabaseUrl = nextUrl;
  globalForPrisma.prisma = testClient;
}

export function num(val: unknown, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}
