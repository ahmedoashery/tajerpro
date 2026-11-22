import {
  ChevronDown,
  ChevronUp,
  FilePlus2,
  FileSpreadsheet,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type {
  AutoReorderSupplierGroup,
  Product,
  PurchaseOrder,
  StaffUser,
  StoreSettings,
  Supplier,
  TreasuryAccount,
} from '../shared/types';
import { exportWorkbookXlsx } from '../utils/exportUtils';
import { formatDateTimeAr, formatEGP, formatNum } from '../utils/formatters';
import { NewPurchaseModal } from './purchases/NewPurchaseModal';
import { PurchaseReturnModal } from './purchases/PurchaseReturnModal';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';

interface PurchasesViewProps {
  purchases: PurchaseOrder[];
  products: Product[];
  suppliers: Supplier[];
  treasuries?: TreasuryAccount[];
  reorderSuggestions?: AutoReorderSupplierGroup[];
  prefillDraft?: AutoReorderSupplierGroup | null;
  onClearPrefillDraft?: () => void;
  settings: StoreSettings;
  currentUser: StaffUser;
  canManagePurchases: boolean;
  canViewCosts: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
}

const SOURCE_LABELS: Record<'cash' | 'bank_transfer' | 'credit', string> = {
  cash: 'سداد نقدي (درج/خزينة)',
  bank_transfer: 'تحويل بنكي / إنستا باي',
  credit: 'آجل بالكامل على الحساب',
};

export function PurchasesView({
  purchases,
  products,
  suppliers,
  treasuries = [],
  reorderSuggestions = [],
  prefillDraft = null,
  onClearPrefillDraft,
  settings,
  currentUser,
  canManagePurchases,
  canViewCosts,
  apiFetch,
  onMutated,
}: PurchasesViewProps) {
  const { printDocument } = usePrint();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [debtFilter, setDebtFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [selectedId, setSelectedId] = useState<string>(purchases[0]?.id || '');
  const [showSuggestions, setShowSuggestions] = useState(true);

  const [showNewModal, setShowNewModal] = useState(false);
  const [activePrefill, setActivePrefill] = useState<AutoReorderSupplierGroup | null>(null);
  const [returnTarget, setReturnTarget] = useState<PurchaseOrder | null>(null);

  const activeTreasuries = useMemo(() => treasuries.filter((t) => t.active), [treasuries]);

  const preSearched = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return purchases.filter((p) => {
      if (debtFilter === 'unpaid' && p.remainingDebt <= 0) return false;
      if (debtFilter === 'paid' && p.remainingDebt > 0) return false;
      if (!q) return true;
      return (
        p.purchaseNumber.toLowerCase().includes(q) ||
        p.supplierName.toLowerCase().includes(q) ||
        p.supplierInvoiceRef.toLowerCase().includes(q) ||
        p.items.some((it) => it.productName.toLowerCase().includes(q))
      );
    });
  }, [purchases, debouncedSearch, debtFilter]);

  const excelColumns: ExcelColumnDef<PurchaseOrder>[] = useMemo(
    () => [
      { key: 'number', label: 'رقم التوريد', getValue: (p) => p.purchaseNumber },
      { key: 'supplier', label: 'المورد', getValue: (p) => p.supplierName },
      { key: 'source', label: 'السداد', getValue: (p) => SOURCE_LABELS[p.paymentSource] },
      {
        key: 'total',
        label: 'الإجمالي',
        getValue: (p) => formatEGP(p.grandTotal),
        getSortValue: (p) => p.grandTotal,
      },
      {
        key: 'debt',
        label: 'الآجل',
        getValue: (p) => (p.remainingDebt > 0 ? formatEGP(p.remainingDebt) : 'مسددة'),
        getSortValue: (p) => p.remainingDebt,
      },
    ],
    []
  );

  const excel = useExcelTableFilter(preSearched, excelColumns);

  const {
    visibleItems: visiblePurchases,
    visibleCount,
    hasMore,
    totalCount,
    loadMore,
    sentinelRef,
  } = useInfiniteScroll(excel.filteredRows, {
    batchSize: 20,
    resetKey: `${debouncedSearch}-${debtFilter}-${excel.activeFilterKeys.join(',')}-${excel.sortState.columnKey}`,
  });

  useEffect(() => {
    if (excel.filteredRows.length === 0) {
      setSelectedId('');
      return;
    }
    if (!excel.filteredRows.some((p) => p.id === selectedId)) {
      setSelectedId(excel.filteredRows[0].id);
    }
  }, [excel.filteredRows, selectedId]);

  const selectedPurchase = useMemo(
    () => excel.filteredRows.find((p) => p.id === selectedId) || excel.filteredRows[0] || null,
    [excel.filteredRows, selectedId]
  );

  const canReturnSelected = useMemo(() => {
    if (!selectedPurchase || !canManagePurchases) return false;
    return selectedPurchase.items.some((it) => it.quantity - (it.returnedQuantity || 0) > 0.0001);
  }, [selectedPurchase, canManagePurchases]);

  const totalPurchasesAmount = useMemo(
    () => purchases.reduce((s, p) => s + Math.max(0, p.grandTotal - (p.returnedTotal || 0)), 0),
    [purchases]
  );
  const totalUnpaidSupplierDebt = useMemo(
    () => suppliers.reduce((s, sup) => s + sup.balanceDue, 0),
    [suppliers]
  );

  const applyReorderGroup = useCallback((group: AutoReorderSupplierGroup) => {
    setActivePrefill(group);
    setShowNewModal(true);
  }, []);

  useEffect(() => {
    if (!prefillDraft) return;
    applyReorderGroup(prefillDraft);
    onClearPrefillDraft?.();
  }, [prefillDraft, applyReorderGroup, onClearPrefillDraft]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Truck className="h-5 w-5 text-emerald-600" />
            <span>المشتريات وفواتير توريد البضاعة</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            تسجيل فواتير الشراء من الموردين ومرتجعات المشتريات وتحديث أسعار التكلفة دون التأثير على أرباح فواتير البيع السابقة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div>
              <span className="text-slate-500">صافي التوريدات: </span>
              <strong className="font-mono-num text-slate-900 dark:text-white">
                {canViewCosts ? formatEGP(totalPurchasesAmount) : 'مقيد'}
              </strong>
            </div>
            <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
            <div>
              <span className="text-slate-500">مديونية الموردين: </span>
              <strong className="font-mono-num text-amber-600 dark:text-amber-400">
                {formatEGP(totalUnpaidSupplierDebt)}
              </strong>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const rows = excel.filteredRows;
              const sumGrand = Number(rows.reduce((s, p) => s + Number(p.grandTotal || 0), 0).toFixed(2));
              const sumReturned = Number(rows.reduce((s, p) => s + Number(p.returnedTotal || 0), 0).toFixed(2));
              const sumPaid = Number(rows.reduce((s, p) => s + Number(p.paidAmount || 0), 0).toFixed(2));
              const sumDebt = Number(rows.reduce((s, p) => s + Number(p.remainingDebt || 0), 0).toFixed(2));
              const itemRows = rows.flatMap((p) =>
                (p.items || []).map((it) => [
                  p.purchaseNumber,
                  formatDateTimeAr(p.createdAt),
                  p.supplierName,
                  it.productName,
                  it.unit,
                  it.quantity,
                  it.returnedQuantity || 0,
                  ...(canViewCosts ? [it.unitCost, it.lineTotal] : []),
                  it.newSalePrice ?? '—',
                  it.batchCode || '—',
                  it.expiryDate || '—',
                ])
              );
              const sumItemQty = Number(itemRows.reduce((s, r) => s + Number(r[5] || 0), 0).toFixed(2));
              const sumItemTotal = canViewCosts
                ? Number(itemRows.reduce((s, r) => s + Number(r[8] || 0), 0).toFixed(2))
                : 0;

              exportWorkbookXlsx('سجل-المشتريات.xlsx', [
                {
                  name: 'المشتريات',
                  title: `${settings.storeName} — سجل المشتريات وفواتير التوريد`,
                  subtitle: `عدد الفواتير: ${rows.length} | المدفوع: ${formatEGP(sumPaid)} | المتبقي آجل: ${formatEGP(sumDebt)}`,
                  headers: [
                    'رقم التوريد',
                    'التاريخ',
                    'المورد',
                    'رقم فاتورة المورد',
                    'طريقة السداد',
                    'الخزينة المسدد منها',
                    ...(canViewCosts ? ['الإجمالي', 'المرتجع'] : []),
                    'المدفوع',
                    'المتبقي آجل',
                    'مسؤول الاستلام',
                  ],
                  rows: rows.map((p) => [
                    p.purchaseNumber,
                    formatDateTimeAr(p.createdAt),
                    p.supplierName,
                    p.supplierInvoiceRef || '—',
                    SOURCE_LABELS[p.paymentSource],
                    p.treasuryName || '—',
                    ...(canViewCosts ? [p.grandTotal, p.returnedTotal || 0] : []),
                    p.paidAmount,
                    p.remainingDebt,
                    p.actorName,
                  ]),
                  totalsRow: [
                    'الإجمالي',
                    `${rows.length} فاتورة`,
                    '',
                    '',
                    '',
                    '',
                    ...(canViewCosts ? [sumGrand, sumReturned] : []),
                    sumPaid,
                    sumDebt,
                    '',
                  ],
                },
                {
                  name: 'تفصيل_أصناف_المشتريات',
                  title: `${settings.storeName} — تفصيل الأصناف الموردة`,
                  subtitle: `إجمالي السطور: ${itemRows.length}`,
                  headers: [
                    'رقم التوريد',
                    'التاريخ',
                    'المورد',
                    'الصنف',
                    'الوحدة',
                    'الكمية',
                    'المرتجع',
                    ...(canViewCosts ? ['تكلفة الوحدة', 'إجمالي التكلفة'] : []),
                    'سعر البيع المحدث',
                    'رقم التشغيلة',
                    'تاريخ الصلاحية',
                  ],
                  rows: itemRows,
                  totalsRow: [
                    'الإجمالي',
                    '',
                    '',
                    `${itemRows.length} سطر`,
                    '',
                    sumItemQty,
                    '',
                    ...(canViewCosts ? ['', sumItemTotal] : []),
                    '',
                    '',
                    '',
                  ],
                },
              ]);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>

          {canManagePurchases && (
            <button
              type="button"
              onClick={() => {
                setActivePrefill(null);
                setShowNewModal(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <FilePlus2 className="h-4 w-4" />
              <span>فاتورة شراء وتوريد جديدة</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Auto-Reorder Suggestions Grouped by Supplier */}
      {canManagePurchases && reorderSuggestions.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                مقترحات أوامر الشراء التلقائية حسب المورد ({reorderSuggestions.length} مورد)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSuggestions((v) => !v)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <span>{showSuggestions ? 'إخفاء' : 'عرض المقترحات'}</span>
              {showSuggestions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {showSuggestions && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {reorderSuggestions.map((grp) => (
                <div
                  key={grp.supplierId}
                  className="rounded-lg border border-amber-200/80 bg-white p-3 dark:border-amber-900/40 dark:bg-slate-900 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        {grp.supplierName}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-amber-700 dark:text-amber-400">
                        {formatEGP(grp.totalEstimatedCost)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      {grp.items.length} أصناف ناقصة ·{' '}
                      {grp.items
                        .slice(0, 2)
                        .map((i) => `${i.productName} (+${formatNum(i.suggestedQty)})`)
                        .join('، ')}
                      {grp.items.length > 2 ? ` +${grp.items.length - 2}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyReorderGroup(grp)}
                    className="w-full min-h-[38px] rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                  >
                    تحويل لأمر شراء
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Search & Excel Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-lg">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم التوريد أو اسم المورد أو الصنف..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
            {(
              [
                ['all', 'كل الفواتير'],
                ['unpaid', 'آجل متبقي'],
                ['paid', 'مسددة بالكامل'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDebtFilter(id)}
                className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                  debtFilter === id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ActiveExcelFiltersBar
          columns={excelColumns}
          activeFilterKeys={excel.activeFilterKeys}
          sortState={excel.sortState}
          totalBefore={preSearched.length}
          totalAfter={excel.filteredRows.length}
          onClearOne={(colId) => excel.applyColumnFilter(colId, null)}
          onClearAll={excel.clearAllFilters}
        />
      </div>

      {/* Master-Detail Split Layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2.5">
                    <ExcelColumnHeader
                      columnKey="number"
                      label="رقم التوريد"
                      options={excel.getColumnOptions('number')}
                      activeFilterValues={excel.columnFilters.number}
                      sortDirection={excel.sortState.columnKey === 'number' ? excel.sortState.direction : null}
                      onSort={(dir) => excel.setColumnSort('number', dir)}
                      onApplyFilter={(vals) => excel.applyColumnFilter('number', vals)}
                    />
                  </th>
                  <th className="px-3 py-2.5">
                    <ExcelColumnHeader
                      columnKey="supplier"
                      label="المورد"
                      options={excel.getColumnOptions('supplier')}
                      activeFilterValues={excel.columnFilters.supplier}
                      sortDirection={excel.sortState.columnKey === 'supplier' ? excel.sortState.direction : null}
                      onSort={(dir) => excel.setColumnSort('supplier', dir)}
                      onApplyFilter={(vals) => excel.applyColumnFilter('supplier', vals)}
                    />
                  </th>
                  <th className="px-3 py-2.5">
                    <ExcelColumnHeader
                      columnKey="source"
                      label="السداد"
                      options={excel.getColumnOptions('source')}
                      activeFilterValues={excel.columnFilters.source}
                      sortDirection={excel.sortState.columnKey === 'source' ? excel.sortState.direction : null}
                      onSort={(dir) => excel.setColumnSort('source', dir)}
                      onApplyFilter={(vals) => excel.applyColumnFilter('source', vals)}
                    />
                  </th>
                  <th className="px-3 py-2.5">
                    <ExcelColumnHeader
                      columnKey="total"
                      label="الإجمالي"
                      options={excel.getColumnOptions('total')}
                      activeFilterValues={excel.columnFilters.total}
                      sortDirection={excel.sortState.columnKey === 'total' ? excel.sortState.direction : null}
                      onSort={(dir) => excel.setColumnSort('total', dir)}
                      onApplyFilter={(vals) => excel.applyColumnFilter('total', vals)}
                    />
                  </th>
                  <th className="px-3 py-2.5">
                    <ExcelColumnHeader
                      columnKey="debt"
                      label="الآجل"
                      options={excel.getColumnOptions('debt')}
                      activeFilterValues={excel.columnFilters.debt}
                      sortDirection={excel.sortState.columnKey === 'debt' ? excel.sortState.direction : null}
                      onSort={(dir) => excel.setColumnSort('debt', dir)}
                      onApplyFilter={(vals) => excel.applyColumnFilter('debt', vals)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visiblePurchases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      لا توجد فواتير مشتريات مطابقة للبحث أو التصفية.
                    </td>
                  </tr>
                ) : (
                  visiblePurchases.map((p) => {
                    const isSelected = selectedPurchase?.id === p.id;
                    const retTotal = Number(p.returnedTotal || 0);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-500/10'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-3 py-3">
                          <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                            {p.purchaseNumber}
                          </div>
                          <div className="text-[11px] text-slate-400">{formatDateTimeAr(p.createdAt)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">
                            {p.supplierName}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {p.items.length} أصناف {p.supplierInvoiceRef ? `· مرجع ${p.supplierInvoiceRef}` : ''}
                            {retTotal > 0 ? ` · مرتجع ${formatEGP(retTotal)}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                          {SOURCE_LABELS[p.paymentSource]}
                        </td>
                        <td className="px-3 py-3 font-mono-num font-bold text-slate-900 dark:text-white">
                          {canViewCosts ? formatEGP(p.grandTotal) : 'مقيد'}
                        </td>
                        <td className="px-3 py-3 font-mono-num font-semibold">
                          <span className={p.remainingDebt > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'}>
                            {p.remainingDebt > 0 ? formatEGP(p.remainingDebt) : 'مسددة'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <InfiniteTableFooter
            visibleCount={visibleCount}
            totalCount={totalCount}
            hasMore={hasMore}
            onLoadMore={loadMore}
            sentinelRef={sentinelRef}
          />
        </div>

        {/* Detail Pane */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          {!selectedPurchase ? (
            <div className="py-16 text-center text-xs text-slate-500">
              اختر فاتورة توريد من الجدول لعرض تفاصيل الأصناف والكميات الموردة.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <div className="font-mono-num text-base font-bold text-slate-900 dark:text-white">
                    {selectedPurchase.purchaseNumber}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedPurchase.supplierName} · {formatDateTimeAr(selectedPurchase.createdAt)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {canReturnSelected && (
                    <button
                      type="button"
                      onClick={() => setReturnTarget(selectedPurchase)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>إرجاع للمورد</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      printDocument({ kind: 'purchase_a4', purchase: selectedPurchase, settings })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>طباعة إذن الاستلام (A4)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950">
                  <div className="text-slate-500">رقم فاتورة المورد</div>
                  <div className="mt-0.5 font-mono-num font-semibold">
                    {selectedPurchase.supplierInvoiceRef || '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950">
                  <div className="text-slate-500">مسؤول الاستلام</div>
                  <div className="mt-0.5 font-semibold">{selectedPurchase.actorName}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950 col-span-2 sm:col-span-1">
                  <div className="text-slate-500">الخزينة / السداد</div>
                  <div className="mt-0.5 font-semibold truncate">
                    {selectedPurchase.treasuryName || SOURCE_LABELS[selectedPurchase.paymentSource]}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950">
                    <tr>
                      <th className="px-3 py-2">الصنف</th>
                      <th className="px-3 py-2">الكمية</th>
                      <th className="px-3 py-2">سعر الشراء</th>
                      <th className="px-3 py-2">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedPurchase.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                          <div>{it.productName}</div>
                          {(it.returnedQuantity || 0) > 0 && (
                            <div className="font-mono-num text-[10px] text-rose-600 dark:text-rose-400">
                              مرتجع: {formatNum(it.returnedQuantity || 0)} {it.unit}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono-num">
                          {formatNum(it.quantity)} {it.unit}
                        </td>
                        <td className="px-3 py-2 font-mono-num">
                          {canViewCosts ? formatEGP(it.unitCost) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono-num font-bold">
                          {canViewCosts ? formatEGP(it.lineTotal) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg bg-slate-50 p-3.5 text-xs space-y-1.5 dark:bg-slate-950">
                <div className="flex justify-between">
                  <span className="text-slate-500">إجمالي الفاتورة:</span>
                  <strong className="font-mono-num">
                    {canViewCosts ? formatEGP(selectedPurchase.grandTotal) : 'مقيد'}
                  </strong>
                </div>
                {(selectedPurchase.returnedTotal || 0) > 0 && (
                  <>
                    <div className="flex justify-between text-rose-600 dark:text-rose-400">
                      <span>إجمالي مرتجعات المورد:</span>
                      <strong className="font-mono-num">
                        -{formatEGP(selectedPurchase.returnedTotal || 0)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">صافي التوريد بعد المرتجع:</span>
                      <strong className="font-mono-num text-slate-900 dark:text-white">
                        {canViewCosts
                          ? formatEGP(Math.max(0, selectedPurchase.grandTotal - (selectedPurchase.returnedTotal || 0)))
                          : 'مقيد'}
                      </strong>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">المدفوع للمورد:</span>
                  <strong className="font-mono-num text-emerald-600">
                    {formatEGP(selectedPurchase.paidAmount)}
                  </strong>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 dark:border-slate-800">
                  <span className="font-semibold">المتبقي آجل للمورد:</span>
                  <strong className="font-mono-num text-amber-600">
                    {formatEGP(selectedPurchase.remainingDebt)}
                  </strong>
                </div>
              </div>

              {selectedPurchase.returns && selectedPurchase.returns.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    سجل مرتجعات الفاتورة ({selectedPurchase.returns.length})
                  </div>
                  <div className="space-y-1.5">
                    {selectedPurchase.returns.map((ret) => (
                      <div
                        key={ret.id}
                        className="rounded-lg border border-rose-200/70 bg-rose-50/40 p-2.5 text-[11px] dark:border-rose-900/40 dark:bg-rose-950/20"
                      >
                        <div className="flex items-center justify-between font-mono-num font-bold text-rose-700 dark:text-rose-300">
                          <span>مرتجع #{ret.id.slice(-6).toUpperCase()}</span>
                          <span>{formatEGP(ret.returnTotal)}</span>
                        </div>
                        <div className="text-slate-500 font-mono-num mt-0.5">
                          {formatDateTimeAr(ret.createdAt)} · {ret.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedPurchase.notes && (
                <div className="text-xs text-slate-500">
                  <strong>ملاحظات: </strong>
                  {selectedPurchase.notes}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNewModal && (
        <NewPurchaseModal
          suppliers={suppliers}
          products={products}
          activeTreasuries={activeTreasuries}
          prefillDraft={activePrefill}
          currentUser={currentUser}
          apiFetch={apiFetch}
          onClose={() => {
            setShowNewModal(false);
            setActivePrefill(null);
          }}
          onCreated={(purchase) => {
            setShowNewModal(false);
            setActivePrefill(null);
            setSelectedId(purchase.id);
            onMutated(`تم اعتماد فاتورة التوريد ${purchase.purchaseNumber} وزيادة المخزون تلقائياً`);
          }}
        />
      )}

      {returnTarget && (
        <PurchaseReturnModal
          purchase={returnTarget}
          activeTreasuries={activeTreasuries}
          currentUser={currentUser}
          apiFetch={apiFetch}
          onClose={() => setReturnTarget(null)}
          onReturned={(msg) => {
            setReturnTarget(null);
            onMutated(msg);
          }}
        />
      )}
    </div>
  );
}
