import {
  AlertTriangle,
  ArrowUpLeft,
  Calendar,
  CheckCircle2,
  Mail,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react';
import type { NavTabId } from './Sidebar';
import type { ScheduledReportDigest } from '../shared/types';
import { formatDateTimeAr, formatEGP, formatNum } from '../utils/formatters';

interface DigestViewerModalProps {
  digest: ScheduledReportDigest | null;
  canViewProfits: boolean;
  onClose: () => void;
  onNavigateTab?: (tab: NavTabId) => void;
}

const EMAIL_STATUS_LABELS: Record<ScheduledReportDigest['emailStatus'], string> = {
  sent: 'تم الإرسال عبر البريد',
  failed: 'فشل إرسال البريد',
  skipped_not_configured: 'إشعار داخلي (خادم SMTP غير مهيأ)',
  not_requested: 'إشعار داخل التطبيق فقط',
};

export function DigestViewerModal({
  digest,
  canViewProfits,
  onClose,
  onNavigateTab,
}: DigestViewerModalProps) {
  if (!digest) return null;

  const s = digest.summary;
  const showProfits = canViewProfits && s.profitsIncluded;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="space-y-1">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {digest.title}
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 font-mono-num">
                <Calendar className="h-3.5 w-3.5" />
                {digest.fromDate} ← {digest.toDate}
              </span>
              <span className="font-mono-num">{formatDateTimeAr(digest.createdAt)}</span>
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {EMAIL_STATUS_LABELS[digest.emailStatus]}
              </span>
            </div>
            {digest.emailError && digest.emailStatus === 'failed' && (
              <div className="text-xs text-rose-600 dark:text-rose-400">
                سبب تعذر البريد: {digest.emailError}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Primary KPI Strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="text-slate-500 dark:text-slate-400">صافي المبيعات</div>
              <div className="mt-1 font-mono-num text-lg font-extrabold text-slate-900 dark:text-white">
                {formatEGP(s.revenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
                {s.invoiceCount} فاتورة · {s.returnedCount} مرتجع
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="text-slate-500 dark:text-slate-400">مجمل الربح</div>
              <div className="mt-1 font-mono-num text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                {showProfits ? formatEGP(s.grossProfit) : 'مقيد'}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
                {showProfits ? `الهامش الإجمالي: ${s.grossMarginPercent}%` : 'غير مدرج بالملخص'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="text-slate-500 dark:text-slate-400">المصروفات وعمولات الدفع</div>
              <div className="mt-1 font-mono-num text-lg font-bold text-rose-600 dark:text-rose-400">
                {showProfits ? formatEGP(s.operatingExpenses + s.cardFees) : 'مقيد'}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
                {showProfits
                  ? `تشغيل: ${formatEGP(s.operatingExpenses)} · عمولات: ${formatEGP(s.cardFees)}`
                  : 'غير مدرج بالملخص'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="text-slate-500 dark:text-slate-400">صافي الربح التشغيلي</div>
              <div
                className={`mt-1 font-mono-num text-lg font-extrabold ${
                  !showProfits
                    ? 'text-slate-500'
                    : s.netOperatingProfit >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {showProfits ? formatEGP(s.netOperatingProfit) : 'مقيد'}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
                {showProfits ? `هامش الصافي: ${s.netMarginPercent}%` : 'حسب الصلاحية'}
              </div>
            </div>
          </div>

          {/* Financial & Stock Snapshot */}
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-300">متوسط قيمة الفاتورة</span>
              <span className="font-mono-num font-bold">{formatEGP(s.avgInvoiceValue)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-300">إجمالي السيولة بالخزائن</span>
              <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(s.treasuriesTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-300">ذمم العملاء (لنا) / مستحقات الموردين (علينا)</span>
              <span className="font-mono-num font-semibold">
                {formatEGP(s.customerReceivables)} / {formatEGP(s.supplierPayables)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-300">نواقص المخزون</span>
              <span className="font-mono-num font-semibold">
                <span className="text-rose-600">{formatNum(s.outOfStockCount)} نافد</span> ·{' '}
                <span className="text-amber-600">{formatNum(s.lowStockCount)} منخفض</span>
              </span>
            </div>
          </div>

          {/* Financial & Operational Warnings */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-amber-600" />
                <span>التحذيرات المالية والتشغيلية ({s.alerts.length})</span>
              </h4>
            </div>

            {s.alerts.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>لا توجد أي تحذيرات مالية أو تشغيلية حرجة وقت إنشاء هذا التقرير.</span>
              </div>
            ) : (
              <div className="space-y-2">
                {s.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                      alert.severity === 'danger'
                        ? 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
                        : alert.severity === 'warning'
                          ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                          : 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {alert.severity === 'danger' ? (
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <div>
                        <div className="font-bold">
                          {alert.title}
                          {alert.metricValue ? (
                            <span className="mr-2 font-mono-num font-normal opacity-80">
                              ({alert.metricValue})
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 opacity-85">{alert.message}</div>
                      </div>
                    </div>
                    {onNavigateTab && (
                      <button
                        type="button"
                        onClick={() => {
                          onNavigateTab(alert.actionTab);
                          onClose();
                        }}
                        className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-current/25 bg-white/80 px-3 py-1.5 text-xs font-semibold hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-900"
                      >
                        <span>{alert.actionLabel}</span>
                        <ArrowUpLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
