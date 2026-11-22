import { X } from 'lucide-react';
import { useState } from 'react';
import { PRICE_TIER_LABELS } from '../../shared/pricingUtils';
import type { Customer, PaymentMethod, PriceTier, Supplier, TreasuryAccount } from '../../shared/types';
import { formatEGP, TREASURY_TYPE_LABELS } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

interface CollectModalProps {
  target: Customer;
  activeTreasuries: TreasuryAccount[];
  saving: boolean;
  pickDefaultTreasuryForMethod: (m: PaymentMethod) => string;
  onClose: () => void;
  onSubmit: (payload: {
    amount: number;
    method: PaymentMethod;
    treasuryId: string;
    referenceCode: string;
  }) => Promise<void>;
}

export function CollectCustomerModal({
  target,
  activeTreasuries,
  saving,
  pickDefaultTreasuryForMethod,
  onClose,
  onSubmit,
}: CollectModalProps) {
  const [amount, setAmount] = useState(String(target.balanceDue));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [treasuryId, setTreasuryId] = useState(pickDefaultTreasuryForMethod('cash'));
  const [refCode, setRefCode] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            amount: Number(amount),
            method,
            treasuryId,
            referenceCode: refCode,
          });
        }}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 shadow-2xl"
      >
        <h3 className="font-display text-base font-bold">تحصيل دفعة من: {target.name}</h3>
        <div className="text-xs text-slate-500">
          الرصيد المستحق: <strong className="font-mono-num">{formatEGP(target.balanceDue)}</strong>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">المبلغ المحصل (ج.م)</label>
          <input
            type="number"
            step="0.01"
            min={0.01}
            max={target.balanceDue}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">طريقة التحصيل</label>
          <SearchableSelect
            value={method}
            onChange={(val) => {
              const m = val as PaymentMethod;
              setMethod(m);
              setTreasuryId(pickDefaultTreasuryForMethod(m));
            }}
            options={[
              { value: 'cash', label: 'نقدي (خزينة الكاش)' },
              { value: 'instapay', label: 'تحويل إنستا باي' },
              { value: 'vodafone_cash', label: 'فودافون / محفظة كاش' },
            ]}
          />
        </div>

        {activeTreasuries.length > 0 && (
          <div>
            <label className="block text-xs font-medium mb-1">إيداع في الخزينة المسجلة</label>
            <SearchableSelect
              value={treasuryId}
              onChange={setTreasuryId}
              options={activeTreasuries.map((t) => ({
                value: t.id,
                label: t.name,
                sublabel: `${TREASURY_TYPE_LABELS[t.type]} · الرصيد: ${formatEGP(t.currentBalance)}`,
              }))}
            />
          </div>
        )}

        {method !== 'cash' && (
          <div>
            <label className="block text-xs font-medium mb-1">رقم المرجع</label>
            <input
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        )}

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
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            تأكيد التحصيل
          </button>
        </div>
      </form>
    </div>
  );
}

interface PaySupplierModalProps {
  target: Supplier;
  activeTreasuries: TreasuryAccount[];
  saving: boolean;
  pickDefaultTreasuryForMethod: (m: PaymentMethod) => string;
  onClose: () => void;
  onSubmit: (payload: {
    amount: number;
    method: PaymentMethod;
    treasuryId: string;
    referenceCode: string;
  }) => Promise<void>;
}

