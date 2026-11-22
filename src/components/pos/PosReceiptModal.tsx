import { CheckCircle2, Copy, Eye, MessageCircle, Printer, X } from 'lucide-react';
import { useState } from 'react';
import type { PrintDocumentPayload } from '../../context/PrintContext';
import type { Customer, Invoice, StoreSettings } from '../../shared/types';
import {
  formatDateTimeAr,
  formatEGP,
  formatNum,
  PAYMENT_METHOD_LABELS,
} from '../../utils/formatters';
import {
  buildWhatsAppUrl,
  copyTextToClipboard,
  formatInvoiceWhatsAppText,
} from '../../utils/whatsappShare';

interface CustomerQuickProfileModalProps {
  customer: Customer | null;
  onClose: () => void;
}

export function CustomerQuickProfileModal({ customer, onClose }: CustomerQuickProfileModalProps) {
  if (!customer) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            بيانات العميل: {customer.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <div className="text-slate-500">رقم الهاتف</div>
            <div className="mt-1 font-mono-num font-bold text-slate-900 dark:text-white">
              {customer.phone}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <div className="text-slate-500">الرصيد الآجل المستحق</div>
            <div className="mt-1 font-mono-num font-bold text-rose-600 dark:text-rose-400">
              {formatEGP(customer.balanceDue)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <div className="text-slate-500">نقاط الولاء المتاحة</div>
            <div className="mt-1 font-mono-num font-bold text-amber-600 dark:text-amber-400">
              {formatNum(customer.loyaltyPoints || 0)} نقطة
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <div className="text-slate-500">الرصيد الدائن (Store Credit)</div>
            <div className="mt-1 font-mono-num font-bold text-sky-600 dark:text-sky-400">
              {formatEGP(customer.storeCreditBalance || 0)}
            </div>
          </div>
        </div>

        {(customer.creditLimit || 0) > 0 && (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">الحد الائتماني المسموح</span>
              <span className="font-mono-num font-semibold">
                {formatEGP(customer.balanceDue)} / {formatEGP(customer.creditLimit || 0)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full ${
                  customer.balanceDue > (customer.creditLimit || 1) ? 'bg-rose-600' : 'bg-emerald-600'
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    (customer.balanceDue / Math.max(1, customer.creditLimit || 1)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="text-xs text-slate-500 flex justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
          <span>
            إجمالي المشتريات:{' '}
            <strong className="font-mono-num">{formatEGP(customer.totalPurchases)}</strong>
          </span>
          <span>
            آخر شراء: {customer.lastPurchaseAt ? formatDateTimeAr(customer.lastPurchaseAt) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface PosReceiptModalProps {
  invoice: Invoice | null;
  customer?: Customer;
  settings: StoreSettings;
  activityName: string;
  onClose: () => void;
  onPrint: (payload: PrintDocumentPayload) => void;
  onPreview: (payload: PrintDocumentPayload) => void;
}

export function PosReceiptModal({
  invoice,
  customer,
  settings,
  activityName,
  onClose,
  onPrint,
  onPreview,
}: PosReceiptModalProps) {
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  if (!invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="no-print flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            <span>تم حفظ الفاتورة وتحديث المخزون لحظياً</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-center">
          <div className="font-display text-lg font-bold text-slate-900 dark:text-white">
            {settings.storeName}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {settings.address} · {settings.phone}
          </div>
          <div className="flex justify-between text-xs border-y border-dashed border-slate-300 py-2 dark:border-slate-700">
            <span>
              فاتورة: <strong className="font-mono-num">{invoice.invoiceNumber}</strong>
            </span>
            <span>{formatDateTimeAr(invoice.createdAt)}</span>
          </div>

          <div className="space-y-1.5 text-right text-xs">
            {invoice.items.map((it) => (
              <div key={it.id} className="flex justify-between">
                <span>
                  {it.productName} ({formatNum(it.quantity)} {it.unit})
                </span>
                <span className="font-mono-num font-semibold">{formatEGP(it.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-300 pt-2 dark:border-slate-700 space-y-1 text-sm">
            <div className="flex justify-between font-bold">
              <span>الإجمالي</span>
              <span className="font-mono-num">{formatEGP(invoice.grandTotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>طريقة الدفع</span>
              <span>{PAYMENT_METHOD_LABELS[invoice.paymentMethod]}</span>
            </div>
            {invoice.allocations && invoice.allocations.length > 0 && (
              <div className="border-t border-dashed border-slate-200 pt-1.5 space-y-1 text-right text-[11px] dark:border-slate-800">
                <div className="font-bold text-slate-600 dark:text-slate-300">توزيع سداد الخزائن:</div>
                {invoice.allocations.map((al) => (
                  <div key={al.id} className="flex justify-between">
                    <span>{al.treasuryName}</span>
                    <span className="font-mono-num font-semibold">{formatEGP(al.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {invoice.paymentRef && (
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>المرجع الإلكتروني</span>
                <span className="font-mono-num">{invoice.paymentRef}</span>
              </div>
            )}
          </div>

          <p className="pt-2 text-[11px] text-slate-400">{settings.receiptFooter}</p>
        </div>

        <div className="no-print mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              onPreview({
                kind: 'invoice_thermal',
                invoice,
                settings,
              })
            }
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            <Eye className="h-4 w-4" />
            <span>معاينة</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onPrint({
                kind: 'invoice_thermal',
                invoice,
                settings,
              })
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
          >
            <Printer className="h-4 w-4" />
            <span>طباعة (80mm)</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onPrint({
                kind: 'invoice_a4',
                invoice,
                settings,
                activityName,
              })
            }
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            <Printer className="h-4 w-4" />
            <span>A4</span>
          </button>
          <a
            href={buildWhatsAppUrl(
              customer?.phone,
              formatInvoiceWhatsAppText(invoice, settings.storeName, settings.phone)
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400"
          >
            <MessageCircle className="h-4 w-4" />
            <span>واتساب</span>
          </a>
          <button
            type="button"
            onClick={async () => {
              const ok = await copyTextToClipboard(
                formatInvoiceWhatsAppText(invoice, settings.storeName, settings.phone)
              );
              if (ok) {
                setCopiedReceipt(true);
                setTimeout(() => setCopiedReceipt(false), 2000);
              }
            }}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            <Copy className="h-4 w-4" />
            <span>{copiedReceipt ? 'نُسخ' : 'نسخ'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            فاتورة جديدة
          </button>
        </div>
      </div>
    </div>
  );
}
