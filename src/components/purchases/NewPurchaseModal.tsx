import { AlertTriangle, PackageCheck, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AutoReorderSupplierGroup,
  Product,
  PurchaseOrder,
  StaffUser,
  Supplier,
  TreasuryAccount,
} from '../../shared/types';
import { formatEGP, formatNum, TREASURY_TYPE_LABELS } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

export interface DraftPurchaseItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  newSalePrice: number;
  batchCode?: string;
  expiryDate?: string;
}

const SOURCE_LABELS: Record<'cash' | 'bank_transfer' | 'credit', string> = {
  cash: 'سداد نقدي (درج/خزينة)',
  bank_transfer: 'تحويل بنكي / إنستا باي',
  credit: 'آجل بالكامل على الحساب',
};

interface NewPurchaseModalProps {
  suppliers: Supplier[];
  products: Product[];
  activeTreasuries: TreasuryAccount[];
  prefillDraft: AutoReorderSupplierGroup | null;
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onCreated: (purchase: PurchaseOrder) => void;
}

export function NewPurchaseModal({
  suppliers,
  products,
  activeTreasuries,
  prefillDraft,
  currentUser,
  apiFetch,
  onClose,
  onCreated,
}: NewPurchaseModalProps) {
  const [supplierId, setSupplierId] = useState<string>(() => {
    if (prefillDraft && suppliers.some((s) => s.id === prefillDraft.supplierId)) {
      return prefillDraft.supplierId;
    }
    return suppliers[0]?.id || '';
  });
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [paymentSource, setPaymentSource] = useState<'cash' | 'bank_transfer' | 'credit'>('cash');
  const [treasuryId, setTreasuryId] = useState<string>('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [notes, setNotes] = useState(() =>
    prefillDraft ? `أمر شراء تلقائي لسد النواقص — ${prefillDraft.supplierName}` : ''
  );
  const [draftItems, setDraftItems] = useState<DraftPurchaseItem[]>(() => {
    if (!prefillDraft) return [];
    return prefillDraft.items.map((it) => {
      const matchedProd = products.find((p) => p.id === it.productId);
      return {
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        quantity: it.suggestedQty,
        unitCost: it.unitCost,
        newSalePrice: matchedProd?.currentSalePrice ?? it.unitCost,
        batchCode: '',
        expiryDate: '',
      };
    });
  });
  const [pickerProductId, setPickerProductId] = useState<string>(products[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const matchingTreasuries = useMemo(() => {
    if (paymentSource === 'credit') return [];
    if (paymentSource === 'cash') {
      return activeTreasuries.filter((t) => t.type === 'cash_drawer');
    }
    return activeTreasuries.filter((t) => t.type !== 'cash_drawer');
  }, [activeTreasuries, paymentSource]);

  useEffect(() => {
    if (paymentSource === 'credit') {
      setTreasuryId('');
      return;
    }
    if (matchingTreasuries.length === 0) {
      setTreasuryId('');
      return;
    }
    if (!matchingTreasuries.some((t) => t.id === treasuryId)) {
      const def = matchingTreasuries.find((t) => t.isDefault) || matchingTreasuries[0];
      setTreasuryId(def.id);
    }
  }, [paymentSource, matchingTreasuries, treasuryId]);

  const draftTotal = useMemo(
    () => Number(draftItems.reduce((s, it) => s + it.quantity * it.unitCost, 0).toFixed(2)),
    [draftItems]
  );

  const negativeMarginItems = useMemo(
    () => draftItems.filter((it) => it.unitCost >= it.newSalePrice || it.newSalePrice <= 0),
    [draftItems]
  );

  const selectedTreasury = useMemo(
    () => matchingTreasuries.find((t) => t.id === treasuryId) || null,
    [matchingTreasuries, treasuryId]
  );

  const computedPaidPreview = useMemo(() => {
    if (paymentSource === 'credit') return 0;
    if (paidAmount === '') return draftTotal;
    const n = Number(paidAmount);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(draftTotal, n));
  }, [paymentSource, paidAmount, draftTotal]);

  const handleAddDraftProduct = (prodId: string) => {
    if (!prodId) return;
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    setDraftItems((prev) => {
      const existing = prev.find((i) => i.productId === prod.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === prod.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          quantity: 10,
          unitCost: prod.currentCostPrice,
          newSalePrice: prod.currentSalePrice,
          batchCode: '',
          expiryDate: '',
        },
      ];
    });
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || draftItems.length === 0) {
      setErrMsg('يرجى اختيار المورد وإضافة صنف واحد على الأقل.');
      return;
    }
    if (
      draftItems.some(
        (it) =>
          !Number.isFinite(it.quantity) ||
          it.quantity <= 0 ||
          !Number.isFinite(it.unitCost) ||
          it.unitCost < 0
      )
    ) {
      setErrMsg('يرجى التحقق من كميات وأسعار الشراء لكل الأصناف.');
      return;
    }
    if (
      paymentSource !== 'credit' &&
      paidAmount !== '' &&
      (!Number.isFinite(Number(paidAmount)) || Number(paidAmount) < 0)
    ) {
      setErrMsg('المبلغ المدفوع غير صالح.');
      return;
    }
    setSubmitting(true);
    setErrMsg(null);
    try {
      const computedPaid =
        paymentSource === 'credit'
          ? 0
          : paidAmount === ''
            ? draftTotal
            : Math.max(0, Math.min(draftTotal, Number(paidAmount)));

      const res = await apiFetch<{ purchase: PurchaseOrder }>('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          supplierInvoiceRef,
          paidAmount: computedPaid,
          paymentSource,
          treasuryId: paymentSource !== 'credit' ? treasuryId || null : null,
          notes,
          actorName: currentUser.name,
          terminalName: 'شاشة المشتريات',
          items: draftItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitCost: it.unitCost,
            newSalePrice: it.newSalePrice,
            batchCode: it.batchCode?.trim() || undefined,
            expiryDate: it.expiryDate?.trim() || undefined,
          })),
        }),
      });
      onCreated(res.purchase);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ فاتورة المشتريات');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleCreatePurchase}
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            <span>تسجيل فاتورة مشتريات وتوريد للمخزون</span>
          </h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">المورد</label>
            <SearchableSelect
              value={supplierId}
              onChange={setSupplierId}
              options={suppliers.map((s) => ({
                value: s.id,
                label: s.name,
                sublabel: `${s.category} · رصيد: ${formatEGP(s.balanceDue)}`,
              }))}
              placeholder="اختر المورد..."
              searchPlaceholder="ابحث باسم المورد..."
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">رقم فاتورة المورد (اختياري)</label>
            <input
              value={supplierInvoiceRef}
              onChange={(e) => setSupplierInvoiceRef(e.target.value)}
              placeholder="مثال: INV-5091"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">طريقة السداد</label>
            <SearchableSelect
              value={paymentSource}
              onChange={(v) => setPaymentSource(v as 'cash' | 'bank_transfer' | 'credit')}
              options={[
                { value: 'cash', label: SOURCE_LABELS.cash },
                { value: 'bank_transfer', label: SOURCE_LABELS.bank_transfer },
                { value: 'credit', label: SOURCE_LABELS.credit },
              ]}
            />
          </div>
        </div>

        {paymentSource !== 'credit' && matchingTreasuries.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-end rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <div>
              <label className="block font-semibold mb-1">الخزينة المسدد منها للمورد</label>
              <SearchableSelect
                value={treasuryId}
                onChange={setTreasuryId}
                options={matchingTreasuries.map((t) => ({
                  value: t.id,
                  label: t.name,
                  sublabel: `${TREASURY_TYPE_LABELS[t.type]} · الرصيد: ${formatEGP(t.currentBalance)}`,
                }))}
                searchPlaceholder="ابحث في الخزائن..."
              />
            </div>
            {selectedTreasury && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <div className="text-[11px] text-slate-500">رصيد الخزينة المتاح</div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatEGP(selectedTreasury.currentBalance)}
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-[11px] text-slate-500">الرصيد بعد السداد</div>
                  <div
                    className={`font-mono-num font-bold ${
                      selectedTreasury.currentBalance - computedPaidPreview < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {formatEGP(selectedTreasury.currentBalance - computedPaidPreview)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {negativeMarginItems.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <strong>تنبيه تسعير: </strong>
              يوجد {negativeMarginItems.length} صنف تكلفة شراؤه تساوي أو تتجاوز سعر البيع المحدد (
              {negativeMarginItems.map((i) => i.productName).join('، ')}). يرجى مراجعة سعر البيع قبل الاعتماد.
            </div>
          </div>
        )}

        {/* Product Line Picker */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-semibold mb-1">إضافة صنف لفاتورة التوريد</label>
              <SearchableSelect
                value={pickerProductId}
                onChange={(val) => {
                  setPickerProductId(val);
                  handleAddDraftProduct(val);
                }}
                options={products.map((p) => ({
                  value: p.id,
                  label: p.name,
                  sublabel: `الرصيد: ${formatNum(p.stockQty)} ${p.unit} · آخر تكلفة: ${formatEGP(p.currentCostPrice)}`,
                }))}
                placeholder="ابحث وأضف صنفاً..."
                searchPlaceholder="ابحث بالاسم أو الباركود..."
              />
            </div>
            <button
              type="button"
              onClick={() => handleAddDraftProduct(pickerProductId)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة للجدول</span>
            </button>
          </div>

          {draftItems.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              اختر الأصناف الواردة من القائمة بالأعلى لتحديد الكميات وأسعار الشراء.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-2.5 py-2">الصنف</th>
                    <th className="px-2.5 py-2">الكمية الموردة</th>
                    <th className="px-2.5 py-2">تكلفة الشراء</th>
                    <th className="px-2.5 py-2">سعر البيع الجديد</th>
                    <th className="px-2.5 py-2">كود التشغيلة</th>
                    <th className="px-2.5 py-2">تاريخ الصلاحية</th>
                    <th className="px-2.5 py-2">الإجمالي</th>
                    <th className="px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {draftItems.map((it) => {
                    const isLoss = it.unitCost >= it.newSalePrice || it.newSalePrice <= 0;
                    const margin =
                      it.newSalePrice > 0
                        ? (((it.newSalePrice - it.unitCost) / it.newSalePrice) * 100).toFixed(0)
                        : '0';
                    return (
                      <tr key={it.productId} className={isLoss ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                        <td className="px-2.5 py-2 font-semibold">{it.productName}</td>
                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={it.quantity}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((row) =>
                                  row.productId === it.productId
                                    ? { ...row, quantity: Math.max(0.01, Number(e.target.value)) }
                                    : row
                                )
                              )
                            }
                            className="w-20 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it.unitCost}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((row) =>
                                  row.productId === it.productId
                                    ? { ...row, unitCost: Math.max(0, Number(e.target.value)) }
                                    : row
                                )
                              )
                            }
                            className="w-24 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={it.newSalePrice}
                              onChange={(e) =>
                                setDraftItems((prev) =>
                                  prev.map((row) =>
                                    row.productId === it.productId
                                      ? { ...row, newSalePrice: Math.max(0, Number(e.target.value)) }
                                      : row
                                  )
                                )
                              }
                              className="w-24 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span
                              className={`font-mono-num text-[11px] font-semibold ${
                                isLoss ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600'
                              }`}
                            >
                              {margin}%
                            </span>
                          </div>
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={it.batchCode || ''}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((row) =>
                                  row.productId === it.productId
                                    ? { ...row, batchCode: e.target.value }
                                    : row
                                )
                              )
                            }
                            placeholder="LOT-..."
                            className="w-24 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="date"
                            value={it.expiryDate || ''}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((row) =>
                                  row.productId === it.productId
                                    ? { ...row, expiryDate: e.target.value }
                                    : row
                                )
                              )
                            }
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                          />
                        </td>
                        <td className="px-2.5 py-2 font-mono-num font-bold">
                          {formatEGP(it.quantity * it.unitCost)}
                        </td>
                        <td className="px-2.5 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftItems((prev) => prev.filter((r) => r.productId !== it.productId))
                            }
                            className="text-rose-600 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-slate-500">إجمالي الفاتورة</div>
            <div className="mt-1 font-mono-num text-base font-bold text-slate-900 dark:text-white">
              {formatEGP(draftTotal)}
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">المبلغ المدفوع للمورد الآن</label>
            <input
              type="number"
              min={0}
              max={draftTotal}
              step="0.01"
              disabled={paymentSource === 'credit'}
              value={paymentSource === 'credit' ? 0 : paidAmount === '' ? draftTotal : paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">ملاحظات</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="تفاصيل الشحنة أو المندوب..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errMsg && <div className="text-xs font-medium text-rose-600">{errMsg}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={submitting || draftItems.length === 0}
            className="rounded-lg bg-emerald-600 px-6 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'جاري التوريد...' : 'اعتماد فاتورة المشتريات وتوريد المخزون'}
          </button>
        </div>
      </form>
    </div>
  );
}
