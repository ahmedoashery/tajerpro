import {
  Award,
  Camera,
  CheckCircle2,
  Copy,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  MessageCircle,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { PRICE_TIER_LABELS, resolveTierUnitPrice } from '../shared/pricingUtils';
import { buildPromotionItemsFromCart, findBestPromotion } from '../shared/promotionEngine';
import type {
  Customer,
  Invoice,
  PaymentGatewayConfig,
  PaymentMethod,
  PriceTier,
  Product,
  SalesQuotation,
  StaffUser,
  StoreActivityProfile,
  StorePromotion,
  StoreSettings,
  TreasuryAccount,
  TreasuryType,
} from '../shared/types';
import {
  formatDateTimeAr,
  formatEGP,
  formatNum,
  PAYMENT_METHOD_LABELS,
  TREASURY_TYPE_LABELS,
} from '../utils/formatters';
import { matchScaleBarcode } from '../utils/scaleBarcode';
import {
  buildWhatsAppUrl,
  copyTextToClipboard,
  formatInvoiceWhatsAppText,
  formatQuotationWhatsAppText,
} from '../utils/whatsappShare';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { QuotationsPanel } from './invoices/QuotationsPanel';
import { ManagerOverrideModal } from './pos/ManagerOverrideModal';
import { SearchableSelect, type SearchableSelectOption } from './ui/SearchableSelect';

interface DesktopSalesInvoiceViewProps {
  products: Product[];
  customers: Customer[];
  treasuries: TreasuryAccount[];
  promotions?: StorePromotion[];
  quotations?: SalesQuotation[];
  requestedMode?: { mode: 'editor' | 'quotations'; seq: number } | null;
  activeActivity: StoreActivityProfile;
  settings: StoreSettings;
  paymentConfig: PaymentGatewayConfig;
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onCheckoutSuccess: (invoice: Invoice) => void;
  onQuotationMutated?: (msg: string) => void;
}

interface InvoiceGridRow {
  rowId: string;
  productId: string;
  priceTier: PriceTier;
  quantity: number;
  unitSalePrice: number;
  discountAmount: number;
}

interface SplitAllocationDraft {
  rowId: string;
  treasuryId: string;
  amount: string;
  referenceCode: string;
}

const METHOD_TO_TREASURY_TYPE: Record<string, TreasuryType> = {
  cash: 'cash_drawer',
  instapay: 'instapay',
  vodafone_cash: 'wallet',
  card: 'bank_pos',
};

const TREASURY_TYPE_TO_METHOD: Record<TreasuryType, Exclude<PaymentMethod, 'split' | 'credit'>> = {
  cash_drawer: 'cash',
  instapay: 'instapay',
  wallet: 'vodafone_cash',
  bank_pos: 'card',
};

function makeEmptyRow(defaultTier: 'retail' | 'half_wholesale' | 'wholesale' = 'retail'): InvoiceGridRow {
  return {
    rowId: `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    productId: '',
    priceTier: defaultTier,
    quantity: 1,
    unitSalePrice: 0,
    discountAmount: 0,
  };
}

export function DesktopSalesInvoiceView({
  products,
  customers,
  treasuries,
  promotions = [],
  quotations = [],
  requestedMode = null,
  activeActivity,
  settings,
  paymentConfig,
  currentUser,
  apiFetch,
  onCheckoutSuccess,
  onQuotationMutated,
}: DesktopSalesInvoiceViewProps) {
  const { printDocument, openPrintPreview } = usePrint();

  const [viewMode, setViewMode] = useState<'editor' | 'quotations'>('editor');
  const [validDays, setValidDays] = useState<number>(7);
  const [savingQuotation, setSavingQuotation] = useState<boolean>(false);
  const [savedQuotation, setSavedQuotation] = useState<SalesQuotation | null>(null);
  const [activeQuotationId, setActiveQuotationId] = useState<string | null>(null);
  const [activeQuotationNumber, setActiveQuotationNumber] = useState<string | null>(null);

  const [defaultTier, setDefaultTier] = useState<'retail' | 'half_wholesale' | 'wholesale'>('retail');
  const [tierApplyScope, setTierApplyScope] = useState<'selected' | 'all'>('all');
  const [rows, setRows] = useState<InvoiceGridRow[]>(() => [makeEmptyRow('retail'), makeEmptyRow('retail')]);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});

  const [customerId, setCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState<string>('');
  const [splitRows, setSplitRows] = useState<SplitAllocationDraft[]>([]);
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<string>('');

  const [applyPromotion, setApplyPromotion] = useState<boolean>(true);
  const [redeemPoints, setRedeemPoints] = useState<boolean>(false);
  const [useStoreCredit, setUseStoreCredit] = useState<boolean>(false);

  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState<boolean>(false);
  const [activeCustomerDiscountPct, setActiveCustomerDiscountPct] = useState<number | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState<boolean>(false);
  const [pendingPrintTarget, setPendingPrintTarget] = useState<'none' | 'a4' | 'thermal'>('none');
  const [overrideApproval, setOverrideApproval] = useState<{
    authorizerName: string;
    maxApprovedDiscount: number;
  } | null>(null);

  useEffect(() => {
    if (requestedMode) {
      setViewMode(requestedMode.mode);
    }
  }, [requestedMode]);

  const activeQuotationsCount = useMemo(
    () => quotations.filter((q) => q.status === 'active').length,
    [quotations]
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const activeTreasuries = useMemo(() => treasuries.filter((t) => t.active), [treasuries]);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );

  useEffect(() => {
    setRedeemPoints(false);
    setUseStoreCredit(false);
  }, [customerId]);

  const matchingTreasuries = useMemo(() => {
    const tType = METHOD_TO_TREASURY_TYPE[paymentMethod];
    if (!tType) return [];
    return activeTreasuries.filter((t) => t.type === tType);
  }, [activeTreasuries, paymentMethod]);

  useEffect(() => {
    if (paymentMethod === 'credit' || paymentMethod === 'split') return;
    if (matchingTreasuries.length === 0) {
      setSelectedTreasuryId('');
      return;
    }
    if (!matchingTreasuries.some((t) => t.id === selectedTreasuryId)) {
      const def = matchingTreasuries.find((t) => t.isDefault) || matchingTreasuries[0];
      setSelectedTreasuryId(def.id);
    }
  }, [paymentMethod, matchingTreasuries, selectedTreasuryId]);

  const productOptions = useMemo<SearchableSelectOption[]>(
    () =>
      products.map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: `${p.barcode} · بيع ${formatEGP(p.currentSalePrice)} · جملة ${formatEGP(p.wholesalePrice)} · متاح ${formatNum(p.stockQty)} ${p.unit}`,
      })),
    [products]
  );

  const customerOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: '', label: 'عميل نقدي سريع (بدون حساب آجل)' },
      ...customers.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: `${c.phone}${c.balanceDue > 0 ? ` · متبقي ${formatEGP(c.balanceDue)}` : ''}${Number(c.storeCreditBalance || 0) > 0 ? ` · محفظة ${formatEGP(c.storeCreditBalance || 0)}` : ''}`,
      })),
    ],
    [customers]
  );

  const filledRows = useMemo(
    () =>
      rows.filter((r) => {
        const prod = productById.get(r.productId);
        return Boolean(prod) && r.quantity > 0;
      }),
    [rows, productById]
  );

  const selectedCount = useMemo(
    () => rows.filter((r) => selectedRowIds[r.rowId]).length,
    [rows, selectedRowIds]
  );

  // Automatic scope switch: when rows are checked, default scope helps target them smoothly
  useEffect(() => {
    if (selectedCount > 0 && tierApplyScope === 'all') {
      setTierApplyScope('selected');
    } else if (selectedCount === 0 && tierApplyScope === 'selected') {
      setTierApplyScope('all');
    }
  }, [selectedCount]);

  // Financial Calculations
  const subtotal = useMemo(() => {
    return Number(
      filledRows
        .reduce((sum, r) => sum + Number((r.unitSalePrice * r.quantity).toFixed(2)), 0)
        .toFixed(2)
    );
  }, [filledRows]);

  const itemDiscountsTotal = useMemo(() => {
    return Number(
      filledRows
        .reduce((sum, r) => {
          const gross = Number((r.unitSalePrice * r.quantity).toFixed(2));
          return sum + Math.min(gross, Math.max(0, Number(r.discountAmount || 0)));
        }, 0)
        .toFixed(2)
    );
  }, [filledRows]);

  const afterItemDiscTotal = Number(Math.max(0, subtotal - itemDiscountsTotal).toFixed(2));

  const matchedPromo = useMemo(() => {
    if (!applyPromotion || filledRows.length === 0) {
      return { promotion: null, discountAmount: 0 };
    }
    const itemsForPromo = buildPromotionItemsFromCart(
      filledRows
        .map((r) => {
          const prod = productById.get(r.productId);
          if (!prod) return null;
          const gross = Number((r.unitSalePrice * r.quantity).toFixed(2));
          const clampedDisc = Math.min(gross, Math.max(0, Number(r.discountAmount || 0)));
          return {
            product: prod,
            quantity: r.quantity,
            unitSalePrice: r.unitSalePrice,
            lineTotal: Number(Math.max(0, gross - clampedDisc).toFixed(2)),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    );
    return findBestPromotion(promotions, itemsForPromo);
  }, [applyPromotion, filledRows, productById, promotions]);

  const promotionDiscount = Math.min(afterItemDiscTotal, matchedPromo.discountAmount);
  const afterPromoTotal = Number(Math.max(0, afterItemDiscTotal - promotionDiscount).toFixed(2));

  useEffect(() => {
    if (activeCustomerDiscountPct === null) return;
    if (activeCustomerDiscountPct <= 0) {
      setInvoiceDiscount(0);
      return;
    }
    setInvoiceDiscount(Number(((afterPromoTotal * activeCustomerDiscountPct) / 100).toFixed(2)));
  }, [activeCustomerDiscountPct, afterPromoTotal]);

  const handleCustomerChange = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId);
    setOverrideApproval(null);
    const cust = customers.find((c) => c.id === nextCustomerId) || null;
    const targetTier: 'retail' | 'half_wholesale' | 'wholesale' =
      cust?.defaultPriceTier === 'wholesale' || cust?.defaultPriceTier === 'half_wholesale'
        ? cust.defaultPriceTier
        : 'retail';
    setDefaultTier(targetTier);
    setRows((prev) =>
      prev.map((r) => {
        if (r.priceTier === 'custom') return r;
        const prod = productById.get(r.productId);
        if (!prod) return { ...r, priceTier: targetTier };
        const nextPrice = resolveTierUnitPrice(prod, targetTier);
        const gross = Number((nextPrice * r.quantity).toFixed(2));
        return {
          ...r,
          priceTier: targetTier,
          unitSalePrice: nextPrice,
          discountAmount: Math.min(r.discountAmount, gross),
        };
      })
    );
    const discPct = Number(cust?.defaultDiscountPercent || 0);
    if (discPct > 0) {
      setActiveCustomerDiscountPct(discPct);
    } else {
      setActiveCustomerDiscountPct(null);
      setInvoiceDiscount(0);
    }
  };

  const clampedInvoiceDiscount = Number(
    Math.min(afterPromoTotal, Math.max(0, Number(invoiceDiscount || 0))).toFixed(2)
  );
  const afterManualDiscTotal = Number(Math.max(0, afterPromoTotal - clampedInvoiceDiscount).toFixed(2));

  const loyaltyCfg = settings.loyaltyConfig || {
    enabled: true,
    earnRateEgpPerPoint: 50,
    pointValueEgp: 1,
    minRedeemPoints: 10,
  };

  const loyaltyStats = useMemo(() => {
    if (!selectedCustomer || !loyaltyCfg.enabled) {
      return { availablePoints: 0, pointsUsed: 0, discountEgp: 0, canRedeem: false };
    }
    const availablePoints = Number(selectedCustomer.loyaltyPoints || 0);
    const canRedeem = availablePoints >= loyaltyCfg.minRedeemPoints && afterManualDiscTotal > 0;
    if (!redeemPoints || !canRedeem) {
      return { availablePoints, pointsUsed: 0, discountEgp: 0, canRedeem };
    }
    const pointVal = Math.max(0.01, Number(loyaltyCfg.pointValueEgp || 1));
    const maxRedeemValue = Number((availablePoints * pointVal).toFixed(2));
    const discountEgp = Number(Math.min(afterManualDiscTotal, maxRedeemValue).toFixed(2));
    const pointsUsed = Number(Math.min(availablePoints, Math.ceil(discountEgp / pointVal)).toFixed(2));
    return { availablePoints, pointsUsed, discountEgp, canRedeem };
  }, [selectedCustomer, loyaltyCfg, redeemPoints, afterManualDiscTotal]);

  const grandTotal = Number(Math.max(0, afterManualDiscTotal - loyaltyStats.discountEgp).toFixed(2));

  const storeCreditApplied = useMemo(() => {
    if (!useStoreCredit || !selectedCustomer || Number(selectedCustomer.storeCreditBalance || 0) <= 0) {
      return 0;
    }
    return Number(Math.min(grandTotal, Number(selectedCustomer.storeCreditBalance || 0)).toFixed(2));
  }, [useStoreCredit, selectedCustomer, grandTotal]);

  const remainingAfterStoreCredit = Number(Math.max(0, grandTotal - storeCreditApplied).toFixed(2));

  const numericPaid = paidAmount === '' ? remainingAfterStoreCredit : Number(paidAmount);
  const changeAmount =
    paymentMethod === 'cash' && Number.isFinite(numericPaid)
      ? Number(Math.max(0, numericPaid - remainingAfterStoreCredit).toFixed(2))
      : 0;

  const splitTotalEntered = useMemo(
    () => Number(splitRows.reduce((s, r) => s + Math.max(0, Number(r.amount || 0)), 0).toFixed(2)),
    [splitRows]
  );

  const splitCardFeeEstimate = useMemo(() => {
    return Number(
      splitRows
        .reduce((sum, r) => {
          const tr = activeTreasuries.find((t) => t.id === r.treasuryId);
          if (tr?.type === 'bank_pos') {
            return sum + (Math.max(0, Number(r.amount || 0)) * paymentConfig.cardFeePercent) / 100;
          }
          return sum;
        }, 0)
        .toFixed(2)
    );
  }, [splitRows, activeTreasuries, paymentConfig.cardFeePercent]);

  const hasCreditAllocation =
    paymentMethod === 'credit' ||
    (paymentMethod === 'split' && splitRows.some((r) => r.treasuryId === '__credit__'));

  // Row Mutations
  const handleSelectProductOnRow = (rowId: string, newProductId: string) => {
    setErrMsg(null);
    setInfoMsg(null);
    const prod = productById.get(newProductId);
    setRows((prev) => {
      const updated = prev.map((r) => {
        if (r.rowId !== rowId) return r;
        if (!prod) {
          return { ...r, productId: '', unitSalePrice: 0, discountAmount: 0 };
        }
        const tier: PriceTier = r.priceTier === 'custom' ? defaultTier : r.priceTier;
        const unitSalePrice = resolveTierUnitPrice(prod, tier);
        return {
          ...r,
          productId: prod.id,
          priceTier: tier,
          unitSalePrice,
          quantity: r.quantity > 0 ? r.quantity : 1,
          discountAmount: 0,
        };
      });

      // Auto-append a fresh empty row if the last row now has a selected product
      const last = updated[updated.length - 1];
      if (last && last.productId) {
        return [...updated, makeEmptyRow(defaultTier)];
      }
      return updated;
    });
  };

  const handleRowTierChange = (rowId: string, tier: PriceTier) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const prod = productById.get(r.productId);
        if (!prod) return { ...r, priceTier: tier };
        if (tier === 'custom') return { ...r, priceTier: 'custom' };
        const nextPrice = resolveTierUnitPrice(prod, tier);
        const gross = Number((nextPrice * r.quantity).toFixed(2));
        return {
          ...r,
          priceTier: tier,
          unitSalePrice: nextPrice,
          discountAmount: Math.min(r.discountAmount, gross),
        };
      })
    );
  };

  const handleRowQuantityChange = (rowId: string, rawQty: string) => {
    const val = Number(rawQty);
    const qty = Number.isFinite(val) ? Math.max(0, val) : 0;
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const gross = Number((r.unitSalePrice * qty).toFixed(2));
        return {
          ...r,
          quantity: qty,
          discountAmount: Math.min(r.discountAmount, gross),
        };
      })
    );
  };

  const handleRowPriceChange = (rowId: string, rawPrice: string) => {
    const val = Number(rawPrice);
    const price = Number.isFinite(val) ? Math.max(0, Number(val.toFixed(2))) : 0;
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const gross = Number((price * r.quantity).toFixed(2));
        return {
          ...r,
          priceTier: 'custom',
          unitSalePrice: price,
          discountAmount: Math.min(r.discountAmount, gross),
        };
      })
    );
  };

  const handleRowDiscountChange = (rowId: string, rawDisc: string) => {
    const val = Number(rawDisc);
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const gross = Number((r.unitSalePrice * r.quantity).toFixed(2));
        const clamped = Number.isFinite(val) ? Math.min(gross, Math.max(0, Number(val.toFixed(2)))) : 0;
        return { ...r, discountAmount: clamped };
      })
    );
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, makeEmptyRow(defaultTier)]);
  };

  const handleDeleteRow = (rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    setRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [makeEmptyRow(defaultTier)];
    });
  };

  const handleDeleteSelectedRows = () => {
    if (selectedCount === 0) return;
    setRows((prev) => {
      const next = prev.filter((r) => !selectedRowIds[r.rowId]);
      return next.length > 0 ? next : [makeEmptyRow(defaultTier)];
    });
    setSelectedRowIds({});
    setInfoMsg(`تم حذف ${selectedCount} سطر محدد من الفاتورة.`);
  };

  const applyTierBulk = (tier: 'retail' | 'half_wholesale' | 'wholesale') => {
    const targetSelectedOnly = tierApplyScope === 'selected' && selectedCount > 0;
    if (tierApplyScope === 'selected' && selectedCount === 0) {
      setErrMsg('يرجى تحديد صف واحد على الأقل لتطبيق السعر على المحدد، أو اختر (كل أصناف الفاتورة).');
      return;
    }
    setErrMsg(null);
    if (!targetSelectedOnly) {
      setDefaultTier(tier);
    }
    let updatedFilledCount = 0;
    setRows((prev) =>
      prev.map((r) => {
        const shouldUpdate = targetSelectedOnly ? Boolean(selectedRowIds[r.rowId]) : true;
        if (!shouldUpdate) return r;
        const prod = productById.get(r.productId);
        if (!prod) return { ...r, priceTier: tier };
        updatedFilledCount += 1;
        const nextPrice = resolveTierUnitPrice(prod, tier);
        const gross = Number((nextPrice * r.quantity).toFixed(2));
        return {
          ...r,
          priceTier: tier,
          unitSalePrice: nextPrice,
          discountAmount: Math.min(r.discountAmount, gross),
        };
      })
    );
    const scopeText = targetSelectedOnly ? 'الأسطر المحددة' : 'جميع أسطر الفاتورة';
    setInfoMsg(
      `تم تطبيق (${PRICE_TIER_LABELS[tier]}) على ${scopeText} (${updatedFilledCount} صنف) وإعادة احتساب الإجمالي.`
    );
  };

  const handleToggleSelectAll = () => {
    if (rows.length === 0) return;
    const allChecked = rows.every((r) => Boolean(selectedRowIds[r.rowId]));
    if (allChecked) {
      setSelectedRowIds({});
    } else {
      const next: Record<string, boolean> = {};
      rows.forEach((r) => {
        next[r.rowId] = true;
      });
      setSelectedRowIds(next);
    }
  };

  const handleBarcodeEntry = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;
    setErrMsg(null);

    const scaleMatch = matchScaleBarcode(trimmed, products);
    const matchedProd =
      scaleMatch?.product ||
      products.find((p) => p.barcode.trim() === trimmed || p.sku.trim().toLowerCase() === trimmed.toLowerCase());

    if (!matchedProd) {
      setErrMsg(`لم يتم العثور على صنف بالباركود: ${trimmed}`);
      return;
    }

    const addQty = scaleMatch ? scaleMatch.quantity : 1;
    setRows((prev) => {
      // 1) If already present and not scale-weighted, increment qty
      if (!scaleMatch) {
        const idx = prev.findIndex((r) => r.productId === matchedProd.id);
        if (idx >= 0) {
          return prev.map((r, i) =>
            i === idx ? { ...r, quantity: Number((r.quantity + addQty).toFixed(3)) } : r
          );
        }
      }
      // 2) Fill first empty row
      const emptyIdx = prev.findIndex((r) => !r.productId);
      const unitPrice = resolveTierUnitPrice(matchedProd, defaultTier);
      const filledLine: InvoiceGridRow = {
        rowId:
          emptyIdx >= 0
            ? prev[emptyIdx].rowId
            : `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        productId: matchedProd.id,
        priceTier: defaultTier,
        quantity: addQty,
        unitSalePrice: unitPrice,
        discountAmount: 0,
      };

      const next =
        emptyIdx >= 0
          ? prev.map((r, i) => (i === emptyIdx ? filledLine : r))
          : [...prev, filledLine];

      // Always keep an empty trailing row ready
      if (next[next.length - 1]?.productId) {
        return [...next, makeEmptyRow(defaultTier)];
      }
      return next;
    });

    setBarcodeInput('');
    setInfoMsg(
      scaleMatch
        ? `تم قراءة باركود ميزان (${matchedProd.name} × ${formatNum(addQty)} ${matchedProd.unit})`
        : `تم إدراج "${matchedProd.name}" في جدول الفاتورة`
    );
  };

  const resetForm = () => {
    setRows([makeEmptyRow(defaultTier), makeEmptyRow(defaultTier)]);
    setSelectedRowIds({});
    setCustomerId('');
    setDefaultTier('retail');
    setActiveCustomerDiscountPct(null);
    setOverrideApproval(null);
    setPaymentMethod('cash');
    setSplitRows([]);
    setPaymentRef('');
    setDueDate('');
    setNotes('');
    setInvoiceDiscount(0);
    setPaidAmount('');
    setRedeemPoints(false);
    setUseStoreCredit(false);
    setErrMsg(null);
    setInfoMsg(null);
    setSavedInvoice(null);
    setSavedQuotation(null);
    setActiveQuotationId(null);
    setActiveQuotationNumber(null);
  };

  const handleSaveAsQuotation = async () => {
    setErrMsg(null);
    setInfoMsg(null);
    if (filledRows.length === 0) {
      setErrMsg('يرجى إدراج صنف واحد على الأقل لحفظ عرض السعر.');
      return;
    }

    setSavingQuotation(true);
    try {
      const totalExtraDiscount = Number(
        (clampedInvoiceDiscount + promotionDiscount).toFixed(2)
      );
      const res = await apiFetch<{ quotation: SalesQuotation }>('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({
          items: filledRows.map((r) => ({
            productId: r.productId,
            quantity: r.quantity,
            priceTier: r.priceTier,
            unitSalePrice: r.unitSalePrice,
            discountAmount: r.discountAmount,
          })),
          customerId: customerId || null,
          invoiceDiscount: totalExtraDiscount,
          validDays,
          notes: notes.trim() || 'عرض سعر تجاري مبدئي',
        }),
      });
      setSavedInvoice(null);
      setSavedQuotation(res.quotation);
      setInfoMsg(`تم حفظ عرض السعر ${res.quotation.quotationNumber} بنجاح دون خصم من المخزون.`);
      onQuotationMutated?.(`تم حفظ عرض السعر ${res.quotation.quotationNumber}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ عرض السعر');
    } finally {
      setSavingQuotation(false);
    }
  };

  const handleLoadQuotationIntoEditor = (qt: SalesQuotation) => {
    setErrMsg(null);
    setSavedInvoice(null);
    setSavedQuotation(null);
    setActiveCustomerDiscountPct(null);
    setOverrideApproval(null);

    const mappedRows: InvoiceGridRow[] = qt.items
      .filter((it) => productById.has(it.productId))
      .map((it, idx) => ({
        rowId: `qt-row-${Date.now().toString(36)}-${idx}`,
        productId: it.productId,
        priceTier: it.priceTier || 'retail',
        quantity: it.quantity,
        unitSalePrice: it.unitSalePrice,
        discountAmount: it.discountAmount || 0,
      }));

    if (mappedRows.length === 0) {
      setErrMsg(`الأصناف المدرجة في عرض السعر ${qt.quotationNumber} لم تعد متوفرة في الدليل الحالي.`);
      return;
    }

    setRows([...mappedRows, makeEmptyRow(defaultTier)]);
    setSelectedRowIds({});
    setCustomerId(qt.customerId || '');
    setInvoiceDiscount(Number(qt.discountTotal || 0));
    setNotes(qt.notes || `محول من عرض سعر رقم ${qt.quotationNumber}`);
    setActiveQuotationId(qt.id);
    setActiveQuotationNumber(qt.quotationNumber);
    setViewMode('editor');
    setInfoMsg(`تم تحميل عرض السعر ${qt.quotationNumber} إلى المحرر — راجع طريقة السداد ثم اعتمد الفاتورة.`);
  };

  const initializeSplitMode = () => {
    setPaymentMethod('split');
    const firstCash = activeTreasuries.find((t) => t.type === 'cash_drawer' && t.isDefault) || activeTreasuries[0];
    const secondAlt = activeTreasuries.find((t) => t.id !== firstCash?.id) || firstCash;
    const half = Number((remainingAfterStoreCredit / 2).toFixed(2));
    const rem = Number((remainingAfterStoreCredit - half).toFixed(2));
    setSplitRows([
      {
        rowId: `sp-${Date.now()}-1`,
        treasuryId: firstCash?.id || '__credit__',
        amount: String(half),
        referenceCode: '',
      },
      {
        rowId: `sp-${Date.now()}-2`,
        treasuryId: secondAlt?.id || '__credit__',
        amount: String(rem),
        referenceCode: '',
      },
    ]);
  };

  const handleSubmitInvoice = async (
    printTarget: 'none' | 'a4' | 'thermal',
    overrideApprovedBypass = false
  ) => {
    setErrMsg(null);
    setInfoMsg(null);

    if (filledRows.length === 0) {
      setErrMsg('يرجى اختيار صنف واحد على الأقل من القائمة المنسدلة داخل الجدول.');
      return;
    }

    // Guard: non-owner/manager discounts exceeding 10% require Manager/Owner PIN override
    const requiresOverride =
      currentUser.role !== 'owner' &&
      currentUser.role !== 'manager' &&
      clampedInvoiceDiscount > afterPromoTotal * 0.1 + 0.01;
    const alreadyApproved =
      overrideApprovedBypass ||
      (overrideApproval !== null &&
        clampedInvoiceDiscount <= overrideApproval.maxApprovedDiscount + 0.01);

    if (requiresOverride && !alreadyApproved) {
      setPendingPrintTarget(printTarget);
      setOverrideModalOpen(true);
      return;
    }

    // Validate stock availability client-side before submit when negative stock disabled
    if (!settings.allowNegativeStock) {
      const qtyByProduct = new Map<string, number>();
      for (const r of filledRows) {
        qtyByProduct.set(r.productId, Number(((qtyByProduct.get(r.productId) || 0) + r.quantity).toFixed(3)));
      }
      for (const [pid, reqQty] of qtyByProduct.entries()) {
        const prod = productById.get(pid);
        if (prod && reqQty > prod.stockQty) {
          setErrMsg(
            `الكمية المطلوبة من "${prod.name}" (${formatNum(reqQty)}) تتجاوز الرصيد المتاح (${formatNum(prod.stockQty)} ${prod.unit}).`
          );
          return;
        }
      }
    }

    if ((paymentMethod === 'credit' || hasCreditAllocation) && !customerId) {
      setErrMsg('يرجى اختيار عميل مسجل لإتمام الفاتورة الآجلة.');
      return;
    }

    let allocationsPayload:
      | Array<{
          treasuryId?: string | null;
          method: Exclude<PaymentMethod, 'split'>;
          amount: number;
          referenceCode?: string;
        }>
      | undefined;

    if (paymentMethod === 'split' && remainingAfterStoreCredit > 0.001) {
      const validRows = splitRows.filter((r) => Number(r.amount || 0) > 0);
      if (validRows.length === 0) {
        setErrMsg('يرجى إدخال دفعة واحدة على الأقل في جدول الدفع المقسم.');
        return;
      }
      if (Math.abs(splitTotalEntered - remainingAfterStoreCredit) > 0.05) {
        setErrMsg(
          `مجموع الدفعات (${formatEGP(splitTotalEntered)}) لا يطابق الصافي المطلوب (${formatEGP(remainingAfterStoreCredit)}).`
        );
        return;
      }
      allocationsPayload = validRows.map((r) => {
        if (r.treasuryId === '__credit__') {
          return {
            treasuryId: null,
            method: 'credit' as const,
            amount: Number(Number(r.amount).toFixed(2)),
            referenceCode: r.referenceCode.trim(),
          };
        }
        const tr = activeTreasuries.find((t) => t.id === r.treasuryId);
        const m = tr ? TREASURY_TYPE_TO_METHOD[tr.type] : 'cash';
        return {
          treasuryId: tr?.id || null,
          method: m,
          amount: Number(Number(r.amount).toFixed(2)),
          referenceCode: r.referenceCode.trim(),
        };
      });
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ invoice: Invoice }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          items: filledRows.map((r) => ({
            productId: r.productId,
            quantity: r.quantity,
            discountAmount: r.discountAmount,
            priceTier: r.priceTier,
            unitSalePrice: r.unitSalePrice,
          })),
          customerId: customerId || null,
          paymentMethod,
          treasuryId:
            paymentMethod !== 'credit' && paymentMethod !== 'split' ? selectedTreasuryId || null : null,
          allocations: allocationsPayload,
          paymentRef: paymentRef.trim(),
          invoiceDiscount: clampedInvoiceDiscount,
          paidAmount: paymentMethod === 'cash' ? numericPaid : remainingAfterStoreCredit,
          dueDate: hasCreditAllocation ? dueDate || null : null,
          applyPromotion,
          redeemLoyaltyPoints: loyaltyStats.pointsUsed,
          useStoreCredit,
          quotationId: activeQuotationId || undefined,
          notes:
            notes.trim() ||
            (overrideApproval
              ? `فاتورة مكتبية (اعتماد خصم: ${overrideApproval.authorizerName})`
              : activeQuotationNumber
                ? `فاتورة معتمدة من عرض سعر ${activeQuotationNumber}`
                : 'فاتورة مبيعات تفصيلية (جدول الأصناف)'),
          terminalName: `فاتورة مكتبية - ${currentUser.name}`,
        }),
      });

      setOverrideApproval(null);
      setActiveQuotationId(null);
      setActiveQuotationNumber(null);
      setSavedQuotation(null);
      setSavedInvoice(res.invoice);
      setInfoMsg(`تم حفظ واعتماد الفاتورة رقم ${res.invoice.invoiceNumber} بنجاح.`);
      onCheckoutSuccess(res.invoice);

      if (printTarget === 'a4') {
        printDocument({
          kind: 'invoice_a4',
          invoice: res.invoice,
          settings,
          activityName: activeActivity.nameAr,
          customerBalanceDue: selectedCustomer?.balanceDue,
        });
      } else if (printTarget === 'thermal') {
        printDocument({ kind: 'invoice_thermal', invoice: res.invoice, settings });
      } else if (settings.autoPrintAfterSale) {
        printDocument({ kind: 'invoice_thermal', invoice: res.invoice, settings });
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ واعتماد الفاتورة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header Title, Mode Switcher & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <span>
              {viewMode === 'quotations'
                ? 'عروض الأسعار والفواتير المبدئية'
                : 'فاتورة مبيعات مكتبية (جدول الأصناف)'}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {viewMode === 'quotations'
              ? 'إدارة عروض الأسعار المحفوظة، الطباعة والتصدير، المشاركة عبر واتساب، والتحويل المباشر لفاتورة بيع معتمدة'
              : 'اختر الصنف من القائمة المنسدلة لكل سطر ليتم تحميل بياناته وأسعاره تلقائياً مع دعم الحفظ كعرض سعر'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              className={`min-h-[34px] rounded-md px-3 text-xs font-semibold transition-colors ${
                viewMode === 'editor'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              محرر الفاتورة
            </button>
            <button
              type="button"
              onClick={() => setViewMode('quotations')}
              className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                viewMode === 'quotations'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              <FileText className="h-3.5 w-3.5 text-emerald-600" />
              <span>عروض الأسعار ({formatNum(activeQuotationsCount)})</span>
            </button>
          </div>

          {viewMode === 'editor' && (
            <>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة سطر</span>
              </button>

              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Camera className="h-4 w-4 text-emerald-600" />
                <span>مسح باركود</span>
              </button>

              <button
                type="button"
                onClick={resetForm}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                <span>فاتورة جديدة</span>
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'quotations' ? (
        <QuotationsPanel
          quotations={quotations}
          settings={settings}
          activeActivity={activeActivity}
          apiFetch={apiFetch}
          onLoadIntoEditor={handleLoadQuotationIntoEditor}
          onMutated={(msg) => {
            setInfoMsg(msg);
            onQuotationMutated?.(msg);
          }}
          onError={(msg) => setErrMsg(msg)}
        />
      ) : (
        <>

      {/* Active Quotation Conversion Banner */}
      {activeQuotationId && activeQuotationNumber && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs dark:border-sky-900/60 dark:bg-sky-950/30">
          <div className="flex items-center gap-2 text-sky-900 dark:text-sky-200">
            <FileCheck2 className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span>
              جاري التحويل من عرض السعر رقم{' '}
              <strong className="font-mono-num">{activeQuotationNumber}</strong> — عند اعتماد الفاتورة سيتم تحديث حالة العرض إلى "محول لفاتورة" تلقائياً.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveQuotationId(null);
              setActiveQuotationNumber(null);
            }}
            className="rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300"
          >
            فك الربط بالعرض
          </button>
        </div>
      )}

      {/* Post-Save Quotation Confirmation Bar */}
      {savedQuotation && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-sky-600 shrink-0" />
              <div>
                <div className="text-sm font-bold text-sky-900 dark:text-sky-200">
                  تم حفظ عرض السعر {savedQuotation.quotationNumber} — الإجمالي{' '}
                  <span className="font-mono-num">{formatEGP(savedQuotation.grandTotal)}</span>
                </div>
                <div className="text-xs text-sky-700 dark:text-sky-400">
                  {savedQuotation.customerName} · ساري حتى{' '}
                  <span className="font-mono-num">{savedQuotation.validUntil}</span> · بدون خصم من المخزون
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  openPrintPreview({
                    kind: 'quotation_a4',
                    quotation: savedQuotation,
                    settings,
                    activityName: activeActivity.nameAr,
                  })
                }
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>معاينة A4</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  printDocument({
                    kind: 'quotation_a4',
                    quotation: savedQuotation,
                    settings,
                    activityName: activeActivity.nameAr,
                  })
                }
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>طباعة A4</span>
              </button>
              <a
                href={buildWhatsAppUrl(
                  savedQuotation.customerPhone,
                  formatQuotationWhatsAppText(savedQuotation, settings.storeName, settings.phone)
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>واتساب</span>
              </a>
              <button
                type="button"
                onClick={() => setViewMode('quotations')}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <span>كل عروض الأسعار</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Save Confirmation Bar */}
      {savedInvoice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  تم اعتماد الفاتورة {savedInvoice.invoiceNumber} — الصافي{' '}
                  <span className="font-mono-num">{formatEGP(savedInvoice.grandTotal)}</span>
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-400">
                  {savedInvoice.customerName} · {formatDateTimeAr(savedInvoice.createdAt)} ·{' '}
                  {PAYMENT_METHOD_LABELS[savedInvoice.paymentMethod]}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  openPrintPreview({
                    kind: 'invoice_a4',
                    invoice: savedInvoice,
                    settings,
                    activityName: activeActivity.nameAr,
                    customerBalanceDue: selectedCustomer?.balanceDue,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>معاينة A4</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  printDocument({
                    kind: 'invoice_a4',
                    invoice: savedInvoice,
                    settings,
                    activityName: activeActivity.nameAr,
                    customerBalanceDue: selectedCustomer?.balanceDue,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>طباعة A4</span>
              </button>
              <button
                type="button"
                onClick={() => printDocument({ kind: 'invoice_thermal', invoice: savedInvoice, settings })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>إيصال 80mm</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const txt = formatInvoiceWhatsAppText(savedInvoice, settings.storeName, settings.phone);
                  await copyTextToClipboard(txt);
                  setCopiedWhatsapp(true);
                  setTimeout(() => setCopiedWhatsapp(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copiedWhatsapp ? 'تم النسخ' : 'نسخ النص'}</span>
              </button>
              <a
                href={buildWhatsAppUrl(
                  selectedCustomer?.phone || '',
                  formatInvoiceWhatsAppText(savedInvoice, settings.storeName, settings.phone)
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>واتساب</span>
              </a>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>فاتورة جديدة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {errMsg && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <span>{errMsg}</span>
          <button type="button" onClick={() => setErrMsg(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {infoMsg && !savedInvoice && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>{infoMsg}</span>
          <button type="button" onClick={() => setInfoMsg(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Invoice Header Metadata */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              العميل / جهة الفاتورة
            </label>
            <SearchableSelect
              value={customerId}
              onChange={handleCustomerChange}
              options={customerOptions}
              placeholder="عميل نقدي سريع..."
              searchPlaceholder="ابحث باسم العميل أو الهاتف..."
              usePortal
            />
            {selectedCustomer && (
              <div className="mt-1.5 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    رصيد سابق: <strong className="font-mono-num">{formatEGP(selectedCustomer.balanceDue)}</strong>
                  </span>
                  {(selectedCustomer.creditLimit ?? 0) > 0 && (
                    <span>
                      الحد الائتماني: <strong className="font-mono-num">{formatEGP(selectedCustomer.creditLimit ?? 0)}</strong>
                    </span>
                  )}
                  {Number(selectedCustomer.loyaltyPoints || 0) > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      نقاط الولاء: <strong className="font-mono-num">{formatNum(selectedCustomer.loyaltyPoints || 0)}</strong>
                    </span>
                  )}
                  {Number(selectedCustomer.storeCreditBalance || 0) > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      محفظة العميل: <strong className="font-mono-num">{formatEGP(selectedCustomer.storeCreditBalance || 0)}</strong>
                    </span>
                  )}
                </div>
                {((selectedCustomer.defaultPriceTier && selectedCustomer.defaultPriceTier !== 'retail') ||
                  (selectedCustomer.defaultDiscountPercent || 0) > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-700 dark:text-emerald-400">
                    <span>
                      شريحة العميل: <strong>{PRICE_TIER_LABELS[selectedCustomer.defaultPriceTier || 'retail']}</strong>
                      {(selectedCustomer.defaultDiscountPercent || 0) > 0
                        ? ` · خصم دائم ${selectedCustomer.defaultDiscountPercent}%`
                        : ''}
                    </span>
                    {(selectedCustomer.defaultDiscountPercent || 0) > 0 &&
                      activeCustomerDiscountPct === null && (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveCustomerDiscountPct(Number(selectedCustomer.defaultDiscountPercent || 0))
                          }
                          className="font-semibold underline"
                        >
                          تطبيق خصم العميل ({selectedCustomer.defaultDiscountPercent}%)
                        </button>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              قراءة باركود سريع (إدراج تلقائي في الجدول)
            </label>
            <div className="relative flex gap-1.5">
              <div className="relative flex-1">
                <QrCode className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeEntry(barcodeInput);
                    }
                  }}
                  placeholder="امسح الباركود ثم Enter..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-3 text-sm font-mono-num focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <button
                type="button"
                onClick={() => handleBarcodeEntry(barcodeInput)}
                className="rounded-lg border border-slate-200 bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                إدراج
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              مرجع العملية / رقم الإذن
            </label>
            <input
              type="text"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="اختياري (مثال: REF-204)"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              ملاحظات الفاتورة {hasCreditAllocation ? 'وتاريخ الاستحقاق' : ''}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات البيع أو التسليم..."
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
              {hasCreditAllocation && (
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  title="تاريخ استحقاق الآجل"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Row Selection & Price Tier Control Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Selection Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={rows.length > 0 && rows.every((r) => Boolean(selectedRowIds[r.rowId]))}
                onChange={handleToggleSelectAll}
                className="h-4 w-4 rounded accent-emerald-600"
              />
              <span>تحديد الكل ({rows.length})</span>
            </label>

            {selectedCount > 0 && (
              <>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                  محدد: {selectedCount} سطر
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRowIds({})}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400"
                >
                  إلغاء التحديد
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedRows}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>حذف المحدد</span>
                </button>
              </>
            )}
          </div>

          {/* Bulk Price Tier Selector: Apply to Selected OR All */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">تخصيص السعر:</span>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setTierApplyScope('selected')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  tierApplyScope === 'selected'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                المحدد ({selectedCount})
              </button>
              <button
                type="button"
                onClick={() => setTierApplyScope('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  tierApplyScope === 'all'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                كل أصناف الفاتورة
              </button>
            </div>

            <div className="flex items-center gap-1">
              {(['retail', 'half_wholesale', 'wholesale'] as const).map((tier) => {
                const isDefaultActive = tierApplyScope === 'all' && defaultTier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => applyTierBulk(tier)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isDefaultActive
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {PRICE_TIER_LABELS[tier]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Spreadsheet-Style Invoice Lines Table */}
      <div className="hidden md:block rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
              <tr>
                <th className="w-10 px-3 py-3 text-center">تحديد</th>
                <th className="w-10 px-2 py-3 text-center">م</th>
                <th className="min-w-[260px] px-3 py-3">الصنف (قائمة بحث منسدلة)</th>
                <th className="w-28 px-2.5 py-3">المتاح / الوحدة</th>
                <th className="w-36 px-2.5 py-3">نوع السعر</th>
                <th className="w-24 px-2.5 py-3">الكمية</th>
                <th className="w-28 px-2.5 py-3">سعر الوحدة</th>
                <th className="w-24 px-2.5 py-3">خصم السطر</th>
                <th className="w-32 px-3 py-3">صافي السطر</th>
                <th className="w-14 px-2 py-3 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row, idx) => {
                const prod = productById.get(row.productId);
                const gross = Number((row.unitSalePrice * row.quantity).toFixed(2));
                const disc = Math.min(gross, Math.max(0, Number(row.discountAmount || 0)));
                const lineNet = Number(Math.max(0, gross - disc).toFixed(2));
                const isSelected = Boolean(selectedRowIds[row.rowId]);
                const overStock =
                  Boolean(prod) && !settings.allowNegativeStock && row.quantity > (prod?.stockQty ?? 0);

                return (
                  <tr
                    key={row.rowId}
                    className={`transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                    }`}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          setSelectedRowIds((prev) => ({ ...prev, [row.rowId]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded accent-emerald-600"
                        aria-label={`تحديد السطر ${idx + 1}`}
                      />
                    </td>

                    <td className="px-2 py-2.5 text-center font-mono-num text-slate-400">
                      {idx + 1}
                    </td>

                    <td className="px-3 py-2">
                      <SearchableSelect
                        value={row.productId}
                        onChange={(pid) => handleSelectProductOnRow(row.rowId, pid)}
                        options={productOptions}
                        placeholder="اختر أو ابحث عن الصنف..."
                        searchPlaceholder="ابحث بالاسم أو الباركود أو الكود..."
                        usePortal
                      />
                    </td>

                    <td className="px-2.5 py-2.5">
                      {prod ? (
                        <div className="space-y-0.5">
                          <div
                            className={`font-mono-num font-bold ${
                              overStock || prod.stockQty <= 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : prod.stockQty <= prod.minStockAlert
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {formatNum(prod.stockQty)} {prod.unit}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[100px]">
                            {prod.category}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-2.5 py-2">
                      <select
                        value={row.priceTier}
                        disabled={!prod}
                        onChange={(e) => handleRowTierChange(row.rowId, e.target.value as PriceTier)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="retail">بيع (قطاعي)</option>
                        <option value="half_wholesale">نصف جملة</option>
                        <option value="wholesale">جملة</option>
                        <option value="custom">مخصص</option>
                      </select>
                    </td>

                    <td className="px-2.5 py-2">
                      <input
                        type="number"
                        min={0.001}
                        step="any"
                        disabled={!prod}
                        value={prod ? row.quantity : ''}
                        onChange={(e) => handleRowQuantityChange(row.rowId, e.target.value)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-center font-mono-num font-bold focus:outline-none disabled:opacity-40 ${
                          overStock
                            ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
                            : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-emerald-600 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-white'
                        }`}
                      />
                    </td>

                    <td className="px-2.5 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!prod}
                        value={prod ? row.unitSalePrice : ''}
                        onChange={(e) => handleRowPriceChange(row.rowId, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono-num font-bold text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </td>

                    <td className="px-2.5 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!prod}
                        value={prod ? row.discountAmount : ''}
                        onChange={(e) => handleRowDiscountChange(row.rowId, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono-num text-slate-800 focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </td>

                    <td className="px-3 py-2.5 font-mono-num font-bold text-slate-900 dark:text-white">
                      {prod ? formatEGP(lineNet) : '—'}
                    </td>

                    <td className="px-2 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.rowId)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                        title="حذف السطر"
                        aria-label={`حذف السطر ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة سطر جديد إلى الفاتورة</span>
          </button>
          <span className="font-mono-num">
            الأصناف المدرجة: <strong>{filledRows.length}</strong> · النشاط: {activeActivity.nameAr}
          </span>
        </div>
      </div>

      {/* Mobile Responsive Invoice Line Cards */}
      <div className="md:hidden space-y-3">
        {rows.map((row, idx) => {
          const prod = productById.get(row.productId);
          const gross = Number((row.unitSalePrice * row.quantity).toFixed(2));
          const disc = Math.min(gross, Math.max(0, Number(row.discountAmount || 0)));
          const lineNet = Number(Math.max(0, gross - disc).toFixed(2));
          const isSelected = Boolean(selectedRowIds[row.rowId]);

          return (
            <div
              key={row.rowId}
              className={`rounded-xl border p-3.5 space-y-3 ${
                isSelected
                  ? 'border-emerald-400 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) =>
                      setSelectedRowIds((prev) => ({ ...prev, [row.rowId]: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span>سطر #{idx + 1}</span>
                </label>

                <div className="flex items-center gap-2">
                  {prod && (
                    <span className="font-mono-num text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {formatEGP(lineNet)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(row.rowId)}
                    className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    aria-label="حذف السطر"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <SearchableSelect
                value={row.productId}
                onChange={(pid) => handleSelectProductOnRow(row.rowId, pid)}
                options={productOptions}
                placeholder="اختر الصنف..."
                searchPlaceholder="ابحث بالاسم أو الباركود..."
                usePortal
              />

              {prod && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      المتاح: <strong className="font-mono-num">{formatNum(prod.stockQty)}</strong> {prod.unit}
                    </span>
                    <select
                      value={row.priceTier}
                      onChange={(e) => handleRowTierChange(row.rowId, e.target.value as PriceTier)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="retail">بيع (قطاعي)</option>
                      <option value="half_wholesale">نصف جملة</option>
                      <option value="wholesale">جملة</option>
                      <option value="custom">مخصص</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="mb-1 block text-[11px] text-slate-500">الكمية</span>
                      <input
                        type="number"
                        min={0.001}
                        step="any"
                        value={row.quantity}
                        onChange={(e) => handleRowQuantityChange(row.rowId, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[11px] text-slate-500">السعر</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.unitSalePrice}
                        onChange={(e) => handleRowPriceChange(row.rowId, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[11px] text-slate-500">الخصم</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.discountAmount}
                        onChange={(e) => handleRowDiscountChange(row.rowId, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-mono-num dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleAddRow}
          className="flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-400 bg-emerald-50/40 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة سطر صنف جديد</span>
        </button>
      </div>

      {/* Settlement, Discounts, Promotions & Summary Footer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Payment Method & Options */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="font-display text-sm font-bold text-slate-900 dark:text-white">
            طريقة السداد وتوجيه الخزينة
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {(
              [
                { id: 'cash', label: 'نقدي بالدرج' },
                { id: 'instapay', label: 'إنستا باي' },
                { id: 'vodafone_cash', label: 'فودافون كاش' },
                { id: 'card', label: 'ماكينة فيزا' },
                { id: 'credit', label: 'آجل على العميل' },
                { id: 'split', label: 'دفع مقسم' },
              ] as const
            ).map((m) => {
              const active = paymentMethod === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (m.id === 'split') {
                      initializeSplitMode();
                    } else {
                      setPaymentMethod(m.id);
                    }
                  }}
                  className={`min-h-[40px] rounded-lg border px-3 py-2 font-semibold transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {paymentMethod !== 'credit' && paymentMethod !== 'split' && matchingTreasuries.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">
                  الخزينة / الحساب المستلم
                </label>
                <select
                  value={selectedTreasuryId}
                  onChange={(e) => setSelectedTreasuryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  {matchingTreasuries.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({TREASURY_TYPE_LABELS[t.type]})
                    </option>
                  ))}
                </select>
              </div>

              {paymentMethod === 'cash' && (
                <div>
                  <label className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">
                    المبلغ المستلم نقداً من العميل
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder={String(remainingAfterStoreCredit)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              )}
            </div>
          )}

          {paymentMethod === 'split' && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">
                  توزيع السداد المقسم (المطلوب {formatEGP(remainingAfterStoreCredit)})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSplitRows((prev) => [
                      ...prev,
                      {
                        rowId: `sp-${Date.now()}`,
                        treasuryId: activeTreasuries[0]?.id || '__credit__',
                        amount: String(Math.max(0, Number((remainingAfterStoreCredit - splitTotalEntered).toFixed(2)))),
                        referenceCode: '',
                      },
                    ])
                  }
                  className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  + إضافة دفعة
                </button>
              </div>

              {splitRows.map((sr) => (
                <div key={sr.rowId} className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                  <select
                    value={sr.treasuryId}
                    onChange={(e) =>
                      setSplitRows((prev) =>
                        prev.map((x) => (x.rowId === sr.rowId ? { ...x, treasuryId: e.target.value } : x))
                      )
                    }
                    className="sm:col-span-5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                  >
                    {activeTreasuries.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    <option value="__credit__">ترحيل آجل على حساب العميل</option>
                  </select>

                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={sr.amount}
                    onChange={(e) =>
                      setSplitRows((prev) =>
                        prev.map((x) => (x.rowId === sr.rowId ? { ...x, amount: e.target.value } : x))
                      )
                    }
                    placeholder="المبلغ"
                    className="sm:col-span-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center font-mono-num font-bold dark:border-slate-700 dark:bg-slate-900"
                  />

                  <input
                    type="text"
                    value={sr.referenceCode}
                    onChange={(e) =>
                      setSplitRows((prev) =>
                        prev.map((x) => (x.rowId === sr.rowId ? { ...x, referenceCode: e.target.value } : x))
                      )
                    }
                    placeholder="مرجع (اختياري)"
                    className="sm:col-span-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                  />

                  <button
                    type="button"
                    onClick={() => setSplitRows((prev) => prev.filter((x) => x.rowId !== sr.rowId))}
                    className="sm:col-span-1 flex items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  المدخل: <strong className="font-mono-num">{formatEGP(splitTotalEntered)}</strong>
                </span>
                {splitCardFeeEstimate > 0 && (
                  <span>
                    عمولة الفيزا المتوقعة: <strong className="font-mono-num">{formatEGP(splitCardFeeEstimate)}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Extra Discount, Promotions, Loyalty & Store Credit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">
                خصم إضافي على إجمالي الفاتورة (ج.م)
                {activeCustomerDiscountPct !== null && (
                  <span className="mr-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    (تلقائي {activeCustomerDiscountPct}%)
                  </span>
                )}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={invoiceDiscount}
                onChange={(e) => {
                  setActiveCustomerDiscountPct(null);
                  setInvoiceDiscount(Math.max(0, Number(e.target.value || 0)));
                }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
              />
              {overrideApproval && clampedInvoiceDiscount > afterPromoTotal * 0.1 + 0.01 && (
                <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>اعتماد الخصم: {overrideApproval.authorizerName}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-end gap-2">
              {promotions.some((p) => p.active) && (
                <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={applyPromotion}
                    onChange={(e) => setApplyPromotion(e.target.checked)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>
                    تطبيق العروض التلقائية
                    {matchedPromo.promotion ? ` (${matchedPromo.promotion.name})` : ''}
                  </span>
                </label>
              )}

              {selectedCustomer && loyaltyStats.canRedeem && (
                <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                  <input
                    type="checkbox"
                    checked={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.checked)}
                    className="h-4 w-4 rounded accent-amber-600"
                  />
                  <Award className="h-3.5 w-3.5" />
                  <span>
                    استبدال {formatNum(loyaltyStats.availablePoints)} نقطة ولاء
                  </span>
                </label>
              )}

              {selectedCustomer && Number(selectedCustomer.storeCreditBalance || 0) > 0 && (
                <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                  <input
                    type="checkbox"
                    checked={useStoreCredit}
                    onChange={(e) => setUseStoreCredit(e.target.checked)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <Wallet className="h-3.5 w-3.5" />
                  <span>
                    خصم من محفظة العميل ({formatEGP(selectedCustomer.storeCreditBalance || 0)})
                  </span>
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Invoice Totals & Submit Actions */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between space-y-4">
          <div className="space-y-2 text-xs">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-white pb-1 border-b border-slate-100 dark:border-slate-800">
              ملخص حساب الفاتورة
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>إجمالي الأصناف قبل الخصم ({filledRows.length} صنف)</span>
              <span className="font-mono-num font-semibold">{formatEGP(subtotal)}</span>
            </div>
            {itemDiscountsTotal > 0 && (
              <div className="flex justify-between text-rose-600 dark:text-rose-400">
                <span>خصومات السطور</span>
                <span className="font-mono-num">- {formatEGP(itemDiscountsTotal)}</span>
              </div>
            )}
            {promotionDiscount > 0 && (
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>خصم العرض الترويجي</span>
                <span className="font-mono-num">- {formatEGP(promotionDiscount)}</span>
              </div>
            )}
            {clampedInvoiceDiscount > 0 && (
              <div className="flex justify-between text-rose-600 dark:text-rose-400">
                <span>خصم إضافي على الفاتورة</span>
                <span className="font-mono-num">- {formatEGP(clampedInvoiceDiscount)}</span>
              </div>
            )}
            {loyaltyStats.discountEgp > 0 && (
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>استبدال نقاط الولاء ({loyaltyStats.pointsUsed} نقطة)</span>
                <span className="font-mono-num">- {formatEGP(loyaltyStats.discountEgp)}</span>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-200 pt-2.5 text-base font-bold text-slate-900 dark:border-slate-800 dark:text-white">
              <span>صافي الفاتورة</span>
              <span className="font-mono-num text-emerald-700 dark:text-emerald-400">
                {formatEGP(grandTotal)}
              </span>
            </div>

            {storeCreditApplied > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                <span>مسدد من محفظة العميل</span>
                <span className="font-mono-num">- {formatEGP(storeCreditApplied)}</span>
              </div>
            )}

            {storeCreditApplied > 0 && (
              <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                <span>المتبقي للتحصيل</span>
                <span className="font-mono-num">{formatEGP(remainingAfterStoreCredit)}</span>
              </div>
            )}

            {paymentMethod === 'cash' && changeAmount > 0 && (
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>الباقي للعميل</span>
                <span className="font-mono-num font-bold">{formatEGP(changeAmount)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              disabled={submitting || filledRows.length === 0}
              onClick={() => handleSubmitInvoice('none')}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserCheck className="h-4 w-4" />
              <span>{submitting ? 'جاري الاعتماد...' : 'اعتماد وحفظ الفاتورة'}</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={submitting || filledRows.length === 0}
                onClick={() => handleSubmitInvoice('a4')}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <Printer className="h-3.5 w-3.5 text-emerald-600" />
                <span>اعتماد وطباعة A4</span>
              </button>
              <button
                type="button"
                disabled={submitting || filledRows.length === 0}
                onClick={() => handleSubmitInvoice('thermal')}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <Printer className="h-3.5 w-3.5 text-emerald-600" />
                <span>اعتماد وإيصال 80mm</span>
              </button>
            </div>

            {/* Save as Proforma / Sales Quotation without deducting stock */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
              <select
                value={validDays}
                onChange={(e) => setValidDays(Number(e.target.value))}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                title="مدة صلاحية عرض السعر"
              >
                <option value={3}>صالح 3 أيام</option>
                <option value={7}>صالح 7 أيام</option>
                <option value={14}>صالح 14 يوماً</option>
                <option value={30}>صالح 30 يوماً</option>
              </select>
              <button
                type="button"
                disabled={savingQuotation || filledRows.length === 0}
                onClick={() => void handleSaveAsQuotation()}
                className="flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>{savingQuotation ? 'جاري الحفظ...' : 'حفظ كعرض سعر (بدون خصم مخزون)'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {/* Camera Barcode Scanner */}
      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          setCameraOpen(false);
          handleBarcodeEntry(code);
        }}
      />

      {/* Manager/Owner PIN Override Modal */}
      <ManagerOverrideModal
        open={overrideModalOpen}
        discountAmount={clampedInvoiceDiscount}
        baseAmount={afterPromoTotal}
        apiFetch={apiFetch}
        onClose={() => setOverrideModalOpen(false)}
        onApproved={(approver) => {
          setOverrideApproval({
            authorizerName: approver.authorizerName,
            maxApprovedDiscount: clampedInvoiceDiscount,
          });
          setOverrideModalOpen(false);
          void handleSubmitInvoice(pendingPrintTarget, true);
        }}
      />
    </div>
  );
}
