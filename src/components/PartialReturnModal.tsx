import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Minus, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type {
  Invoice,
  PaymentMethod,
  Product,
  TreasuryAccount,
} from '../shared/types';
import { formatEGP, formatNum } from '../utils/formatters';

export type PartialRefundStrategy = 'cash' | 'instapay' | 'wallet' | 'reduce_credit' | 'store_credit';

interface PartialReturnModalProps {
  open: boolean;
  invoice: Invoice | null;
  products: Product[];
  treasuries: TreasuryAccount[];
  apiHeaders?: Record<string, string>;
  apiFetch?: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function PartialReturnModal({
  open,
  invoice,
  products,
  treasuries,
  apiHeaders,
  apiFetch,
  onClose,
  onSuccess,
}: PartialReturnModalProps) {
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [strategy, setStrategy] = useState<PartialRefundStrategy>('cash');
  const [treasuryId, setTreasuryId] = useState<string>('');
  const [reason, setReason] = useState('مرتجع عميل');
  const [enableExchange, setEnableExchange] = useState(false);
  const [exchangeSearch, setExchangeSearch] = useState('');
  const [exchangeLines, setExchangeLines] = useState<
    Array<{ product: Product; quantity: number; unitSalePrice: number }>
  >([]);
  const [diffMethod, setDiffMethod] = useState<PaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open || !invoice) return;
    const init: Record<string, number> = {};
    for (const it of invoice.items) {
      init[it.id] = 0;
    }
    setReturnQtys(init);
    setStrategy(invoice.customerId && invoice.paymentMethod === 'credit' ? 'reduce_credit' : 'cash');
    const defCash = treasuries.find((t) => t.active && t.type === 'cash_drawer' && t.isDefault) || treasuries[0];
    setTreasuryId(defCash?.id || '');
    setReason('مرتجع عميل');
    setEnableExchange(false);
    setExchangeSearch('');
    setExchangeLines([]);
    setDiffMethod('cash');
    setErrorMsg('');
  }, [open, invoice, treasuries]);

  const netRatio = useMemo(() => {
    if (!invoice) return 1;
    const origTotal = invoice.grandTotal + Number(invoice.returnedTotal || 0);
    const itemsSum = invoice.items.reduce((s, it) => s + Number(it.lineTotal || 0), 0);
    return itemsSum > 0 ? origTotal / itemsSum : 1;
  }, [invoice]);

  const estimatedReturnTotal = useMemo(() => {
    if (!invoice) return 0;
    let total = 0;
    let returningAll = true;
    for (const it of invoice.items) {
      const rem = Math.max(0, it.quantity - Number(it.returnedQuantity || 0));
      const rq = Math.min(rem, Math.max(0, Number(returnQtys[it.id] || 0)));
      if (rem - rq > 0.0001) returningAll = false;
      if (rq > 0 && it.quantity > 0) {
        total += (it.lineTotal / it.quantity) * netRatio * rq;
      }
    }
    if (returningAll && Object.values(returnQtys).some((q) => q > 0)) {
      return Number(invoice.grandTotal.toFixed(2));
    }
    return Number(Math.min(invoice.grandTotal, total).toFixed(2));
  }, [invoice, returnQtys, netRatio]);

  const exchangeTotal = useMemo(() => {
    if (!enableExchange) return 0;
    return Number(exchangeLines.reduce((s, l) => s + l.quantity * l.unitSalePrice, 0).toFixed(2));
  }, [enableExchange, exchangeLines]);

  const netDifference = Number((exchangeTotal - estimatedReturnTotal).toFixed(2));

  const filteredExchangeProducts = useMemo(() => {
    const q = exchangeSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 10);
  }, [products, exchangeSearch]);

  if (!open || !invoice) return null;

  const selectedItems = Object.entries(returnQtys)
    .filter(([, q]) => q > 0)
    .map(([invoiceItemId, quantity]) => ({ invoiceItemId, quantity }));

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      setErrorMsg('يرجى تحديد كمية لإرجاع صنف واحد على الأقل.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const payloadBody = JSON.stringify({
        items: selectedItems,
        refundStrategy: strategy,
        treasuryId: strategy === 'reduce_credit' || strategy === 'store_credit' ? null : treasuryId || null,
        reason,
        exchangeItems:
          enableExchange && exchangeLines.length > 0
            ? exchangeLines.map((l) => ({
                productId: l.product.id,
                quantity: l.quantity,
                unitSalePrice: l.unitSalePrice,
              }))
            : undefined,
        exchangeDifferenceMethod: diffMethod,
      });

      let data: { exchangeInvoice?: { invoiceNumber: string }; returnRecord?: { returnTotal: number } };
      if (apiFetch) {
        data = await apiFetch(`/api/invoices/${invoice.id}/partial-return`, {
          method: 'POST',
          body: payloadBody,
        });
      } else {
        const res = await fetch(`/api/invoices/${invoice.id}/partial-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiHeaders || {}) },
          body: payloadBody,
        });
        const parsed = await res.json();
        if (!res.ok) {
          setErrorMsg(parsed.error || 'تعذر تنفيذ عملية المرتجع أو الاستبدال.');
          return;
        }
        data = parsed;
      }

      onSuccess(
        data.exchangeInvoice
          ? `تم تنفيذ المرتجع وإصدار فاتورة الاستبدال ${data.exchangeInvoice.invoiceNumber}`
          : `تم تسجيل مرتجع بقيمة ${formatEGP(data.returnRecord?.returnTotal || estimatedReturnTotal)} للفاتورة ${invoice.invoiceNumber}`
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالخادم.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                مرتجع جزئي / استبدال — {invoice.invoiceNumber}
              </h3>
              <p className="text-xs text-slate-500">
                العميل: {invoice.customerName} · الصافي المتاح حالياً:{' '}
                <span className="font-mono-num font-bold text-slate-800 dark:text-slate-200">
                  {formatEGP(invoice.grandTotal)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-sm font-medium text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Items table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">1. حدد كميات الأصناف المرتجعة</h4>
              <button
                type="button"
                onClick={() => {
                  const allMax: Record<string, number> = {};
                  for (const it of invoice.items) {
                    allMax[it.id] = Math.max(0, Number((it.quantity - (it.returnedQuantity || 0)).toFixed(3)));
                  }
                  setReturnQtys(allMax);
                }}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                تحديد المتبقي بالكامل
              </button>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
              {invoice.items.map((it) => {
                const alreadyReturned = Number(it.returnedQuantity || 0);
                const remaining = Number(Math.max(0, it.quantity - alreadyReturned).toFixed(3));
                const curReq = Number(returnQtys[it.id] || 0);
                const unitNet = it.quantity > 0 ? (it.lineTotal / it.quantity) * netRatio : 0;
                return (
                  <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-[180px] flex-1">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{it.productName}</div>
                      <div className="text-xs text-slate-500 font-mono-num">
                        مباع: {formatNum(it.quantity)} {it.unit}
                        {alreadyReturned > 0 ? ` · مسترجع سابقاً: ${formatNum(alreadyReturned)}` : ''} · متاح:{' '}
                        {formatNum(remaining)} · صافي الوحدة: {formatEGP(unitNet)}
                      </div>
                    </div>

                    {remaining > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setReturnQtys((p) => ({
                              ...p,
                              [it.id]: Math.max(0, Number((curReq - 1).toFixed(3))),
                            }))
                          }
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={remaining}
                          step="any"
                          value={curReq}
                          onChange={(e) => {
                            const v = Math.min(remaining, Math.max(0, Number(e.target.value || 0)));
                            setReturnQtys((p) => ({ ...p, [it.id]: v }));
                          }}
                          className="w-20 min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center text-sm font-mono-num font-bold text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setReturnQtys((p) => ({
                              ...p,
                              [it.id]: Math.min(remaining, Number((curReq + 1).toFixed(3))),
                            }))
                          }
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-slate-400">مرتجع بالكامل</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Refund settlement strategy */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                تسوية قيمة المرتجع
              </label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as PartialRefundStrategy)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
              >
                <option value="cash">رد نقدي من الخزينة</option>
                <option value="instapay">رد عبر إنستا باي</option>
                <option value="wallet">رد عبر محفظة إلكترونية</option>
                <option value="reduce_credit" disabled={!invoice.customerId}>
                  خصم من مديونية العميل الآجلة
                </option>
                <option value="store_credit" disabled={!invoice.customerId}>
                  إضافة كرصيد دائن للعميل (Store Credit)
                </option>
              </select>
            </div>

            {strategy !== 'reduce_credit' && strategy !== 'store_credit' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  الخزينة المصروف منها
                </label>
                <select
                  value={treasuryId}
                  onChange={(e) => setTreasuryId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                >
                  {treasuries
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatEGP(t.currentBalance)})
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                سبب المرتجع
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Exchange toggle */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-sky-600" />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  استبدال بأصناف جديدة (إصدار فاتورة بديلة مرتبطة)
                </span>
              </div>
              <input
                type="checkbox"
                checked={enableExchange}
                onChange={(e) => setEnableExchange(e.target.checked)}
                className="h-5 w-5 accent-emerald-600"
              />
            </label>

            {enableExchange && (
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={exchangeSearch}
                    onChange={(e) => setExchangeSearch(e.target.value)}
                    placeholder="ابحث عن صنف بديل لإضافته..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-sm text-slate-900 dark:text-white"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {filteredExchangeProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setExchangeLines((prev) => {
                          const idx = prev.findIndex((x) => x.product.id === p.id);
                          if (idx >= 0) {
                            return prev.map((x, i) => (i === idx ? { ...x, quantity: x.quantity + 1 } : x));
                          }
                          return [...prev, { product: p, quantity: 1, unitSalePrice: p.currentSalePrice }];
                        })
                      }
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-emerald-500 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      + {p.name} (<span className="font-mono-num">{formatEGP(p.currentSalePrice)}</span>)
                    </button>
                  ))}
                </div>

                {exchangeLines.length > 0 && (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
                    {exchangeLines.map((line) => (
                      <div key={line.product.id} className="flex items-center justify-between gap-3 p-2.5 text-xs">
                        <div className="font-bold text-slate-900 dark:text-white">{line.product.name}</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0.1}
                            step="any"
                            value={line.quantity}
                            onChange={(e) => {
                              const q = Math.max(0.1, Number(e.target.value || 1));
                              setExchangeLines((prev) =>
                                prev.map((x) => (x.product.id === line.product.id ? { ...x, quantity: q } : x))
                              );
                            }}
                            className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-center font-mono-num"
                          />
                          <span className="font-mono-num font-bold">{formatEGP(line.quantity * line.unitSalePrice)}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setExchangeLines((prev) => prev.filter((x) => x.product.id !== line.product.id))
                            }
                            className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      طريقة سداد الفاتورة البديلة
                    </label>
                    <select
                      value={diffMethod}
                      onChange={(e) => setDiffMethod(e.target.value as PaymentMethod)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm"
                    >
                      <option value="cash">نقدي</option>
                      <option value="instapay">إنستا باي</option>
                      <option value="vodafone_cash">محفظة كاش</option>
                      <option value="card">بطاقة / فيزا</option>
                      {invoice.customerId && <option value="credit">آجل على العميل</option>}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-5 py-4">
          <div className="space-y-0.5 text-xs">
            <div>
              إجمالي المرتجع:{' '}
              <strong className="font-mono-num text-sm text-amber-700 dark:text-amber-400">
                {formatEGP(estimatedReturnTotal)}
              </strong>
            </div>
            {enableExchange && exchangeLines.length > 0 && (
              <div>
                صافي فرق الاستبدال:{' '}
                <strong className="font-mono-num text-sm text-sky-700 dark:text-sky-400">
                  {netDifference > 0
                    ? `يدفع العميل ${formatEGP(netDifference)}`
                    : netDifference < 0
                      ? `يُرد للعميل ${formatEGP(Math.abs(netDifference))}`
                      : 'متساوي (0.00 ج.م)'}
                </strong>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={submitting || selectedItems.length === 0}
              onClick={handleSubmit}
              className="min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-5 text-sm font-bold text-white"
            >
              {submitting ? 'جاري التنفيذ...' : enableExchange && exchangeLines.length > 0 ? 'اعتماد المرتجع والاستبدال' : 'اعتماد المرتجع الجزئي'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
