# تاجر برو — TajirPro (Nuxt 3 + Nuxt UI + Prisma + MySQL 8.0)

نسخة مستقلة بالكامل مبنية حصرياً بتقنيات **Nuxt 3 + Nuxt UI + Prisma + MySQL 8.0** لنظام إدارة المحلات التجارية في السوق المصري:
- نقاط بيع (POS) سريعة مع دعم الدفع الإلكتروني (كاش، إنستا باي، فودافون كاش، فيزا/ميزة، آجل).
- حساب أرباح الأصناف **بتاريخ الفاتورة** (`unitPriceSnapshot` و`unitCostSnapshot`) بحيث لا تتأثر الفواتير السابقة بتعديل الأسعار مستقبلاً.
- تحديث لحظي للمخزون وتنبيهات حد الطلب ونفاد الأصناف.
- صلاحيات المستخدمين (RBAC) + تقفيل الوردية (`Z-Report`) + سلسلة تحقق الفواتير (`SHA-256`) + طباعة A4 و80mm.
- نافذة إعدادات الخادم وMySQL من شاشة تسجيل الدخول.

## خطوات التشغيل والنشر أونلاين

### 1) إعداد قاعدة بيانات MySQL 8.0
يمكنك استخدام MySQL محلي أو سحابي (Railway / Aiven / DigitalOcean / VPS) ثم ضبط المتغير في `.env`:
```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/tajirpro_pos"
NUXT_LICENSE_SECRET="your-strong-secret-key"
```

### 2) تهيئة الجداول والبيانات الأولية وتشغيل النظام
```bash
npm install
npx prisma generate
npx prisma db push
npx prisma db seed
npm run build
npm start
```

### 3) النشر السريع عبر Docker Compose (MySQL + Nuxt أونلاين)
```bash
docker compose up -d --build
```
سيعمل التطبيق على المنفذ `3000` متصلاً بقاعدة بيانات MySQL 8.0 تلقائياً.
