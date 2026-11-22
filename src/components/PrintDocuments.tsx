import type { PrintDocumentPayload } from '../context/PrintContext';
import { PRICE_TIER_LABELS } from '../shared/pricingUtils';
import type { DocumentTemplateArtifact, StoreSettings } from '../shared/types';
import { BarcodeGraphic } from '../utils/barcodeSvg';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SOURCE_LABELS,
  formatDateTimeAr,
  formatEGP,
  formatNum,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';
import { EquityPartnerStatementSheet } from './print/EquityPartnerStatementSheet';
import { PartnerStatementSheet } from './print/PartnerStatementSheet';
import { ReportPrintSheets } from './print/ReportPrintSheets';

export function TemplateSheetPreview({
  template,
  settings,
  compact = false,
}: {
  template: DocumentTemplateArtifact;
  settings: StoreSettings;
  compact?: boolean;
}) {
  const accent = template.accentColor || settings.printTemplate?.accentColor || '#059669';
  const visibleColumns = [...template.columns]
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order);
  const isThermal = template.paperSize === 'thermal_80mm';
  const isBordered = template.style === 'classic_bordered';
  const isExecutive = template.style === 'executive_slate';

  return (
    <div
      dir="rtl"
      className={`bg-white text-slate-900 ${
        isThermal ? 'mx-auto max-w-[320px] border border-dashed border-slate-400 p-3.5 text-[11px]' : 'w-full p-6 text-xs'
      } ${isBordered ? 'border-2 border-slate-800' : ''}`}
      style={{ fontFamily: 'Cairo, Tajawal, sans-serif' }}
    >
      {/* Header */}
      <div
        className={`flex ${isThermal ? 'flex-col text-center items-center' : 'items-start justify-between'} pb-3 mb-4`}
        style={{
          borderBottom: `2px solid ${isExecutive ? '#0f172a' : accent}`,
        }}
      >
        <div className={isThermal ? 'space-y-0.5' : 'space-y-1'}>
          {template.showLogo && (
            <div className="font-bold text-lg" style={{ color: isExecutive ? '#0f172a' : accent }}>
              {settings.storeName}
            </div>
          )}
          <div className="text-[11px] text-slate-600">
            {settings.address} · هاتف: <span className="font-mono-num">{settings.phone}</span>
          </div>
          {template.showTaxNumber && settings.taxNumber && (
            <div className="text-[11px] text-slate-600 font-mono-num">
              الرقم الضريبي: {settings.taxNumber}
            </div>
          )}
        </div>

        <div className={isThermal ? 'mt-2' : 'text-left space-y-0.5'}>
          <div className="text-sm font-extrabold text-slate-900">{template.headerTitle}</div>
          {template.headerSubtitle && (
            <div className="text-[11px] font-medium" style={{ color: accent }}>
              {template.headerSubtitle}
            </div>
          )}
          <div className="text-[10px] text-slate-500 font-mono-num">
            {template.xlsxFileName} · {template.paperSize === 'thermal_80mm' ? '80mm' : 'A4'}
          </div>
        </div>
      </div>

      {/* Preview Table driven by Excel Columns & Sample Rows */}
      <div className="overflow-hidden rounded border border-slate-300">
        <table className="w-full border-collapse text-right">
          <thead>
            <tr
              style={{
                backgroundColor: isExecutive ? '#0f172a' : isBordered ? '#f1f5f9' : accent,
                color: isBordered ? '#0f172a' : '#ffffff',
              }}
            >
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="px-2.5 py-2 font-bold border-b border-slate-300"
                  style={{ width: `${col.widthPercent}%` }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {template.sampleRows.slice(0, compact ? 3 : 8).map((row, idx) => (
              <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-2.5 py-2 text-slate-800 font-mono-num">
                    {row[col.key] !== undefined && row[col.key] !== '' ? String(row[col.key]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
            {template.sampleRows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, visibleColumns.length)} className="px-3 py-4 text-center text-slate-400">
                  لا توجد صفوف معاينة في ملف Excel
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Optional Split Payments Showcase */}
      {template.showSplitPayments && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-bold text-slate-700">توزيع سداد الخزائن المسجلة (نموذج):</span>
          <span className="font-mono-num text-slate-700">
            خزينة الكاشير (500 ج.م) + إنستا باي التجاري (350 ج.م)
          </span>
        </div>
      )}

      {/* Footer, Barcode & Signature */}
      <div className="mt-4 border-t border-slate-200 pt-3 flex items-end justify-between gap-4">
        <div className="space-y-1 text-[11px] text-slate-600">
          {template.footerNote && <div className="font-semibold text-slate-800">{template.footerNote}</div>}
          {template.showSignatureLine && (
            <div className="pt-2 text-[10px] text-slate-500">
              التوقيع / الاعتماد: ..............................
            </div>
          )}
        </div>
        {template.showBarcode && (
          <div className="shrink-0">
            <BarcodeGraphic code="INV-SAMPLE-001" height={compact ? 22 : 28} />
          </div>
        )}
      </div>
    </div>
  );
}

export function PrintDocuments({ payload }: { payload: PrintDocumentPayload }) {
  const printedAt = formatDateTimeAr(new Date().toISOString());

  if (payload.kind === 'invoice_thermal') {
    const { invoice, settings } = payload;
    const tpl = settings.printTemplate;
    return (
      <div className="print-thermal-80mm" dir="rtl">
        <div className="text-center border-b border-dashed border-slate-500 pb-2.5">
          <div className="font-display text-base font-bold text-black">{settings.storeName}</div>
          {tpl?.customHeaderNote && (
            <div className="text-[10px] font-semibold text-slate-700 mt-0.5">{tpl.customHeaderNote}</div>
          )}
          <div className="text-[10px] text-slate-700 mt-0.5">{settings.address}</div>
          <div className="text-[10px] text-slate-700 font-mono-num">هاتف: {settings.phone}</div>
          {tpl?.showTaxNumber !== false && settings.taxNumber && (
            <div className="text-[10px] text-slate-700 font-mono-num">
              الرقم الضريبي: {settings.taxNumber}
            </div>
          )}
        </div>

        <div className="my-2 border-b border-dashed border-slate-500 pb-2 text-[10px] space-y-1">
          <div className="flex justify-between">
            <span>رقم الفاتورة:</span>
            <strong className="font-mono-num">{invoice.invoiceNumber}</strong>
          </div>
          <div className="flex justify-between">
            <span>التاريخ:</span>
            <span>{formatDateTimeAr(invoice.createdAt)}</span>
          </div>
          {tpl?.showCashierName !== false && (
            <div className="flex justify-between">
              <span>الكاشير:</span>
              <span>{invoice.cashierName}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>العميل:</span>
            <span>{invoice.customerName}</span>
          </div>
          {invoice.status === 'returned' && (
            <div className="text-center font-bold text-rose-700 border border-rose-700 py-0.5 mt-1">
              *** فاتورة مرتجعة ***
            </div>
          )}
        </div>

        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-slate-400 text-right">
              <th className="py-1">الصنف</th>
              <th className="py-1 text-center">كمية</th>
              <th className="py-1 text-left">السعر</th>
              <th className="py-1 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dashed divide-slate-300">
            {invoice.items.map((it) => (
              <tr key={it.id}>
                <td className="py-1 font-medium">{it.productName}</td>
                <td className="py-1 text-center font-mono-num">{formatNum(it.quantity)}</td>
                <td className="py-1 text-left font-mono-num">{formatNum(it.unitSalePrice)}</td>
                <td className="py-1 text-left font-mono-num font-bold">{formatNum(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 border-t border-dashed border-slate-500 pt-2 space-y-1 text-[11px]">
          {invoice.discountTotal > 0 && (
            <>
              <div className="flex justify-between">
                <span>الإجمالي قبل الخصم:</span>
                <span className="font-mono-num">{formatEGP(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>الخصم:</span>
                <span className="font-mono-num">-{formatEGP(invoice.discountTotal)}</span>
              </div>
            </>
          )}
          {tpl?.showVatSummary && settings.vatPercent > 0 && (
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>شامل ض.ق.م ({settings.vatPercent}%):</span>
              <span className="font-mono-num">
                {formatEGP((invoice.grandTotal * settings.vatPercent) / (100 + settings.vatPercent))}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold pt-0.5">
            <span>الصافي المطلوب:</span>
            <span className="font-mono-num">{formatEGP(invoice.grandTotal)}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span>طريقة الدفع:</span>
            <span>{PAYMENT_METHOD_LABELS[invoice.paymentMethod]}</span>
          </div>
          {invoice.allocations && invoice.allocations.length > 0 && (
            <div className="border-t border-dashed border-slate-300 pt-1 space-y-0.5 text-[10px]">
              <div className="font-bold">توزيع الخزائن:</div>
              {invoice.allocations.map((al) => (
                <div key={al.id} className="flex justify-between">
                  <span>{al.treasuryName}</span>
                  <span className="font-mono-num font-semibold">{formatEGP(al.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {invoice.paymentMethod === 'cash' && (
            <>
              <div className="flex justify-between text-[10px]">
                <span>المدفوع:</span>
                <span className="font-mono-num">{formatEGP(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span>الباقي:</span>
                <span className="font-mono-num">{formatEGP(invoice.changeAmount)}</span>
              </div>
            </>
          )}
          {invoice.paymentRef && (
            <div className="flex justify-between text-[10px]">
              <span>المرجع الإلكتروني:</span>
              <span className="font-mono-num">{invoice.paymentRef}</span>
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-dashed border-slate-500 pt-2 text-center space-y-1.5">
          {tpl?.showBarcode !== false && <BarcodeGraphic code={invoice.invoiceNumber} height={28} />}
          <p className="text-[10px] text-slate-700">{settings.receiptFooter}</p>
        </div>
      </div>
    );
  }

  if (payload.kind === 'invoice_a4') {
    const { invoice, settings, activityName, customerBalanceDue } = payload;
    const tpl = settings.printTemplate;
    const accent = tpl?.accentColor || '#059669';
    return (
      <div className="print-a4-sheet space-y-5" dir="rtl">
        <header
          className="flex items-start justify-between pb-4"
          style={{ borderBottom: `2px solid ${accent}` }}
        >
          <div className="space-y-1">
            <div className="font-display text-2xl font-bold" style={{ color: accent }}>
              {settings.storeName}
            </div>
            {tpl?.customHeaderNote && (
              <div className="text-xs font-semibold text-slate-700">{tpl.customHeaderNote}</div>
            )}
            <div className="text-xs text-slate-600">النشاط التجاري: {activityName}</div>
            <div className="text-xs text-slate-600">{settings.address}</div>
            <div className="text-xs text-slate-600 font-mono-num">
              هاتف: {settings.phone}
              {tpl?.showTaxNumber !== false && settings.taxNumber
                ? ` · الرقم الضريبي: ${settings.taxNumber}`
                : ''}
            </div>
          </div>

          <div className="text-left space-y-1">
            <div className="font-display text-lg font-bold text-slate-900">
              {invoice.status === 'returned' ? 'إشعار مرتجع مبيعات' : 'فاتورة مبيعات تجارية'}
            </div>
            <div className="font-mono-num text-sm font-bold text-slate-900">
              #{invoice.invoiceNumber}
            </div>
            <div className="text-xs text-slate-600">{formatDateTimeAr(invoice.createdAt)}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-xs">
          <div className="space-y-1">
            <div>
              <span className="text-slate-500">بيانات العميل: </span>
              <strong className="text-slate-900">{invoice.customerName}</strong>
            </div>
            {tpl?.showCustomerBalance !== false && typeof customerBalanceDue === 'number' && (
              <div>
                <span className="text-slate-500">رصيد حساب العميل الحالي: </span>
                <strong className="font-mono-num text-slate-900">{formatEGP(customerBalanceDue)}</strong>
              </div>
            )}
            {tpl?.showCashierName !== false && (
              <div>
                <span className="text-slate-500">الكاشير / المسؤول: </span>
                <strong className="text-slate-900">{invoice.cashierName}</strong>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div>
              <span className="text-slate-500">وسيلة التحصيل: </span>
              <strong className="text-slate-900">{PAYMENT_METHOD_LABELS[invoice.paymentMethod]}</strong>
            </div>
            {invoice.paymentRef && (
              <div>
                <span className="text-slate-500">المرجع الإلكتروني: </span>
                <strong className="font-mono-num text-slate-900">{invoice.paymentRef}</strong>
              </div>
            )}
          </div>
        </section>

        <table className="print-table text-xs">
          <thead>
            <tr>
              <th className="w-10 text-center">#</th>
              <th>اسم الصنف والبيان</th>
              <th className="text-center">الوحدة</th>
              <th className="text-center">الكمية</th>
              <th className="text-left">سعر الوحدة</th>
              <th className="text-left">الخصم</th>
              <th className="text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, idx) => (
              <tr key={item.id}>
                <td className="text-center font-mono-num">{idx + 1}</td>
                <td className="font-semibold">{item.productName}</td>
                <td className="text-center">{item.unit}</td>
                <td className="text-center font-mono-num">{formatNum(item.quantity)}</td>
                <td className="text-left font-mono-num">{formatEGP(item.unitSalePrice)}</td>
                <td className="text-left font-mono-num">
                  {item.discountAmount > 0 ? formatEGP(item.discountAmount) : '—'}
                </td>
                <td className="text-left font-mono-num font-bold">{formatEGP(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Split Treasury Allocations */}
        {invoice.allocations && invoice.allocations.length > 0 && (
          <section className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs space-y-1.5 print-avoid-break">
            <div className="font-bold text-slate-800">تفصيل توزيع السداد على الخزائن المسجلة:</div>
            <div className="grid grid-cols-2 gap-2">
              {invoice.allocations.map((al) => (
                <div
                  key={al.id}
                  className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1.5"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{al.treasuryName}</div>
                    <div className="text-[10px] text-slate-500">
                      {PAYMENT_METHOD_LABELS[al.method]}
                      {al.referenceCode ? ` · مرجع: ${al.referenceCode}` : ''}
                    </div>
                  </div>
                  <div className="font-mono-num font-bold text-slate-900">{formatEGP(al.amount)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex items-start justify-between gap-6 pt-2 print-avoid-break">
          <div className="space-y-2 text-xs text-slate-600 max-w-sm">
            {tpl?.showSha256Hash !== false && (
              <div>
                بصمة التحقق الرقمية (SHA-256):
                <div className="font-mono-num text-[10px] text-slate-800 mt-0.5">
                  {invoice.rowHash.slice(0, 36)}...
                </div>
              </div>
            )}
            {tpl?.showBarcode !== false && <BarcodeGraphic code={invoice.invoiceNumber} height={32} />}
          </div>

          <div className="w-72 rounded-lg border border-slate-300 p-3.5 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600">الإجمالي قبل الخصم</span>
              <span className="font-mono-num font-semibold">{formatEGP(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">إجمالي الخصومات</span>
              <span className="font-mono-num font-semibold">{formatEGP(invoice.discountTotal)}</span>
            </div>
            {tpl?.showVatSummary && settings.vatPercent > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>ضريبة القيمة المضافة ({settings.vatPercent}%)</span>
                <span className="font-mono-num">
                  {formatEGP((invoice.grandTotal * settings.vatPercent) / (100 + settings.vatPercent))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold">
              <span>الصافي المطلوب</span>
              <span className="font-mono-num">{formatEGP(invoice.grandTotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>المبلغ المدفوع</span>
              <span className="font-mono-num">{formatEGP(invoice.paidAmount)}</span>
            </div>
            {invoice.changeAmount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>المتبقي للعميل</span>
                <span className="font-mono-num">{formatEGP(invoice.changeAmount)}</span>
              </div>
            )}
          </div>
        </section>

        {tpl?.showSignatureLine && (
          <div className="flex justify-between pt-4 text-xs text-slate-600">
            <span>توقيع المستلم / العميل: ...........................</span>
            <span>اعتماد البائع / الختم: ...........................</span>
          </div>
        )}

        <footer className="border-t border-slate-300 pt-4 text-center text-xs text-slate-600 space-y-1">
          <p className="font-medium text-slate-800">{settings.receiptFooter}</p>
          <p className="text-[10px] text-slate-500">
            صدرت بواسطة نظام تاجر برو · تاريخ الطباعة: {printedAt}
          </p>
        </footer>
      </div>
    );
  }

  if (payload.kind === 'partner_statement_a4') {
    return <PartnerStatementSheet payload={payload} printedAt={printedAt} />;
  }

  if (payload.kind === 'equity_partner_statement') {
    return <EquityPartnerStatementSheet payload={payload} printedAt={printedAt} />;
  }

  if (payload.kind === 'report') {
    return <ReportPrintSheets payload={payload} printedAt={printedAt} />;
  }

  if (payload.kind === 'barcodes') {
    const { items, settings } = payload;
    const expandedStickers = items.flatMap((entry) =>
      Array.from({ length: Math.max(1, entry.copies) }, (_, idx) => ({
        key: `${entry.product.id}-${idx}`,
        product: entry.product,
      }))
    );

    return (
      <div className="print-a4-sheet space-y-3" dir="rtl">
        <div className="flex items-center justify-between border-b border-slate-300 pb-2 text-xs text-slate-600">
          <span className="font-display font-bold text-slate-900">
            ملصقات الأسعار والباركود — {settings.storeName}
          </span>
          <span className="font-mono-num">{expandedStickers.length} ملصق · {printedAt}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {expandedStickers.map(({ key, product }) => (
            <div
              key={key}
              className="print-avoid-break flex flex-col items-center justify-between rounded border border-slate-400 p-2.5 text-center bg-white"
            >
              <div className="text-[10px] font-bold text-slate-700 truncate max-w-full">
                {settings.storeName}
              </div>
              <div className="mt-0.5 text-xs font-bold text-slate-900 line-clamp-1">
                {product.name}
              </div>
              {product.attributeValue && (
                <div className="text-[10px] text-slate-600">{product.attributeValue}</div>
              )}
              <div className="my-1.5">
                <BarcodeGraphic code={product.barcode} height={34} />
              </div>
              <div className="font-mono-num text-sm font-extrabold text-slate-900 border-t border-slate-200 pt-1 w-full">
                {formatEGP(product.currentSalePrice)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (payload.kind === 'purchase_a4') {
    const { purchase, settings } = payload;
    return (
      <div className="print-a4-sheet space-y-5" dir="rtl">
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">{settings.storeName}</h1>
            <div className="mt-1 text-xs text-slate-600">{settings.address}</div>
            <div className="mt-0.5 text-xs text-slate-600 font-mono-num">هاتف: {settings.phone}</div>
          </div>
          <div className="text-left">
            <div className="text-xs font-semibold text-slate-500">إذن استلام بضاعة / فاتورة مشتريات</div>
            <div className="mt-1 font-mono-num text-xl font-bold text-slate-900">
              {purchase.purchaseNumber}
            </div>
            <div className="mt-1 text-xs text-slate-600">{formatDateTimeAr(purchase.createdAt)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs">
          <div>
            <div className="text-slate-500">المورد</div>
            <div className="mt-0.5 font-bold text-slate-900">{purchase.supplierName}</div>
          </div>
          <div>
            <div className="text-slate-500">رقم فاتورة المورد</div>
            <div className="mt-0.5 font-mono-num font-bold text-slate-900">
              {purchase.supplierInvoiceRef || '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">مسؤول الاستلام</div>
            <div className="mt-0.5 font-bold text-slate-900">{purchase.actorName}</div>
          </div>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الصنف</th>
              <th>الوحدة</th>
              <th>الكمية الموردة</th>
              <th>تكلفة الوحدة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((it, idx) => (
              <tr key={it.id}>
                <td className="font-mono-num">{idx + 1}</td>
                <td className="font-semibold">{it.productName}</td>
                <td>{it.unit}</td>
                <td className="font-mono-num">{formatNum(it.quantity)}</td>
                <td className="font-mono-num">{formatEGP(it.unitCost)}</td>
                <td className="font-mono-num font-bold">{formatEGP(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-72 rounded-lg border border-slate-300 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600">إجمالي فاتورة التوريد:</span>
              <strong className="font-mono-num">{formatEGP(purchase.grandTotal)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">المدفوع للمورد:</span>
              <strong className="font-mono-num">{formatEGP(purchase.paidAmount)}</strong>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold">
              <span>المتبقي (آجل للمورد):</span>
              <span className="font-mono-num">{formatEGP(purchase.remainingDebt)}</span>
            </div>
          </div>
        </div>

        {purchase.notes && (
          <div className="text-xs text-slate-700 border-t border-slate-200 pt-2">
            <strong>ملاحظات: </strong>
            {purchase.notes}
          </div>
        )}

        <div className="mt-8 flex justify-between text-xs text-slate-600">
          <span>توقيع أمين المخزن: ....................</span>
          <span>توقيع المورد / المندوب: ....................</span>
        </div>
      </div>
    );
  }

  if (payload.kind === 'expenses_report') {
    const { expenses, settings, printedBy, dateFrom, dateTo, treasuryFilterLabel, template } = payload;
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const catMap = new Map<string, number>();
    for (const ex of expenses) {
      const lbl = EXPENSE_CATEGORY_LABELS[ex.category];
      catMap.set(lbl, (catMap.get(lbl) || 0) + ex.amount);
    }
    const accent = template?.accentColor || '#059669';
    const titleText = template?.headerTitle || 'تقرير المصروفات وحركة الخزينة';
    const subtitleText = template?.headerSubtitle || '';
    const footerText = template?.footerNote || settings.receiptFooter;

    return (
      <div className="print-a4-sheet space-y-5" dir="rtl">
        <div className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: accent }}>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">{settings.storeName}</h1>
            <div className="mt-1 text-xs text-slate-600">
              {settings.address} · هاتف: <span className="font-mono-num">{settings.phone}</span>
            </div>
            {(template?.showTaxNumber ?? settings.printTemplate.showTaxNumber) && settings.taxNumber && (
              <div className="text-xs text-slate-500 font-mono-num">
                الرقم الضريبي: {settings.taxNumber}
              </div>
            )}
          </div>
          <div className="text-left">
            <div className="text-sm font-bold text-slate-900">{titleText}</div>
            {subtitleText && <div className="text-[11px] text-slate-500">{subtitleText}</div>}
            {(dateFrom || dateTo || treasuryFilterLabel) && (
              <div className="mt-1 text-[11px] font-semibold text-slate-700 font-mono-num">
                {dateFrom || dateTo ? `الفترة: ${dateFrom || '...'} إلى ${dateTo || '...'}` : ''}
                {treasuryFilterLabel ? ` · الخزينة: ${treasuryFilterLabel}` : ''}
              </div>
            )}
            <div className="mt-1 text-xs text-slate-600">طُبع بواسطة: {printedBy}</div>
            <div className="text-xs text-slate-500 font-mono-num">{printedAt}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="rounded border border-slate-300 p-3">
            <div className="text-slate-500">عدد بنود المصروفات</div>
            <div className="mt-1 font-mono-num text-base font-bold">{expenses.length}</div>
          </div>
          <div className="rounded border border-slate-300 p-3">
            <div className="text-slate-500">عدد التصنيفات</div>
            <div className="mt-1 font-mono-num text-base font-bold">{catMap.size}</div>
          </div>
          <div className="rounded border border-slate-300 p-3">
            <div className="text-slate-500">إجمالي المصروفات المسجلة</div>
            <div className="mt-1 font-mono-num text-base font-bold">{formatEGP(total)}</div>
          </div>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>البيان</th>
              <th>التصنيف</th>
              <th>الخزينة / جهة الصرف</th>
              <th>المسؤول</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((ex) => (
              <tr key={ex.id}>
                <td className="font-mono-num">{formatDateTimeAr(ex.createdAt)}</td>
                <td>
                  <div className="font-semibold">{ex.title}</div>
                  {ex.receiptRef && (
                    <div className="font-mono-num text-[10px] text-slate-500">مرجع: {ex.receiptRef}</div>
                  )}
                </td>
                <td>{EXPENSE_CATEGORY_LABELS[ex.category]}</td>
                <td>{ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource]}</td>
                <td>{ex.actorName}</td>
                <td className="font-mono-num font-bold">{formatEGP(ex.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {catMap.size > 0 && (
          <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs print-avoid-break">
            <div className="font-bold text-slate-800 mb-1.5">ملخص التوزيع حسب التصنيف:</div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from(catMap.entries()).map(([lbl, val]) => (
                <div key={lbl} className="flex items-center justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-600">{lbl}</span>
                  <span className="font-mono-num font-bold">{formatEGP(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-slate-300 pt-4 text-[11px] text-slate-600 print-avoid-break">
          <div>{footerText}</div>
          {(template?.showSignatureLine ?? settings.printTemplate.showSignatureLine) && (
            <div className="flex gap-8">
              <span>توقيع المحاسب: ....................</span>
              <span>اعتماد المالك: ....................</span>
            </div>
          )}
        </footer>
      </div>
    );
  }

  if (payload.kind === 'quotation_a4') {
    const { quotation, settings, activityName } = payload;
    const tpl = settings.printTemplate;
    const accent = tpl?.accentColor || '#059669';
    const statusLabel =
      quotation.status === 'converted'
        ? 'تم التحويل لفاتورة بيع'
        : quotation.status === 'cancelled'
          ? 'عرض سعر ملغي'
          : quotation.status === 'expired'
            ? 'منتهي الصلاحية'
            : 'ساري المفعول';

    return (
      <div className="print-a4-sheet space-y-5" dir="rtl">
        <header
          className="flex items-start justify-between pb-4"
          style={{ borderBottom: `2px solid ${accent}` }}
        >
          <div className="space-y-1">
            <div className="font-display text-2xl font-bold" style={{ color: accent }}>
              {settings.storeName}
            </div>
            {tpl?.customHeaderNote && (
              <div className="text-xs font-semibold text-slate-700">{tpl.customHeaderNote}</div>
            )}
            <div className="text-xs text-slate-600">النشاط التجاري: {activityName}</div>
            <div className="text-xs text-slate-600">{settings.address}</div>
            <div className="text-xs text-slate-600 font-mono-num">
              هاتف: {settings.phone}
              {tpl?.showTaxNumber !== false && settings.taxNumber
                ? ` · الرقم الضريبي: ${settings.taxNumber}`
                : ''}
            </div>
          </div>

          <div className="text-left space-y-1">
            <div className="font-display text-lg font-bold text-slate-900">
              عرض سعر / فاتورة مبدئية
            </div>
            <div className="font-mono-num text-sm font-bold text-slate-900">
              #{quotation.quotationNumber}
            </div>
            <div className="text-xs text-slate-600">تاريخ الإصدار: {formatDateTimeAr(quotation.createdAt)}</div>
            <div className="text-xs font-semibold text-slate-800 font-mono-num">
              صالح حتى: {quotation.validUntil} · ({statusLabel})
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-xs">
          <div className="space-y-1">
            <div>
              <span className="text-slate-500">موجه إلى العميل: </span>
              <strong className="text-slate-900">{quotation.customerName}</strong>
            </div>
            {quotation.customerPhone && (
              <div>
                <span className="text-slate-500">هاتف العميل: </span>
                <strong className="font-mono-num text-slate-900">{quotation.customerPhone}</strong>
              </div>
            )}
          </div>
          <div className="space-y-1">
            {tpl?.showCashierName !== false && (
              <div>
                <span className="text-slate-500">محرر العرض: </span>
                <strong className="text-slate-900">{quotation.createdBy || 'إدارة المبيعات'}</strong>
              </div>
            )}
            <div>
              <span className="text-slate-500">حالة المخزون: </span>
              <strong className="text-slate-900">عرض تسعيري غير مخصوم من المخزون لحين الاعتماد</strong>
            </div>
          </div>
        </section>

        <table className="print-table text-xs">
          <thead>
            <tr>
              <th className="w-10 text-center">#</th>
              <th>الصنف والبيان</th>
              <th className="text-center">الوحدة</th>
              <th className="text-center">شريحة السعر</th>
              <th className="text-center">الكمية</th>
              <th className="text-left">سعر الوحدة</th>
              <th className="text-left">الخصم</th>
              <th className="text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item, idx) => (
              <tr key={`${item.productId}-${idx}`}>
                <td className="text-center font-mono-num">{idx + 1}</td>
                <td>
                  <div className="font-semibold">{item.productName}</div>
                  {item.sku && (
                    <div className="font-mono-num text-[10px] text-slate-500">{item.sku}</div>
                  )}
                </td>
                <td className="text-center">{item.unit}</td>
                <td className="text-center">{PRICE_TIER_LABELS[item.priceTier] || 'بيع'}</td>
                <td className="text-center font-mono-num">{formatNum(item.quantity)}</td>
                <td className="text-left font-mono-num">{formatEGP(item.unitSalePrice)}</td>
                <td className="text-left font-mono-num">
                  {item.discountAmount > 0 ? formatEGP(item.discountAmount) : '—'}
                </td>
                <td className="text-left font-mono-num font-bold">{formatEGP(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="flex items-start justify-between gap-6 pt-2 print-avoid-break">
          <div className="space-y-2 text-xs text-slate-600 max-w-sm">
            {quotation.notes && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                <strong className="block mb-0.5">شروط وملاحظات العرض:</strong>
                <span>{quotation.notes}</span>
              </div>
            )}
            {tpl?.showBarcode !== false && <BarcodeGraphic code={quotation.quotationNumber} height={32} />}
          </div>

          <div className="w-72 rounded-lg border border-slate-300 p-3.5 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600">إجمالي البنود</span>
              <span className="font-mono-num font-semibold">{formatEGP(quotation.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">الخصم الممنوح</span>
              <span className="font-mono-num font-semibold">{formatEGP(quotation.discountTotal)}</span>
            </div>
            {tpl?.showVatSummary && settings.vatPercent > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>ضريبة القيمة المضافة ({settings.vatPercent}%)</span>
                <span className="font-mono-num">
                  {formatEGP((quotation.grandTotal * settings.vatPercent) / (100 + settings.vatPercent))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold">
              <span>إجمالي عرض السعر</span>
              <span className="font-mono-num">{formatEGP(quotation.grandTotal)}</span>
            </div>
          </div>
        </section>

        {tpl?.showSignatureLine && (
          <div className="flex justify-between pt-4 text-xs text-slate-600">
            <span>توقيع العميل بالموافقة: ...........................</span>
            <span>اعتماد المبيعات / الختم: ...........................</span>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-slate-300 pt-3 text-[11px] text-slate-500">
          <span>هذا المستند عرض سعر مبدئي لا يُعد فاتورة بيع نهائية إلا بعد الاعتماد والتحويل.</span>
          <span className="font-mono-num">طُبع بتاريخ: {printedAt}</span>
        </footer>
      </div>
    );
  }

  const { closure, settings } = payload;
  return (
    <div className="print-thermal-80mm" dir="rtl">
      <div className="text-center border-b border-dashed border-slate-500 pb-2.5">
        <div className="font-display text-base font-bold">{settings.storeName}</div>
        <div className="text-xs font-bold mt-0.5">تقرير تقفيل الوردية وجرد الدرج (Z-Report)</div>
        <div className="text-[10px] text-slate-600 font-mono-num">{formatDateTimeAr(closure.closedAt)}</div>
      </div>

      <div className="my-2 border-b border-dashed border-slate-500 pb-2 text-[11px] space-y-1">
        <div className="flex justify-between">
          <span>المسؤول / الكاشير:</span>
          <strong>{closure.cashierName}</strong>
        </div>
        <div className="flex justify-between">
          <span>بداية الوردية:</span>
          <span className="font-mono-num">{formatDateTimeAr(closure.periodStartAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>عدد الفواتير / المرتجع:</span>
          <span className="font-mono-num">
            {closure.invoiceCount} فاتورة / {closure.returnedCount} مرتجع
          </span>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-500 pb-2">
        <div className="flex justify-between">
          <span>عهدة بداية الوردية:</span>
          <span className="font-mono-num">{formatEGP(closure.openingFloat)}</span>
        </div>
        <div className="flex justify-between">
          <span>مبيعات النقدي (الكاش):</span>
          <span className="font-mono-num font-semibold">{formatEGP(closure.cashSales)}</span>
        </div>
        {(closure.cashCollections || 0) > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>تحصيلات آجل نقدية:</span>
            <span className="font-mono-num font-semibold">+{formatEGP(closure.cashCollections || 0)}</span>
          </div>
        )}
        {(closure.cashReturns || 0) > 0 && (
          <div className="flex justify-between text-rose-700">
            <span>مرتجعات مبيعات نقدية:</span>
            <span className="font-mono-num font-semibold">-{formatEGP(closure.cashReturns || 0)}</span>
          </div>
        )}
        {(closure.cashExpenses || 0) > 0 && (
          <div className="flex justify-between text-rose-700">
            <span>مصروفات مسحوبة من الدرج:</span>
            <span className="font-mono-num font-semibold">-{formatEGP(closure.cashExpenses || 0)}</span>
          </div>
        )}
        {(closure.cashSupplierPayouts || 0) > 0 && (
          <div className="flex justify-between text-rose-700">
            <span>سداد موردين نقدي من الدرج:</span>
            <span className="font-mono-num font-semibold">-{formatEGP(closure.cashSupplierPayouts || 0)}</span>
          </div>
        )}
        {(closure.cashEquityDrawings || 0) > 0 && (
          <div className="flex justify-between text-rose-700">
            <span>مسحوبات شركاء نقدية من الدرج:</span>
            <span className="font-mono-num font-semibold">-{formatEGP(closure.cashEquityDrawings || 0)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold border-t border-slate-300 pt-1">
          <span>النقدي المتوقع بالدرج:</span>
          <span className="font-mono-num">{formatEGP(closure.expectedCash)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>الجرد الفعلي بالدرج:</span>
          <span className="font-mono-num">{formatEGP(closure.actualCash)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>الفرق (عجز / زيادة):</span>
          <span className="font-mono-num">
            {closure.variance === 0
              ? 'متطابق (0 ج.م)'
              : closure.variance > 0
                ? `زيادة +${formatEGP(closure.variance)}`
                : `عجز ${formatEGP(closure.variance)}`}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-[11px] border-b border-dashed border-slate-500 pb-2">
        <div className="font-bold">ملخص التحصيل الإلكتروني والآجل:</div>
        <div className="flex justify-between">
          <span>إنستا باي (InstaPay):</span>
          <span className="font-mono-num">{formatEGP(closure.instapayTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>محافظ إلكترونية:</span>
          <span className="font-mono-num">{formatEGP(closure.walletTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>فيزا / ماكينة بنكية:</span>
          <span className="font-mono-num">{formatEGP(closure.cardTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>مبيعات آجل (عملاء):</span>
          <span className="font-mono-num">{formatEGP(closure.creditTotal)}</span>
        </div>
      </div>

      {closure.notes && (
        <div className="mt-2 text-[10px]">
          <strong>ملاحظات: </strong>
          {closure.notes}
        </div>
      )}

      <div className="mt-4 pt-2 flex justify-between text-[10px]">
        <span>توقيع الكاشير: ............</span>
        <span>اعتماد الإدارة: ............</span>
      </div>
    </div>
  );
}
