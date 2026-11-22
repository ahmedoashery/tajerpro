import {
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  FileDown,
  FileText,
  ImageDown,
  MessageCircle,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePrint } from '../../context/PrintContext';
import type { QuotationStatus, SalesQuotation, StoreActivityProfile, StoreSettings } from '../../shared/types';
import { formatDateTimeAr, formatEGP, formatNum } from '../../utils/formatters';
import { buildWhatsAppUrl, copyTextToClipboard, formatQuotationWhatsAppText } from '../../utils/whatsappShare';

interface QuotationsPanelProps {
  quotations: SalesQuotation[];
  settings: StoreSettings;
  activeActivity: StoreActivityProfile;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onLoadIntoEditor: (quotation: SalesQuotation) => void;
  onMutated: (msg: string) => void;
  onError: (msg: string) => void;
}

type StatusFilter = 'all' | 'active' | 'converted' | 'ended';

const STATUS_LABELS: Record<QuotationStatus, string> = {
  active: 'ساري',
  converted: 'محول لفاتورة',
  expired: 'منتهي الصلاحية',
  cancelled: 'ملغي',
};

const STATUS_BADGE_CLASSES: Record<QuotationStatus, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  converted: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300',
  expired: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
};

export function QuotationsPanel({
  quotations,
  settings,
  activeActivity,
  apiFetch,
  onLoadIntoEditor,
  onMutated,
  onError,
}: QuotationsPanelProps) {
  const { printDocument, openPrintPreview, exportDocumentAsPdf, exportDocumentAsPng, exporting } = usePrint();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const active = quotations.filter((q) => q.status === 'active');
    const converted = quotations.filter((q) => q.status === 'converted');
    const activeValue = active.reduce((s, q) => s + q.grandTotal, 0);
    return {
      total: quotations.length,
      activeCount: active.length,
      convertedCount: converted.length,
      activeValue,
    };
  }, [quotations]);

  const filtered = useMemo(() => {
    const qLower = search.trim().toLowerCase();
    return quotations.filter((qt) => {
      if (statusFilter === 'active' && qt.status !== 'active') return false;
      if (statusFilter === 'converted' && qt.status !== 'converted') return false;
      if (statusFilter === 'ended' && qt.status !== 'expired' && qt.status !== 'cancelled') return false;
      if (!qLower) return true;
      return (
        qt.quotationNumber.toLowerCase().includes(qLower) ||
        qt.customerName.toLowerCase().includes(qLower) ||
        (qt.customerPhone || '').toLowerCase().includes(qLower) ||
        qt.items.some((it) => it.productName.toLowerCase().includes(qLower))
      );
    });
  }, [quotations, search, statusFilter]);

  const handleToggleStatus = async (qt: SalesQuotation, nextStatus: 'active' | 'cancelled') => {
    setBusyId(qt.id);
    try {
      await apiFetch(`/api/quotations/${qt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      onMutated(
        nextStatus === 'cancelled'
          ? `تم إلغاء عرض السعر ${qt.quotationNumber}`
          : `تمت إعادة تفعيل عرض السعر ${qt.quotationNumber}`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر تحديث حالة عرض السعر');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (qt: SalesQuotation) => {
    setBusyId(qt.id);
    try {
      await apiFetch(`/api/quotations/${qt.id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      onMutated(`تم حذف عرض السعر ${qt.quotationNumber}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر حذف عرض السعر');
    } finally {
      setBusyId(null);
    }
  };

  const buildPayload = (qt: SalesQuotation) => ({
    kind: 'quotation_a4' as const,
    quotation: qt,
    settings,
    activityName: activeActivity.nameAr,
  });

  return (
    <div className="space-y-4">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">إجمالي عروض الأسعار</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {formatNum(stats.total)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">العروض السارية حالياً</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatNum(stats.activeCount)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">قيمة العروض السارية</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {formatEGP(stats.activeValue)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">عروض محولة لفواتير بيع</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-sky-700 dark:text-sky-400">
            {formatNum(stats.convertedCount)}
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `الكل (${quotations.length})` },
              { id: 'active', label: `ساري (${stats.activeCount})` },
              { id: 'converted', label: `محول لفاتورة (${stats.convertedCount})` },
              { id: 'ended', label: 'منتهي / ملغي' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === tab.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم العرض أو العميل أو الصنف..."
            className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <FileText className="mx-auto h-9 w-9 text-slate-400" />
          <div className="mt-2 font-display text-sm font-bold text-slate-800 dark:text-white">
            لا توجد عروض أسعار مطابقة
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            يمكنك إنشاء عرض سعر من جدول الفاتورة المكتبية عبر زر "حفظ كعرض سعر" دون خصم أي مخزون.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                  <tr>
                    <th className="px-3.5 py-3">رقم العرض</th>
                    <th className="px-3.5 py-3">العميل</th>
                    <th className="px-3.5 py-3 text-center">الأصناف</th>
                    <th className="px-3.5 py-3">الإجمالي</th>
                    <th className="px-3.5 py-3">صالح حتى</th>
                    <th className="px-3.5 py-3 text-center">الحالة</th>
                    <th className="px-3.5 py-3">إجراءات المستند والتحويل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((qt) => {
                    const isBusy = busyId === qt.id;
                    const whatsappTxt = formatQuotationWhatsAppText(qt, settings.storeName, settings.phone);
                    return (
                      <tr key={qt.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-3.5 py-3">
                          <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                            {qt.quotationNumber}
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-400">
                            {formatDateTimeAr(qt.createdAt)}
                          </div>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{qt.customerName}</div>
                          {qt.customerPhone && (
                            <div className="font-mono-num text-[11px] text-slate-500">{qt.customerPhone}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-center font-mono-num font-semibold">
                          {formatNum(qt.items.length)}
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                            {formatEGP(qt.grandTotal)}
                          </div>
                          {qt.discountTotal > 0 && (
                            <div className="font-mono-num text-[11px] text-rose-600 dark:text-rose-400">
                              خصم: {formatEGP(qt.discountTotal)}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 font-mono-num text-slate-700 dark:text-slate-300">
                          {qt.validUntil}
                        </td>
                        <td className="px-3.5 py-3 text-center">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE_CLASSES[qt.status]}`}
                          >
                            {STATUS_LABELS[qt.status]}
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {qt.status !== 'converted' && qt.status !== 'cancelled' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onLoadIntoEditor(qt)}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                title="تحميل الأصناف إلى المحرر لتحويلها إلى فاتورة بيع"
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                                <span>تحويل لفاتورة</span>
                              </button>
                            )}

                            {qt.status === 'converted' && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>تم الاعتماد</span>
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => openPrintPreview(buildPayload(qt))}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="معاينة"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => printDocument(buildPayload(qt))}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="طباعة A4"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={exporting}
                              onClick={() => void exportDocumentAsPdf(buildPayload(qt), `${qt.quotationNumber}.pdf`)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="تصدير PDF"
                            >
                              <FileDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={exporting}
                              onClick={() => void exportDocumentAsPng(buildPayload(qt), `${qt.quotationNumber}.png`)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="تصدير PNG"
                            >
                              <ImageDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await copyTextToClipboard(whatsappTxt);
                                setCopiedId(qt.id);
                                setTimeout(() => setCopiedId(null), 1800);
                              }}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="نسخ نص العرض"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {copiedId === qt.id && <span>تم</span>}
                            </button>
                            <a
                              href={buildWhatsAppUrl(qt.customerPhone, whatsappTxt)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                              title="إرسال عبر واتساب"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>

                            {qt.status === 'active' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleToggleStatus(qt, 'cancelled')}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:bg-slate-900 dark:text-amber-300"
                                title="إلغاء عرض السعر"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {qt.status === 'cancelled' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleToggleStatus(qt, 'active')}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-emerald-300"
                                title="إعادة تفعيل"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {confirmDeleteId === qt.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleDelete(qt)}
                                  className="min-h-[34px] rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-700"
                                >
                                  تأكيد الحذف
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[34px] rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                >
                                  تراجع
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(qt.id)}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                                title="حذف عرض السعر"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Responsive Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((qt) => {
              const isBusy = busyId === qt.id;
              const whatsappTxt = formatQuotationWhatsAppText(qt, settings.storeName, settings.phone);
              return (
                <div
                  key={qt.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                        {qt.quotationNumber}
                      </div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {qt.customerName}
                      </div>
                      <div className="font-mono-num text-[11px] text-slate-500">
                        {formatNum(qt.items.length)} صنف · صالح حتى {qt.validUntil}
                      </div>
                    </div>
                    <div className="text-left">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE_CLASSES[qt.status]}`}
                      >
                        {STATUS_LABELS[qt.status]}
                      </span>
                      <div className="mt-1 font-mono-num text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        {formatEGP(qt.grandTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    {qt.status !== 'converted' && qt.status !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onLoadIntoEditor(qt)}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        <span>تحويل لفاتورة</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => openPrintPreview(buildPayload(qt))}
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>معاينة</span>
                    </button>

                    <a
                      href={buildWhatsAppUrl(qt.customerPhone, whatsappTxt)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span>واتساب</span>
                    </a>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDelete(qt)}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-600 dark:border-rose-900/60 dark:text-rose-400"
                      aria-label="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
