import {
  Activity,
  Barcode,
  CalendarClock,
  ClipboardCheck,
  Edit3,
  FileSpreadsheet,
  History,
  LayoutGrid,
  PackagePlus,
  Percent,
  Plus,
  Search,
  Table as TableIcon,
  Tag,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type {
  Product,
  ProductBatch,
  ProductPriceHistory,
  StaffUser,
  StockMovement,
  StoreActivityProfile,
  StorePromotion,
  StoreSettings,
  Supplier,
} from '../shared/types';
import { exportWorkbookXlsx } from '../utils/exportUtils';
import { formatEGP, formatNum } from '../utils/formatters';
import {
  AddProductModal,
  BarcodeLabelsModal,
  EditPriceModal,
  PriceHistoryModal,
  RestockModal,
} from './inventory/InventoryCatalogModals';
import {
  BatchesFefoModal,
  BulkPriceModal,
  PromotionsModal,
  StockMovementsModal,
  StocktakeModal,
} from './inventory/InventoryOperationsModals';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';

interface InventoryViewProps {
  products: Product[];
  batches?: ProductBatch[];
  promotions?: StorePromotion[];
  priceHistory: ProductPriceHistory[];
  movements?: StockMovement[];
  suppliers: Supplier[];
  activeActivity: StoreActivityProfile;
  settings: StoreSettings;
  currentUser: StaffUser;
  canEditStockAndPrices: boolean;
  canViewCosts: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
  onOpenDataHub?: () => void;
  requestedModal?: {
    modal: 'add_product' | 'batches' | 'promotions' | 'stocktake' | 'movements';
    seq: number;
  } | null;
}

type StockFilter = 'all' | 'available' | 'low' | 'overstock' | 'out';

export function InventoryView({
  products,
  batches = [],
  promotions = [],
  priceHistory,
  movements = [],
  suppliers,
  activeActivity,
  settings,
  currentUser,
  canEditStockAndPrices,
  canViewCosts,
  apiFetch,
  onMutated,
  onOpenDataHub,
  requestedModal,
}: InventoryViewProps) {
  const { printDocument } = usePrint();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [statusFilter, setStatusFilter] = useState<StockFilter>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [barcodeSingleMode, setBarcodeSingleMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editPriceProduct, setEditPriceProduct] = useState<Product | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const [showBulkPriceModal, setShowBulkPriceModal] = useState(false);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [showBatchesModal, setShowBatchesModal] = useState(false);
  const [showPromotionsModal, setShowPromotionsModal] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const getProductStatus = (p: Product): Exclude<StockFilter, 'all'> => {
    if (p.stockQty <= 0) return 'out';
    if (p.stockQty <= p.minStockAlert) return 'low';
    if (p.stockQty > p.maxStockLimit) return 'overstock';
    return 'available';
  };

  const getStatusLabel = (st: Exclude<StockFilter, 'all'>) =>
    st === 'out'
      ? 'نفذ من المخزن'
      : st === 'low'
        ? 'ناقص — يحتاج توريد'
        : st === 'overstock'
          ? 'فوق الحد الأقصى'
          : 'متوفر';

  const baseFiltered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      const st = getProductStatus(p);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, debouncedSearch, statusFilter]);

  const excelColumns: ExcelColumnDef<Product>[] = useMemo(
    () => [
      { key: 'name', label: 'الصنف', getValue: (p) => p.name },
      { key: 'category', label: 'التصنيف', getValue: (p) => p.category },
      {
        key: 'currentSalePrice',
        label: 'سعر البيع',
        getValue: (p) => formatEGP(p.currentSalePrice),
        getSortValue: (p) => p.currentSalePrice,
      },
      {
        key: 'stockQty',
        label: 'الكمية',
        getValue: (p) => `${formatNum(p.stockQty)} ${p.unit}`,
        getSortValue: (p) => p.stockQty,
      },
      {
        key: 'status',
        label: 'الحالة',
        getValue: (p) => getStatusLabel(getProductStatus(p)),
      },
    ],
    []
  );

  const excel = useExcelTableFilter(baseFiltered, excelColumns);
  const filtered = excel.filteredRows;

  const { visibleItems, visibleCount, totalCount, hasMore, loadMore, sentinelRef } =
    useInfiniteScroll(filtered, {
      batchSize: 15,
      resetKey: `${debouncedSearch}-${statusFilter}-${excel.activeFilterKeys.join(',')}-${excel.sortState.columnKey}-${excel.sortState.direction}`,
    });

  useEffect(() => {
    if (!requestedModal?.seq) return;
    if (requestedModal.modal === 'add_product' && canEditStockAndPrices) {
      setShowAddModal(true);
    } else if (requestedModal.modal === 'batches') {
      setShowBatchesModal(true);
    } else if (requestedModal.modal === 'promotions') {
      setShowPromotionsModal(true);
    } else if (requestedModal.modal === 'movements') {
      setShowMovementsModal(true);
    } else if (requestedModal.modal === 'stocktake' && canEditStockAndPrices) {
      setShowStocktakeModal(true);
    }
  }, [requestedModal, canEditStockAndPrices]);

  const handleDeleteProduct = async (prod: Product) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/products/${prod.id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      onMutated(`تم حذف الصنف (${prod.name}) من المخزون`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الصنف');
    } finally {
      setSaving(false);
    }
  };

  const handleExportProductsXlsx = () => {
    const totalQty = Number(filtered.reduce((s, p) => s + Number(p.stockQty || 0), 0).toFixed(2));
    const totalCostVal = Number(
      filtered
        .reduce((s, p) => s + Number(p.stockQty || 0) * Number(p.currentCostPrice || 0), 0)
        .toFixed(2)
    );
    const totalSaleVal = Number(
      filtered
        .reduce((s, p) => s + Number(p.stockQty || 0) * Number(p.currentSalePrice || 0), 0)
        .toFixed(2)
    );

    exportWorkbookXlsx(`قائمة-البضاعة-${activeActivity.id}.xlsx`, [
      {
        name: 'البضاعة_والمخزون',
        title: `${settings.storeName} — قائمة البضاعة والأسعار (${activeActivity.nameAr})`,
        subtitle: `عدد الأصناف: ${filtered.length} | إجمالي الكميات: ${formatNum(totalQty)} | القيمة بسعر البيع: ${formatEGP(totalSaleVal)}`,
        headers: [
          'id',
          'sku',
          'الباركود',
          'اسم الصنف',
          'القسم',
          'الوحدة',
          'المواصفات',
          ...(canViewCosts ? ['سعر التكلفة'] : []),
          'سعر البيع (قطاعي)',
          'سعر نصف الجملة',
          'سعر الجملة',
          'الكمية',
          'حالة المخزون',
          'الحد الأدنى',
          'الحد الأقصى',
          ...(canViewCosts ? ['إجمالي التكلفة'] : []),
          'إجمالي القيمة بالبيع',
        ],
        rows: filtered.map((p) => {
          const stockStatus =
            p.stockQty <= 0
              ? 'نفذ'
              : p.stockQty <= p.minStockAlert
                ? 'ناقص'
                : p.maxStockLimit > 0 && p.stockQty > p.maxStockLimit
                  ? 'فوق الحد'
                  : 'متوفر';
          const costVal = Number((p.stockQty * p.currentCostPrice).toFixed(2));
          const saleVal = Number((p.stockQty * p.currentSalePrice).toFixed(2));
          return [
            p.id,
            p.sku,
            p.barcode,
            p.name,
            p.category,
            p.unit,
            p.attributeValue || '',
            ...(canViewCosts ? [p.currentCostPrice] : []),
            p.currentSalePrice,
            p.halfWholesalePrice ?? p.currentSalePrice,
            p.wholesalePrice ?? p.currentSalePrice,
            p.stockQty,
            stockStatus,
            p.minStockAlert,
            p.maxStockLimit,
            ...(canViewCosts ? [costVal] : []),
            saleVal,
          ];
        }),
        totalsRow: [
          'الإجمالي',
          '',
          '',
          `${filtered.length} صنف`,
          '',
          '',
          '',
          ...(canViewCosts ? [''] : []),
          '',
          '',
          '',
          totalQty,
          '',
          '',
          '',
          ...(canViewCosts ? [totalCostVal] : []),
          totalSaleVal,
        ],
      },
    ]);
  };

  const selectedProductIds = useMemo(
    () => filtered.filter((p) => selectedIds[p.id]).map((p) => p.id),
    [filtered, selectedIds]
  );

  const selectedProducts = useMemo(() => {
    const chosen = filtered.filter((p) => selectedIds[p.id]);
    return chosen.length > 0 ? chosen : filtered.slice(0, 6);
  }, [filtered, selectedIds]);

  const selectedCount = selectedProductIds.length;

  const openBarcodeSheet = (singleProd?: Product) => {
    if (singleProd) {
      setSelectedIds({ [singleProd.id]: true });
      setBarcodeSingleMode(true);
    } else {
      setBarcodeSingleMode(false);
    }
    setShowBarcodeModal(true);
  };

  const sortedBatches = useMemo(() => {
    return [...batches].sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate);
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [batches]);

  const nearestBatchByProduct = useMemo(() => {
    const map = new Map<string, ProductBatch>();
    for (const b of sortedBatches) {
      if (b.qty > 0 && !map.has(b.productId)) {
        map.set(b.productId, b);
      }
    }
    return map;
  }, [sortedBatches]);

  const batchExpiryMetrics = useMemo(() => {
    const nowMs = Date.now();
    const soonThreshold = nowMs + 30 * 86400 * 1000;
    let expired = 0;
    let expiringSoon = 0;
    for (const b of batches) {
      if (b.qty <= 0 || !b.expiryDate) continue;
      const ms = new Date(b.expiryDate).getTime();
      if (Number.isNaN(ms)) continue;
      if (ms < nowMs) expired += 1;
      else if (ms <= soonThreshold) expiringSoon += 1;
    }
    return { expired, expiringSoon, urgentTotal: expired + expiringSoon };
  }, [batches]);

  const activePromotionsCount = useMemo(
    () => promotions.filter((p) => p.active).length,
    [promotions]
  );

  const inventorySummary = useMemo(() => {
    let available = 0;
    let low = 0;
    let overstock = 0;
    let out = 0;
    let totalCostValue = 0;
    let totalRetailValue = 0;
    for (const p of products) {
      const st = getProductStatus(p);
      if (st === 'out') out += 1;
      else if (st === 'low') low += 1;
      else if (st === 'overstock') overstock += 1;
      else available += 1;
      if (p.stockQty > 0) {
        totalCostValue += p.stockQty * p.currentCostPrice;
        totalRetailValue += p.stockQty * p.currentSalePrice;
      }
    }
    return {
      total: products.length,
      available,
      low,
      overstock,
      out,
      totalCostValue: Number(totalCostValue.toFixed(2)),
      totalRetailValue: Number(totalRetailValue.toFixed(2)),
    };
  }, [products]);

  return (
    <div className="space-y-5">
      {/* Live Inventory Valuation & Clickable Stock Health Strip */}
      <div className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`rounded-xl border p-3.5 text-right transition-colors ${
            statusFilter === 'all'
              ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="text-[11px] text-slate-500">إجمالي الأصناف</div>
          <div className="mt-1 font-mono-num text-xl font-extrabold text-slate-900 dark:text-white">
            {inventorySummary.total}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('available')}
          className={`rounded-xl border p-3.5 text-right transition-colors ${
            statusFilter === 'available'
              ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="text-[11px] text-slate-500">أصناف متوفرة</div>
          <div className="mt-1 font-mono-num text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {inventorySummary.available}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('low')}
          className={`rounded-xl border p-3.5 text-right transition-colors ${
            statusFilter === 'low'
              ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="text-[11px] text-slate-500">نواقص (حد الطلب)</div>
          <div className="mt-1 font-mono-num text-xl font-extrabold text-amber-600 dark:text-amber-400">
            {inventorySummary.low}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('out')}
          className={`rounded-xl border p-3.5 text-right transition-colors ${
            statusFilter === 'out'
              ? 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="text-[11px] text-slate-500">نفذت الكمية</div>
          <div className="mt-1 font-mono-num text-xl font-extrabold text-rose-600 dark:text-rose-400">
            {inventorySummary.out}
          </div>
        </button>
        {canViewCosts && (
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] text-slate-500">قيمة المخزون بالتكلفة</div>
            <div className="mt-1 font-mono-num text-base font-extrabold text-slate-900 dark:text-white">
              {formatEGP(inventorySummary.totalCostValue)}
            </div>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">القيمة البيعية المتوقعة</div>
          <div className="mt-1 font-mono-num text-base font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatEGP(inventorySummary.totalRetailValue)}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الباركود أو التصنيف..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['all', 'الكل'],
                ['available', 'متوفر'],
                ['low', 'نواقص'],
                ['overstock', 'فوق الحد'],
                ['out', 'نفذ'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex min-h-[34px] items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>جدول</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`flex min-h-[34px] items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'cards'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>بطاقات</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowBatchesModal(true)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <CalendarClock
              className={`h-4 w-4 ${
                batchExpiryMetrics.expired > 0
                  ? 'text-rose-600'
                  : batchExpiryMetrics.expiringSoon > 0
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }`}
            />
            <span>التشغيلات والصلاحية (FEFO)</span>
            {batchExpiryMetrics.urgentTotal > 0 && (
              <span
                className={`font-mono-num text-[11px] font-bold ${
                  batchExpiryMetrics.expired > 0 ? 'text-rose-600' : 'text-amber-600'
                }`}
              >
                ({batchExpiryMetrics.urgentTotal})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowPromotionsModal(true)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Tag className="h-4 w-4 text-emerald-600" />
            <span>العروض الترويجية ({activePromotionsCount})</span>
          </button>

          <button
            type="button"
            onClick={handleExportProductsXlsx}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>

          {onOpenDataHub && (
            <button
              type="button"
              onClick={onOpenDataHub}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-4 w-4 text-sky-600" />
              <span>استيراد XLSX</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMovementsModal(true)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Activity className="h-4 w-4 text-emerald-600" />
            <span>حركة المخزن</span>
          </button>

          <button
            type="button"
            onClick={() => openBarcodeSheet()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Barcode className="h-4 w-4 text-emerald-600" />
            <span>
              {selectedCount > 0 ? `ملصقات الباركود (${selectedCount})` : 'طباعة ملصقات باركود'}
            </span>
          </button>

          {canEditStockAndPrices && (
            <button
              type="button"
              onClick={() => setShowBulkPriceModal(true)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Percent className="h-4 w-4 text-amber-600" />
              <span>تعديل أسعار جماعي</span>
            </button>
          )}

          {canEditStockAndPrices && (
            <button
              type="button"
              onClick={() => setShowStocktakeModal(true)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <ClipboardCheck className="h-4 w-4 text-emerald-600" />
              <span>جرد فعلي ومطابقة</span>
            </button>
          )}

          {canEditStockAndPrices && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex min-h-[40px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة صنف جديد</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      <ActiveExcelFiltersBar
        columns={excelColumns}
        activeFilterKeys={excel.activeFilterKeys}
        sortState={excel.sortState}
        totalBefore={baseFiltered.length}
        totalAfter={filtered.length}
        onClearOne={(k) => excel.applyColumnFilter(k, null)}
        onClearAll={excel.clearAllFilters}
      />

      {/* Inventory Table or Cards Grid */}
      {viewMode === 'cards' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((p) => {
              const st = getProductStatus(p);
              const statusText = getStatusLabel(st);
              const statusColor =
                st === 'out'
                  ? 'text-rose-600 dark:text-rose-400'
                  : st === 'low'
                    ? 'text-amber-600 dark:text-amber-400'
                    : st === 'overstock'
                      ? 'text-sky-600 dark:text-sky-400'
                      : 'text-emerald-600 dark:text-emerald-400';
              const nearestBatch = nearestBatchByProduct.get(p.id);

              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</div>
                      <div className="mt-0.5 font-mono-num text-xs text-slate-500">
                        {p.barcode} · {p.category}
                        {p.attributeValue ? ` · ${p.attributeValue}` : ''}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={`تحديد ${p.name}`}
                      checked={Boolean(selectedIds[p.id])}
                      onChange={(e) =>
                        setSelectedIds((prev) => ({ ...prev, [p.id]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-emerald-600 cursor-pointer shrink-0 mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-y border-slate-100 py-2.5 text-xs dark:border-slate-800">
                    <div>
                      <div className="text-[11px] text-slate-400">سعر البيع</div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                        {formatEGP(p.currentSalePrice)}
                      </div>
                    </div>
                    {canViewCosts && (
                      <div>
                        <div className="text-[11px] text-slate-400">التكلفة</div>
                        <div className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                          {formatEGP(p.currentCostPrice)}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] text-slate-400">المخزون</div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                        {formatNum(p.stockQty)} <span className="font-normal text-slate-500">{p.unit}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className={`font-semibold ${statusColor}`}>{statusText}</span>
                    {nearestBatch && (
                      <span className="font-mono-num text-[11px] text-slate-500">
                        تشغيلة {nearestBatch.batchCode}
                        {nearestBatch.expiryDate ? ` · صلاحية ${nearestBatch.expiryDate}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="no-print flex flex-wrap items-center gap-1.5 pt-1">
                    {canEditStockAndPrices && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRestockProduct(p)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <PackagePlus className="h-3.5 w-3.5" />
                          <span>توريد</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditPriceProduct(p)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>تسعير</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryProduct(p)}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <History className="h-3.5 w-3.5" />
                      <span>السجل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openBarcodeSheet(p)}
                      title="طباعة ملصقات باركود وسعر"
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Barcode className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <InfiniteTableFooter
            visibleCount={visibleCount}
            totalCount={totalCount}
            hasMore={hasMore}
            onLoadMore={loadMore}
            sentinelRef={sentinelRef}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="no-print w-10 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="تحديد كل الأصناف"
                      checked={filtered.length > 0 && filtered.every((p) => selectedIds[p.id])}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const next: Record<string, boolean> = {};
                        if (checked) filtered.forEach((p) => (next[p.id] = true));
                        setSelectedIds(next);
                      }}
                      className="h-4 w-4 accent-emerald-600 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <ExcelColumnHeader
                      columnKey="name"
                      label="الصنف والباركود"
                      options={excel.getColumnOptions('name')}
                      activeFilterValues={excel.columnFilters['name']}
                      sortDirection={
                        excel.sortState.columnKey === 'name' ? excel.sortState.direction : null
                      }
                      onApplyFilter={(v) => excel.applyColumnFilter('name', v)}
                      onSort={(d) => excel.setColumnSort('name', d)}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <ExcelColumnHeader
                      columnKey="category"
                      label="التصنيف"
                      options={excel.getColumnOptions('category')}
                      activeFilterValues={excel.columnFilters['category']}
                      sortDirection={
                        excel.sortState.columnKey === 'category' ? excel.sortState.direction : null
                      }
                      onApplyFilter={(v) => excel.applyColumnFilter('category', v)}
                      onSort={(d) => excel.setColumnSort('category', d)}
                    />
                  </th>
                  {canViewCosts && <th className="px-4 py-3">سعر الشراء الحالي</th>}
                  <th className="px-4 py-3">
                    <ExcelColumnHeader
                      columnKey="currentSalePrice"
                      label="سعر البيع الحالي"
                      options={excel.getColumnOptions('currentSalePrice')}
                      activeFilterValues={excel.columnFilters['currentSalePrice']}
                      sortDirection={
                        excel.sortState.columnKey === 'currentSalePrice'
                          ? excel.sortState.direction
                          : null
                      }
                      onApplyFilter={(v) => excel.applyColumnFilter('currentSalePrice', v)}
                      onSort={(d) => excel.setColumnSort('currentSalePrice', d)}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <ExcelColumnHeader
                      columnKey="stockQty"
                      label="الكمية بالمخزن"
                      options={excel.getColumnOptions('stockQty')}
                      activeFilterValues={excel.columnFilters['stockQty']}
                      sortDirection={
                        excel.sortState.columnKey === 'stockQty' ? excel.sortState.direction : null
                      }
                      onApplyFilter={(v) => excel.applyColumnFilter('stockQty', v)}
                      onSort={(d) => excel.setColumnSort('stockQty', d)}
                    />
                  </th>
                  <th className="px-4 py-3">
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
                  <th className="no-print px-4 py-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleItems.map((p) => {
                  const st = getProductStatus(p);
                  const statusText = getStatusLabel(st);
                  const statusColor =
                    st === 'out'
                      ? 'text-rose-600 dark:text-rose-400'
                      : st === 'low'
                        ? 'text-amber-600 dark:text-amber-400'
                        : st === 'overstock'
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-emerald-600 dark:text-emerald-400';

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="no-print px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`تحديد ${p.name}`}
                          checked={Boolean(selectedIds[p.id])}
                          onChange={(e) =>
                            setSelectedIds((prev) => ({ ...prev, [p.id]: e.target.checked }))
                          }
                          className="h-4 w-4 accent-emerald-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                        <div className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          {p.barcode} {p.attributeValue ? `· ${p.attributeValue}` : ''}
                          {nearestBatchByProduct.get(p.id)?.expiryDate
                            ? ` · صلاحية ${nearestBatchByProduct.get(p.id)?.expiryDate}`
                            : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{p.category}</td>
                      {canViewCosts && (
                        <td className="px-4 py-3 font-mono-num font-medium text-slate-700 dark:text-slate-300">
                          {formatEGP(p.currentCostPrice)}
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono-num">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {formatEGP(p.currentSalePrice)}
                        </div>
                        {(p.halfWholesalePrice > 0 || p.wholesalePrice > 0) && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            ن.جملة {formatNum(p.halfWholesalePrice || p.currentSalePrice)} · جملة{' '}
                            {formatNum(p.wholesalePrice || p.currentSalePrice)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono-num">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatNum(p.stockQty)}
                        </span>{' '}
                        <span className="text-xs text-slate-500">{p.unit}</span>
                      </td>
                      <td className={`px-4 py-3 text-xs font-semibold ${statusColor}`}>
                        {statusText}
                      </td>
                      <td className="no-print px-4 py-3">
                        <div className="flex items-center gap-2">
                          {canEditStockAndPrices && (
                            <>
                              <button
                                type="button"
                                onClick={() => setRestockProduct(p)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <PackagePlus className="h-3.5 w-3.5" />
                                <span>توريد</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditPriceProduct(p)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                <span>تعديل / تسعير</span>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setHistoryProduct(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <History className="h-3.5 w-3.5" />
                            <span>سجل الأسعار</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openBarcodeSheet(p)}
                            title="طباعة ملصقات باركود وسعر"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Barcode className="h-3.5 w-3.5" />
                          </button>
                          {canEditStockAndPrices &&
                            (confirmDeleteId === p.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleDeleteProduct(p)}
                                  className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-rose-700"
                                >
                                  تأكيد
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded border border-slate-200 px-1.5 py-1 text-[11px] text-slate-500 dark:border-slate-700"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(p.id)}
                                title="حذف الصنف"
                                className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
      )}

      {/* Catalog & Pricing Modals */}
      <AddProductModal
        open={showAddModal}
        activeActivity={activeActivity}
        suppliers={suppliers}
        currentUser={currentUser}
        apiFetch={apiFetch}
        onClose={() => setShowAddModal(false)}
        onSuccess={onMutated}
      />

      <EditPriceModal
        product={editPriceProduct}
        activeActivity={activeActivity}
        canViewCosts={canViewCosts}
        currentUser={currentUser}
        apiFetch={apiFetch}
        onClose={() => setEditPriceProduct(null)}
        onSuccess={onMutated}
      />

      <RestockModal
        product={restockProduct}
        canViewCosts={canViewCosts}
        currentUser={currentUser}
        apiFetch={apiFetch}
        onClose={() => setRestockProduct(null)}
        onSuccess={onMutated}
      />

      <PriceHistoryModal
        product={historyProduct}
        priceHistory={priceHistory}
        canViewCosts={canViewCosts}
        onClose={() => setHistoryProduct(null)}
      />

      <BarcodeLabelsModal
        open={showBarcodeModal}
        products={selectedProducts}
        singleMode={barcodeSingleMode}
        settings={settings}
        onClose={() => setShowBarcodeModal(false)}
        onPrint={printDocument}
      />

      {/* Operations Modals */}
      <StocktakeModal
        open={showStocktakeModal}
        products={products}
        currentUser={currentUser}
        apiFetch={apiFetch}
        onClose={() => setShowStocktakeModal(false)}
        onSuccess={onMutated}
      />

      <BulkPriceModal
        open={showBulkPriceModal}
        productsCount={products.length}
        selectedProductIds={selectedProductIds}
        activeActivity={activeActivity}
        canViewCosts={canViewCosts}
        apiFetch={apiFetch}
        onClose={() => setShowBulkPriceModal(false)}
        onSuccess={onMutated}
      />

      <StockMovementsModal
        open={showMovementsModal}
        movements={movements}
        onClose={() => setShowMovementsModal(false)}
      />

      <BatchesFefoModal
        open={showBatchesModal}
        products={products}
        suppliers={suppliers}
        sortedBatches={sortedBatches}
        canEditStockAndPrices={canEditStockAndPrices}
        canViewCosts={canViewCosts}
        apiFetch={apiFetch}
        onClose={() => setShowBatchesModal(false)}
        onSuccess={onMutated}
      />

      <PromotionsModal
        open={showPromotionsModal}
        promotions={promotions}
        products={products}
        activeActivity={activeActivity}
        canEditStockAndPrices={canEditStockAndPrices}
        apiFetch={apiFetch}
        onClose={() => setShowPromotionsModal(false)}
        onSuccess={onMutated}
      />
    </div>
  );
}
