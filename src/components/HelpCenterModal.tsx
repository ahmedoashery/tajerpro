import { BookOpen, Info, Keyboard, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LicenseStatus, StoreActivityProfile, StoreSettings } from '../shared/types';
import { formatDateTimeAr } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

export type HelpModalTab = 'guide' | 'shortcuts' | 'about';

interface HelpCenterModalProps {
  open: boolean;
  initialTab?: HelpModalTab;
  onClose: () => void;
  settings: StoreSettings;
  activeActivity: StoreActivityProfile;
  license: LicenseStatus;
  onOpenTab: (viewId: NavTabId) => void;
}

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: 'F2', description: 'فتح أو التركيز على شاشة نقطة البيع (الكاشير)' },
  { keys: 'F3', description: 'فتح شاشة فاتورة المبيعات التفصيلية (جدول الأصناف)' },
  { keys: 'Ctrl + Shift + N', description: 'فتح تبويب كاشير إضافي لخدمة عميل آخر بالتوازي' },
  { keys: 'Ctrl + K', description: 'فتح البحث الشامل السريع والأوامر' },
  { keys: 'Ctrl + B', description: 'إظهار أو إخفاء القائمة الجانبية' },
  { keys: 'Ctrl + U', description: 'تبديل الموظف أو تسجيل الدخول برمز PIN' },
  { keys: 'Ctrl + P', description: 'طباعة الشاشة أو التقرير الحالي' },
  { keys: 'Alt + 1', description: 'ملخص المحل اليومي (الرئيسية)' },
  { keys: 'Alt + 2', description: 'نقطة البيع والكاشير' },
  { keys: 'Alt + 3', description: 'المخزون والأسعار والتشغيلات' },
  { keys: 'Alt + 4', description: 'الفواتير والأرباح والمرتجعات' },
  { keys: 'Alt + 5', description: 'التقارير الشاملة والأرباح والخسائر' },
  { keys: 'Alt + 6', description: 'العملاء والموردون والدفع الإلكتروني' },
  { keys: 'Alt + 7', description: 'الصلاحيات والمستخدمون والترخيص' },
  { keys: 'Alt + 8', description: 'المشتريات وفواتير التوريد' },
  { keys: 'Alt + 9', description: 'المصروفات والخزينة اليومية' },
  { keys: 'Alt + 0', description: 'مركز الإعدادات والبيانات والنماذج' },
];

export function HelpCenterModal({
  open,
  initialTab = 'guide',
  onClose,
  settings,
  activeActivity,
  license,
  onOpenTab,
}: HelpCenterModalProps) {
  const [tab, setTab] = useState<HelpModalTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const jumpTo = (viewId: NavTabId) => {
    onClose();
    onOpenTab(viewId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex w-full max-w-2xl max-h-[90dvh] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              مركز المساعدة ودليل استخدام تاجر برو
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {settings.storeName} · {activeActivity.nameAr}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50/70 px-5 py-2 dark:border-slate-800 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={() => setTab('guide')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'guide'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>خريطة استخدام النظام</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('shortcuts')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'shortcuts'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span>اختصارات لوحة المفاتيح</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('about')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'about'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span>حول النظام والترخيص</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {tab === 'guide' && (
            <div className="space-y-4">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                تم تقسيم قائمة النظام العلوية إلى ست مجموعات قياسية لتسهيل العمل اليومي ومنع تشتيت الموظفين:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800 space-y-2">
                  <div className="font-bold text-slate-900 dark:text-white">01. ملف</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    الوصول إلى ملخص المحل اليومي، تبديل الموظف (PIN)، قفل الشاشة، الطباعة، وأخذ نسخة احتياطية JSON.
                  </p>
                  <button
                    type="button"
                    onClick={() => jumpTo('dashboard')}
                    className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    فتح ملخص المحل ←
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800 space-y-2">
                  <div className="font-bold text-slate-900 dark:text-white">02. تكويد</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    إعداد البيانات الأساسية قبل البدء: تكويد الأصناف والأسعار، التشغيلات FEFO، العروض، العملاء، الموردين، والخزائن.
                  </p>
                  <button
                    type="button"
                    onClick={() => jumpTo('inventory')}
                    className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    فتح شاشة الأصناف والمخزون ←
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800 space-y-2">
                  <div className="font-bold text-slate-900 dark:text-white">03. عمليات</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    الحركة اليومية الفورية: نقطة البيع (الكاشير)، الفواتير والمرتجعات، المشتريات، المصروفات، وتقفيل الوردية.
                  </p>
                  <button
                    type="button"
                    onClick={() => jumpTo('pos')}
                    className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    فتح الكاشير ونقطة البيع ←
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800 space-y-2">
                  <div className="font-bold text-slate-900 dark:text-white">04. تقارير و05. إعدادات</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    قوائم الأرباح والخسائر، حصص الشركاء، الأصناف الراكدة، منشئ التقارير المخصصة، الصلاحيات، وقوالب الطباعة.
                  </p>
                  <button
                    type="button"
                    onClick={() => jumpTo('reports')}
                    className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    فتح مركز التقارير الشاملة ←
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {SHORTCUTS.map((sc) => (
                <div key={sc.keys} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className="text-slate-700 dark:text-slate-200 font-medium">{sc.description}</span>
                  <kbd
                    dir="ltr"
                    className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono-num text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shrink-0"
                  >
                    {sc.keys}
                  </kbd>
                </div>
              ))}
            </div>
          )}

          {tab === 'about' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    تاجر برو — نظام إدارة المبيعات والمخزون والحسابات
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    النشاط الحالي: <strong>{activeActivity.nameAr}</strong> · حالة الترخيص:{' '}
                    <strong className={license.valid ? 'text-emerald-600' : 'text-rose-600'}>
                      {license.valid ? 'مفعّل وساري' : license.reason}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div>
                  <div className="text-slate-400">اسم المتجر المسجل</div>
                  <div className="mt-0.5 font-bold text-slate-900 dark:text-white">{settings.storeName}</div>
                </div>
                <div>
                  <div className="text-slate-400">باقة الترخيص</div>
                  <div className="mt-0.5 font-bold text-slate-900 dark:text-white">
                    {license.payload?.tier || 'قياسي'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">الحد الأقصى لنقاط البيع المتصلة</div>
                  <div className="mt-0.5 font-mono-num font-bold text-slate-900 dark:text-white">
                    {license.payload?.maxTerminals ?? 1} نقطة
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">انتهاء صلاحية الترخيص</div>
                  <div className="mt-0.5 font-mono-num font-bold text-slate-900 dark:text-white">
                    {license.payload?.expiresAt ? formatDateTimeAr(license.payload.expiresAt) : 'دائم'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
