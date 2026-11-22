import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import type { PaymentGatewayConfig, PaymentTransaction } from '../../shared/types';
import { formatDateTimeAr, formatEGP, PAYMENT_METHOD_LABELS } from '../../utils/formatters';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from '../ui/ExcelColumnFilter';

interface EPaymentsAndTreasuriesTabProps {
  transactions: PaymentTransaction[];
  paymentConfig: PaymentGatewayConfig;
  canManagePayments: boolean;
  saving: boolean;
  onSaveConfig: (cfg: PaymentGatewayConfig) => Promise<void>;
}

const txStatusLabel = (st: PaymentTransaction['status']) =>
  st === 'settled' ? 'تمت التسوية' : st === 'pending' ? 'آجل معلق' : 'مسترد';

export function EPaymentsAndTreasuriesTab({
  transactions,
  paymentConfig,
  canManagePayments,
  saving,
  onSaveConfig,
}: EPaymentsAndTreasuriesTabProps) {
  const [payCfg, setPayCfg] = useState<PaymentGatewayConfig>(paymentConfig);
  const [txSearch, setTxSearch] = useState('');
  const debouncedTxSearch = useDebouncedValue(txSearch, 200);

  const baseTx = useMemo(() => {
    const q = debouncedTxSearch.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (tx) =>
        tx.invoiceNumber.toLowerCase().includes(q) ||
        tx.referenceCode.toLowerCase().includes(q) ||
        (tx.treasuryName || '').toLowerCase().includes(q) ||
        PAYMENT_METHOD_LABELS[tx.method].toLowerCase().includes(q)
    );
  }, [transactions, debouncedTxSearch]);

  const txColumns: ExcelColumnDef<PaymentTransaction>[] = useMemo(
    () => [
      { key: 'invoiceNumber', label: 'الفاتورة', getValue: (t) => t.invoiceNumber },
      { key: 'method', label: 'البوابة', getValue: (t) => PAYMENT_METHOD_LABELS[t.method] },
      {
        key: 'amount',
        label: 'المبلغ',
        getValue: (t) => formatEGP(t.amount),
        getSortValue: (t) => t.amount,
      },
      { key: 'status', label: 'الحالة', getValue: (t) => txStatusLabel(t.status) },
    ],
    []
  );
  const txExcel = useExcelTableFilter(baseTx, txColumns);
  const txScroll = useInfiniteScroll(txExcel.filteredRows, {
    batchSize: 12,
    resetKey: `tx-${debouncedTxSearch}-${txExcel.activeFilterKeys.join(',')}-${txExcel.sortState.columnKey}`,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSaveConfig(payCfg);
        }}
        className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <h3 className="font-display text-sm font-bold">إعدادات الربط مع أنظمة الدفع المصرية</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          يتم ربط حسابات الاستقبال ومزودي الخدمة (InstaPay / المحافظ / Paymob / Fawry) من الخادم بشكل آمن.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">عنوان إنستا باي للمحل (InstaPay IPA)</label>
            <input
              disabled={!canManagePayments}
              value={payCfg.instapayIpa}
              onChange={(e) => setPayCfg({ ...payCfg, instapayIpa: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">رقم المحفظة الإلكترونية (فودافون / أورنج / اتصالات كاش)</label>
            <input
              disabled={!canManagePayments}
              value={payCfg.vodafoneCashNumber}
              onChange={(e) => setPayCfg({ ...payCfg, vodafoneCashNumber: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">معرف Paymob Integration</label>
              <input
                disabled={!canManagePayments}
                value={payCfg.paymobIntegrationId}
                onChange={(e) => setPayCfg({ ...payCfg, paymobIntegrationId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">كود تاجر فوري (Fawry)</label>
              <input
                disabled={!canManagePayments}
                value={payCfg.fawryMerchantCode}
                onChange={(e) => setPayCfg({ ...payCfg, fawryMerchantCode: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">نسبة عمولة ماكينة البطاقات (%)</label>
            <input
              type="number"
              step="0.1"
              disabled={!canManagePayments}
              value={payCfg.cardFeePercent}
              onChange={(e) => setPayCfg({ ...payCfg, cardFeePercent: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {canManagePayments ? (
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            حفظ إعدادات الدفع
          </button>
        ) : (
          <div className="text-xs text-amber-600">تعديل بوابات الدفع يتطلب صلاحية إدارة الدفع.</div>
        )}
      </form>

      <div className="lg:col-span-7 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-display text-sm font-bold">سجل العمليات والتسويات</div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="بحث برقم الفاتورة أو الخزينة..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            {txSearch && (
              <button
                type="button"
                onClick={() => setTxSearch('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <ActiveExcelFiltersBar
          columns={txColumns}
          activeFilterKeys={txExcel.activeFilterKeys}
          sortState={txExcel.sortState}
          totalBefore={baseTx.length}
          totalAfter={txExcel.filteredRows.length}
          onClearOne={(k) => txExcel.applyColumnFilter(k, null)}
          onClearAll={txExcel.clearAllFilters}
        />

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">
                    <ExcelColumnHeader
                      columnKey="invoiceNumber"
                      label="المرجع / الفاتورة"
                      options={txExcel.getColumnOptions('invoiceNumber')}
                      activeFilterValues={txExcel.columnFilters['invoiceNumber']}
                      sortDirection={
                        txExcel.sortState.columnKey === 'invoiceNumber'
                          ? txExcel.sortState.direction
                          : null
                      }
                      onApplyFilter={(v) => txExcel.applyColumnFilter('invoiceNumber', v)}
                      onSort={(d) => txExcel.setColumnSort('invoiceNumber', d)}
                    />
                  </th>
                  <th className="px-4 py-2.5">
                    <ExcelColumnHeader
                      columnKey="method"
                      label="البوابة / الخزينة"
                      options={txExcel.getColumnOptions('method')}
                      activeFilterValues={txExcel.columnFilters['method']}
                      sortDirection={
                        txExcel.sortState.columnKey === 'method' ? txExcel.sortState.direction : null
                      }
                      onApplyFilter={(v) => txExcel.applyColumnFilter('method', v)}
                      onSort={(d) => txExcel.setColumnSort('method', d)}
                    />
                  </th>
                  <th className="px-4 py-2.5">
                    <ExcelColumnHeader
                      columnKey="amount"
                      label="المبلغ"
                      options={txExcel.getColumnOptions('amount')}
                      activeFilterValues={txExcel.columnFilters['amount']}
                      sortDirection={
                        txExcel.sortState.columnKey === 'amount' ? txExcel.sortState.direction : null
                      }
                      onApplyFilter={(v) => txExcel.applyColumnFilter('amount', v)}
                      onSort={(d) => txExcel.setColumnSort('amount', d)}
                    />
                  </th>
                  <th className="px-4 py-2.5">الصافي بعد العمولة</th>
                  <th className="px-4 py-2.5">
                    <ExcelColumnHeader
                      columnKey="status"
                      label="الحالة"
                      options={txExcel.getColumnOptions('status')}
                      activeFilterValues={txExcel.columnFilters['status']}
                      sortDirection={
                        txExcel.sortState.columnKey === 'status' ? txExcel.sortState.direction : null
                      }
                      onApplyFilter={(v) => txExcel.applyColumnFilter('status', v)}
                      onSort={(d) => txExcel.setColumnSort('status', d)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {txScroll.visibleItems.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-mono-num font-semibold text-slate-900 dark:text-white">
                        {tx.invoiceNumber}
                      </div>
                      <div className="text-[11px] text-slate-500">{formatDateTimeAr(tx.createdAt)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div>{tx.treasuryName || PAYMENT_METHOD_LABELS[tx.method]}</div>
                      {tx.referenceCode && (
                        <div className="font-mono-num text-[11px] text-slate-500">{tx.referenceCode}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num">{formatEGP(tx.amount)}</td>
                    <td className="px-4 py-2.5 font-mono-num font-semibold">{formatEGP(tx.netAmount)}</td>
                    <td className="px-4 py-2.5 font-semibold">
                      {tx.status === 'settled' && <span className="text-emerald-600">تمت التسوية</span>}
                      {tx.status === 'pending' && <span className="text-amber-600">آجل معلق</span>}
                      {tx.status === 'refunded' && <span className="text-rose-600">مسترد</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfiniteTableFooter
            visibleCount={txScroll.visibleCount}
            totalCount={txScroll.totalCount}
            hasMore={txScroll.hasMore}
            onLoadMore={txScroll.loadMore}
            sentinelRef={txScroll.sentinelRef}
          />
        </div>
      </div>
    </div>
  );
}
