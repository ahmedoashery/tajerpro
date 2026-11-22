# تاجر برو (TajirPro) — نظام إدارة المحلات ونقاط البيع والمخزون

نظام **Full-Stack** متكامل لإدارة المحلات والأنشطة التجارية المتعددة (سوبر ماركت، مستحضرات تجميل، ملابس، إلكترونيات، جملة وقطاعي) مبني بـ **React 19 + TypeScript + Tailwind CSS + Express + SQLite/MySQL** مع دعم **PWA** وتوافق كامل مع النشر المباشر على **Vercel**.

---

## النشر المباشر على Vercel (من GitHub)

### 1) رفع المشروع إلى GitHub
**من داخل Google AI Studio:**
- اضغط على أيقونة **GitHub / Save to GitHub** في الشريط العلوي لرفع الكود إلى مستودعك.

**أو عبر Git يدوياً:**
```bash
git add .
git commit -m "Deploy TajirPro to Vercel"
git push origin main
```

### 2) النشر على Vercel
1. ادخل إلى [Vercel](https://vercel.com) واختر **Add New → Project** ثم اربط مستودع GitHub.
2. سيتعرف Vercel تلقائياً على إعدادات `vercel.json`:
   - **Install Command:** `npm install --include=dev --legacy-peer-deps`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Serverless API Route:** `api/handler.ts` (Node.js 22.x)
3. اضغط **Deploy**.

### 3) متغيرات البيئة الاختيارية على Vercel
من **Vercel → Project Settings → Environment Variables** يمكنك إضافة:
- `SESSION_AUTH_SECRET`: مفتاح سري لتوقيع جلسات الدخول عبر جميع حاويات Vercel.
- `LICENSE_INSTALL_SECRET`: مفتاح سري لتوقيع التراخيص وسلسلة الفواتير.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: لإرسال التقارير المجدولة بالبريد الإلكتروني.
- `CRON_SECRET`: (اختياري) لتأمين استدعاء `/api/cron/scheduled-reports`.

> **ملاحظة حول قاعدة البيانات على Vercel:**
> - يعمل النظام فوراً بدون أي إعداد إضافي عبر SQLite السريع داخل بيئة Vercel (`/tmp`) مع إمكانية تنزيل واستعادة نسخة احتياطية JSON في أي وقت من الإعدادات.
> - لربط قاعدة بيانات **MySQL 8.0** خارجية دائمة، أدخل بيانات الاتصال من واجهة النظام (**إعدادات الخادم وقواعد البيانات**) أو أضف متغيرات `DB_DRIVER=mysql` و`MYSQL_HOST` و`MYSQL_USER` و`MYSQL_PASSWORD` و`MYSQL_DATABASE` في Vercel.

---

## التشغيل المحلي للتطوير
```bash
npm install --include=dev --legacy-peer-deps
npm run dev
```
سيعمل التطبيق على `http://localhost:3000`.
