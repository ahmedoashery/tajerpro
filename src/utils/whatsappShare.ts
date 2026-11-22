import type { Customer, Invoice, SalesQuotation } from '../shared/types';
import { formatDateTimeAr, formatEGP, formatNum, PAYMENT_METHOD_LABELS } from './formatters';

export function normalizeEgyptWhatsAppPhone(phone?: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('01') && digits.length === 11) {
    return `2${digits}`;
  }
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  return digits;
}

export function buildWhatsAppUrl(phone: string | undefined, message: string): string {
  const normalized = normalizeEgyptWhatsAppPhone(phone);
  const encoded = encodeURIComponent(message);
  return normalized ? `https://wa.me/${normalized}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function formatInvoiceWhatsAppText(
  invoice: Invoice,
  storeName: string,
  storePhone?: string
): string {
  const lines: string[] = [
    `*${storeName}*`,
    `فاتورة مبيعات رقم: ${invoice.invoiceNumber}`,
    `التاريخ: ${formatDateTimeAr(invoice.createdAt)}`,
    `العميل: ${invoice.customerName}`,
    '--------------------',
  ];

  for (const it of invoice.items) {
    const activeQty = Math.max(0, it.quantity - (it.returnedQuantity || 0));
    lines.push(`• ${it.productName} (${formatNum(activeQty)} ${it.unit}) = ${formatEGP(it.lineTotal)}`);
  }

  lines.push('--------------------');
  if (invoice.discountTotal > 0) {
    lines.push(`الخصم: ${formatEGP(invoice.discountTotal)}`);
  }
  lines.push(`*الإجمالي الصافي: ${formatEGP(invoice.grandTotal)}*`);
  lines.push(`وسيلة السداد: ${PAYMENT_METHOD_LABELS[invoice.paymentMethod]}`);
  if (invoice.dueDate) {
    lines.push(`تاريخ الاستحقاق: ${invoice.dueDate}`);
  }
  if (storePhone) {
    lines.push(`للتواصل: ${storePhone}`);
  }
  return lines.join('\n');
}

export function formatQuotationWhatsAppText(
  quotation: SalesQuotation,
  storeName: string,
  storePhone?: string
): string {
  const lines: string[] = [
    `*${storeName}*`,
    `عرض سعر / فاتورة مبدئية رقم: ${quotation.quotationNumber}`,
    `التاريخ: ${formatDateTimeAr(quotation.createdAt)}`,
    `العميل: ${quotation.customerName}`,
    `ساري حتى: ${quotation.validUntil}`,
    '--------------------',
  ];

  for (const it of quotation.items) {
    lines.push(
      `• ${it.productName} (${formatNum(it.quantity)} ${it.unit} × ${formatEGP(it.unitSalePrice)}) = ${formatEGP(it.lineTotal)}`
    );
  }

  lines.push('--------------------');
  if (quotation.discountTotal > 0) {
    lines.push(`الإجمالي قبل الخصم: ${formatEGP(quotation.subtotal)}`);
    lines.push(`الخصم: ${formatEGP(quotation.discountTotal)}`);
  }
  lines.push(`*إجمالي عرض السعر: ${formatEGP(quotation.grandTotal)}*`);
  if (quotation.notes) {
    lines.push(`ملاحظات: ${quotation.notes}`);
  }
  if (storePhone) {
    lines.push(`للتواصل والاعتماد: ${storePhone}`);
  }
  return lines.join('\n');
}

export function formatCustomerReminderText(customer: Customer, storeName: string): string {
  return [
    `تحية طيبة أ/ ${customer.name}،`,
    `نذكركم بلطف بوجود رصيد مستحق بقيمة *${formatEGP(customer.balanceDue)}* لدى *${storeName}*.`,
    'يسعدنا تواصلكم لتنسيق السداد في الوقت المناسب لكم. شكراً لتعاملكم معنا.',
  ].join('\n');
}

export function formatPartnerStatementSummaryText(params: {
  partnerType: 'customer' | 'supplier';
  partnerName: string;
  storeName: string;
  storePhone?: string;
  periodLabel: string;
  openingBalance: number;
  periodVolume: number;
  periodPaid: number;
  periodReturns: number;
  closingBalance: number;
}): string {
  const kindLabel = params.partnerType === 'customer' ? 'العميل' : 'المورد';
  const volumeLabel = params.partnerType === 'customer' ? 'إجمالي الفواتير' : 'إجمالي التوريدات';
  const balanceStatus =
    params.closingBalance === 0
      ? 'خالص الحساب'
      : params.partnerType === 'customer'
        ? params.closingBalance > 0
          ? 'مستحق على العميل'
          : 'رصيد دائن للعميل'
        : params.closingBalance > 0
          ? 'مستحق للمورد'
          : 'رصيد مدفوع مقدماً';

  const lines = [
    `*${params.storeName}* — ملخص كشف حساب`,
    `${kindLabel}: *${params.partnerName}*`,
    `الفترة: ${params.periodLabel}`,
    '--------------------',
    ...(params.openingBalance !== 0 ? [`رصيد سابق مرحّل: ${formatEGP(params.openingBalance)}`] : []),
    `${volumeLabel}: ${formatEGP(params.periodVolume)}`,
    `إجمالي السداد/التحصيل: ${formatEGP(params.periodPaid)}`,
    ...(params.periodReturns > 0 ? [`المرتجعات: ${formatEGP(params.periodReturns)}`] : []),
    `*الرصيد الختامي: ${formatEGP(params.closingBalance)}* (${balanceStatus})`,
  ];
  if (params.storePhone) {
    lines.push(`للاستفسار: ${params.storePhone}`);
  }
  return lines.join('\n');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
