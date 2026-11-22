import { BookmarkPlus, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportFilterRule,
  CustomReportTabularResult,
  SavedCustomReportPreset,
  StoreActivityId,
} from '../../shared/types';
import { formatNum } from '../../utils/formatters';

interface CustomReportBuilderTabProps {
  presets: SavedCustomReportPreset[];
  dateFrom: string;
  dateTo: string;
  activityFilter: StoreActivityId | 'all';
  canViewProfits: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onResultChange: (result: CustomReportTabularResult | null) => void;
  onPresetsUpdated: (msg: string) => void;
}

interface SourceCatalogItem {
  label: string;
  columns: Array<{ key: string; label: string; profitSensitive?: boolean }>;
}

const SOURCE_CATALOG: Record<CustomReportDataSource, SourceCatalogItem> = {
  sales_invoices: {
    label: 'فواتير المبيعات التفصيلية',
    columns: [
      { key: 'invoiceNumber', label: 'رقم الفاتورة' },
      { key: 'createdAt', label: 'التاريخ' },
      { key: 'customerName', label: 'العميل' },
      { key: 'cashierName', label: 'الكاشير' },
      { key: 'paymentMethod', label: 'طريقة الدفع' },
      { key: 'subtotal', label: 'قبل الخصم' },
      { key: 'discountTotal', label: 'الخصم' },
      { key: 'grandTotal', label: 'الصافي' },
      { key: 'totalCostAtSale', label: 'التكلفة التاريخية', profitSensitive: true },
      { key: 'totalProfit', label: 'الربح', profitSensitive: true },
      { key: 'status', label: 'الحالة' },
    ],
  },
  product_profits: {
    label: 'أرباح الأصناف المباعة',
    columns: [
      { key: 'productName', label: 'الصنف' },
      { key: 'activityId', label: 'النشاط' },
      { key: 'qtySold', label: 'الكمية المباعة' },
      { key: 'revenue', label: 'إجمالي المبيعات' },
      { key: 'historicalCost', label: 'التكلفة التاريخية', profitSensitive: true },
      { key: 'historicalProfit', label: 'صافي الربح', profitSensitive: true },
      { key: 'marginPercent', label: 'الهامش %', profitSensitive: true },
    ],
  },
  inventory_stock: {
    label: 'المخزون وشرائح الأسعار',
    columns: [
      { key: 'name', label: 'اسم الصنف' },
      { key: 'barcode', label: 'الباركود' },
      { key: 'category', label: 'التصنيف' },
      { key: 'unit', label: 'الوحدة' },
      { key: 'stockQty', label: 'الكمية' },
      { key: 'currentCostPrice', label: 'التكلفة', profitSensitive: true },
      { key: 'currentSalePrice', label: 'سعر القطاعي' },
      { key: 'halfWholesalePrice', label: 'سعر نصف جملة' },
      { key: 'wholesalePrice', label: 'سعر الجملة' },
      { key: 'stockValueCost', label: 'قيمة المخزون بالتكلفة', profitSensitive: true },
    ],
  },
  expenses: {
    label: 'المصروفات التشغيلية',
    columns: [
      { key: 'createdAt', label: 'التاريخ' },
      { key: 'title', label: 'البند / البيان' },
      { key: 'category', label: 'التصنيف' },
      { key: 'treasuryName', label: 'الخزينة' },
      { key: 'actorName', label: 'المسؤول' },
      { key: 'amount', label: 'المبلغ (ج.م)' },
    ],
  },
  customers_ar: {
    label: 'العملاء والمديونيات (لنا)',
    columns: [
      { key: 'name', label: 'اسم العميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'balanceDue', label: 'الرصيد المستحق' },
      { key: 'totalPurchases', label: 'إجمالي المسحوبات' },
      { key: 'creditLimit', label: 'الحد الائتماني' },
    ],
  },
  suppliers_ap: {
    label: 'الموردين والمستحقات (علينا)',
    columns: [
      { key: 'name', label: 'المورد' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'category', label: 'التخصص' },
      { key: 'balanceDue', label: 'المستحق للمورد' },
    ],
  },
  purchases: {
    label: 'فواتير المشتريات والتوريد',
    columns: [
      { key: 'purchaseNumber', label: 'رقم التوريد' },
      { key: 'createdAt', label: 'التاريخ' },
      { key: 'supplierName', label: 'المورد' },
      { key: 'grandTotal', label: 'إجمالي الفاتورة' },
      { key: 'paidAmount', label: 'المدفوع' },
      { key: 'remainingDebt', label: 'المتبقي آجل' },
    ],
  },
  equity_partners: {
    label: 'الشركاء وتوزيع الأرباح',
    columns: [
      { key: 'name', label: 'اسم الشريك' },
      { key: 'roleTitle', label: 'الصفة' },
      { key: 'capitalContribution', label: 'رأس المال المساهم' },
      { key: 'profitSharePercent', label: 'نسبة الربح %' },
      { key: 'periodProfitShare', label: 'حصة أرباح الفترة', profitSensitive: true },
      { key: 'allTimeDrawings', label: 'المسحوبات' },
      { key: 'netPayableBalance', label: 'صافي المستحق للشريك', profitSensitive: true },
    ],
  },
};

export function CustomReportBuilderTab({
  presets,
  dateFrom,
  dateTo,
  activityFilter,
  canViewProfits,
  apiFetch,
  onResultChange,
  onPresetsUpdated,
}: CustomReportBuilderTabProps) {
  const [reportName, setReportName] = useState('تقرير مبيعات مخصص');
  const [source, setSource] = useState<CustomReportDataSource>('sales_invoices');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    'invoiceNumber',
    'createdAt',
    'customerName',
    'paymentMethod',
    'grandTotal',
    'totalProfit',
  ]);
  const [sortBy, setSortBy] = useState('grandTotal');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<CustomReportFilterRule[]>([]);
  const [result, setResult] = useState<CustomReportTabularResult | null>(null);
  const [running, setRunning] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableColumns = SOURCE_CATALOG[source].columns.filter(
    (c) => canViewProfits || !c.profitSensitive
  );

  const handleSourceChange = (nextSource: CustomReportDataSource) => {
    setSource(nextSource);
    const cols = SOURCE_CATALOG[nextSource].columns.filter((c) => canViewProfits || !c.profitSensitive);
    const defaults = cols.slice(0, 6).map((c) => c.key);
    setSelectedColumns(defaults);
    setSortBy(cols[0]?.key || '');
    setFilters([]);
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const executeQuery = async (overrideConfig?: CustomReportConfig) => {
    setRunning(true);
    setError(null);
    try {
      const safeCols = (overrideConfig?.columns || selectedColumns).filter((colKey) =>
        availableColumns.some((ac) => ac.key === colKey)
      );
      const payload: CustomReportConfig = overrideConfig || {
        name: reportName.trim() || SOURCE_CATALOG[source].label,
        source,
        columns: safeCols.length > 0 ? safeCols : availableColumns.slice(0, 5).map((c) => c.key),
        sortBy: sortBy || availableColumns[0]?.key || '',
        sortDir,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        activityFilter,
        filters: filters.filter((f) => f.value.trim().length > 0),
      };
      const data = await apiFetch<CustomReportTabularResult>('/api/reports/custom-query', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResult(data);
      onResultChange(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ الاستعلام المخصص');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    executeQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSavePreset = async () => {
    setSavingPreset(true);
    setError(null);
    try {
      const config: CustomReportConfig = {
        name: reportName.trim() || SOURCE_CATALOG[source].label,
        source,
        columns: selectedColumns,
        sortBy,
        sortDir,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        activityFilter,
        filters,
      };
      await apiFetch('/api/reports/custom-presets', {
        method: 'POST',
        body: JSON.stringify({
          name: config.name,
          config,
        }),
      });
      onPresetsUpdated(`تم حفظ قالب التقرير المخصص: ${config.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ القالب');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleLoadPreset = (preset: SavedCustomReportPreset) => {
    const cfg = preset.config;
    setReportName(preset.name);
    setSource(cfg.source);
    const cols = SOURCE_CATALOG[cfg.source].columns.filter((c) => canViewProfits || !c.profitSensitive);
    const validCols = cfg.columns.filter((k) => cols.some((c) => c.key === k));
    setSelectedColumns(validCols.length > 0 ? validCols : cols.slice(0, 5).map((c) => c.key));
    setSortBy(cfg.sortBy || cols[0]?.key || '');
    setSortDir(cfg.sortDir || 'desc');
    setFilters(cfg.filters || []);
    executeQuery({
      ...cfg,
      columns: validCols.length > 0 ? validCols : cols.slice(0, 5).map((c) => c.key),
      dateFrom: dateFrom || cfg.dateFrom,
      dateTo: dateTo || cfg.dateTo,
      activityFilter,
    });
  };

  const handleDeletePreset = async (id: string) => {
    try {
      await apiFetch(`/api/reports/custom-presets/${id}`, { method: 'DELETE' });
      onPresetsUpdated('تم حذف قالب التقرير المخصص');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف القالب');
    }
  };

  return (
    <div className="space-y-5">
      {/* Saved Presets Strip */}
      {presets.length > 0 && (
        <div className="no-print rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            القوالب المحفوظة مسبقاً ({presets.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
              >
                <button
                  type="button"
                  onClick={() => handleLoadPreset(p)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-800 hover:text-emerald-600 dark:text-slate-200"
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePreset(p.id)}
                  title="حذف القالب"
                  className="border-r border-slate-200 px-2 py-1.5 text-slate-400 hover:text-rose-600 dark:border-slate-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Report Builder Controls */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">عنوان التقرير</label>
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="مثال: تقرير مبيعات الجملة اليومي"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">مصدر البيانات</label>
            <select
              value={source}
              onChange={(e) => handleSourceChange(e.target.value as CustomReportDataSource)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              {(Object.keys(SOURCE_CATALOG) as CustomReportDataSource[]).map((k) => (
                <option key={k} value={k}>
                  {SOURCE_CATALOG[k].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">ترتيب النتائج حسب</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              {availableColumns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">اتجاه الفرز</label>
            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="desc">تنازلي (من الأعلى للأقل)</option>
              <option value="asc">تصاعدي (من الأقل للأعلى)</option>
            </select>
          </div>
        </div>

        {/* Column Picker */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            الأعمدة المعروضة في التقرير والمطبوعة:
          </div>
          <div className="flex flex-wrap gap-2">
            {availableColumns.map((col) => {
              const checked = selectedColumns.includes(col.key);
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => toggleColumn(col.key)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    checked
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                  }`}
                >
                  {col.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Rule Filters */}
        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              شروط التصفية المتقدمة ({filters.length})
            </span>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => [
                  ...prev,
                  { field: availableColumns[0]?.key || '', operator: 'contains', value: '' },
                ])
              }
              className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة شرط تصفية</span>
            </button>
          </div>

          {filters.map((rule, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-12 text-xs">
              <select
                value={rule.field}
                onChange={(e) =>
                  setFilters((prev) => prev.map((r, i) => (i === idx ? { ...r, field: e.target.value } : r)))
                }
                className="sm:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {availableColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>

              <select
                value={rule.operator}
                onChange={(e) =>
                  setFilters((prev) =>
                    prev.map((r, i) =>
                      i === idx ? { ...r, operator: e.target.value as CustomReportFilterRule['operator'] } : r
                    )
                  )
                }
                className="sm:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="contains">يحتوي على</option>
                <option value="eq">يساوي (=)</option>
                <option value="gt">أكبر من (&gt;)</option>
                <option value="gte">أكبر أو يساوي (&ge;)</option>
                <option value="lt">أصغر من (&lt;)</option>
                <option value="lte">أصغر أو يساوي (&le;)</option>
              </select>

              <input
                type="text"
                value={rule.value}
                onChange={(e) =>
                  setFilters((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))
                }
                placeholder="القيمة المطلوبة..."
                className="sm:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950"
              />

              <button
                type="button"
                onClick={() => setFilters((prev) => prev.filter((_, i) => i !== idx))}
                className="sm:col-span-1 flex items-center justify-center rounded-lg border border-slate-200 py-2 text-rose-600 hover:bg-rose-50 dark:border-slate-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={savingPreset}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-emerald-600" />
            <span>{savingPreset ? 'جاري الحفظ...' : 'حفظ كقالب تقرير'}</span>
          </button>
          <button
            type="button"
            onClick={() => executeQuery()}
            disabled={running}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{running ? 'جاري التشغيل...' : 'تشغيل وعرض التقرير'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Results Table */}
      {result && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {result.title}
              </h3>
              <div className="text-xs text-slate-500 font-mono-num">{result.subtitle}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs sm:text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  {result.headers.map((h, i) => (
                    <th key={`${h}-${i}`} className="px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={result.headers.length} className="px-4 py-8 text-center text-xs text-slate-500">
                      لا توجد نتائج مطابقة لشروط التصفية المحددة.
                    </td>
                  </tr>
                ) : (
                  result.rows.slice(0, 250).map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-4 py-2.5 whitespace-nowrap ${
                            typeof cell === 'number' ? 'font-mono-num font-semibold' : ''
                          }`}
                        >
                          {typeof cell === 'number' ? formatNum(cell) : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {result.totalsRow && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900 dark:border-slate-800 dark:bg-slate-950/60 dark:text-white">
                    {result.totalsRow.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className={`px-4 py-3 whitespace-nowrap ${
                          typeof cell === 'number' ? 'font-mono-num text-emerald-600 dark:text-emerald-400' : ''
                        }`}
                      >
                        {typeof cell === 'number' ? formatNum(cell) : String(cell)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