export function PaySupplierModal({
  target,
  activeTreasuries,
  saving,
  pickDefaultTreasuryForMethod,
  onClose,
  onSubmit,
}: PaySupplierModalProps) {
  const [amount, setAmount] = useState(String(target.balanceDue));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [treasuryId, setTreasuryId] = useState(pickDefaultTreasuryForMethod('cash'));
  const [refCode, setRefCode] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            amount: Number(amount),
            method,
            treasuryId,
            referenceCode: refCode,
          });
        }}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 shadow-2xl"
      >
        <h3 className="font-display text-base font-bold">سداد دفعة للمورد: {target.name}</h3>
        <div className="text-xs text-slate-500">
          الرصيد المستحق للمورد:{' '}
          <strong className="font-mono-num text-rose-600">{formatEGP(target.balanceDue)}</strong>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">المبلغ المسدد (ج.م)</label>
          <input
            type="number"
            step="0.01"
            min={0.01}
            max={target.balanceDue}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">وسيلة السداد</label>
          <SearchableSelect
            value={method}
            onChange={(val) => {
              const m = val as PaymentMethod;
              setMethod(m);
              setTreasuryId(pickDefaultTreasuryForMethod(m));
            }}
            options={[
              { value: 'cash', label: 'نقدي من الخزينة' },
              { value: 'instapay', label: 'تحويل بنكي / إنستا باي' },
              { value: 'vodafone_cash', label: 'محفظة إلكترونية' },
            ]}
          />
        </div>

        {activeTreasuries.length > 0 && (
          <div>
            <label className="block text-xs font-medium mb-1">الصرف من الخزينة</label>
            <SearchableSelect
              value={treasuryId}
              onChange={setTreasuryId}
              options={activeTreasuries.map((t) => ({
                value: t.id,
                label: t.name,
                sublabel: `${TREASURY_TYPE_LABELS[t.type]} · المتاح: ${formatEGP(t.currentBalance)}`,
              }))}
            />
          </div>
        )}

        {method !== 'cash' && (
          <div>
            <label className="block text-xs font-medium mb-1">رقم المرجع / الإيصال</label>
            <input
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        )}

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
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            اعتماد السداد
          </button>
        </div>
      </form>
    </div>
  );
}

interface EditCustomerModalProps {
  customer: Customer;
  saving: boolean;
  onClose: () => void;
  onSubmit: (form: {
    name: string;
    phone: string;
    creditLimit: number;
    defaultPriceTier: PriceTier;
    defaultDiscountPercent: number;
    notes: string;
  }) => Promise<void>;
}

export function EditCustomerModal({ customer, saving, onClose, onSubmit }: EditCustomerModalProps) {
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone,
    creditLimit: customer.creditLimit || 0,
    defaultPriceTier: (customer.defaultPriceTier || 'retail') as PriceTier,
    defaultDiscountPercent: customer.defaultDiscountPercent || 0,
    notes: customer.notes || '',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(form);
        }}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <h3 className="font-display text-sm font-bold">تعديل بيانات العميل: {customer.name}</h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">الاسم</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">الموبايل</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">شريحة التسعير التلقائية</label>
            <select
              value={form.defaultPriceTier}
              onChange={(e) => setForm({ ...form, defaultPriceTier: e.target.value as PriceTier })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
            >
              {(Object.keys(PRICE_TIER_LABELS) as PriceTier[]).map((t) => (
                <option key={t} value={t}>
                  {PRICE_TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">نسبة الخصم الدائمة (%)</label>
            <input
              type="number"
              min={0}
              max={80}
              step="0.5"
              value={form.defaultDiscountPercent}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultDiscountPercent: Math.max(0, Math.min(80, Number(e.target.value) || 0)),
                })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">الحد الائتماني (ج.م)</label>
          <input
            type="number"
            min={0}
            value={form.creditLimit}
            onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">ملاحظات</label>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
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
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            حفظ التعديلات
          </button>
        </div>
      </form>
    </div>
  );
}

interface EditSupplierModalProps {
  supplier: Supplier;
  saving: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; phone: string; category: string; notes: string }) => Promise<void>;
}

export function EditSupplierModal({ supplier, saving, onClose, onSubmit }: EditSupplierModalProps) {
  const [form, setForm] = useState({
    name: supplier.name,
    phone: supplier.phone,
    category: supplier.category,
    notes: supplier.notes || '',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(form);
        }}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <h3 className="font-display text-sm font-bold">تعديل بيانات المورد: {supplier.name}</h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">اسم المورد</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">رقم التواصل</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">التخصص / مجال التوريد</label>
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">ملاحظات</label>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
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
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            حفظ التعديلات
          </button>
        </div>
      </form>
    </div>
  );
}
