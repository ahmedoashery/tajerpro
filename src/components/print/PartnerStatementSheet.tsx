import { Fragment } from 'react';
import type { PrintDocumentPayload } from '../../context/PrintContext';
import { formatDateTimeAr, formatEGP, formatNum } from '../../utils/formatters';

type PartnerStatementPayload = Extract<PrintDocumentPayload, { kind: 'partner_statement_a4' }>;

export function PartnerStatementSheet({
  payload,
  printedAt,
}: {
  payload: PartnerStatementPayload;
  printedAt: string;
}) {
  const {
    partnerType,
    partnerName,
    partnerPhone,
    currentBalance,
    openingBalance = 0,
    creditLimit,
    entries,
    statementMode = 'itemized',
    dateFrom,
    dateTo,
    itemizedSummary = [],
    paymentBreakdown = [],
    loyaltyPoints = 0,
    storeCreditBalance = 0,
    totalReturns = 0,
    settings,
    printedBy,
    template,
  } = payload;

  const isItemized = statementMode === 'itemized';
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const accent = template?.accentColor || '#059669';
  const defaultTitle = isItemized
    ? partnerType === 'customer'
      ? 'كشف حساب عميل تفصيلي بالأصناف'
      : 'كشف حساب مورد تفصيلي بالأصناف'
    : partnerType === 'customer'
      ? 'كشف حساب عميل (ملخص الحركات)'
      : 'كشف حساب مورد (ملخص الحركات)';
  const headerTitle = template?.headerTitle || defaultTitle;
  const headerSubtitle = template?.headerSubtitle || '';
  const showTax = template?.showTaxNumber ?? settings.printTemplate.showTaxNumber;
  const showSig = template?.showSignatureLine ?? settings.printTemplate.showSignatureLine;
  const footerNote = template?.footerNote || settings.receiptFooter;

  const balanceDirectionLabel =
    currentBalance === 0
      ? 'خالص الحساب'
      : partnerType === 'customer'
        ? currentBalance > 0
          ? 'مستحق على العميل'
          : 'رصيد دائن للعميل'
        : currentBalance > 0
          ? 'مستحق للمورد'
          : 'رصيد مدفوع مقدماً';

  const itemizedGrandTotal = itemizedSummary.reduce((s, r) => s + r.totalAmount, 0);
  const totalPaymentCollected = paymentBreakdown.reduce((s, p) => s + p.total, 0);

  return (
    <div className="print-a4-sheet space-y-5" dir="rtl">
      <header className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: accent }}>
        <div className="space-y-1">
          <div className="font-display text-2xl font-bold text-slate-900">{settings.storeName}</div>
          <div className="text-xs text-slate-600">
            {settings.address} · هاتف: <span className="font-mono-num">{settings.phone}</span>
          </div>
          {showTax && settings.taxNumber && (
            <div className="font-mono-num text-[11px] text-slate-500">
              الرقم الضريبي: {settings.taxNumber}
            </div>
          )}
        </div>
        <div className="text-left space-y-1">
          <div className="font-display text-lg font-bold text-slate-900">{headerTitle}</div>
          {headerSubtitle && <div className="text-[11px] text-slate-500">{headerSubtitle}</div>}
          <div className="text-xs text-slate-600">تاريخ الإصدار: {printedAt}</div>
          <div className="font-mono-num text-[11px] text-slate-600">
            الفترة: {dateFrom || 'البداية'} ← {dateTo || 'الآن'}
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-xs space-y-3 print-avoid-break">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
          <div>
            <span className="text-slate-500">{partnerType === 'customer' ? 'اسم العميل: ' : 'اسم المورد: '}</span>
            <strong className="text-sm font-bold text-slate-900">{partnerName}</strong>
            <span className="mr-3 font-mono-num text-slate-600">هاتف: {partnerPhone || '—'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono-num text-[11px] text-slate-700">
            {partnerType === 'customer' && (
              <>
                <span>
                  الحد الائتماني:{' '}
                  <strong>{creditLimit && creditLimit > 0 ? formatEGP(creditLimit) : 'غير محدد'}</strong>
                </span>
                {loyaltyPoints > 0 && (
                  <span>
                    نقاط الولاء: <strong>{formatNum(loyaltyPoints)}</strong>
                  </span>
                )}
                {storeCreditBalance > 0 && (
                  <span>
                    محفظة العميل: <strong>{formatEGP(storeCreditBalance)}</strong>
                  </span>
                )}
              </>
            )}
            {partnerType === 'supplier' && <span>حساب موردين وتوريد بضاعة</span>}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2.5">
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">رصيد سابق مرحّل</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-slate-900">
              {formatEGP(openingBalance)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">
              {partnerType === 'customer' ? 'فواتير / مسحوبات' : 'توريدات / مشتريات'}
            </div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-slate-900">
              {formatEGP(totalDebit)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">إجمالي السداد / التحصيل</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-emerald-700">
              {formatEGP(totalCredit)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">المرتجعات / الأصناف</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-slate-800">
              {totalReturns > 0 ? formatEGP(totalReturns) : `${itemizedSummary.length} صنف`}
            </div>
          </div>
          <div className="rounded border border-slate-300 bg-white p-2">
            <div className="text-[10px] text-slate-600">{balanceDirectionLabel}</div>
            <div className="mt-0.5 font-mono-num text-sm font-extrabold text-slate-900">
              {formatEGP(currentBalance)}
            </div>
          </div>
        </div>
      </section>

      <table className="print-table text-xs">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>نوع الحركة والبيان</th>
            <th>المرجع</th>
            <th className="text-left">مدين (+)</th>
            <th className="text-left">دائن / سداد (-)</th>
            <th className="text-left">الرصيد التراكمي</th>
            <th>السداد / ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {openingBalance !== 0 && (
            <tr className="bg-amber-50 font-semibold">
              <td className="font-mono-num">—</td>
              <td className="text-slate-900">رصيد مرحّل قبل الفترة المحددة</td>
              <td className="font-mono-num">رصيد سابق</td>
              <td className="text-left font-mono-num">—</td>
              <td className="text-left font-mono-num">—</td>
              <td className="text-left font-mono-num font-bold">{formatEGP(openingBalance)}</td>
              <td className="text-[11px]">رصيد افتتاحي</td>
            </tr>
          )}
          {entries.map((entry) => {
            const hasItems = isItemized && entry.items && entry.items.length > 0;
            return (
              <Fragment key={entry.id}>
                <tr className={hasItems ? 'bg-slate-50 font-semibold' : ''}>
                  <td className="font-mono-num whitespace-nowrap">{formatDateTimeAr(entry.date)}</td>
                  <td className="font-semibold text-slate-900">{entry.typeLabel}</td>
                  <td className="font-mono-num">{entry.reference}</td>
                  <td className="text-left font-mono-num">
                    {entry.debit > 0 ? formatEGP(entry.debit) : '—'}
                  </td>
                  <td className="text-left font-mono-num">
                    {entry.credit > 0 ? formatEGP(entry.credit) : '—'}
                  </td>
                  <td className="text-left font-mono-num font-bold">{formatEGP(entry.runningBalance)}</td>
                  <td className="text-[11px]">
                    {entry.notes || '—'}
                    {entry.treasuryBreakdown && (
                      <div className="mt-0.5 font-mono-num text-[10px] text-slate-600">
                        {entry.treasuryBreakdown}
                      </div>
                    )}
                  </td>
                </tr>
                {hasItems && (
                  <tr key={`${entry.id}-items`} className="print-avoid-break">
                    <td colSpan={7} className="bg-white p-2">
                      <div className="rounded border border-slate-300 overflow-hidden">
                        <table className="w-full border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
                              <th className="px-2 py-1 text-right">#</th>
                              <th className="px-2 py-1 text-right">الصنف</th>
                              <th className="px-2 py-1 text-center">الوحدة</th>
                              <th className="px-2 py-1 text-center">الكمية</th>
                              <th className="px-2 py-1 text-left">سعر الوحدة</th>
                              <th className="px-2 py-1 text-left">الخصم</th>
                              <th className="px-2 py-1 text-left">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {entry.items!.map((it, idx) => (
                              <tr key={`${entry.id}-${it.productId}-${idx}`}>
                                <td className="px-2 py-1 font-mono-num text-slate-500">{idx + 1}</td>
                                <td className="px-2 py-1 font-semibold text-slate-900">{it.productName}</td>
                                <td className="px-2 py-1 text-center text-slate-600">{it.unit}</td>
                                <td className="px-2 py-1 text-center font-mono-num font-semibold">
                                  {formatNum(it.quantity)}
                                </td>
                                <td className="px-2 py-1 text-left font-mono-num">
                                  {formatEGP(it.unitPrice)}
                                </td>
                                <td className="px-2 py-1 text-left font-mono-num text-slate-600">
                                  {it.discountAmount > 0 ? formatEGP(it.discountAmount) : '—'}
                                </td>
                                <td className="px-2 py-1 text-left font-mono-num font-bold text-slate-900">
                                  {formatEGP(it.lineTotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold text-slate-900">
            <td colSpan={3}>إجمالي حركات الفترة ({entries.length} حركة)</td>
            <td className="text-left font-mono-num">{formatEGP(totalDebit)}</td>
            <td className="text-left font-mono-num text-emerald-700">{formatEGP(totalCredit)}</td>
            <td className="text-left font-mono-num">{formatEGP(currentBalance)}</td>
            <td>{balanceDirectionLabel}</td>
          </tr>
        </tfoot>
      </table>

      {isItemized && itemizedSummary.length > 0 && (
        <section className="space-y-2 pt-2 print-avoid-break">
          <div className="text-xs font-bold text-slate-900 border-b border-slate-300 pb-1">
            ملخص إجمالي حركة الأصناف خلال الفترة ({itemizedSummary.length} صنف)
          </div>
          <table className="print-table text-[11px]">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الوحدة</th>
                <th className="text-center">عدد المستندات</th>
                <th className="text-center">إجمالي الكمية</th>
                <th className="text-left">متوسط السعر</th>
                <th className="text-left">إجمالي القيمة</th>
                <th className="text-center">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {itemizedSummary.map((row) => {
                const pct =
                  itemizedGrandTotal > 0 ? Math.round((row.totalAmount / itemizedGrandTotal) * 100) : 0;
                return (
                  <tr key={row.productId}>
                    <td className="font-semibold text-slate-900">{row.productName}</td>
                    <td>{row.unit}</td>
                    <td className="text-center font-mono-num">{row.invoiceCount}</td>
                    <td className="text-center font-mono-num font-bold">{formatNum(row.totalQty)}</td>
                    <td className="text-left font-mono-num">{formatEGP(row.avgUnitPrice)}</td>
                    <td className="text-left font-mono-num font-bold">{formatEGP(row.totalAmount)}</td>
                    <td className="text-center font-mono-num">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={3}>الإجمالي التجميعي للأصناف</td>
                <td className="text-center font-mono-num">
                  {formatNum(itemizedSummary.reduce((s, r) => s + r.totalQty, 0))}
                </td>
                <td className="text-left">—</td>
                <td className="text-left font-mono-num">{formatEGP(itemizedGrandTotal)}</td>
                <td className="text-center font-mono-num">100%</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {paymentBreakdown.length > 0 && (
        <section className="space-y-2 pt-1 print-avoid-break">
          <div className="text-xs font-bold text-slate-900 border-b border-slate-300 pb-1">
            تحليل وسائل السداد والخزائن ({paymentBreakdown.length} قناة)
          </div>
          <table className="print-table text-[11px]">
            <thead>
              <tr>
                <th>الوسيلة / الخزينة</th>
                <th className="text-center">عدد الحركات</th>
                <th className="text-left">إجمالي المسدد</th>
                <th className="text-center">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {paymentBreakdown.map((pb) => {
                const pct =
                  totalPaymentCollected > 0 ? Math.round((pb.total / totalPaymentCollected) * 100) : 0;
                return (
                  <tr key={pb.label}>
                    <td className="font-semibold text-slate-900">{pb.label}</td>
                    <td className="text-center font-mono-num">{pb.count}</td>
                    <td className="text-left font-mono-num font-bold text-emerald-700">
                      {formatEGP(pb.total)}
                    </td>
                    <td className="text-center font-mono-num">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td>الإجمالي</td>
                <td className="text-center font-mono-num">
                  {paymentBreakdown.reduce((s, p) => s + p.count, 0)}
                </td>
                <td className="text-left font-mono-num">{formatEGP(totalPaymentCollected)}</td>
                <td className="text-center font-mono-num">100%</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <footer className="flex items-center justify-between border-t border-slate-300 pt-4 text-[11px] text-slate-600 print-avoid-break">
        <div>
          طبع بواسطة: {printedBy}
          {footerNote ? ` · ${footerNote}` : ''}
        </div>
        {showSig && <div>توقيع المطابقة والاعتماد: ..........................</div>}
      </footer>
    </div>
  );
}
