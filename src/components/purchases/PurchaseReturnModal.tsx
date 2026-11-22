import { RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PurchaseOrder, StaffUser, TreasuryAccount } from '../../shared/types';
import { formatEGP, formatNum, TREASURY_TYPE_LABELS } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

interface PurchaseReturnModalProps {
  purchase: PurchaseOrder;
  activeTreasuries: TreasuryAccount[];
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onReturned: (msg: string) => void;
}

export function PurchaseReturnModal({
  purchase,
  activeTreasuries,
  currentUser,
  apiFetch,
  onClose,
  onReturned,
}: PurchaseReturnModalProps) {
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const it of purchase.items) {
      map[it.id] = 0;
    }
    return map;
  });
  const [refundMethod, setRefundMethod] = useState<'cash' | 'bank_transfer' | 'credit'>(
    purchase.remainingDebt > 0 ? 'credit' : 'cash'
  );
  const [treasuryId, setTreasuryId] = useState<string>('');
  const [reason, setReason] = useState('مرتجع بضاعة تالفة أو غير مطابقة للمورد');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const matchingTreasuries = useMemo(() => {
    if (refundMethod === 'credit') return [];
    if (refundMethod === 'cash') {
      return activeTreasuries.filter((t) => t.type === 'cash_drawer');
    }
    return activeTreasuries.filter((t) => t.type !== 'cash_drawer');
  }, [activeTreasuries, refundMethod]);

  useEffect(() => {
    if (refundMethod === 'credit') {
      setTreasuryId('');
      return;
    }
    if (matchingTreasuries.length === 0) {
      setTreasuryId(activeTreasuries[0]?.id || '');
      return;
    }
    if (!matchingTreasuries.some((t) => t.id === treasuryId)) {
      const def = matchingTreasuries.find((t) => t.isDefault) || matchingTreasuries[0];
      setTreasuryId(def.id);
    }
  }, [refundMethod, matchingTreasuries, activeTreasuries, treasuryId]);

  const totalReturnAmount = useMemo(() => {
    let total = 0;
    for (const it of purchase.items) {
      const maxRet = Math.max(0, Number((it.quantity - (it.returnedQuantity || 0)).toFixed(3)));
      const q = Math.max(0, Math.min(maxRet, Number(returnQuantities[it.id] || 0)));
      total += q * it.unitCost;
    }
    return Number(total.toFixed(2));
  }, [purchase.items, returnQuantities]);

  const debtReductionPreview = Math.min(purchase.remainingDebt, totalReturnAmount);
  const cashRefundPreview = Number(Math.max(0, totalReturnAmount - debtReductionPreview).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = purchase.items
      .map((it) => ({
        itemId: it.id,
        quantity: Number(returnQuantities[it.id] || 0),
      }))
      .filter((x) => x.quantity > 0);

    if (items.length === 0) {
      setErrMsg('يرجى تحديد كمية الإرجاع لصنف واحد على الأقل.');
      return;
    }
    setSubmitting(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/purchases/${purchase.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          items,
          refundMethod,
          treasuryId: cashRefundPreview > 0 && refundMethod !== 'credit' ? treasuryId || null : null,
          reason: reason.trim() || 'مرتجع مشتريات للمورد',
          actorName: currentUser.name,
        }),
      });
      onReturned(
        `تم تسجيل مرتجع مشتريات بقيمة ${formatEGP(totalReturnAmount)} على فاتورة ${purchase.purchaseNumber}`
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تنفيذ مرتجع المشتريات');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-rose-600" />
            <span>مرتجع مشتريات للمورد — {purchase.purchaseNumber}</span>
          </h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-3 font-mono-num">
          <span>المورد: {purchase.supplierName}</span>
          <span>·</span>
          <span>الآجل المتبقي على الفاتورة: {formatEGP(purchase.remainingDebt)}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950">
              <tr>
                <th className="px-3 py-2">الصنف</th>
                <th className="px-3 py-2">المتاح للإرجاع</th>
                <th className="px-3 py-2">سعر الشراء</th>
                <th className="px-3 py-2">كمية المرتجع</th>
                <th className="px-3 py-2">قيمة المرتجع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchase.items.map((it) => {
                const maxRet = Math.max(0, Number((it.quantity - (it.returnedQuantity || 0)).toFixed(3)));
                const qtyVal = Number(returnQuantities[it.id] || 0);
                return (
                  <tr key={it.id}>
                    <td className="px-3 py-2 font-semibold">{it.productName}</td>
                    <td className="px-3 py-2 font-mono-num">
                      {formatNum(maxRet)} {it.unit}
                    </td>
                    <td className="px-3 py-2 font-mono-num">{formatEGP(it.unitCost)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={maxRet}
                        step="any"
                        disabled={maxRet <= 0}
                        value={qtyVal}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(maxRet, Number(e.target.value) || 0));
                          setReturnQuantities((prev) => ({ ...prev, [it.id]: n }));
                        }}
                        className="w-24 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono-num font-bold text-rose-600">
                      {formatEGP(qtyVal * it.unitCost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div>
            <label className="block font-semibold mb-1">آلية تسوية الفائض النقدي بعد خصم الآجل</label>
            <SearchableSelect
              value={refundMethod}
              onChange={(v) => setRefundMethod(v as 'cash' | 'bank_transfer' | 'credit')}
              options={[
                { value: 'cash', label: 'استرداد نقدي إلى الخزينة' },
                { value: 'bank_transfer', label: 'استرداد بتحويل بنكي' },
                { value: 'credit', label: 'خصم من رصيد المورد فقط (دون نقدية)' },
              ]}
            />
          </div>

          {cashRefundPreview > 0 && refundMethod !== 'credit' && activeTreasuries.length > 0 ? (
            <div>
              <label className="block font-semibold mb-1">الخزينة المستلمة للمرتجع النقدي</label>
              <SearchableSelect
                value={treasuryId}
                onChange={setTreasuryId}
                options={(matchingTreasuries.length > 0 ? matchingTreasuries : activeTreasuries).map((t) => ({
                  value: t.id,
                  label: t.name,
                  sublabel: `${TREASURY_TYPE_LABELS[t.type]} · الرصيد: ${formatEGP(t.currentBalance)}`,
                }))}
              />
            </div>
          ) : (
            <div>
              <label className="block font-semibold mb-1">سبب المرتجع</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          )}
        </div>

        {cashRefundPreview > 0 && refundMethod !== 'credit' && (
          <div className="text-xs">
            <label className="block font-semibold mb-1">سبب المرتجع</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-mono-num dark:border-slate-800 dark:bg-slate-950">
          <div>
            <div className="text-slate-500">إجمالي المرتجع</div>
            <div className="font-bold text-rose-600">{formatEGP(totalReturnAmount)}</div>
          </div>
          <div>
            <div className="text-slate-500">خصم من مديونية المورد</div>
            <div className="font-bold text-slate-900 dark:text-white">{formatEGP(debtReductionPreview)}</div>
          </div>
          <div>
            <div className="text-slate-500">مسترد للخزينة</div>
            <div className="font-bold text-emerald-600">
              {refundMethod === 'credit' ? formatEGP(0) : formatEGP(cashRefundPreview)}
            </div>
          </div>
        </div>

        {errMsg && <div className="text-xs font-medium text-rose-600">{errMsg}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={submitting || totalReturnAmount <= 0}
            className="rounded-lg bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {submitting ? 'جاري التنفيذ...' : 'اعتماد مرتجع المشتريات'}
          </button>
        </div>
      </form>
    </div>
  );
}
