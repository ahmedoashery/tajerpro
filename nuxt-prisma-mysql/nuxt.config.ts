export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'ar',
        dir: 'rtl',
      },
      title: 'تاجر برو — نظام إدارة المحلات التجارية (Nuxt + Prisma + MySQL)',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'برنامج إدارة المحلات التجارية والمخزون اللحظي والدفع الإلكتروني وحساب الأرباح التاريخي باستخدام Nuxt و Nuxt UI و Prisma و MySQL.',
        },
      ],
      link: [
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap',
        },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    licenseSecret: process.env.NUXT_LICENSE_SECRET || 'TAJIRPRO-PRODUCTION-HMAC-KEY',
    sessionSecret:
      process.env.NUXT_SESSION_SECRET ||
      process.env.SESSION_AUTH_SECRET ||
      'TAJIRPRO-NUXT-SESSION-HMAC-SECRET',
    cronSecret: process.env.CRON_SECRET || '',
    public: {
      appName: 'تاجر برو',
    },
  },
  nitro: {
    preset: process.env.VERCEL ? 'vercel' : 'node-server',
  },
});
