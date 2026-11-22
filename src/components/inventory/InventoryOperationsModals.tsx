import {
  Activity,
  CalendarClock,
  ClipboardCheck,
  Percent,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  Product,
  ProductBatch,
  PromotionRuleType,
  StaffUser,
  StockMovement,
  StoreActivityProfile,
  StorePromotion,
  Supplier,
} from '../../shared/types';
import { formatDateTimeAr, formatEGP, formatNum } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

interface StocktakeModalProps {
  open: boolean;
  products: Product[];
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function StocktakeModal({
  open,
  products,
  currentUser,
  apiFetch,
  onClose,
  onSuccess,
}: StocktakeModalProps) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('جرد فعلي دوري للأرفف والمخزن');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      products.forEach((p) => {
        initial[p.id] = String(p.stockQty);
      });
      setCounts(initial);
      setSearch('');
      setErrorMsg(null);
    }
  }, [open, products]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const items = products
        .map((p) => ({
          productId: p.id,
          actualQty: Math.max(0, Number(counts[p.id] ?? p.stockQty)),
          prevQty: p.stockQty,
        }))
        .filter((r) => Math.abs(r.actualQty - r.prevQty) > 0.0001)
        .map(({ productId, actualQty }) => ({ productId, actualQty }));

      if (items.length === 0) {
        onClose();
        return;
      }

      const res = await apiFetch<{ adjustedCount: number }>('/api/inventory/stocktake', {
        method: 'POST',
        body: JSON.stringify({
          items,
          reason,
          actorName: currentUser.name,
          terminalName: 'جرد المخزون الفعلي',
        }),
      });
      onClose();
      onSuccess(`تمت مطابقة الجرد الفعلي وتحديث ${res.adjustedCount} أصناف بنجاح`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تطبيق الجرد الفعلي');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-emerald-600" />
              <span>الجرد الفعلي ومطابقة كميات المخزون</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              أدخل الكميات المعدودة فعلياً على الأرفف ليتم احتساب الفائض/العجز وتعديل الرصيد في حركة واحدة
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث سريع في أصناف الجرد..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-3 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="سبب/مرجع الجرد..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">الصنف</th>
                <th className="px-3 py-2">رصيد النظام</th>
                <th className="px-3 py-2">العد الفعلي</th>
                <th className="px-3 py-2">الفرق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {products
                .filter((p) => {
                  const q = search.trim().toLowerCase();
                  return !q || p.name.toLowerCase().includes(q) || p.barcode.includes(q);
                })
                .map((p) => {
                  const actual = Number(counts[p.id] ?? p.stockQty);
                  const diff = Number((actual - p.stockQty).toFixed(3));
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-semibold">{p.name}</td>
                      <td className="px-3 py-2 font-mono-num text-slate-500">
                        {formatNum(p.stockQty)} {p.unit}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={counts[p.id] ?? String(p.stockQty)}
                          onChange={(e) =>
                            setCounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-24 rounded border border-slate-200 bg-white px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono-num font-bold">
                        {diff === 0 ? (
                          <span className="text-slate-400">متطابق</span>
                        ) : diff > 0 ? (
                          <span className="text-emerald-600">+{formatNum(diff)}</span>
                        ) : (
                          <span className="text-rose-600">{formatNum(diff)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {errorMsg && <div className="text-xs font-medium text-rose-600">{errorMsg}</div>}

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
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'جاري المطابقة...' : 'اعتماد وتحديث الأرصدة الفعلية'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface BulkPriceModalProps {
  open: boolean;
  productsCount: number;
  selectedProductIds: string[];
  activeActivity: StoreActivityProfile;
  canViewCosts: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function BulkPriceModal({
  open,
  productsCount,
  selectedProductIds,
  activeActivity,
  canViewCosts,
  apiFetch,
  onClose,
  onSuccess,
}: BulkPriceModalProps) {
  const [bulkForm, setBulkForm] = useState<{
    scope: 'selected' | 'category' | 'all';
    category: string;
    mode: 'percent' | 'fixed';
    target: 'sale' | 'cost' | 'both';
    value: number;
    reason: string;
  }>({
    scope: 'all',
    category: 'all',
    mode: 'percent',
    target: 'sale',
    value: 5,
    reason: 'تعديل أسعار جماعي',
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setBulkForm((prev) => ({
        ...prev,
        scope: selectedProductIds.length > 0 ? 'selected' : 'all',
        category: activeActivity.categories[0] || 'all',
      }));
    }
  }, [open, selectedProductIds.length, activeActivity]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/api/products/bulk-price', {
        method: 'POST',
        body: JSON.stringify({
          productIds: bulkForm.scope === 'selected' ? selectedProductIds : undefined,
          category: bulkForm.scope === 'category' ? bulkForm.category : 'all',
          mode: bulkForm.mode,
          target: bulkForm.target,
          value: Number(bulkForm.value),
          reason: bulkForm.reason,
        }),
      });
      onClose();
      onSuccess(`تم تحديث أسعار ${res.updatedCount} صنف جماعياً بنجاح`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تنفيذ التعديل الجماعي للأسعار');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Percent className="h-4 w-4 text-amber-600" />
            <span>تعديل الأسعار جماعياً</span>
          </h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-medium mb-1">نطاق الأصناف المشمولة</label>
            <select
              value={bulkForm.scope}
              onChange={(e) =>
                setBulkForm({
                  ...bulkForm,
                  scope: e.target.value as 'selected' | 'category' | 'all',
                })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              {selectedProductIds.length > 0 && (
                <option value="selected">الأصناف المحددة فقط ({selectedProductIds.length})</option>
              )}
              <option value="all">جميع أصناف النشاط الحالي ({productsCount})</option>
              <option value="category">قسم / تصنيف محدد</option>
            </select>
          </div>

          {bulkForm.scope === 'category' && (
            <div>
              <label className="block font-medium mb-1">القسم المستهدف</label>
              <select
                value={bulkForm.category}
                onChange={(e) => setBulkForm({ ...bulkForm, category: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {activeActivity.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">نوع التعديل</label>
              <select
                value={bulkForm.mode}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, mode: e.target.value as 'percent' | 'fixed' })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="percent">نسبة مئوية (%)</option>
                <option value="fixed">مبلغ ثابت (ج.م)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">الأسعار المستهدفة</label>
              <select
                value={bulkForm.target}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, target: e.target.value as 'sale' | 'cost' | 'both' })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="sale">سعر البيع فقط</option>
                {canViewCosts && <option value="cost">سعر التكلفة فقط</option>}
                {canViewCosts && <option value="both">سعر البيع والتكلفة معاً</option>}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">
              القيمة (
              {bulkForm.mode === 'percent' ? '% موجب للزيادة أو سالب للخصم' : 'ج.م موجب أو سالب'})
            </label>
            <input
              type="number"
              step="0.1"
              required
              value={bulkForm.value}
              onChange={(e) => setBulkForm({ ...bulkForm, value: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">سبب التعديل الجماعي</label>
            <input
              value={bulkForm.reason}
              onChange={(e) => setBulkForm({ ...bulkForm, reason: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errorMsg && <div className="text-xs font-medium text-rose-600">{errorMsg}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'جاري التطبيق...' : 'تطبيق التعديل السعري'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface StockMovementsModalProps {
  open: boolean;
  movements: StockMovement[];
  onClose: () => void;
}

export function StockMovementsModal({ open, movements, onClose }: StockMovementsModalProps) {
  const [search, setSearch] = useState('');

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-600" />
              <span>سجل حركة المخزن التفصيلي ({movements.length})</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة كافة عمليات الصرف والبيع والمرتجع والتوريد والجرد اللحظي
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف أو السبب أو المسؤول..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">الصنف</th>
                <th className="px-3 py-2">التغير</th>
                <th className="px-3 py-2">الرصيد بعد</th>
                <th className="px-3 py-2">البيان / السبب</th>
                <th className="px-3 py-2">المسؤول</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {movements
                .filter((m) => {
                  const q = search.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    m.productName.toLowerCase().includes(q) ||
                    m.reason.toLowerCase().includes(q) ||
                    m.actorName.toLowerCase().includes(q)
                  );
                })
                .slice(0, 120)
                .map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 font-mono-num text-[11px] text-slate-500">
                      {formatDateTimeAr(m.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">
                      {m.productName}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono-num font-bold ${
                        m.deltaQty > 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {m.deltaQty > 0 ? `+${formatNum(m.deltaQty)}` : formatNum(m.deltaQty)}
                    </td>
                    <td className="px-3 py-2 font-mono-num font-bold">{formatNum(m.afterQty)}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{m.reason}</td>
                    <td className="px-3 py-2 text-slate-500">{m.actorName}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface BatchesFefoModalProps {
  open: boolean;
  products: Product[];
  suppliers: Supplier[];
  sortedBatches: ProductBatch[];
  canEditStockAndPrices: boolean;
  canViewCosts: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function BatchesFefoModal({
  open,
  products,
  suppliers,
  sortedBatches,
  canEditStockAndPrices,
  canViewCosts,
  apiFetch,
  onClose,
  onSuccess,
}: BatchesFefoModalProps) {
  const [batchSearch, setBatchSearch] = useState('');
  const [batchForm, setBatchForm] = useState({
    productId: products[0]?.id || '',
    batchCode: '',
    expiryDate: '',
    qty: 10,
    costPrice: products[0]?.currentCostPrice || 0,
    supplierId: suppliers[0]?.id || '',
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setBatchForm((prev) => ({
        ...prev,
        productId: prev.productId || products[0]?.id || '',
        costPrice: products[0]?.currentCostPrice || 0,
        supplierId: prev.supplierId || suppliers[0]?.id || '',
      }));
    }
  }, [open, products, suppliers]);

  if (!open) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchForm.productId || !batchForm.batchCode.trim()) {
      setErrorMsg('يرجى اختيار الصنف وإدخال رقم التشغيلة.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/batches', {
        method: 'POST',
        body: JSON.stringify({
          productId: batchForm.productId,
          batchCode: batchForm.batchCode.trim(),
          expiryDate: batchForm.expiryDate || null,
          qty: Number(batchForm.qty),
          costPrice: Number(batchForm.costPrice || 0),
          supplierId: batchForm.supplierId || null,
        }),
      });
      setBatchForm((prev) => ({ ...prev, batchCode: '', expiryDate: '', qty: 10 }));
      onSuccess('تم تسجيل التشغيلة وتحديث المخزون بنظام FEFO');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل التشغيلة');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/batches/${id}`, { method: 'DELETE' });
      onSuccess('تم حذف التشغيلة بنجاح');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف التشغيلة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex w-full max-w-4xl max-h-[90dvh] flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <CalendarClock className="h-4 w-4 text-emerald-600" />
              <span>التشغيلات وتواريخ الصلاحية (صرف الأقرب انتهاءً FEFO)</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              يتم خصم الكميات المباعة تلقائياً من التشغيلة الأقرب لانتهاء الصلاحية أولاً.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {canEditStockAndPrices && (
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">الصنف</label>
              <SearchableSelect
                value={batchForm.productId}
                onChange={(pid) => {
                  const prod = products.find((p) => p.id === pid);
                  setBatchForm((prev) => ({
                    ...prev,
                    productId: pid,
                    costPrice: prod?.currentCostPrice ?? prev.costPrice,
                  }));
                }}
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="اختر الصنف..."
                searchPlaceholder="بحث عن صنف..."
              />
            </div>
            <div>
              <label className="block font-medium mb-1">كود التشغيلة</label>
              <input
                required
                value={batchForm.batchCode}
                onChange={(e) => setBatchForm((p) => ({ ...p, batchCode: e.target.value }))}
                placeholder="LOT-2026-01"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">تاريخ الانتهاء</label>
              <input
                type="date"
                value={batchForm.expiryDate}
                onChange={(e) => setBatchForm((p) => ({ ...p, expiryDate: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">الكمية</label>
              <input
                type="number"
                required
                min={0.01}
                step="any"
                value={batchForm.qty}
                onChange={(e) => setBatchForm((p) => ({ ...p, qty: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[38px] rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? '...' : 'إضافة تشغيلة'}
              </button>
            </div>
          </form>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={batchSearch}
            onChange={(e) => setBatchSearch(e.target.value)}
            placeholder="بحث باسم الصنف أو رقم التشغيلة..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {errorMsg && <div className="text-xs font-medium text-rose-600">{errorMsg}</div>}

        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5">الصنف</th>
                <th className="px-3 py-2.5">رقم التشغيلة</th>
                <th className="px-3 py-2.5">تاريخ الانتهاء</th>
                <th className="px-3 py-2.5">الرصيد المتبقي</th>
                {canViewCosts && <th className="px-3 py-2.5">تكلفة التشغيلة</th>}
                {canEditStockAndPrices && <th className="px-3 py-2.5">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sortedBatches
                .filter((b) => {
                  const q = batchSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    b.productName.toLowerCase().includes(q) ||
                    b.batchCode.toLowerCase().includes(q)
                  );
                })
                .map((b) => {
                  const daysLeft = b.expiryDate
                    ? Math.ceil((new Date(b.expiryDate).getTime() - Date.now()) / 86400000)
                    : null;
                  const expiryClass =
                    daysLeft === null
                      ? 'text-slate-500'
                      : daysLeft <= 0
                        ? 'text-rose-600 font-bold'
                        : daysLeft <= 30
                          ? 'text-amber-600 font-bold'
                          : 'text-emerald-600';
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                        {b.productName}
                      </td>
                      <td className="px-3 py-2.5 font-mono-num">{b.batchCode}</td>
                      <td className={`px-3 py-2.5 font-mono-num ${expiryClass}`}>
                        {b.expiryDate
                          ? `${b.expiryDate} ${
                              daysLeft !== null
                                ? daysLeft <= 0
                                  ? '(منتهي الصلاحية)'
                                  : `(${daysLeft} يوم)`
                                : ''
                            }`
                          : 'بدون صلاحية'}
                      </td>
                      <td className="px-3 py-2.5 font-mono-num font-bold">{formatNum(b.qty)}</td>
                      {canViewCosts && (
                        <td className="px-3 py-2.5 font-mono-num">{formatEGP(b.costPrice)}</td>
                      )}
                      {canEditStockAndPrices && (
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleDelete(b.id)}
                            className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="حذف التشغيلة"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              {sortedBatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    لا توجد تشغيلات مسجلة حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface PromotionsModalProps {
  open: boolean;
  promotions: StorePromotion[];
  products: Product[];
  activeActivity: StoreActivityProfile;
  canEditStockAndPrices: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function PromotionsModal({
  open,
  promotions,
  products,
  activeActivity,
  canEditStockAndPrices,
  apiFetch,
  onClose,
  onSuccess,
}: PromotionsModalProps) {
  const [promoForm, setPromoForm] = useState<{
    name: string;
    ruleType: PromotionRuleType;
    value: number;
    minSubtotal: number;
    minQty: number;
    category: string;
    productId: string;
    startsAt: string;
    endsAt: string;
  }>({
    name: '',
    ruleType: 'percent',
    value: 10,
    minSubtotal: 0,
    minQty: 1,
    category: 'all',
    productId: '',
    startsAt: '',
    endsAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) setErrorMsg(null);
  }, [open]);

  if (!open) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoForm.name.trim()) {
      setErrorMsg('يرجى إدخال اسم العرض الترويجي.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/promotions', {
        method: 'POST',
        body: JSON.stringify({
          name: promoForm.name.trim(),
          active: true,
          ruleType: promoForm.ruleType,
          value: Number(promoForm.value),
          minSubtotal: Number(promoForm.minSubtotal || 0),
          minQty: Number(promoForm.minQty || 1),
          category: promoForm.category === 'all' ? '' : promoForm.category,
          productId: promoForm.productId || null,
          startsAt: promoForm.startsAt || null,
          endsAt: promoForm.endsAt || null,
        }),
      });
      setPromoForm({
        name: '',
        ruleType: 'percent',
        value: 10,
        minSubtotal: 0,
        minQty: 1,
        category: 'all',
        productId: '',
        startsAt: '',
        endsAt: '',
      });
      onSuccess('تمت إضافة العرض الترويجي وتفعيله في الكاشير');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إنشاء العرض الترويجي');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (promo: StorePromotion) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/promotions/${promo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !promo.active }),
      });
      onSuccess(
        promo.active ? `تم إيقاف العرض (${promo.name})` : `تم تفعيل العرض (${promo.name})`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث حالة العرض');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/promotions/${id}`, { method: 'DELETE' });
      onSuccess('تم حذف العرض الترويجي');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف العرض');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex w-full max-w-4xl max-h-[90dvh] flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <Tag className="h-4 w-4 text-emerald-600" />
              <span>العروض والخصومات الترويجية التلقائية</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              يختار الكاشير تلقائياً أفضل عرض ترويجي متاح لسلة العميل عند تفعيل خيار تطبيق العروض.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {canEditStockAndPrices && (
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">اسم العرض الترويجي</label>
              <input
                required
                value={promoForm.name}
                onChange={(e) => setPromoForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="خصم عطلة نهاية الأسبوع 10%"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">نوع العرض</label>
              <select
                value={promoForm.ruleType}
                onChange={(e) =>
                  setPromoForm((p) => ({ ...p, ruleType: e.target.value as PromotionRuleType }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="percent">نسبة مئوية %</option>
                <option value="fixed">مبلغ ثابت ج.م</option>
                <option value="bogo_qty">خصم كمية (BOGO %)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">القيمة</label>
              <input
                type="number"
                required
                min={0.01}
                step="0.01"
                value={promoForm.value}
                onChange={(e) => setPromoForm((p) => ({ ...p, value: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">الحد الأدنى للفاتورة</label>
              <input
                type="number"
                min={0}
                step="1"
                value={promoForm.minSubtotal}
                onChange={(e) =>
                  setPromoForm((p) => ({ ...p, minSubtotal: Number(e.target.value) }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">أقل كمية</label>
              <input
                type="number"
                min={1}
                step="1"
                value={promoForm.minQty}
                onChange={(e) => setPromoForm((p) => ({ ...p, minQty: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">تصنيف مستهدف (اختياري)</label>
              <select
                value={promoForm.category}
                onChange={(e) => setPromoForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="all">كل التصنيفات</option>
                {activeActivity.categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">صنف محدد (اختياري)</label>
              <SearchableSelect
                value={promoForm.productId}
                onChange={(pid) => setPromoForm((p) => ({ ...p, productId: pid }))}
                options={[
                  { value: '', label: 'كل الأصناف' },
                  ...products.map((pr) => ({ value: pr.id, label: pr.name })),
                ]}
                placeholder="كل الأصناف"
                searchPlaceholder="بحث عن صنف..."
              />
            </div>
            <div className="sm:col-span-2 flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[38px] rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? '...' : 'إنشاء وتفعيل العرض'}
              </button>
            </div>
          </form>
        )}

        {errorMsg && <div className="text-xs font-medium text-rose-600">{errorMsg}</div>}

        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5">اسم العرض</th>
                <th className="px-3 py-2.5">النوع والقيمة</th>
                <th className="px-3 py-2.5">الشروط</th>
                <th className="px-3 py-2.5">الحالة</th>
                {canEditStockAndPrices && <th className="px-3 py-2.5">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {promotions.map((pr) => {
                const ruleLabel =
                  pr.ruleType === 'percent'
                    ? `خصم ${pr.value}%`
                    : pr.ruleType === 'fixed'
                      ? `خصم ثابت ${formatEGP(pr.value)}`
                      : `خصم كمية ${pr.value}%`;
                return (
                  <tr key={pr.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                      {pr.name}
                    </td>
                    <td className="px-3 py-2.5 font-mono-num font-bold text-emerald-600">
                      {ruleLabel}
                    </td>
                    <td className="px-3 py-2.5 font-mono-num text-slate-500">
                      {pr.minSubtotal > 0 ? `حد أدنى ${formatEGP(pr.minSubtotal)} · ` : ''}
                      {pr.minQty > 1 ? `كمية ≥ ${pr.minQty} · ` : ''}
                      {pr.category ? `قسم: ${pr.category}` : 'عام'}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-semibold ${
                        pr.active ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    >
                      {pr.active ? 'نشط' : 'متوقف'}
                    </td>
                    {canEditStockAndPrices && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleToggle(pr)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:border-slate-700"
                          >
                            {pr.active ? 'إيقاف' : 'تفعيل'}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleDelete(pr.id)}
                            className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="حذف العرض"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {promotions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    لا توجد عروض ترويجية مسجلة حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
