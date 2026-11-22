import { Barcode, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PrintDocumentPayload } from '../../context/PrintContext';
import type {
  Product,
  ProductPriceHistory,
  StaffUser,
  StoreActivityProfile,
  StoreSettings,
  Supplier,
} from '../../shared/types';
import { BarcodeGraphic } from '../../utils/barcodeSvg';
import { formatDateTimeAr, formatEGP, formatNum } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

interface AddProductModalProps {
  open: boolean;
  activeActivity: StoreActivityProfile;
  suppliers: Supplier[];
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function AddProductModal({
  open,
  activeActivity,
  suppliers,
  currentUser,
  apiFetch,
  onClose,
  onSuccess,
}: AddProductModalProps) {
  const [newProd, setNewProd] = useState({
    name: '',
    barcode: '',
    category: activeActivity.categories[0] || '',
    unit: activeActivity.defaultUnits[0] || 'قطعة',
    attributeValue: '',
    currentCostPrice: 50,
    currentSalePrice: 70,
    halfWholesalePrice: 66,
    wholesalePrice: 62,
    stockQty: 20,
    minStockAlert: 5,
    maxStockLimit: 100,
    supplierId: suppliers[0]?.id || '',
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setNewProd((prev) => ({
        ...prev,
        category: prev.category || activeActivity.categories[0] || '',
        unit: prev.unit || activeActivity.defaultUnits[0] || 'قطعة',
        supplierId: prev.supplierId || suppliers[0]?.id || '',
      }));
    }
  }, [open, activeActivity, suppliers]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          ...newProd,
          actorName: currentUser.name,
          terminalName: 'إدارة المخزون',
        }),
      });
      setNewProd({
        ...newProd,
        name: '',
        barcode: '',
        attributeValue: '',
        currentCostPrice: 0,
        currentSalePrice: 0,
        halfWholesalePrice: 0,
        wholesalePrice: 0,
      });
      onClose();
      onSuccess('تمت إضافة الصنف للمخزون بنجاح');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل إضافة الصنف');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold">
            إضافة صنف جديد ({activeActivity.nameAr})
          </h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">اسم الصنف</label>
            <input
              required
              value={newProd.name}
              onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">التصنيف</label>
            <SearchableSelect
              value={newProd.category}
              onChange={(val) => setNewProd({ ...newProd, category: val })}
              options={activeActivity.categories.map((c) => ({ value: c, label: c }))}
              searchPlaceholder="ابحث في التصنيفات..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">الوحدة</label>
            <SearchableSelect
              value={newProd.unit}
              onChange={(val) => setNewProd({ ...newProd, unit: val })}
              options={activeActivity.defaultUnits.map((u) => ({ value: u, label: u }))}
              searchPlaceholder="ابحث في الوحدات..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">سعر الشراء (التكلفة ج.م)</label>
            <input
              type="number"
              step="0.01"
              required
              value={newProd.currentCostPrice}
              onChange={(e) => setNewProd({ ...newProd, currentCostPrice: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">سعر البيع قطاعي (ج.م)</label>
            <input
              type="number"
              step="0.01"
              required
              value={newProd.currentSalePrice}
              onChange={(e) => setNewProd({ ...newProd, currentSalePrice: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">سعر نصف الجملة (ج.م)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={newProd.halfWholesalePrice}
              onChange={(e) =>
                setNewProd({ ...newProd, halfWholesalePrice: Number(e.target.value) })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">سعر الجملة (ج.م)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={newProd.wholesalePrice}
              onChange={(e) => setNewProd({ ...newProd, wholesalePrice: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">الكمية الافتتاحية</label>
            <input
              type="number"
              step="0.1"
              required
              value={newProd.stockQty}
              onChange={(e) => setNewProd({ ...newProd, stockQty: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{activeActivity.attributeLabelAr}</label>
            <input
              value={newProd.attributeValue}
              onChange={(e) => setNewProd({ ...newProd, attributeValue: e.target.value })}
              placeholder="اختياري"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">
              الباركود (يُولد تلقائياً إذا تركته فارغاً)
            </label>
            <div className="flex gap-2">
              <input
                value={newProd.barcode}
                onChange={(e) => setNewProd({ ...newProd, barcode: e.target.value })}
                placeholder="622..."
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() =>
                  setNewProd({
                    ...newProd,
                    barcode: `622${Math.floor(1000000000 + Math.random() * 8999999999)}`,
                  })
                }
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                توليد باركود
              </button>
            </div>
          </div>
        </div>

        {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}

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
            {saving ? 'جاري الحفظ...' : 'حفظ الصنف'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface EditPriceModalProps {
  product: Product | null;
  activeActivity: StoreActivityProfile;
  canViewCosts: boolean;
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function EditPriceModal({
  product,
  activeActivity,
  canViewCosts,
  currentUser,
  apiFetch,
  onClose,
  onSuccess,
}: EditPriceModalProps) {
  const [priceForm, setPriceForm] = useState({
    name: '',
    barcode: '',
    category: '',
    unit: '',
    attributeValue: '',
    cost: 0,
    sale: 0,
    halfWholesale: 0,
    wholesale: 0,
    minAlert: 5,
    maxLimit: 60,
    reason: 'تحديث بيانات وتسعير الصنف',
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setErrorMsg(null);
      setPriceForm({
        name: product.name,
        barcode: product.barcode,
        category: product.category,
        unit: product.unit,
        attributeValue: product.attributeValue || '',
        cost: product.currentCostPrice,
        sale: product.currentSalePrice,
        halfWholesale: product.halfWholesalePrice ?? 0,
        wholesale: product.wholesalePrice ?? 0,
        minAlert: product.minStockAlert,
        maxLimit: product.maxStockLimit,
        reason: 'تحديث بيانات وتسعير الصنف',
      });
    }
  }, [product]);

  if (!product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: priceForm.name,
          barcode: priceForm.barcode,
          category: priceForm.category,
          unit: priceForm.unit,
          attributeValue: priceForm.attributeValue,
          currentCostPrice: priceForm.cost,
          currentSalePrice: priceForm.sale,
          halfWholesalePrice: priceForm.halfWholesale,
          wholesalePrice: priceForm.wholesale,
          minStockAlert: priceForm.minAlert,
          maxStockLimit: priceForm.maxLimit,
          reason: priceForm.reason,
          actorName: currentUser.name,
        }),
      });
      onClose();
      onSuccess('تم تحديث بيانات وأسعار الصنف بنجاح — الفواتير السابقة محفوظة بتكلفتها التاريخية');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تحديث الصنف');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold">تعديل بيانات وتسعير: {product.name}</h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          حماية الأرباح التاريخية: تغيير سعر الشراء أو البيع الآن يسري على الفواتير الجديدة فقط، ولن يؤثر على تكلفة أو أرباح أي فاتورة صدرت قبل هذه اللحظة.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1">اسم الصنف</label>
            <input
              required
              value={priceForm.name}
              onChange={(e) => setPriceForm({ ...priceForm, name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الباركود</label>
            <input
              value={priceForm.barcode}
              onChange={(e) => setPriceForm({ ...priceForm, barcode: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{activeActivity.attributeLabelAr}</label>
            <input
              value={priceForm.attributeValue}
              onChange={(e) => setPriceForm({ ...priceForm, attributeValue: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">التصنيف</label>
            <SearchableSelect
              value={priceForm.category}
              onChange={(val) => setPriceForm({ ...priceForm, category: val })}
              options={activeActivity.categories.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الوحدة</label>
            <SearchableSelect
              value={priceForm.unit}
              onChange={(val) => setPriceForm({ ...priceForm, unit: val })}
              options={activeActivity.defaultUnits.map((u) => ({ value: u, label: u }))}
            />
          </div>
          {canViewCosts && (
            <div>
              <label className="block text-xs font-medium mb-1">سعر الشراء الجديد (ج.م)</label>
              <input
                type="number"
                step="0.01"
                required
                value={priceForm.cost}
                onChange={(e) => setPriceForm({ ...priceForm, cost: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          )}
          <div className={canViewCosts ? '' : 'col-span-2'}>
            <label className="block text-xs font-medium mb-1">سعر البيع قطاعي (ج.م)</label>
            <input
              type="number"
              step="0.01"
              required
              value={priceForm.sale}
              onChange={(e) => setPriceForm({ ...priceForm, sale: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">سعر نصف الجملة (ج.م)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={priceForm.halfWholesale}
              onChange={(e) => setPriceForm({ ...priceForm, halfWholesale: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">سعر الجملة (ج.م)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={priceForm.wholesale}
              onChange={(e) => setPriceForm({ ...priceForm, wholesale: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">حد التنبيه للنواقص</label>
            <input
              type="number"
              value={priceForm.minAlert}
              onChange={(e) => setPriceForm({ ...priceForm, minAlert: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الحد الأقصى للمخزون</label>
            <input
              type="number"
              value={priceForm.maxLimit}
              onChange={(e) => setPriceForm({ ...priceForm, maxLimit: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1">سبب التعديل</label>
            <input
              value={priceForm.reason}
              onChange={(e) => setPriceForm({ ...priceForm, reason: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}

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
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            {saving ? 'جاري التحديث...' : 'حفظ التعديلات'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface RestockModalProps {
  product: Product | null;
  canViewCosts: boolean;
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function RestockModal({
  product,
  canViewCosts,
  currentUser,
  apiFetch,
  onClose,
  onSuccess,
}: RestockModalProps) {
  const [restockForm, setRestockForm] = useState({
    deltaQty: 10,
    reason: 'توريد بضاعة من المورد',
    newCostPrice: 0,
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setErrorMsg(null);
      setRestockForm({
        deltaQty: 10,
        reason: 'توريد بضاعة من المورد',
        newCostPrice: product.currentCostPrice,
      });
    }
  }, [product]);

  if (!product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/products/${product.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          deltaQty: restockForm.deltaQty,
          reason: restockForm.reason,
          newCostPrice: restockForm.newCostPrice,
          actorName: currentUser.name,
          terminalName: 'إدارة المخزون',
        }),
      });
      onClose();
      onSuccess('تم تحديث الكمية بالمخزون لحظياً');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تعديل المخزون');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold">توريد / تعديل كمية: {product.name}</h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="text-xs text-slate-500">
          الرصيد الحالي: <strong className="font-mono-num">{formatNum(product.stockQty)}</strong>{' '}
          {product.unit}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              الكمية المضافة (أو سالب للخصم التالف)
            </label>
            <input
              type="number"
              step="0.1"
              required
              value={restockForm.deltaQty}
              onChange={(e) => setRestockForm({ ...restockForm, deltaQty: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          {canViewCosts && (
            <div>
              <label className="block text-xs font-medium mb-1">سعر الشراء للدفعة الجديدة (ج.م)</label>
              <input
                type="number"
                step="0.01"
                value={restockForm.newCostPrice}
                onChange={(e) =>
                  setRestockForm({ ...restockForm, newCostPrice: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">البيان / السبب</label>
            <input
              required
              value={restockForm.reason}
              onChange={(e) => setRestockForm({ ...restockForm, reason: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}

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
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            تأكيد التحديث اللحظي
          </button>
        </div>
      </form>
    </div>
  );
}

interface PriceHistoryModalProps {
  product: Product | null;
  priceHistory: ProductPriceHistory[];
  canViewCosts: boolean;
  onClose: () => void;
}

export function PriceHistoryModal({
  product,
  priceHistory,
  canViewCosts,
  onClose,
}: PriceHistoryModalProps) {
  if (!product) return null;

  const rows = priceHistory.filter((h) => h.productId === product.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold">سجل تغيّرات الأسعار: {product.name}</h3>
            <p className="text-xs text-slate-500">
              توثيق كل تعديل سعري لضمان دقة أرباح الفواتير حسب تاريخها
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            لم يتم تعديل سعر هذا الصنف منذ تسجيله الأول بالمخزن.
          </div>
        ) : (
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {rows.map((h) => (
              <div key={h.id} className="py-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">{h.reason}</span>
                  <span className="text-xs text-slate-500">{formatDateTimeAr(h.changedAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300 font-mono-num">
                  {canViewCosts && (
                    <span>
                      التكلفة: {formatEGP(h.oldCostPrice)} ←{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {formatEGP(h.newCostPrice)}
                      </strong>
                    </span>
                  )}
                  <span>
                    سعر البيع: {formatEGP(h.oldSalePrice)} ←{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {formatEGP(h.newSalePrice)}
                    </strong>
                  </span>
                  <span>بواسطة: {h.changedBy}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface BarcodeLabelsModalProps {
  open: boolean;
  products: Product[];
  singleMode: boolean;
  settings: StoreSettings;
  onClose: () => void;
  onPrint: (payload: PrintDocumentPayload) => void;
}

export function BarcodeLabelsModal({
  open,
  products,
  singleMode,
  settings,
  onClose,
  onPrint,
}: BarcodeLabelsModalProps) {
  const [barcodeCopies, setBarcodeCopies] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) {
      const next: Record<string, number> = {};
      products.forEach((p) => {
        next[p.id] = singleMode ? 6 : barcodeCopies[p.id] || 3;
      });
      setBarcodeCopies(next);
    }
  }, [open, products, singleMode]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Barcode className="h-4 w-4 text-emerald-600" />
              <span>إعداد وطباعة ملصقات الباركود والأسعار</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              حدد عدد الملصقات لكل صنف ثم اضغط طباعة لإخراج صفحة ملصقات جاهزة للرفوف
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const count = barcodeCopies[p.id] ?? 3;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                    {p.name}
                  </div>
                  <div className="font-mono-num text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatEGP(p.currentSalePrice)}
                  </div>
                  <div className="pt-1">
                    <BarcodeGraphic code={p.barcode} height={26} />
                  </div>
                </div>

                <div className="shrink-0 text-center">
                  <label className="block text-[11px] text-slate-500 mb-1">عدد الملصقات</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={count}
                    onChange={(e) =>
                      setBarcodeCopies((prev) => ({
                        ...prev,
                        [p.id]: Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                      }))
                    }
                    className="w-16 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={() => {
              onPrint({
                kind: 'barcodes',
                items: products.map((product) => ({
                  product,
                  copies: barcodeCopies[product.id] ?? 3,
                })),
                settings,
              });
            }}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Printer className="h-4 w-4" />
            <span>طباعة ملصقات الباركود</span>
          </button>
        </div>
      </div>
    </div>
  );
}
