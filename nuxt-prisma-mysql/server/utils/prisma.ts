import { PrismaClient } from '@prisma/client';

let runtimeDatabaseUrl = process.env.DATABASE_URL || '';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient(
      runtimeDatabaseUrl
        ? { datasources: { db: { url: runtimeDatabaseUrl } } }
        : undefined
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
