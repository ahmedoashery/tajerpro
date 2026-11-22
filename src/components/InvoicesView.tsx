import {
  Copy,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  MessageCircle,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type {
  Customer,
  Invoice,
  InvoiceStatus,
  Product,
  StaffUser,
  StoreSettings,
  TreasuryAccount,
} from '../shared/types';
import { BarcodeGraphic } from '../utils/barcodeSvg';
import { exportWorkbookXlsx } from '../utils/exportUtils';
import {
  formatDateTimeAr,
  formatEGP,
  formatNum,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';
import {
  buildWhatsAppUrl,
  copyTextToClipboard,
  formatInvoiceWhatsAppText,
} from '../utils/whatsappShare';
import { PartialReturnModal } from './PartialReturnModal';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';

interface InvoicesViewProps {
  invoices: Invoice[];
  allProducts: Product[];
  customers?: Customer[];
  treasuries?: TreasuryAccount[];
  settings: StoreSettings;
  activeActivityName: string;
  currentUser: StaffUser;
  canViewProfits: boolean;
  canReturnInvoice: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
}

function getStatusLabel(status: InvoiceStatus): string {
  if (status === 'completed') return 'مكتملة';
  if (status === 'partial_returned') return 'مرتجع جزئي';
  return 'مرتجعة';
}

function getStatusTextClass(status: InvoiceStatus): string {
  if (status === 'completed') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'partial_returned') return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

export function InvoicesView({
  invoices,
  allProducts,
  customers = [],
  treasuries = [],
  settings,
  activeActivityName,
  currentUser,
  canViewProfits,
  canReturnInvoice,
  apiFetch,
  onMutated,
}: InvoicesViewProps) {
  const {
    printDocument,
    openPrintPreview,
    exportDocumentAsPdf,
    exportDocumentAsPng,
    exporting,
  } = usePrint();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>(invoices[0]?.id || '');
  const [confirmReturnId, setConfirmReturnId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [partialReturnOpen, setPartialReturnOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const baseFiltered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      const createdYmd = inv.createdAt.slice(0, 10);
      if (dateFrom && createdYmd < dateFrom) return false;
      if (dateTo && createdYmd > dateTo) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.cashierName.toLowerCase().includes(q) ||
        inv.paymentRef.toLowerCase().includes(q)
      );
    });
  }, [invoices, debouncedSearch, statusFilter, dateFrom, dateTo]);

  const excelColumns: ExcelColumnDef<Invoice>[] = useMemo(
    () => [
      {
        key: 'invoiceNumber',
        label: 'رقم الفاتورة',
        getValue: (r) => r.invoiceNumber,
      },
      {
        key: 'customerName',
        label: 'العميل',
        getValue: (r) => r.customerName,
      },
      {
        key: 'cashierName',
        label: 'الكاشير',
        getValue: (r) => r.cashierName,
      },
      {
        key: 'paymentMethod',
        label: 'وسيلة الدفع',
        getValue: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod],
      },
      {
        key: 'grandTotal',
        label: 'إجمالي الفاتورة',
        getValue: (r) => formatEGP(r.grandTotal),
        getSortValue: (r) => r.grandTotal,
      },
      {
        key: 'status',
        label: 'الحالة',
        getValue: (r) => getStatusLabel(r.status),
      },
    ],
    []
  );

  const excel = useExcelTableFilter(baseFiltered, excelColumns);

  const { visibleItems, visibleCount, totalCount, hasMore, loadMore, sentinelRef } =
    useInfiniteScroll(excel.filteredRows, {
      batchSize: 15,
      resetKey: `${debouncedSearch}-${statusFilter}-${dateFrom}-${dateTo}-${excel.activeFilterKeys.join(',')}-${excel.sortState.columnKey}-${excel.sortState.direction}`,
    });

  useEffect(() => {
    if (excel.filteredRows.length === 0) return;
    if (!excel.filteredRows.some((i) => i.id === selectedId)) {
      setSelectedId(excel.filteredRows[0].id);
      setConfirmReturnId(null);
    }
  }, [excel.filteredRows, selectedId]);

  const selectedInvoice = useMemo(
    () =>
      invoices.find((i) => i.id === selectedId) ||
      excel.filteredRows[0] ||
      null,
    [invoices, selectedId, excel.filteredRows]
  );

  const selectedCustomer = selectedInvoice?.customerId
    ? customerMap.get(selectedInvoice.customerId)
    : undefined;

  const handleReturnInvoice = async (invoiceId: string) => {
    setReturningId(invoiceId);
    setErrMsg(null);
    try {
      const res = await apiFetch<{ invoice: Invoice }>(`/api/invoices/${invoiceId}/return`, {
        method: 'POST',
        body: JSON.stringify({
          actorName: currentUser.name,
          terminalName: 'إدارة الفواتير',
        }),
      });
      setConfirmReturnId(null);
      setSelectedId(res.invoice.id);
      onMutated(`تم عمل مرتجع للفاتورة ${res.invoice.invoiceNumber} وإعادة الكميات للمخزن`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر عمل المرتجع');
    } finally {
      setReturningId(null);
    }
  };

  const handleCopyInvoiceText = async (inv: Invoice) => {
    const text = formatInvoiceWhatsAppText(inv, settings.storeName, settings.phone);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2200);
    }
  };

  return (
    <div className="space-y-4">
      {/* Explanation Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              أرشيف الفواتير — عرض Master-Detail والمرتجعات الجزئية والاستبدال
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              اختر أي فاتورة لعرض بنودها وأرباحها التاريخية وتنفيذ مرتجع كلي أو جزئي أو استبدال أصناف مع الحفاظ على دقة الخزائن والمخزون.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span>سلسلة توثيق SHA-256 ضد التلاعب</span>
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث فوري برقم الفاتورة، العميل، الكاشير، أو المرجع..."
            className="w-full min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-8 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="مسح البحث"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 min-h-[40px] text-xs dark:border-slate-700 dark:bg-slate-950">
            <span className="text-slate-500">من</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent font-mono-num text-xs focus:outline-none"
            />
            <span className="text-slate-400">—</span>
            <span className="text-slate-500">إلى</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent font-mono-num text-xs focus:outline-none"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-slate-400 hover:text-rose-600"
                title="مسح نطاق التاريخ"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['all', 'الكل'],
                ['completed', 'مكتملة'],
                ['partial_returned', 'مرتجع جزئي'],
                ['returned', 'مرتجعة'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mobile / Desktop Table vs Cards View Switcher */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="عرض جدول"
            >
              <Table2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">جدول</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'cards'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="عرض بطاقات للهاتف"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">بطاقات</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              const rows = excel.filteredRows;
              const sumGrand = Number(rows.reduce((s, inv) => s + Number(inv.grandTotal || 0), 0).toFixed(2));
              const sumRet = Number(rows.reduce((s, inv) => s + Number(inv.returnedTotal || 0), 0).toFixed(2));
              const sumProfit = Number(
                rows.reduce((s, inv) => s + (inv.status === 'returned' ? 0 : Number(inv.totalProfit || 0)), 0).toFixed(2)
              );
              const itemRows = rows.flatMap((inv) =>
                (inv.items || []).map((it) => {
                  const retQty = Number(it.returnedQuantity || 0);
                  const activeQty = Math.max(0, Number(it.quantity || 0) - retQty);
                  const netLine =
                    it.quantity > 0 ? Number(((it.lineTotal * activeQty) / it.quantity).toFixed(2)) : it.lineTotal;
                  return [
                    inv.invoiceNumber,
                    formatDateTimeAr(inv.createdAt),
                    inv.customerName,
                    it.productName,
                    it.unit,
                    it.quantity,
                    retQty,
                    activeQty,
                    it.unitSalePrice,
                    it.discountAmount || 0,
                    netLine,
                    ...(canViewProfits
                      ? [inv.status === 'returned' || it.quantity <= 0 ? 0 : Number(((it.lineProfit * activeQty) / it.quantity).toFixed(2))]
                      : []),
                  ];
                })
              );
              const sumItemQty = Number(itemRows.reduce((s, r) => s + Number(r[7] || 0), 0).toFixed(2));
              const sumItemNet = Number(itemRows.reduce((s, r) => s + Number(r[10] || 0), 0).toFixed(2));
              const sumItemProfit = canViewProfits
                ? Number(itemRows.reduce((s, r) => s + Number(r[11] || 0), 0).toFixed(2))
                : 0;

              exportWorkbookXlsx('سجل-الفواتير.xlsx', [
                {
                  name: 'الفواتير',
                  title: `${settings.storeName} — سجل فواتير المبيعات (${activeActivityName})`,
                  subtitle: `عدد الفواتير: ${rows.length} | صافي المبيعات: ${formatEGP(sumGrand)} | المرتجعات: ${formatEGP(sumRet)}`,
                  headers: [
                    'رقم الفاتورة',
                    'التاريخ',
                    'العميل',
                    'الكاشير',
                    'طريقة الدفع',
                    'توزيع الخزائن',
                    'الإجمالي الصافي',
                    'قيمة المرتجع',
                    ...(canViewProfits ? ['الربح'] : []),
                    'الحالة',
                  ],
                  rows: rows.map((inv) => [
                    inv.invoiceNumber,
                    formatDateTimeAr(inv.createdAt),
                    inv.customerName,
                    inv.cashierName,
                    PAYMENT_METHOD_LABELS[inv.paymentMethod],
                    (inv.allocations || [])
                      .map((a) => `${a.treasuryName}: ${a.amount}`)
                      .join(' | ') || '—',
                    inv.grandTotal,
                    Number(inv.returnedTotal || 0),
                    ...(canViewProfits ? [inv.status === 'returned' ? 0 : inv.totalProfit] : []),
                    getStatusLabel(inv.status),
                  ]),
                  totalsRow: [
                    'الإجمالي',
                    `${rows.length} فاتورة`,
                    '',
                    '',
                    '',
                    '',
                    sumGrand,
                    sumRet,
                    ...(canViewProfits ? [sumProfit] : []),
                    '',
                  ],
                },
                {
                  name: 'تفصيل_أصناف_الفواتير',
                  title: `${settings.storeName} — تفصيل الأصناف المباعة بالفواتير`,
                  subtitle: `إجمالي السطور: ${itemRows.length}`,
                  headers: [
                    'رقم الفاتورة',
                    'التاريخ',
                    'العميل',
                    'الصنف',
                    'الوحدة',
                    'الكمية الأصلية',
                    'المرتجع',
                    'الصافي الفعلي',
                    'سعر الوحدة',
                    'الخصم',
                    'الصافي (ج.م)',
                    ...(canViewProfits ? ['الربح الصافي'] : []),
                  ],
                  rows: itemRows,
                  totalsRow: [
                    'الإجمالي',
                    '',
                    '',
                    `${itemRows.length} سطر`,
                    '',
                    '',
                    '',
                    sumItemQty,
                    '',
                    '',
                    sumItemNet,
                    ...(canViewProfits ? [sumItemProfit] : []),
                  ],
                },
              ]);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      <ActiveExcelFiltersBar
        columns={excelColumns}
        activeFilterKeys={excel.activeFilterKeys}
        sortState={excel.sortState}
        totalBefore={baseFiltered.length}
        totalAfter={excel.filteredRows.length}
        onClearOne={(k) => excel.applyColumnFilter(k, null)}
        onClearAll={excel.clearAllFilters}
      />

      {errMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errMsg}
        </div>
      )}

      {/* Master-Detail Split Layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* MASTER: Scrollable Filtered Invoices List (7 Cols) */}
        <div className="lg:col-span-7 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {viewMode === 'cards' ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleItems.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  لا توجد فواتير مطابقة لخيارات البحث والتصفية.
                </div>
              ) : (
                visibleItems.map((inv) => {
                  const isSelected = selectedInvoice?.id === inv.id;
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(inv.id);
                        setConfirmReturnId(null);
                      }}
                      className={`w-full text-right p-4 transition-colors space-y-2 ${
                        isSelected
                          ? 'bg-emerald-50/90 dark:bg-emerald-500/15'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                            {inv.invoiceNumber}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {inv.customerName} · {formatDateTimeAr(inv.createdAt)}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                            {formatEGP(inv.grandTotal)}
                          </div>
                          <div className={`text-xs font-semibold ${getStatusTextClass(inv.status)}`}>
                            {getStatusLabel(inv.status)}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 pt-2 dark:border-slate-800">
                        <span>
                          {PAYMENT_METHOD_LABELS[inv.paymentMethod]} · {inv.cashierName}
                        </span>
                        {canViewProfits && (
                          <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                            الربح: {inv.status === 'returned' ? '0 ج.م' : `+${formatEGP(inv.totalProfit)}`}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3.5 py-3">
                      <ExcelColumnHeader
                        columnKey="invoiceNumber"
                        label="الفاتورة"
                        options={excel.getColumnOptions('invoiceNumber')}
                        activeFilterValues={excel.columnFilters['invoiceNumber']}
                        sortDirection={
                          excel.sortState.columnKey === 'invoiceNumber' ? excel.sortState.direction : null
                        }
                        onApplyFilter={(v) => excel.applyColumnFilter('invoiceNumber', v)}
                        onSort={(d) => excel.setColumnSort('invoiceNumber', d)}
                      />
                    </th>
                    <th className="px-3.5 py-3">
                      <ExcelColumnHeader
                        columnKey="customerName"
                        label="العميل"
                        options={excel.getColumnOptions('customerName')}
                        activeFilterValues={excel.columnFilters['customerName']}
                        sortDirection={
                          excel.sortState.columnKey === 'customerName' ? excel.sortState.direction : null
                        }
                        onApplyFilter={(v) => excel.applyColumnFilter('customerName', v)}
                        onSort={(d) => excel.setColumnSort('customerName', d)}
                      />
                    </th>
                    <th className="px-3.5 py-3">
                      <ExcelColumnHeader
                        columnKey="paymentMethod"
                        label="الدفع"
                        options={excel.getColumnOptions('paymentMethod')}
                        activeFilterValues={excel.columnFilters['paymentMethod']}
                        sortDirection={
                          excel.sortState.columnKey === 'paymentMethod' ? excel.sortState.direction : null
                        }
                        onApplyFilter={(v) => excel.applyColumnFilter('paymentMethod', v)}
                        onSort={(d) => excel.setColumnSort('paymentMethod', d)}
                      />
                    </th>
                    <th className="px-3.5 py-3">
                      <ExcelColumnHeader
                        columnKey="grandTotal"
                        label="الإجمالي"
                        options={excel.getColumnOptions('grandTotal')}
                        activeFilterValues={excel.columnFilters['grandTotal']}
                        sortDirection={
                          excel.sortState.columnKey === 'grandTotal' ? excel.sortState.direction : null
                        }
                        onApplyFilter={(v) => excel.applyColumnFilter('grandTotal', v)}
                        onSort={(d) => excel.setColumnSort('grandTotal', d)}
                      />
                    </th>
                    {canViewProfits && <th className="px-3.5 py-3">الربح التاريخي</th>}
                    <th className="px-3.5 py-3">
                      <ExcelColumnHeader
                        columnKey="status"
                        label="الحالة"
                        options={excel.getColumnOptions('status')}
                        activeFilterValues={excel.columnFilters['status']}
                        sortDirection={
                          excel.sortState.columnKey === 'status' ? excel.sortState.direction : null
                        }
                        onApplyFilter={(v) => excel.applyColumnFilter('status', v)}
                        onSort={(d) => excel.setColumnSort('status', d)}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={canViewProfits ? 6 : 5}
                        className="px-4 py-10 text-center text-sm text-slate-500"
                      >
                        لا توجد فواتير مطابقة لخيارات البحث والتصفية.
                      </td>
                    </tr>
                  ) : (
                    visibleItems.map((inv) => {
                      const isSelected = selectedInvoice?.id === inv.id;
                      return (
                        <tr
                          key={inv.id}
                          onClick={() => {
                            setSelectedId(inv.id);
                            setConfirmReturnId(null);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50/90 dark:bg-emerald-500/15'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="px-3.5 py-3">
                            <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                              {inv.invoiceNumber}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {formatDateTimeAr(inv.createdAt)}
                            </div>
                          </td>
                          <td className="px-3.5 py-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {inv.customerName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {inv.cashierName}
                            </div>
                          </td>
                          <td className="px-3.5 py-3">
                            <div className="text-slate-800 dark:text-slate-200">
                              {PAYMENT_METHOD_LABELS[inv.paymentMethod]}
                            </div>
                            {inv.paymentRef && (
                              <div className="font-mono-num text-[10px] text-slate-500">
                                {inv.paymentRef}
                              </div>
                            )}
                          </td>
                          <td className="px-3.5 py-3 font-mono-num font-bold text-slate-900 dark:text-white">
                            {formatEGP(inv.grandTotal)}
                          </td>
                          {canViewProfits && (
                            <td className="px-3.5 py-3 font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                              {inv.status === 'returned' ? '0 ج.م' : `+${formatEGP(inv.totalProfit)}`}
                            </td>
                          )}
                          <td className={`px-3.5 py-3 font-semibold ${getStatusTextClass(inv.status)}`}>
                            {getStatusLabel(inv.status)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <InfiniteTableFooter
            visibleCount={visibleCount}
            totalCount={totalCount}
            hasMore={hasMore}
            onLoadMore={loadMore}
            sentinelRef={sentinelRef}
          />
        </div>

        {/* DETAIL: Sticky Inspector Pane (5 Cols) */}
        <div className="lg:col-span-5 lg:sticky lg:top-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          {!selectedInvoice ? (
            <div className="py-16 text-center text-sm text-slate-500 space-y-2">
              <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-700" />
              <div>اختر فاتورة من الجدول لعرض تفاصيل بنودها وأرباحها وطباعتها.</div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                    <h3 className="font-display">فاتورة {selectedInvoice.invoiceNumber}</h3>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span className={`text-xs font-bold ${getStatusTextClass(selectedInvoice.status)}`}>
                      {getStatusLabel(selectedInvoice.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTimeAr(selectedInvoice.createdAt)} · {selectedInvoice.customerName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    الكاشير: {selectedInvoice.cashierName} ·{' '}
                    {PAYMENT_METHOD_LABELS[selectedInvoice.paymentMethod]}
                    {selectedInvoice.paymentRef ? ` (${selectedInvoice.paymentRef})` : ''}
                    {selectedInvoice.dueDate ? ` · استحقاق ${selectedInvoice.dueDate}` : ''}
                  </p>
                </div>

                <div className="shrink-0">
                  <BarcodeGraphic code={selectedInvoice.invoiceNumber} height={26} />
                </div>
              </div>

              {/* Detail Line Items Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-2.5 py-2">الصنف</th>
                      <th className="px-2.5 py-2">الكمية</th>
                      <th className="px-2.5 py-2">سعر وقتها</th>
                      {canViewProfits && <th className="px-2.5 py-2">تكلفة وقتها</th>}
                      {canViewProfits && <th className="px-2.5 py-2">الربح</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedInvoice.items.map((item) => {
                      const liveProd = productMap.get(item.productId);
                      const priceDrifted =
                        liveProd &&
                        (liveProd.currentSalePrice !== item.unitSalePrice ||
                          liveProd.currentCostPrice !== item.unitCostAtSale);
                      const retQty = Number(item.returnedQuantity || 0);

                      return (
                        <tr key={item.id}>
                          <td className="px-2.5 py-2">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {item.productName}
                              {item.priceTier && item.priceTier !== 'retail' && (
                                <span className="mr-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                  ·{' '}
                                  {item.priceTier === 'wholesale'
                                    ? 'جملة'
                                    : item.priceTier === 'half_wholesale'
                                      ? 'نصف جملة'
                                      : 'سعر مخصص'}
                                </span>
                              )}
                            </div>
                            {retQty > 0 && (
                              <div className="font-mono-num text-[10px] text-amber-600 dark:text-amber-400">
                                مرتجع جزئي: {formatNum(retQty)} {item.unit}
                              </div>
                            )}
                            {canViewProfits && liveProd && priceDrifted && (
                              <div className="font-mono-num text-[10px] text-amber-600 dark:text-amber-400">
                                اليوم: بيع {formatEGP(liveProd.currentSalePrice)} / تكلفة{' '}
                                {formatEGP(liveProd.currentCostPrice)}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-2 font-mono-num">
                            {formatNum(item.quantity)} {item.unit}
                          </td>
                          <td className="px-2.5 py-2 font-mono-num font-semibold">
                            {formatEGP(item.unitSalePrice)}
                          </td>
                          {canViewProfits && (
                            <td className="px-2.5 py-2 font-mono-num text-slate-500">
                              {formatEGP(item.unitCostAtSale)}
                            </td>
                          )}
                          {canViewProfits && (
                            <td className="px-2.5 py-2 font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                              +{formatEGP(item.lineProfit)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Multi-Treasury Payment Allocations Breakdown */}
              {selectedInvoice.allocations && selectedInvoice.allocations.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="font-bold text-slate-700 dark:text-slate-200">
                    توزيع التحصيل على الخزائن المسجلة ({selectedInvoice.allocations.length})
                  </div>
                  <div className="space-y-1">
                    {selectedInvoice.allocations.map((al) => (
                      <div key={al.id} className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-300">
                          {al.treasuryName} ({PAYMENT_METHOD_LABELS[al.method]})
                          {al.referenceCode ? ` · ${al.referenceCode}` : ''}
                        </span>
                        <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                          {formatEGP(al.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Partial Return & Exchange History */}
              {selectedInvoice.returns && selectedInvoice.returns.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs space-y-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <div className="font-bold text-amber-900 dark:text-amber-300">
                    سجل المرتجعات الجزئية / الاستبدال ({selectedInvoice.returns.length})
                  </div>
                  <div className="space-y-1.5">
                    {selectedInvoice.returns.map((ret) => (
                      <div
                        key={ret.id}
                        className="border-t border-amber-200/70 pt-1.5 first:border-t-0 first:pt-0 dark:border-amber-900/40"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>
                            {formatDateTimeAr(ret.createdAt)} · {ret.actorName}
                          </span>
                          <span className="font-mono-num text-rose-700 dark:text-rose-400">
                            -{formatEGP(ret.returnTotal)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          {ret.reason || 'مرتجع'}
                          {ret.cashRefunded > 0 ? ` · نقدي/خزينة: ${formatEGP(ret.cashRefunded)}` : ''}
                          {ret.creditDebtReduced > 0 ? ` · خصم آجل: ${formatEGP(ret.creditDebtReduced)}` : ''}
                          {ret.storeCreditAdded > 0 ? ` · رصيد دائن: ${formatEGP(ret.storeCreditAdded)}` : ''}
                          {ret.exchangeInvoiceNumber ? ` · فاتورة استبدال: ${ret.exchangeInvoiceNumber}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Financial Summary & SHA-256 Chain Proof */}
              <div className="rounded-lg bg-slate-50 p-3.5 text-xs dark:bg-slate-950 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">الإجمالي الفرعي</span>
                  <span className="font-mono-num font-semibold">{formatEGP(selectedInvoice.subtotal)}</span>
                </div>
                {selectedInvoice.discountTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">الخصم</span>
                    <span className="font-mono-num text-rose-600">
                      -{formatEGP(selectedInvoice.discountTotal)}
                    </span>
                  </div>
                )}
                {Number(selectedInvoice.storeCreditUsed || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">مسدد من الرصيد الدائن</span>
                    <span className="font-mono-num text-sky-600">
                      -{formatEGP(Number(selectedInvoice.storeCreditUsed || 0))}
                    </span>
                  </div>
                )}
                {Number(selectedInvoice.returnedTotal || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي المرتجعات</span>
                    <span className="font-mono-num text-amber-600">
                      -{formatEGP(Number(selectedInvoice.returnedTotal || 0))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold dark:border-slate-800">
                  <span>الصافي النهائي</span>
                  <span className="font-mono-num">{formatEGP(selectedInvoice.grandTotal)}</span>
                </div>
                {canViewProfits && (
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>صافي الربح المحفوظ وقت الفاتورة</span>
                    <span className="font-mono-num">
                      {selectedInvoice.status === 'returned'
                        ? '0 ج.م (مرتجع)'
                        : `+${formatEGP(selectedInvoice.totalProfit)}`}
                    </span>
                  </div>
                )}
                <div className="pt-1 font-mono-num text-[10px] text-slate-400 truncate" dir="ltr">
                  SHA-256: {selectedInvoice.rowHash}
                </div>
              </div>

              {/* Detail Actions */}
              <div className="no-print flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openPrintPreview({
                      kind: 'invoice_a4',
                      invoice: selectedInvoice,
                      settings,
                      activityName: activeActivityName,
                      customerBalanceDue: selectedCustomer?.balanceDue,
                    })
                  }
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>معاينة قبل الطباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printDocument({
                      kind: 'invoice_a4',
                      invoice: selectedInvoice,
                      settings,
                      activityName: activeActivityName,
                      customerBalanceDue: selectedCustomer?.balanceDue,
                    })
                  }
                  className="flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>طباعة A4</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printDocument({
                      kind: 'invoice_thermal',
                      invoice: selectedInvoice,
                      settings,
                    })
                  }
                  className="flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>إيصال 80mm</span>
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() =>
                    exportDocumentAsPdf(
                      {
                        kind: 'invoice_a4',
                        invoice: selectedInvoice,
                        settings,
                        activityName: activeActivityName,
                      },
                      `${selectedInvoice.invoiceNumber}.pdf`
                    )
                  }
                  className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() =>
                    exportDocumentAsPng(
                      {
                        kind: 'invoice_a4',
                        invoice: selectedInvoice,
                        settings,
                        activityName: activeActivityName,
                      },
                      `${selectedInvoice.invoiceNumber}.png`
                    )
                  }
                  className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>PNG</span>
                </button>

                <a
                  href={buildWhatsAppUrl(
                    selectedCustomer?.phone,
                    formatInvoiceWhatsAppText(selectedInvoice, settings.storeName, settings.phone)
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400 whitespace-nowrap"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>واتساب</span>
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyInvoiceText(selectedInvoice)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>{copiedId === selectedInvoice.id ? 'تم النسخ' : 'نسخ النص'}</span>
                </button>

                {(selectedInvoice.status === 'completed' || selectedInvoice.status === 'partial_returned') &&
                  canReturnInvoice && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPartialReturnOpen(true)}
                        className="flex flex-1 min-w-[160px] min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 whitespace-nowrap"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>مرتجع جزئي / استبدال</span>
                      </button>

                      {selectedInvoice.status === 'completed' &&
                        (confirmReturnId === selectedInvoice.id ? (
                          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs dark:border-rose-900/70 dark:bg-rose-950/40">
                            <span className="font-semibold text-rose-800 dark:text-rose-200">
                              تأكيد إرجاع الفاتورة بالكامل واسترداد المبلغ وإعادة الكميات للمخزن؟
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={returningId === selectedInvoice.id}
                                onClick={() => handleReturnInvoice(selectedInvoice.id)}
                                className="rounded-md bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                {returningId === selectedInvoice.id ? 'جاري المرتجع...' : 'تأكيد المرتجع الكامل'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmReturnId(null)}
                                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={returningId === selectedInvoice.id}
                            onClick={() => setConfirmReturnId(selectedInvoice.id)}
                            className="flex flex-1 min-w-[140px] min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 whitespace-nowrap"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>مرتجع كامل</span>
                          </button>
                        ))}
                    </>
                  )}
              </div>
            </>
          )}
        </div>
      </div>

      <PartialReturnModal
        open={partialReturnOpen}
        invoice={selectedInvoice}
        products={allProducts}
        treasuries={treasuries}
        apiFetch={apiFetch}
        onClose={() => setPartialReturnOpen(false)}
        onSuccess={(msg) => {
          setPartialReturnOpen(false);
          onMutated(msg);
        }}
      />
    </div>
  );
}
