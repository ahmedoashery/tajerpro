import { Calculator, CheckCircle2, Clock, Printer, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import type { ShiftClosure, ShiftSummary, StaffUser, StoreSettings } from '../shared/types';
import { formatDateTimeAr, formatEGP } from '../utils/formatters';

interface ShiftClosingModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: StaffUser;
  settings: StoreSettings;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onShiftClosed: (msg: string) => void;
}

export function ShiftClosingModal({
  open,
  onClose,
  currentUser,
  settings,
  apiFetch,
  onShiftClosed,
}: ShiftClosingModalProps) {
  const { printDocument } = usePrint();
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingFloat, setOpeningFloat] = useState<number>(500);
  const [actualCash, setActualCash] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [justClosed, setJustClosed] = useState<ShiftClosure | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const data = await apiFetch<ShiftSummary>('/api/shifts/summary');
      setSummary(data);
      const netExpected = Number(
        (
          500 +
          data.cashSales +
          (data.cashCollections || 0) -
          (data.cashReturns || 0) -
          (data.cashExpenses || 0) -
          (data.cashSupplierPayouts || 0) -
          (data.cashEquityDrawings || 0)
        ).toFixed(2)
      );
      setActualCash(String(Math.max(0, netExpected)));
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحميل ملخص الوردية');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (open) {
      setJustClosed(null);
      loadSummary();
    }
  }, [open, loadSummary]);

  if (!open) return null;

  const cashCollections = summary?.cashCollections || 0;
  const cashReturns = summary?.cashReturns || 0;
  const cashExpenses = summary?.cashExpenses || 0;
  const cashSupplierPayouts = summary?.cashSupplierPayouts || 0;
  const cashEquityDrawings = summary?.cashEquityDrawings || 0;
  const expectedCash = summary
    ? Number(
        (
          openingFloat +
          summary.cashSales +
          cashCollections -
          cashReturns -
          cashExpenses -
          cashSupplierPayouts -
          cashEquityDrawings
        ).toFixed(2)
      )
    : 0;
  const actualNum = actualCash === '' ? expectedCash : Number(actualCash);
  const variance = Number((actualNum - expectedCash).toFixed(2));

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      const res = await apiFetch<{ closure: ShiftClosure; summary: ShiftSummary }>('/api/shifts/close', {
        method: 'POST',
        body: JSON.stringify({
          cashierId: currentUser.id,
          cashierName: currentUser.name,
          openingFloat,
          actualCash: actualNum,
          notes,
        }),
      });
      setSummary(res.summary);
      setJustClosed(res.closure);
      setNotes('');
      onShiftClosed('تم اعتماد تقفيل الوردية وجرد الدرج بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ تقفيل الوردية');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Calculator className="h-4 w-4 text-emerald-600" />
              <span>تقفيل الوردية وجرد درج النقدية (X/Z Report)</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              مطابقة النقدية الفعلية بالدرج مع مبيعات الكاش والتحصيل الإلكتروني منذ آخر تقفيل
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSummary}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              title="تحديث الأرقام"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {errMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {errMsg}
          </div>
        )}

        {justClosed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                تم تقفيل الوردية بنجاح ({formatDateTimeAr(justClosed.closedAt)}) — جاهز للطباعة
              </span>
            </div>
            <button
              type="button"
              onClick={() => printDocument({ kind: 'shift_z', closure: justClosed, settings })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>طباعة تقرير Z-Report</span>
            </button>
          </div>
        )}

        {summary && (
          <>
            {/* Live Channel Totals */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">مبيعات الكاش</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatEGP(summary.cashSales)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">إنستا باي</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatEGP(summary.instapayTotal)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">فودافون كاش</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatEGP(summary.walletTotal)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">فيزا / ماكينة</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatEGP(summary.cardTotal)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">آجل (عملاء)</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatEGP(summary.creditTotal)}
                </div>
              </div>
            </div>

            {/* Cash Count Reconciliation Form */}
            <form
              onSubmit={handleCloseShift}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  بداية الوردية الحالية: <strong className="font-mono-num">{formatDateTimeAr(summary.periodStartAt)}</strong>
                </span>
                <span className="font-mono-num">
                  {summary.invoiceCount} فاتورة مكتملة · {summary.returnedCount} مرتجع
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <div>
                  <label className="block font-medium mb-1">عهدة بداية الوردية (فكة الدرج)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>

                <div>
                  <label className="block font-medium mb-1">النقدي المتوقع بالدرج (صافي الحركة)</label>
                  <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
                    {formatEGP(expectedCash)}
                  </div>
                  <div className="mt-1 space-y-0.5 font-mono-num text-[11px]">
                    {cashCollections > 0 && (
                      <div className="text-emerald-600 dark:text-emerald-400">
                        + تحصيل آجل نقدي: {formatEGP(cashCollections)}
                      </div>
                    )}
                    {cashReturns > 0 && (
                      <div className="text-rose-600 dark:text-rose-400">
                        - مرتجع مبيعات نقدي: {formatEGP(cashReturns)}
                      </div>
                    )}
                    {cashExpenses > 0 && (
                      <div className="text-rose-600 dark:text-rose-400">
                        - مصروفات الدرج: {formatEGP(cashExpenses)}
                      </div>
                    )}
                    {cashSupplierPayouts > 0 && (
                      <div className="text-rose-600 dark:text-rose-400">
                        - مدفوعات موردين نقدية: {formatEGP(cashSupplierPayouts)}
                      </div>
                    )}
                    {cashEquityDrawings > 0 && (
                      <div className="text-rose-600 dark:text-rose-400">
                        - مسحوبات شركاء نقدية: {formatEGP(cashEquityDrawings)}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">الجرد الفعلي للنقدية بالدرج</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num text-sm font-bold focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs dark:bg-slate-950">
                <span className="font-medium text-slate-600 dark:text-slate-300">حالة مطابقة الدرج:</span>
                <span
                  className={`font-mono-num font-bold text-sm ${
                    variance === 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : variance > 0
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {variance === 0
                    ? 'متطابق 100% (0 ج.م)'
                    : variance > 0
                      ? `زيادة بالدرج +${formatEGP(variance)}`
                      : `عجز بالدرج ${formatEGP(variance)}`}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">ملاحظات تقفيل الوردية (اختياري)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: تم تسليم الدرج لموظف الوردية المسائية..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  إغلاق
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'جاري الاعتماد...' : 'اعتماد وتقفيل الوردية (Z-Report)'}
                </button>
              </div>
            </form>

            {/* Recent Closures History */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span>سجل تقفيلات الورديات السابقة</span>
              </div>
              {summary.recentClosures.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs text-slate-500 dark:border-slate-800">
                  لم يتم تسجيل تقفيل ورديات بعد — اعتمد التقفيل الأول من الأعلى.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {summary.recentClosures.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {c.cashierName} · <span className="font-mono-num">{formatDateTimeAr(c.closedAt)}</span>
                        </div>
                        <div className="text-slate-500 font-mono-num">
                          المتوقع: {formatEGP(c.expectedCash)} · الفعلي: {formatEGP(c.actualCash)} · إلكتروني:{' '}
                          {formatEGP(c.instapayTotal + c.walletTotal + c.cardTotal)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => printDocument({ kind: 'shift_z', closure: c, settings })}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>طباعة</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
