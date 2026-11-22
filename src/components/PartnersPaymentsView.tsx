import {
  CreditCard,
  Edit3,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  MessageCircle,
  Plus,
  Search,
  Table as TableIcon,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PartnerStatementEntry } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { PRICE_TIER_LABELS } from '../shared/pricingUtils';
import type {
  Customer,
  DocumentTemplateArtifact,
  PartnerItemizedSummaryRow,
  PartnerStatementLineItem,
  PaymentGatewayConfig,
  PaymentMethod,
  PaymentTransaction,
  PriceTier,
  StaffUser,
  StoreSettings,
  Supplier,
  TreasuryAccount,
} from '../shared/types';
import { exportWorkbookXlsx } from '../utils/exportUtils';
import { formatDateTimeAr, formatEGP, formatNum, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { buildWhatsAppUrl, formatCustomerReminderText } from '../utils/whatsappShare';
import { EPaymentsAndTreasuriesTab } from './partners/EPaymentsAndTreasuriesTab';
import {
  CollectCustomerModal,
  EditCustomerModal,
  EditSupplierModal,
  PaySupplierModal,
} from './partners/PartnerActionModals';
import { PartnerStatementModal, type PartnerStatementViewData } from './partners/PartnerStatementModal';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';

interface PartnersPaymentsViewProps {
  customers: Customer[];
  suppliers: Supplier[];
  transactions: PaymentTransaction[];
  treasuries?: TreasuryAccount[];
  templates?: DocumentTemplateArtifact[];
  paymentConfig: PaymentGatewayConfig;
  settings: StoreSettings;
  currentUser: StaffUser;
  canManagePayments: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
  requestedSubTab?: { tab: 'customers' | 'suppliers' | 'epayments'; seq: number } | null;
}

interface RawStatementResponse {
  partnerType: 'customer' | 'supplier';
  customer?: Customer;
  supplier?: Supplier;
  entries: Array<{
    id: string;
    date: string;
    type: 'invoice' | 'purchase' | 'payment' | 'return';
    reference: string;
    description: string;
    debit: number;
    credit: number;
    method: string;
    dueDate?: string | null;
    invoiceStatus?: string;
    treasuryBreakdown?: string;
    items?: PartnerStatementLineItem[];
  }>;
  itemizedSummary?: PartnerItemizedSummaryRow[];
  totalInvoiced?: number;
  totalSupplied?: number;
  totalPaid: number;
  closingBalance: number;
}

export function PartnersPaymentsView({
  customers,
  suppliers,
  transactions,
  treasuries = [],
  templates = [],
  paymentConfig,
  settings,
  currentUser,
  canManagePayments,
  apiFetch,
  onMutated,
  requestedSubTab,
}: PartnersPaymentsViewProps) {
  const [tab, setTab] = useState<'customers' | 'suppliers' | 'epayments'>('customers');

  useEffect(() => {
    if (requestedSubTab?.seq) {
      setTab(requestedSubTab.tab);
    }
  }, [requestedSubTab]);

  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [custSearch, setCustSearch] = useState('');
  const debouncedCustSearch = useDebouncedValue(custSearch, 200);
  const [supSearch, setSupSearch] = useState('');
  const debouncedSupSearch = useDebouncedValue(supSearch, 200);

  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: '',
    creditLimit: 0,
    defaultPriceTier: 'retail' as PriceTier,
    defaultDiscountPercent: 0,
    notes: '',
  });
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    phone: '',
    category: '',
    notes: '',
  });

  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [confirmDeleteCustId, setConfirmDeleteCustId] = useState<string | null>(null);
  const [confirmDeleteSupId, setConfirmDeleteSupId] = useState<string | null>(null);
  const [collectTarget, setCollectTarget] = useState<Customer | null>(null);
  const [paySupTarget, setPaySupTarget] = useState<Supplier | null>(null);

  const [statementLoading, setStatementLoading] = useState(false);
  const [statementData, setStatementData] = useState<PartnerStatementViewData | null>(null);

  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const activeTreasuries = useMemo(() => treasuries.filter((t) => t.active), [treasuries]);

  const totalReceivables = useMemo(
    () => Number(customers.reduce((s, c) => s + Number(c.balanceDue || 0), 0).toFixed(2)),
    [customers]
  );
  const totalPayables = useMemo(
    () => Number(suppliers.reduce((s, sup) => s + Number(sup.balanceDue || 0), 0).toFixed(2)),
    [suppliers]
  );
  const netPartnersPosition = Number((totalReceivables - totalPayables).toFixed(2));

  // Customers Excel filter + infinite scroll
  const baseCustomers = useMemo(() => {
    const q = debouncedCustSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q)
    );
  }, [customers, debouncedCustSearch]);

  const custColumns: ExcelColumnDef<Customer>[] = useMemo(
    () => [
      { key: 'name', label: 'العميل', getValue: (c) => c.name },
      {
        key: 'totalPurchases',
        label: 'إجمالي المشتريات',
        getValue: (c) => formatEGP(c.totalPurchases),
        getSortValue: (c) => c.totalPurchases,
      },
      {
        key: 'balanceDue',
        label: 'الرصيد المتبقي',
        getValue: (c) => (c.balanceDue > 0 ? formatEGP(c.balanceDue) : 'خالص'),
        getSortValue: (c) => c.balanceDue,
      },
    ],
    []
  );
  const custExcel = useExcelTableFilter(baseCustomers, custColumns);
  const custScroll = useInfiniteScroll(custExcel.filteredRows, {
    batchSize: 12,
    resetKey: `cust-${debouncedCustSearch}-${custExcel.activeFilterKeys.join(',')}-${custExcel.sortState.columnKey}`,
  });

  // Suppliers Excel filter + infinite scroll
  const baseSuppliers = useMemo(() => {
    const q = debouncedSupSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q)
    );
  }, [suppliers, debouncedSupSearch]);

  const supColumns: ExcelColumnDef<Supplier>[] = useMemo(
    () => [
      { key: 'name', label: 'المورد', getValue: (s) => s.name },
      { key: 'category', label: 'التخصص', getValue: (s) => s.category },
      {
        key: 'balanceDue',
        label: 'مستحقات له',
        getValue: (s) => (s.balanceDue > 0 ? formatEGP(s.balanceDue) : 'مسدد'),
        getSortValue: (s) => s.balanceDue,
      },
    ],
    []
  );
  const supExcel = useExcelTableFilter(baseSuppliers, supColumns);
  const supScroll = useInfiniteScroll(supExcel.filteredRows, {
    batchSize: 12,
    resetKey: `sup-${debouncedSupSearch}-${supExcel.activeFilterKeys.join(',')}-${supExcel.sortState.columnKey}`,
  });

  const pickDefaultTreasuryForMethod = (m: PaymentMethod) => {
    const tType = m === 'instapay' ? 'instapay' : m === 'vodafone_cash' ? 'wallet' : 'cash_drawer';
    return (
      activeTreasuries.find((t) => t.type === tType && t.isDefault)?.id ||
      activeTreasuries.find((t) => t.type === tType)?.id ||
      activeTreasuries[0]?.id ||
      ''
    );
  };

  const handleOpenStatement = async (partnerType: 'customer' | 'supplier', partnerId: string) => {
    setStatementLoading(true);
    setErrMsg(null);
    try {
      const endpoint =
        partnerType === 'customer'
          ? `/api/customers/${partnerId}/statement`
          : `/api/suppliers/${partnerId}/statement`;
      const raw = await apiFetch<RawStatementResponse>(endpoint);
      let running = 0;
      const mappedEntries: PartnerStatementEntry[] = raw.entries.map((entry) => {
        const debitVal = partnerType === 'customer' ? entry.debit : entry.credit;
        const creditVal = partnerType === 'customer' ? entry.credit : entry.debit;
        running = Number((running + debitVal - creditVal).toFixed(2));
        return {
          id: entry.id,
          date: entry.date,
          entryType: entry.type,
          typeLabel: entry.description,
          reference: entry.reference,
          debit: debitVal,
          credit: creditVal,
          runningBalance: running,
          notes: PAYMENT_METHOD_LABELS[entry.method as PaymentMethod] || entry.method,
          dueDate: entry.dueDate || null,
          invoiceStatus: entry.invoiceStatus,
          treasuryBreakdown: entry.treasuryBreakdown,
          items: entry.items || [],
        };
      });

      const partnerObj = partnerType === 'customer' ? raw.customer : raw.supplier;
      setStatementData({
        partnerId,
        partnerType,
        partnerName: partnerObj?.name || '',
        partnerPhone: partnerObj?.phone || '',
        currentBalance: raw.closingBalance,
        creditLimit: raw.customer?.creditLimit,
        loyaltyPoints: raw.customer?.loyaltyPoints ?? 0,
        storeCreditBalance: raw.customer?.storeCreditBalance ?? 0,
        totalVolume: (partnerType === 'customer' ? raw.totalInvoiced : raw.totalSupplied) || 0,
        totalPaid: raw.totalPaid,
        entries: mappedEntries,
        itemizedSummary: raw.itemizedSummary || [],
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحميل كشف الحساب');
    } finally {
      setStatementLoading(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.name.trim()) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(newCustomer) });
      setNewCustomer({
        name: '',
        phone: '',
        creditLimit: 0,
        defaultPriceTier: 'retail',
        defaultDiscountPercent: 0,
        notes: '',
      });
      onMutated('تمت إضافة العميل بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل إضافة العميل');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomerEdit = async (form: {
    name: string;
    phone: string;
    creditLimit: number;
    defaultPriceTier: PriceTier;
    defaultDiscountPercent: number;
    notes: string;
  }) => {
    if (!editCustomer) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/customers/${editCustomer.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setEditCustomer(null);
      onMutated('تم تحديث بيانات العميل بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحديث بيانات العميل');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (cust: Customer) => {
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/customers/${cust.id}`, { method: 'DELETE' });
      setConfirmDeleteCustId(null);
      onMutated(`تم حذف العميل (${cust.name})`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف العميل');
    } finally {
      setSaving(false);
    }
  };

  const handleCollect = async (payload: {
    amount: number;
    method: PaymentMethod;
    treasuryId: string;
    referenceCode: string;
  }) => {
    if (!collectTarget) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/customers/${collectTarget.id}/collect`, {
        method: 'POST',
        body: JSON.stringify({
          amount: payload.amount,
          method: payload.method,
          referenceCode: payload.referenceCode,
          treasuryId: payload.treasuryId || null,
        }),
      });
      const paidCustomerId = collectTarget.id;
      setCollectTarget(null);
      onMutated('تم تحصيل الدفعة وتحديث رصيد العميل والخزينة');
      if (statementData && statementData.partnerType === 'customer' && statementData.partnerId === paidCustomerId) {
        void handleOpenStatement('customer', paidCustomerId);
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تسجيل التحصيل');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.name.trim()) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(newSupplier) });
      setNewSupplier({ name: '', phone: '', category: '', notes: '' });
      onMutated('تمت إضافة المورد بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل إضافة المورد');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSupplierEdit = async (form: {
    name: string;
    phone: string;
    category: string;
    notes: string;
  }) => {
    if (!editSupplier) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/suppliers/${editSupplier.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setEditSupplier(null);
      onMutated('تم تحديث بيانات المورد بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحديث بيانات المورد');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSupplier = async (sup: Supplier) => {
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/suppliers/${sup.id}`, { method: 'DELETE' });
      setConfirmDeleteSupId(null);
      onMutated(`تم حذف المورد (${sup.name})`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف المورد');
    } finally {
      setSaving(false);
    }
  };

  const handlePaySupplierSubmit = async (payload: {
    amount: number;
    method: PaymentMethod;
    treasuryId: string;
    referenceCode: string;
  }) => {
    if (!paySupTarget) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/suppliers/${paySupTarget.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          amount: payload.amount,
          method: payload.method,
          referenceCode: payload.referenceCode,
          treasuryId: payload.treasuryId || null,
        }),
      });
      const paidSupplierId = paySupTarget.id;
      const paidSupplierName = paySupTarget.name;
      setPaySupTarget(null);
      onMutated(`تم تسجيل سداد دفعة للمورد (${paidSupplierName}) وخصمها من الخزينة`);
      if (statementData && statementData.partnerType === 'supplier' && statementData.partnerId === paidSupplierId) {
        void handleOpenStatement('supplier', paidSupplierId);
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل تسجيل السداد');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePaymentConfig = async (cfg: PaymentGatewayConfig) => {
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/payments/config', {
        method: 'POST',
        body: JSON.stringify(cfg),
      });
      onMutated('تم حفظ إعدادات بوابات الدفع الإلكتروني');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCustomersXlsx = () => {
    const rows = custExcel.filteredRows;
    exportWorkbookXlsx('حسابات-العملاء.xlsx', [
      {
        name: 'العملاء',
        title: `${settings.storeName} — سجل حسابات وأرصدة العملاء`,
        subtitle: `إجمالي الحسابات: ${rows.length} عميل`,
        headers: [
          'الاسم',
          'الموبايل',
          'شريحة السعر',
          'الخصم التلقائي %',
          'الحد الائتماني',
          'إجمالي المشتريات',
          'الرصيد المتبقي',
          'نقاط الولاء',
          'رصيد دائن (محفظة)',
          'آخر شراء',
          'ملاحظات',
        ],
        rows: rows.map((c) => [
          c.name,
          c.phone,
          PRICE_TIER_LABELS[c.defaultPriceTier || 'retail'],
          c.defaultDiscountPercent || 0,
          c.creditLimit || 0,
          c.totalPurchases,
          c.balanceDue,
          c.loyaltyPoints || 0,
          c.storeCreditBalance || 0,
          c.lastPurchaseAt ? formatDateTimeAr(c.lastPurchaseAt) : '—',
          c.notes || '',
        ]),
        totalsRow: [
          `الإجمالي (${rows.length})`,
          '—',
          '—',
          '—',
          rows.reduce((s, c) => s + (c.creditLimit || 0), 0),
          rows.reduce((s, c) => s + c.totalPurchases, 0),
          rows.reduce((s, c) => s + c.balanceDue, 0),
          rows.reduce((s, c) => s + (c.loyaltyPoints || 0), 0),
          rows.reduce((s, c) => s + (c.storeCreditBalance || 0), 0),
          '—',
          '',
        ],
      },
    ]);
  };

  const handleExportSuppliersXlsx = () => {
    const rows = supExcel.filteredRows;
    exportWorkbookXlsx('حسابات-الموردين.xlsx', [
      {
        name: 'الموردين',
        title: `${settings.storeName} — سجل حسابات ومستحقات الموردين`,
        subtitle: `إجمالي الموردين: ${rows.length} مورد`,
        headers: ['اسم المورد', 'الهاتف', 'التخصص', 'الرصيد المستحق له', 'ملاحظات'],
        rows: rows.map((s) => [s.name, s.phone, s.category, s.balanceDue, s.notes || '']),
        totalsRow: [
          `الإجمالي (${rows.length})`,
          '—',
          '—',
          rows.reduce((sum, s) => sum + s.balanceDue, 0),
          '',
        ],
      },
    ]);
  };

  const formatCustomerTierInline = (c: Customer) => {
    const parts: string[] = [];
    const tier = c.defaultPriceTier || 'retail';
    if (tier !== 'retail') parts.push(PRICE_TIER_LABELS[tier]);
    if ((c.defaultDiscountPercent || 0) > 0) parts.push(`خصم ${c.defaultDiscountPercent}%`);
    return parts.join(' · ');
  };

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">مستحقات لنا عند العملاء (الآجل)</div>
          <div className="mt-1 font-mono-num text-2xl font-bold text-amber-600 dark:text-amber-400">
            {formatEGP(totalReceivables)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">مديونية علينا للموردين</div>
          <div className="mt-1 font-mono-num text-2xl font-bold text-rose-600 dark:text-rose-400">
            {formatEGP(totalPayables)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">صافي الموقف مع العملاء والموردين</div>
          <div
            className={`mt-1 font-mono-num text-2xl font-bold ${
              netPartnersPosition >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatEGP(netPartnersPosition)}
          </div>
        </div>
      </div>

      {/* Segmented Navigation */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setTab('customers')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'customers'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>العملاء وحسابات الآجل (الشكك)</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('suppliers')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'suppliers'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <Wallet className="h-4 w-4" />
          <span>الموردين وفواتير التوريد</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('epayments')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'epayments'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          <span>بوابات الدفع الإلكتروني والتحصيلات</span>
        </button>
      </div>

      {errMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errMsg}
        </div>
      )}

      {/* Customers Tab */}
      {tab === 'customers' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleAddCustomer}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3 h-fit"
          >
            <h3 className="font-display text-sm font-bold">تسجيل عميل جديد</h3>
            <div>
              <label className="block text-xs font-medium mb-1">اسم العميل أو المطعم/المحل</label>
              <input
                required
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">رقم الموبايل</label>
              <input
                required
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                placeholder="010..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium mb-1">شريحة السعر الافتراضية</label>
                <select
                  value={newCustomer.defaultPriceTier}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, defaultPriceTier: e.target.value as PriceTier })
                  }
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
                <label className="block text-xs font-medium mb-1">خصم دائم (%)</label>
                <input
                  type="number"
                  min={0}
                  max={80}
                  step="0.5"
                  value={newCustomer.defaultDiscountPercent}
                  onChange={(e) =>
                    setNewCustomer({
                      ...newCustomer,
                      defaultDiscountPercent: Math.max(0, Math.min(80, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">الحد الائتماني المسموح (ج.م)</label>
              <input
                type="number"
                min={0}
                value={newCustomer.creditLimit}
                onChange={(e) => setNewCustomer({ ...newCustomer, creditLimit: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">ملاحظات (اختياري)</label>
              <input
                value={newCustomer.notes}
                onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              <span>حفظ العميل</span>
            </button>
          </form>

          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  placeholder="بحث في العملاء بالاسم أو الموبايل..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                {custSearch && (
                  <button
                    type="button"
                    onClick={() => setCustSearch('')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'table'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    <span>جدول</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('cards')}
                    className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'cards'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>بطاقات</span>
                  </button>
                </div>
                <span className="font-mono-num text-xs text-slate-500">
                  {custExcel.filteredRows.length} عميل
                </span>
                <button
                  type="button"
                  onClick={handleExportCustomersXlsx}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            <ActiveExcelFiltersBar
              columns={custColumns}
              activeFilterKeys={custExcel.activeFilterKeys}
              sortState={custExcel.sortState}
              totalBefore={baseCustomers.length}
              totalAfter={custExcel.filteredRows.length}
              onClearOne={(k) => custExcel.applyColumnFilter(k, null)}
              onClearAll={custExcel.clearAllFilters}
            />

            <div className={viewMode === 'cards' ? 'space-y-3' : 'md:hidden space-y-3'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {custScroll.visibleItems.map((c) => {
                  const tierSummary = formatCustomerTierInline(c);
                  return (
                    <div
                      key={c.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                          <div className="font-mono-num text-xs text-slate-500">
                            {c.phone || 'بدون هاتف'}
                            {c.creditLimit && c.creditLimit > 0 ? ` · حد ${formatEGP(c.creditLimit)}` : ''}
                            {tierSummary ? ` · ${tierSummary}` : ''}
                          </div>
                        </div>
                        <div className="text-left font-mono-num">
                          <div className="text-[11px] text-slate-400">المتبقي</div>
                          <div
                            className={`text-sm font-bold ${
                              c.balanceDue > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'
                            }`}
                          >
                            {formatEGP(c.balanceDue)}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 border-y border-slate-100 py-2 text-xs dark:border-slate-800 font-mono-num">
                        <div>
                          <div className="text-[11px] text-slate-400">المشتريات</div>
                          <div className="font-semibold">{formatEGP(c.totalPurchases)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">نقاط الولاء</div>
                          <div className="font-semibold text-emerald-600">{formatNum(c.loyaltyPoints || 0)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">رصيد دائن</div>
                          <div className="font-semibold text-sky-600">{formatEGP(c.storeCreditBalance || 0)}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.balanceDue > 0 && (
                          <button
                            type="button"
                            onClick={() => setCollectTarget(c)}
                            className="min-h-[38px] rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            تحصيل
                          </button>
                        )}
                        {c.balanceDue > 0 && c.phone && (
                          <a
                            href={buildWhatsAppUrl(c.phone, formatCustomerReminderText(c, settings.storeName))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>واتساب</span>
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={statementLoading}
                          onClick={() => handleOpenStatement('customer', c.id)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                        >
                          <FileText className="h-3.5 w-3.5 text-emerald-600" />
                          <span>كشف حساب</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditCustomer(c)}
                          title="تعديل بيانات العميل"
                          className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <InfiniteTableFooter
                visibleCount={custScroll.visibleCount}
                totalCount={custScroll.totalCount}
                hasMore={custScroll.hasMore}
                onLoadMore={custScroll.loadMore}
                sentinelRef={custScroll.sentinelRef}
              />
            </div>

            {viewMode === 'table' && (
              <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="name"
                            label="العميل"
                            options={custExcel.getColumnOptions('name')}
                            activeFilterValues={custExcel.columnFilters['name']}
                            sortDirection={
                              custExcel.sortState.columnKey === 'name'
                                ? custExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => custExcel.applyColumnFilter('name', v)}
                            onSort={(d) => custExcel.setColumnSort('name', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="totalPurchases"
                            label="إجمالي المشتريات"
                            options={custExcel.getColumnOptions('totalPurchases')}
                            activeFilterValues={custExcel.columnFilters['totalPurchases']}
                            sortDirection={
                              custExcel.sortState.columnKey === 'totalPurchases'
                                ? custExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => custExcel.applyColumnFilter('totalPurchases', v)}
                            onSort={(d) => custExcel.setColumnSort('totalPurchases', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="balanceDue"
                            label="الرصيد المتبقي (آجل)"
                            options={custExcel.getColumnOptions('balanceDue')}
                            activeFilterValues={custExcel.columnFilters['balanceDue']}
                            sortDirection={
                              custExcel.sortState.columnKey === 'balanceDue'
                                ? custExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => custExcel.applyColumnFilter('balanceDue', v)}
                            onSort={(d) => custExcel.setColumnSort('balanceDue', d)}
                          />
                        </th>
                        <th className="px-4 py-3">إجراءات وحركات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {custScroll.visibleItems.map((c) => {
                        const tierSummary = formatCustomerTierInline(c);
                        return (
                          <tr key={c.id}>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                              <div className="font-mono-num text-xs text-slate-500">
                                {c.phone}
                                {tierSummary ? ` · ${tierSummary}` : ''}
                                {c.creditLimit && c.creditLimit > 0 ? ` · حد ${formatEGP(c.creditLimit)}` : ''}
                                {(c.loyaltyPoints || 0) > 0
                                  ? ` · ${formatNum(c.loyaltyPoints || 0)} نقطة ولاء`
                                  : ''}
                                {(c.storeCreditBalance || 0) > 0
                                  ? ` · رصيد دائن ${formatEGP(c.storeCreditBalance || 0)}`
                                  : ''}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono-num">{formatEGP(c.totalPurchases)}</td>
                            <td className="px-4 py-3 font-mono-num font-bold">
                              <span
                                className={
                                  c.balanceDue > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'
                                }
                              >
                                {formatEGP(c.balanceDue)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {c.balanceDue > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setCollectTarget(c)}
                                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                  >
                                    تحصيل
                                  </button>
                                )}
                                {c.balanceDue > 0 && c.phone && (
                                  <a
                                    href={buildWhatsAppUrl(
                                      c.phone,
                                      formatCustomerReminderText(c, settings.storeName)
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="تذكير واتساب بالرصيد"
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    <span>تذكير</span>
                                  </a>
                                )}
                                <button
                                  type="button"
                                  disabled={statementLoading}
                                  onClick={() => handleOpenStatement('customer', c.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <FileText className="h-3.5 w-3.5 text-emerald-600" />
                                  <span>كشف حساب</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditCustomer(c)}
                                  title="تعديل بيانات العميل"
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                {confirmDeleteCustId === c.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCustomer(c)}
                                      className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white"
                                    >
                                      حذف
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCustId(null)}
                                      className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                                    >
                                      لا
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCustId(c.id)}
                                    title="حذف العميل"
                                    className="rounded-md border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400"
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
                <InfiniteTableFooter
                  visibleCount={custScroll.visibleCount}
                  totalCount={custScroll.totalCount}
                  hasMore={custScroll.hasMore}
                  onLoadMore={custScroll.loadMore}
                  sentinelRef={custScroll.sentinelRef}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suppliers Tab */}
      {tab === 'suppliers' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleAddSupplier}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3 h-fit"
          >
            <h3 className="font-display text-sm font-bold">إضافة مورد أو شركة توزيع</h3>
            <div>
              <label className="block text-xs font-medium mb-1">اسم المورد</label>
              <input
                required
                value={newSupplier.name}
                onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">رقم التواصل</label>
              <input
                required
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">مجال التوريد</label>
              <input
                required
                value={newSupplier.category}
                onChange={(e) => setNewSupplier({ ...newSupplier, category: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">ملاحظات (اختياري)</label>
              <input
                value={newSupplier.notes}
                onChange={(e) => setNewSupplier({ ...newSupplier, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              حفظ المورد
            </button>
          </form>

          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder="بحث في الموردين بالاسم أو التخصص..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                {supSearch && (
                  <button
                    type="button"
                    onClick={() => setSupSearch('')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'table'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    <span>جدول</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('cards')}
                    className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'cards'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>بطاقات</span>
                  </button>
                </div>
                <span className="font-mono-num text-xs text-slate-500">
                  {supExcel.filteredRows.length} مورد
                </span>
                <button
                  type="button"
                  onClick={handleExportSuppliersXlsx}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            <ActiveExcelFiltersBar
              columns={supColumns}
              activeFilterKeys={supExcel.activeFilterKeys}
              sortState={supExcel.sortState}
              totalBefore={baseSuppliers.length}
              totalAfter={supExcel.filteredRows.length}
              onClearOne={(k) => supExcel.applyColumnFilter(k, null)}
              onClearAll={supExcel.clearAllFilters}
            />

            <div className={viewMode === 'cards' ? 'space-y-3' : 'md:hidden space-y-3'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {supScroll.visibleItems.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{s.name}</div>
                        <div className="font-mono-num text-xs text-slate-500">
                          {s.phone} · {s.category}
                        </div>
                      </div>
                      <div className="text-left font-mono-num">
                        <div className="text-[11px] text-slate-400">مستحقات له</div>
                        <div className="text-sm font-bold text-rose-600 dark:text-rose-400">
                          {formatEGP(s.balanceDue)}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.balanceDue > 0 && (
                        <button
                          type="button"
                          onClick={() => setPaySupTarget(s)}
                          className="min-h-[38px] rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
                        >
                          سداد دفعة
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={statementLoading}
                        onClick={() => handleOpenStatement('supplier', s.id)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                      >
                        <FileText className="h-3.5 w-3.5 text-emerald-600" />
                        <span>كشف حساب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditSupplier(s)}
                        title="تعديل بيانات المورد"
                        className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <InfiniteTableFooter
                visibleCount={supScroll.visibleCount}
                totalCount={supScroll.totalCount}
                hasMore={supScroll.hasMore}
                onLoadMore={supScroll.loadMore}
                sentinelRef={supScroll.sentinelRef}
              />
            </div>

            {viewMode === 'table' && (
              <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="name"
                            label="المورد"
                            options={supExcel.getColumnOptions('name')}
                            activeFilterValues={supExcel.columnFilters['name']}
                            sortDirection={
                              supExcel.sortState.columnKey === 'name'
                                ? supExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => supExcel.applyColumnFilter('name', v)}
                            onSort={(d) => supExcel.setColumnSort('name', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="category"
                            label="التخصص"
                            options={supExcel.getColumnOptions('category')}
                            activeFilterValues={supExcel.columnFilters['category']}
                            sortDirection={
                              supExcel.sortState.columnKey === 'category'
                                ? supExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => supExcel.applyColumnFilter('category', v)}
                            onSort={(d) => supExcel.setColumnSort('category', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="balanceDue"
                            label="مستحقات له"
                            options={supExcel.getColumnOptions('balanceDue')}
                            activeFilterValues={supExcel.columnFilters['balanceDue']}
                            sortDirection={
                              supExcel.sortState.columnKey === 'balanceDue'
                                ? supExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => supExcel.applyColumnFilter('balanceDue', v)}
                            onSort={(d) => supExcel.setColumnSort('balanceDue', d)}
                          />
                        </th>
                        <th className="px-4 py-3">إجراءات وحركات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {supScroll.visibleItems.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{s.name}</div>
                            <div className="font-mono-num text-xs text-slate-500">{s.phone}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.category}</td>
                          <td className="px-4 py-3 font-mono-num font-bold text-rose-600 dark:text-rose-400">
                            {formatEGP(s.balanceDue)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {s.balanceDue > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setPaySupTarget(s)}
                                  className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
                                >
                                  سداد دفعة
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={statementLoading}
                                onClick={() => handleOpenStatement('supplier', s.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <FileText className="h-3.5 w-3.5 text-emerald-600" />
                                <span>كشف حساب</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditSupplier(s)}
                                title="تعديل بيانات المورد"
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              {confirmDeleteSupId === s.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSupplier(s)}
                                    className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white"
                                  >
                                    حذف
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteSupId(null)}
                                    className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                                  >
                                    لا
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSupId(s.id)}
                                  title="حذف المورد"
                                  className="rounded-md border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <InfiniteTableFooter
                  visibleCount={supScroll.visibleCount}
                  totalCount={supScroll.totalCount}
                  hasMore={supScroll.hasMore}
                  onLoadMore={supScroll.loadMore}
                  sentinelRef={supScroll.sentinelRef}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Electronic Payments Tab */}
      {tab === 'epayments' && (
        <EPaymentsAndTreasuriesTab
          transactions={transactions}
          paymentConfig={paymentConfig}
          canManagePayments={canManagePayments}
          saving={saving}
          onSaveConfig={handleSavePaymentConfig}
        />
      )}

      {/* Action Modals */}
      {collectTarget && (
        <CollectCustomerModal
          target={collectTarget}
          activeTreasuries={activeTreasuries}
          saving={saving}
          pickDefaultTreasuryForMethod={pickDefaultTreasuryForMethod}
          onClose={() => setCollectTarget(null)}
          onSubmit={handleCollect}
        />
      )}

      {paySupTarget && (
        <PaySupplierModal
          target={paySupTarget}
          activeTreasuries={activeTreasuries}
          saving={saving}
          pickDefaultTreasuryForMethod={pickDefaultTreasuryForMethod}
          onClose={() => setPaySupTarget(null)}
          onSubmit={handlePaySupplierSubmit}
        />
      )}

      {editCustomer && (
        <EditCustomerModal
          customer={editCustomer}
          saving={saving}
          onClose={() => setEditCustomer(null)}
          onSubmit={handleSaveCustomerEdit}
        />
      )}

      {editSupplier && (
        <EditSupplierModal
          supplier={editSupplier}
          saving={saving}
          onClose={() => setEditSupplier(null)}
          onSubmit={handleSaveSupplierEdit}
        />
      )}

      {statementData && (
        <PartnerStatementModal
          statementData={statementData}
          customers={customers}
          suppliers={suppliers}
          templates={templates}
          settings={settings}
          currentUserName={currentUser.name}
          canManagePayments={canManagePayments}
          onClose={() => setStatementData(null)}
          onSwitchPartner={(pType, pId) => void handleOpenStatement(pType, pId)}
          onOpenSettlement={(pType, pId) => {
            if (pType === 'customer') {
              const target = customers.find((c) => c.id === pId);
              if (target) setCollectTarget(target);
            } else {
              const target = suppliers.find((s) => s.id === pId);
              if (target) setPaySupTarget(target);
            }
          }}
        />
      )}
    </div>
  );
}
