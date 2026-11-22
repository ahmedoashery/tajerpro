import { Download, MonitorDown, Share, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        title="تثبيت البرنامج كتطبيق مستقل على الجهاز"
        className={`flex items-center gap-1.5 rounded-md bg-emerald-600 font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap ${
          compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-xs'
        }`}
      >
        <MonitorDown className="h-3.5 w-3.5 shrink-0" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        title="تثبيت البرنامج على سطح المكتب أو الهاتف (PWA)"
        className={`flex items-center gap-1.5 rounded-md border border-slate-200 font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs'
        }`}
      >
        {isIOS ? <Smartphone className="h-3.5 w-3.5 text-emerald-600" /> : <Download className="h-3.5 w-3.5 text-emerald-600" />}
        <span className="hidden xl:inline">تثبيت التطبيق</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MonitorDown className="h-4 w-4 text-emerald-600" />
                <span>تثبيت تاجر برو كتطبيق سطح مكتب / موبايل (PWA)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p>لتثبيت النظام على الآيفون أو الآيباد (iOS Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5 font-medium text-slate-800 dark:text-slate-100">
                  <li className="flex items-center gap-1.5">
                    <span>1. اضغط على زر المشاركة</span>
                    <Share className="inline h-3.5 w-3.5 text-emerald-600" />
                    <span>في شريط Safari.</span>
                  </li>
                  <li>2. اختر &quot;إضافة إلى الشاشة الرئيسية&quot; (Add to Home Screen).</li>
                  <li>3. اضغط &quot;إضافة&quot; ليعمل كتطبيق مستقل.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p>
                  النظام مهيأ بالكامل للعمل كتطبيق مستقل (Progressive Web App) بنافذة سطح مكتب خاصة وأيقونة مباشرة:
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-slate-700 dark:text-slate-200">
                  <li>
                    في متصفح <strong>Chrome</strong> أو <strong>Edge</strong>: اضغط على أيقونة التثبيت في شريط العنوان بالأعلى، أو من قائمة المتصفح اختر <strong>تثبيت تاجر برو</strong>.
                  </li>
                  <li>
                    على هواتف <strong>Android</strong>: افتح قائمة المتصفح واختر <strong>تثبيت التطبيق</strong> (Install App).
                  </li>
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
            >
              حسناً
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-9 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>وضع عدم الاتصال — يتم استخدام النسخة المخزنة مؤقتاً</span>
    </div>
  );
}
