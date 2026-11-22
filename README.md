# تاجر برو (TajirPro) — نظام إدارة المحلات ونقاط البيع والمخزون اللحظي

نظام **Full-Stack** متكامل لإدارة المحلات والأنشطة التجارية المتعددة (سوبر ماركت، مستحضرات تجميل، ملابس، إلكترونيات، جملة وقطاعي) مبني بـ **React 19 + TypeScript + Tailwind CSS + Express + WebSocket + SQLite/MySQL** مع دعم **PWA**.

---

## ربط المشروع بـ GitHub وتشغيله أونلاين

### 1) رفع المشروع إلى GitHub
**الطريقة الأسهل (من داخل Google AI Studio):**
- اضغط على أيقونة **GitHub / Save to GitHub** في الشريط العلوي داخل Google AI Studio لربط حسابك وإنشاء مستودع جديد ورفع الكود مباشرة.

**أو يدوياً بعد تنزيل مجلد المشروع:**
```bash
git init
git add .
git commit -m "Initial commit: TajirPro POS & Store System"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tajirpro-pos.git
git push -u origin main
```

---

### 2) التشغيل أونلاين مباشرة من GitHub

#### الخيار أ: Render (نشر تلقائي عبر `render.yaml`)
1. سجّل الدخول إلى [Render](https://render.com) بحساب GitHub الخاص بك.
2. اختر **New + → Blueprint** ثم اختر مستودع المشروع.
3. سيقرأ Render ملف `render.yaml` تلقائياً ويجهّز:
   - بناء الواجهة والخادم (`npm install && npm run build`)
   - تشغيل الخادم (`npm start` مع `NODE_ENV=production`)
   - قرص تخزين دائم على `/app/data` لحفظ قاعدة البيانات (`SQLITE_PATH=/app/data/tajirpro.db`)
   - مفتاح حماية تلقائي (`LICENSE_INSTALL_SECRET`)

#### الخيار ب: Railway (نشر تلقائي عبر `Dockerfile` و`railway.toml`)
1. سجّل الدخول إلى [Railway](https://railway.app) بحساب GitHub.
2. اختر **New Project → Deploy from GitHub repo** واختر مستودعك.
3. من تبويب **Variables** أضف:
   - `NODE_ENV=production`
   - `SQLITE_PATH=/app/data/tajirpro.db`
   - `LICENSE_INSTALL_SECRET=<أي نص سري طويل>`
4. من تبويب **Settings / Volumes** أضف Volume على المسار `/app/data` لحفظ البيانات بشكل دائم.

#### الخيار ج: النشر على Vercel
1. يدعم المشروع الآن التشغيل على **Vercel** مباشرة عبر `vercel.json` و`api/index.ts` للتجربة والمعاينة السريعة (تُحفظ قاعدة البيانات مؤقتاً في `/tmp` أثناء التجربة).
2. **للتشغيل الفعلي وحفظ البيانات بشكل دائم** مع استخدام رابط Vercel:
   - انشر الخادم الخلفي على **Render** أو **Railway**.
   - أضف في **Vercel → Project Settings → Environment Variables** المتغير:
     `VITE_API_BASE_URL=https://your-backend-url.onrender.com`
   - ثم أعد نشر المشروع (**Redeploy**).

#### الخيار د: استخدام قاعدة بيانات MySQL سحابية (اختياري)
إذا أردت ربط النظام بقاعدة بيانات **MySQL** بدلاً من SQLite (على Hostinger / AWS RDS / PlanetScale / Aiven / Railway MySQL):
- أضف متغيرات البيئة التالية:
  ```env
  DB_DRIVER=mysql
  MYSQL_HOST=your-mysql-host
  MYSQL_PORT=3306
  MYSQL_USER=your-user
  MYSQL_PASSWORD=your-password
  MYSQL_DATABASE=tajirpro_pos
  ```
- أو أدخلها مباشرة من واجهة النظام عبر **إعدادات الخادم وقواعد البيانات**.

---

### 3) التشغيل المحلي السريع
```bash
npm install
npm run build
NODE_ENV=production npm start
```
سيعمل الخادم على `http://localhost:3000`.
