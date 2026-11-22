import {
  Award,
  Banknote,
  Calculator,
  Camera,
  CheckCircle2,
  CloudOff,
  CreditCard,
  Eye,
  Maximize2,
  Minimize2,
  Minus,
  PauseCircle,
  PlayCircle,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { PRICE_TIER_LABELS, resolveTierUnitPrice } from '../shared/pricingUtils';
import { buildPromotionItemsFromCart, findBestPromotion } from '../shared/promotionEngine';
import type {
  Customer,
  Invoice,
  OfflineQueuedInvoice,
  PaymentGatewayConfig,
  PaymentMethod,
  PriceTier,
  Product,
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
  TREASURY_TYPE_LABELS,
} from '../utils/formatters';
import { matchScaleBarcode } from '../utils/scaleBarcode';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { ManagerOverrideModal } from './pos/ManagerOverrideModal';
import {
  loadOfflineQueue,
  OfflineQueueModal,
  saveOfflineQueue,
} from './pos/OfflineQueueModal';
import { CustomerQuickProfileModal, PosReceiptModal } from './pos/PosReceiptModal';
import { SearchableSelect } from './ui/SearchableSelect';

interface PosViewProps {
  products: Product[];
  customers: Customer[];
  treasuries: TreasuryAccount[];
  promotions?: StorePromotion[];
  activeActivity: StoreActivityProfile;
  settings: StoreSettings;
  paymentConfig: PaymentGatewayConfig;
  currentUser: StaffUser;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onCheckoutSuccess: (invoice: Invoice) => void;
  onOpenShiftClosing?: () => void;
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

interface SplitRowDraft {
  rowId: string;
  treasuryId: string;
  amount: string;
  referenceCode: string;
}

interface CartLine {
  product: Product;
  quantity: number;
  discountAmount: number;
  priceTier: PriceTier;
  unitSalePrice: number;
}

interface ParkedOrder {
  id: string;
  createdAt: string;
  customerId: string;
  customerName: string;
  discount: number;
  items: Array<{
    productId: string;
    quantity: number;
    discountAmount: number;
    priceTier?: PriceTier;
    unitSalePrice?: number;
  }>;
  totalEstimate: number;
}

const PARKED_ORDERS_KEY = 'tajirpro_parked_orders_v1';

function loadParkedOrders(): ParkedOrder[] {
  try {
    const raw = localStorage.getItem(PARKED_ORDERS_KEY);
    return raw ? (JSON.parse(raw) as ParkedOrder[]) : [];
  } catch {
    return [];
  }
}

export function PosView({
  products,
  customers,
  treasuries,
  promotions = [],
  activeActivity,
  settings,
  paymentConfig,
  currentUser,
  apiFetch,
  onCheckoutSuccess,
  onOpenShiftClosing,
}: PosViewProps) {
  const { printDocument, openPrintPreview } = usePrint();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [invoicePriceTier, setInvoicePriceTier] = useState<'retail' | 'half_wholesale' | 'wholesale'>('retail');
  const [selectedCartIds, setSelectedCartIds] = useState<Record<string, boolean>>({});
  const [mobilePane, setMobilePane] = useState<'catalog' | 'cart'>('catalog');
  const [customerId, setCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState<string>('');
  const [splitRows, setSplitRows] = useState<SplitRowDraft[]>([]);
  const [paymentRef, setPaymentRef] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [applyPromotion, setApplyPromotion] = useState<boolean>(true);
  const [redeemPoints, setRedeemPoints] = useState<boolean>(false);
  const [useStoreCredit, setUseStoreCredit] = useState<boolean>(false);
  const [verifyingGateway, setVerifyingGateway] = useState(false);
  const [gatewayVerifiedMsg, setGatewayVerifiedMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null);
  const [parkedOrders, setParkedOrders] = useState<ParkedOrder[]>(loadParkedOrders);
  const [showParkedDrawer, setShowParkedDrawer] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [customerQuickOpen, setCustomerQuickOpen] = useState(false);

  // Customer auto-discount tracking + Manager PIN discount override + Offline queue
  const [activeCustomerDiscountPct, setActiveCustomerDiscountPct] = useState<number | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [pendingCheckoutMethod, setPendingCheckoutMethod] = useState<PaymentMethod | null>(null);
  const [overrideApproval, setOverrideApproval] = useState<{
    authorizerName: string;
    maxApprovedDiscount: number;
  } | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedInvoice[]>(loadOfflineQueue);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [showOfflineQueueModal, setShowOfflineQueueModal] = useState(false);
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);

  const activeTreasuries = useMemo(() => treasuries.filter((t) => t.active), [treasuries]);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );

  // Reset customer-specific settlement flags when customer changes
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

  useEffect(() => {
    try {
      localStorage.setItem(PARKED_ORDERS_KEY, JSON.stringify(parkedOrders));
    } catch {
      // ignore storage quota errors
    }
  }, [parkedOrders]);

  const categories = useMemo(() => {
    const set = new Set<string>(activeActivity.categories);
    products.forEach((p) => set.add(p.category));
    return ['all', ...Array.from(set)];
  }, [products, activeActivity]);

  // Fast-access quick tiles (top 8 stocked products in active catalog)
  const quickTiles = useMemo(() => {
    const inStock = products.filter((p) => p.stockQty > 0 || settings.allowNegativeStock);
    return inStock.slice(0, 8);
  }, [products, settings.allowNegativeStock]);

  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      const catOk = categoryFilter === 'all' || p.category === categoryFilter;
      if (!catOk) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, debouncedSearch, categoryFilter]);

  const {
    visibleItems: visibleProducts,
    visibleCount: visibleProductCount,
    totalCount: totalProductCount,
    hasMore: hasMoreProducts,
    loadMore: loadMoreProducts,
    sentinelRef: productSentinelRef,
  } = useInfiniteScroll(filteredProducts, {
    batchSize: 12,
    resetKey: `${debouncedSearch}-${categoryFilter}`,
  });

  const customerOptions = useMemo(
    () => [
      { value: '', label: 'عميل نقدي سريع (بدون تسجيل)', sublabel: 'بيع مباشر' },
      ...customers.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.balanceDue > 0 ? `${c.phone} · عليه ${formatEGP(c.balanceDue)}` : c.phone,
      })),
    ],
    [customers]
  );

  const addToCart = useCallback(
    (prod: Product, addQty = 1) => {
      setErrMsg(null);
      setInfoBanner(null);
      if (prod.stockQty <= 0 && !settings.allowNegativeStock) {
        setErrMsg(`الصنف "${prod.name}" غير متوفر حالياً بالمخزن.`);
        return;
      }
      const cleanAddQty = Number(Math.max(0.001, addQty).toFixed(3));
      setCart((prev) => {
        const existing = prev.find((line) => line.product.id === prod.id);
        if (existing) {
          const nextQty = Number((existing.quantity + cleanAddQty).toFixed(3));
          if (nextQty > prod.stockQty && !settings.allowNegativeStock) {
            setErrMsg(`أقصى كمية متاحة من "${prod.name}" هي ${prod.stockQty} ${prod.unit}`);
            return prev;
          }
          return prev.map((line) =>
            line.product.id === prod.id ? { ...line, quantity: nextQty } : line
          );
        }
        if (cleanAddQty > prod.stockQty && !settings.allowNegativeStock) {
          setErrMsg(`أقصى كمية متاحة من "${prod.name}" هي ${prod.stockQty} ${prod.unit}`);
          return prev;
        }
        return [
          ...prev,
          {
            product: prod,
            quantity: cleanAddQty,
            discountAmount: 0,
            priceTier: invoicePriceTier,
            unitSalePrice: resolveTierUnitPrice(prod, invoicePriceTier),
          },
        ];
      });
    },
    [invoicePriceTier, settings.allowNegativeStock]
  );

  // Sync live WebSocket product stock & catalog prices into cart items
  const liveCart = useMemo(() => {
    const prodMap = new Map(products.map((p) => [p.id, p]));
    return cart.map((line) => {
      const freshProd = prodMap.get(line.product.id) || line.product;
      return {
        ...line,
        product: freshProd,
        unitSalePrice:
          line.priceTier === 'custom'
            ? line.unitSalePrice
            : resolveTierUnitPrice(freshProd, line.priceTier, line.unitSalePrice),
      };
    });
  }, [cart, products]);

  const applyTierToAllCart = (tier: 'retail' | 'half_wholesale' | 'wholesale') => {
    setInvoicePriceTier(tier);
    setCart((prev) =>
      prev.map((line) => ({
        ...line,
        priceTier: tier,
        unitSalePrice: resolveTierUnitPrice(line.product, tier),
      }))
    );
  };

  const applyTierToSelectedCart = (tier: 'retail' | 'half_wholesale' | 'wholesale') => {
    const anyChecked = cart.some((l) => selectedCartIds[l.product.id]);
    if (!anyChecked) {
      applyTierToAllCart(tier);
      return;
    }
    setCart((prev) =>
      prev.map((line) =>
        selectedCartIds[line.product.id]
          ? {
              ...line,
              priceTier: tier,
              unitSalePrice: resolveTierUnitPrice(line.product, tier),
            }
          : line
      )
    );
  };

  const updateLineTier = (productId: string, tier: 'retail' | 'half_wholesale' | 'wholesale') => {
    setCart((prev) =>
      prev.map((line) =>
        line.product.id === productId
          ? {
              ...line,
              priceTier: tier,
              unitSalePrice: resolveTierUnitPrice(line.product, tier),
            }
          : line
      )
    );
  };

  const updateLineCustomPrice = (productId: string, rawPrice: number) => {
    const cleanPrice = Number.isFinite(rawPrice) ? Math.max(0, Number(rawPrice.toFixed(2))) : 0;
    setCart((prev) =>
      prev.map((line) =>
        line.product.id === productId
          ? {
              ...line,
              priceTier: 'custom',
              unitSalePrice: cleanPrice,
            }
          : line
      )
    );
  };

  const subtotal = liveCart.reduce((sum, line) => sum + line.unitSalePrice * line.quantity, 0);
  const itemDiscounts = liveCart.reduce((sum, line) => sum + line.discountAmount, 0);
  const afterItemDisc = Math.max(0, Number((subtotal - itemDiscounts).toFixed(2)));

  // Automatic Promotion Evaluation
  const promoEval = useMemo(() => {
    if (!promotions || promotions.length === 0 || liveCart.length === 0) {
      return { promotion: null, discountAmount: 0, reason: '' };
    }
    const items = buildPromotionItemsFromCart(
      liveCart.map((l) => ({
        product: l.product,
        quantity: l.quantity,
        unitSalePrice: l.unitSalePrice,
        lineTotal: Math.max(0, Number((l.unitSalePrice * l.quantity - l.discountAmount).toFixed(2))),
      }))
    );
    return findBestPromotion(promotions, items);
  }, [promotions, liveCart]);

  const promotionDiscount = applyPromotion
    ? Math.min(afterItemDisc, promoEval.discountAmount)
    : 0;
  const afterPromo = Math.max(0, Number((afterItemDisc - promotionDiscount).toFixed(2)));

  // Keep customer's permanent discount % synced automatically while active
  useEffect(() => {
    if (activeCustomerDiscountPct === null) return;
    if (activeCustomerDiscountPct <= 0) {
      setInvoiceDiscount(0);
      return;
    }
    const autoAmt = Number(((afterPromo * activeCustomerDiscountPct) / 100).toFixed(2));
    setInvoiceDiscount(autoAmt);
  }, [activeCustomerDiscountPct, afterPromo]);

  const handleCustomerChange = useCallback(
    (nextCustomerId: string) => {
      setCustomerId(nextCustomerId);
      setOverrideApproval(null);
      const cust = customers.find((c) => c.id === nextCustomerId) || null;
      const targetTier: 'retail' | 'half_wholesale' | 'wholesale' =
        cust?.defaultPriceTier === 'wholesale' || cust?.defaultPriceTier === 'half_wholesale'
          ? cust.defaultPriceTier
          : 'retail';
      setInvoicePriceTier(targetTier);
      setCart((prev) =>
        prev.map((line) =>
          line.priceTier === 'custom'
            ? line
            : {
                ...line,
                priceTier: targetTier,
                unitSalePrice: resolveTierUnitPrice(line.product, targetTier),
              }
        )
      );
      const discPct = Number(cust?.defaultDiscountPercent || 0);
      if (discPct > 0) {
        setActiveCustomerDiscountPct(discPct);
      } else {
        setActiveCustomerDiscountPct(null);
        setInvoiceDiscount(0);
      }
    },
    [customers]
  );

  const clampedManualDiscount = Math.min(afterPromo, Math.max(0, invoiceDiscount));
  const afterManualInvDisc = Math.max(0, Number((afterPromo - clampedManualDiscount).toFixed(2)));

  // Customer Loyalty Points Redemption Math (aligned 1:1 with backend)
  const loyaltyCfg = settings.loyaltyConfig || {
    enabled: false,
    earnRateEgpPerPoint: 20,
    pointValueEgp: 0.5,
    minRedeemPoints: 20,
  };
  const availablePoints = Number(selectedCustomer?.loyaltyPoints || 0);
  const canRedeemPoints =
    Boolean(selectedCustomer) &&
    loyaltyCfg.enabled &&
    availablePoints >= loyaltyCfg.minRedeemPoints &&
    afterManualInvDisc > 0;

  let pointsToRedeem = 0;
  let loyaltyDiscount = 0;
  if (redeemPoints && canRedeemPoints) {
    const pointVal = Math.max(0.01, Number(loyaltyCfg.pointValueEgp || 0.5));
    const maxNeededPoints = Math.ceil(afterManualInvDisc / pointVal);
    pointsToRedeem = Math.min(availablePoints, maxNeededPoints);
    loyaltyDiscount = Number(Math.min(afterManualInvDisc, pointsToRedeem * pointVal).toFixed(2));
  }

  const grandTotal = Math.max(0, Number((afterManualInvDisc - loyaltyDiscount).toFixed(2)));

  // Optional Store Credit Tender
  const availableStoreCredit = Number(selectedCustomer?.storeCreditBalance || 0);
  const storeCreditApplied =
    useStoreCredit && selectedCustomer && availableStoreCredit > 0 && grandTotal > 0
      ? Number(Math.min(grandTotal, availableStoreCredit).toFixed(2))
      : 0;
  const remainingToSettle = Math.max(0, Number((grandTotal - storeCreditApplied).toFixed(2)));

  const cashPaidNum = paidAmount === '' ? remainingToSettle : Number(paidAmount);
  const changeAmount =
    paymentMethod === 'cash'
      ? Math.max(0, Number((cashPaidNum - remainingToSettle).toFixed(2)))
      : 0;
  const selectedCartCount = liveCart.filter((l) => selectedCartIds[l.product.id]).length;

  const updateLineQty = (productId: string, delta: number) => {
    setErrMsg(null);
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product.id !== productId) return line;
          const nextQty = Number((line.quantity + delta).toFixed(3));
          if (nextQty <= 0) return null;
          if (delta > 0 && nextQty > line.product.stockQty && !settings.allowNegativeStock) {
            setErrMsg(`الرصيد المتاح بالمخزن هو ${line.product.stockQty} ${line.product.unit}`);
            return line;
          }
          return { ...line, quantity: nextQty };
        })
        .filter((x): x is CartLine => x !== null)
    );
  };

  const processBarcodeOrSearchCode = useCallback(
    (rawCode: string): boolean => {
      const code = rawCode.trim();
      if (!code) return false;
      const scaleMatch = matchScaleBarcode(code, products);
      if (scaleMatch) {
        addToCart(scaleMatch.product, scaleMatch.quantity);
        setInfoBanner(
          `باركود ميزان (${scaleMatch.mode === 'weight' ? 'وزن' : 'سعر'}): ${scaleMatch.product.name} · ${formatNum(scaleMatch.quantity)} ${scaleMatch.product.unit}`
        );
        return true;
      }
      const qLower = code.toLowerCase();
      const exact = products.find(
        (p) => p.barcode.toLowerCase() === qLower || p.sku.toLowerCase() === qLower
      );
      if (exact) {
        addToCart(exact);
        return true;
      }
      return false;
    },
    [products, addToCart]
  );

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = search.trim();
    if (!q) return;
    if (processBarcodeOrSearchCode(q)) {
      setSearch('');
    } else if (filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
      setSearch('');
    }
  };

  const handleVerifyGateway = async () => {
    setVerifyingGateway(true);
    setGatewayVerifiedMsg(null);
    setErrMsg(null);
    try {
      const res = await apiFetch<{ referenceCode: string; message: string }>(
        '/api/payments/verify-gateway',
        {
          method: 'POST',
          body: JSON.stringify({
            provider: paymentMethod,
            amount: remainingToSettle,
            reference: paymentRef,
          }),
        }
      );
      setPaymentRef(res.referenceCode);
      setGatewayVerifiedMsg(`${res.message} (${res.referenceCode})`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل التحقق من بوابة الدفع');
    } finally {
      setVerifyingGateway(false);
    }
  };

  const splitPaidSum = useMemo(
    () =>
      Number(splitRows.reduce((s, r) => s + Math.max(0, Number(r.amount || 0)), 0).toFixed(2)),
    [splitRows]
  );
  const splitRemaining = Number((remainingToSettle - splitPaidSum).toFixed(2));
  const splitUsesCredit = splitRows.some(
    (r) => r.treasuryId === '__credit__' && Number(r.amount || 0) > 0
  );
  const splitValid =
    paymentMethod !== 'split' ||
    remainingToSettle <= 0.001 ||
    (splitRows.length > 0 &&
      splitRows.every((r) => Number(r.amount || 0) > 0) &&
      Math.abs(splitRemaining) <= 0.05 &&
      (!splitUsesCredit || Boolean(customerId)));

  const ensureSplitInitialized = () => {
    if (splitRows.length > 0) return;
    const cashT = activeTreasuries.find((t) => t.type === 'cash_drawer') || activeTreasuries[0];
    const secondT =
      activeTreasuries.find((t) => t.id !== cashT?.id && t.type === 'instapay') ||
      activeTreasuries.find((t) => t.id !== cashT?.id) ||
      cashT;
    const half = remainingToSettle > 0 ? Number((remainingToSettle / 2).toFixed(2)) : 0;
    const rest = remainingToSettle > 0 ? Number((remainingToSettle - half).toFixed(2)) : 0;
    const rows: SplitRowDraft[] = [];
    if (cashT) {
      rows.push({
        rowId: `sp-${Date.now()}-1`,
        treasuryId: cashT.id,
        amount: half > 0 ? String(half) : '',
        referenceCode: '',
      });
    }
    if (secondT) {
      rows.push({
        rowId: `sp-${Date.now()}-2`,
        treasuryId: secondT.id,
        amount: rest > 0 ? String(rest) : '',
        referenceCode: '',
      });
    }
    if (rows.length === 0) {
      rows.push({
        rowId: `sp-${Date.now()}-1`,
        treasuryId: '__credit__',
        amount: remainingToSettle > 0 ? String(remainingToSettle) : '',
        referenceCode: '',
      });
    }
    setSplitRows(rows);
  };

  const splitTreasuryOptions = useMemo(() => {
    const base = activeTreasuries.map((t) => ({
      value: t.id,
      label: t.name,
      sublabel: `${TREASURY_TYPE_LABELS[t.type]} · الرصيد: ${formatEGP(t.currentBalance)}`,
    }));
    if (customerId) {
      base.push({
        value: '__credit__',
        label: 'ترحيل آجل على حساب العميل',
        sublabel: 'يضاف لرصيد العميل الآجل (الشكك)',
      });
    }
    return base;
  }, [activeTreasuries, customerId]);

  useEffect(() => {
    saveOfflineQueue(offlineQueue);
  }, [offlineQueue]);

  const syncOfflineItems = useCallback(
    async (targetLocalIds?: string[]) => {
      if (syncingOfflineQueue) return;
      const current = loadOfflineQueue();
      const targets = targetLocalIds
        ? current.filter((item) => targetLocalIds.includes(item.localId))
        : current;
      if (targets.length === 0) return;
      setSyncingOfflineQueue(true);
      let syncedCount = 0;
      const failedIds = new Map<string, string>();
      for (const item of targets) {
        try {
          const res = await apiFetch<{ invoice: Invoice }>('/api/invoices', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
          syncedCount += 1;
          onCheckoutSuccess(res.invoice);
        } catch (err) {
          failedIds.set(
            item.localId,
            err instanceof Error ? err.message : 'تعذر مزامنة الفاتورة مع الخادم'
          );
        }
      }
      setOfflineQueue((prev) =>
        prev
          .filter((item) => {
            const wasTarget = targets.some((t) => t.localId === item.localId);
            return !wasTarget || failedIds.has(item.localId);
          })
          .map((item) =>
            failedIds.has(item.localId)
              ? { ...item, lastError: failedIds.get(item.localId) }
              : item
          )
      );
      if (syncedCount > 0) {
        setInfoBanner(`تمت مزامنة ${syncedCount} فاتورة من طابور عدم الاتصال بنجاح.`);
      }
      setSyncingOfflineQueue(false);
    },
    [apiFetch, onCheckoutSuccess, syncingOfflineQueue]
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (loadOfflineQueue().length > 0) {
        void syncOfflineItems();
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineItems]);

  const executeCheckout = useCallback(
    async (overrideMethod?: PaymentMethod, overrideApprovedBypass = false) => {
      const effectiveMethod = overrideMethod || paymentMethod;
      if (liveCart.length === 0 || submitting) return;
      if (effectiveMethod === 'credit' && !customerId) {
        setErrMsg('اختر عميلاً مسجلاً لتسجيل الفاتورة على حسابه الآجل.');
        return;
      }
      const effectivePaid =
        overrideMethod === 'cash'
          ? remainingToSettle
          : effectiveMethod === 'cash'
            ? paidAmount === ''
              ? remainingToSettle
              : Number(paidAmount)
            : remainingToSettle;

      if (
        effectiveMethod === 'cash' &&
        paidAmount !== '' &&
        !overrideMethod &&
        (!Number.isFinite(effectivePaid) || effectivePaid < remainingToSettle)
      ) {
        setErrMsg('المبلغ المدفوع نقداً أقل من المطلوب سداده.');
        return;
      }
      if (effectiveMethod === 'split' && !splitValid) {
        setErrMsg('يرجى التأكد من توزيع كامل المتبقي على الخزائن بدون متبقي.');
        return;
      }

      // Guard: non-owner/manager discounts exceeding 10% require Supervisor/Owner PIN override
      const requiresOverride =
        currentUser.role !== 'owner' &&
        currentUser.role !== 'manager' &&
        clampedManualDiscount > afterPromo * 0.1 + 0.01;
      const alreadyApproved =
        overrideApprovedBypass ||
        (overrideApproval !== null &&
          clampedManualDiscount <= overrideApproval.maxApprovedDiscount + 0.01);

      if (requiresOverride && !alreadyApproved) {
        setPendingCheckoutMethod(overrideMethod ?? null);
        setOverrideModalOpen(true);
        return;
      }

      const treasuryMap = new Map(activeTreasuries.map((t) => [t.id, t]));
      const allocationsPayload =
        effectiveMethod === 'split'
          ? splitRows.map((r) => {
              if (r.treasuryId === '__credit__') {
                return {
                  treasuryId: null,
                  method: 'credit' as const,
                  amount: Number(Number(r.amount).toFixed(2)),
                  referenceCode: r.referenceCode.trim(),
                };
              }
              const t = treasuryMap.get(r.treasuryId);
              const method = t ? TREASURY_TYPE_TO_METHOD[t.type] : 'cash';
              return {
                treasuryId: t?.id || null,
                method,
                amount: Number(Number(r.amount).toFixed(2)),
                referenceCode: r.referenceCode.trim(),
              };
            })
          : undefined;

      const defaultCashT =
        activeTreasuries.find((t) => t.type === 'cash_drawer' && t.isDefault) ||
        activeTreasuries.find((t) => t.type === 'cash_drawer');
      const targetTreasuryId =
        overrideMethod === 'cash'
          ? defaultCashT?.id || null
          : effectiveMethod !== 'credit' && effectiveMethod !== 'split'
            ? selectedTreasuryId || null
            : null;

      const invoicePayload: Record<string, unknown> = {
        items: liveCart.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
          discountAmount: l.discountAmount,
          priceTier: l.priceTier,
          unitSalePrice: l.unitSalePrice,
        })),
        customerId: customerId || null,
        paymentMethod: effectiveMethod,
        treasuryId: targetTreasuryId,
        allocations: allocationsPayload,
        paymentRef,
        invoiceDiscount: clampedManualDiscount,
        applyPromotion,
        redeemLoyaltyPoints: pointsToRedeem,
        useStoreCredit,
        dueDate: effectiveMethod === 'credit' || splitUsesCredit ? dueDate || null : null,
        paidAmount: effectiveMethod === 'cash' ? effectivePaid : remainingToSettle,
        cashierName: currentUser.name,
        terminalName: 'كاشير المتصفح الرئيسي',
        notes: overrideApproval
          ? `اعتماد خصم من المشرف: ${overrideApproval.authorizerName}`
          : '',
      };

      const resetCartAfterSave = () => {
        setCart([]);
        setSelectedCartIds({});
        setInvoiceDiscount(0);
        setActiveCustomerDiscountPct(null);
        setOverrideApproval(null);
        setPaidAmount('');
        setPaymentRef('');
        setDueDate('');
        setRedeemPoints(false);
        setUseStoreCredit(false);
        setSplitRows([]);
        setGatewayVerifiedMsg(null);
      };

      // Queue immediately when browser is offline
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const queued: OfflineQueuedInvoice = {
          localId: `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          queuedAt: new Date().toISOString(),
          customerName: selectedCustomer?.name || 'عميل نقدي سريع',
          estimatedTotal: grandTotal,
          payload: invoicePayload,
        };
        setOfflineQueue((prev) => [...prev, queued]);
        resetCartAfterSave();
        setInfoBanner(
          'الجهاز غير متصل بالشبكة — تم حفظ الفاتورة محلياً في طابور عدم الاتصال وستُرحّل تلقائياً عند عودة الاتصال.'
        );
        return;
      }

      setSubmitting(true);
      setErrMsg(null);
      try {
        const res = await apiFetch<{ invoice: Invoice }>('/api/invoices', {
          method: 'POST',
          body: JSON.stringify(invoicePayload),
        });
        resetCartAfterSave();
        setInfoBanner(null);
        setReceiptInvoice(res.invoice);
        onCheckoutSuccess(res.invoice);
        if (settings.autoPrintAfterSale) {
          if (settings.printTemplate?.defaultPaperSize === 'a4') {
            printDocument({
              kind: 'invoice_a4',
              invoice: res.invoice,
              settings,
              activityName: activeActivity.nameAr,
            });
          } else {
            printDocument({
              kind: 'invoice_thermal',
              invoice: res.invoice,
              settings,
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'تعذر إصدار الفاتورة';
        const isNetworkError =
          err instanceof TypeError ||
          /failed to fetch|networkerror|network request failed|load failed/i.test(message);
        if (isNetworkError) {
          const queued: OfflineQueuedInvoice = {
            localId: `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            queuedAt: new Date().toISOString(),
            customerName: selectedCustomer?.name || 'عميل نقدي سريع',
            estimatedTotal: grandTotal,
            payload: invoicePayload,
            lastError: 'انقطع الاتصال بالخادم أثناء الإرسال',
          };
          setOfflineQueue((prev) => [...prev, queued]);
          resetCartAfterSave();
          setInfoBanner(
            'تعذر الوصول إلى الخادم — تم تأمين الفاتورة محلياً في طابور عدم الاتصال لحين استقرار الشبكة.'
          );
        } else {
          setErrMsg(message);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      liveCart,
      submitting,
      paymentMethod,
      customerId,
      selectedCustomer,
      remainingToSettle,
      grandTotal,
      paidAmount,
      splitValid,
      currentUser.role,
      currentUser.name,
      clampedManualDiscount,
      afterPromo,
      overrideApproval,
      activeTreasuries,
      splitRows,
      selectedTreasuryId,
      apiFetch,
      paymentRef,
      applyPromotion,
      pointsToRedeem,
      useStoreCredit,
      splitUsesCredit,
      dueDate,
      onCheckoutSuccess,
      settings,
      printDocument,
      activeActivity.nameAr,
    ]
  );

  const handleCheckout = useCallback(
    (overrideMethod?: PaymentMethod) => executeCheckout(overrideMethod, false),
    [executeCheckout]
  );

  const handleParkCurrentOrder = useCallback(() => {
    if (liveCart.length === 0) return;
    const customerName =
      customers.find((c) => c.id === customerId)?.name || 'عميل نقدي سريع';
    const next: ParkedOrder = {
      id: `hold-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      customerId,
      customerName,
      discount: invoiceDiscount,
      items: liveCart.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        discountAmount: l.discountAmount,
        priceTier: l.priceTier,
        unitSalePrice: l.unitSalePrice,
      })),
      totalEstimate: grandTotal,
    };
    setParkedOrders((prev) => [next, ...prev]);
    setCart([]);
    setSelectedCartIds({});
    setCustomerId('');
    setInvoiceDiscount(0);
    setPaidAmount('');
  }, [liveCart, customers, customerId, invoiceDiscount, grandTotal]);

  const handleResumeParkedOrder = (order: ParkedOrder) => {
    const prodMap = new Map(products.map((p) => [p.id, p]));
    const restored: CartLine[] = [];
    for (const item of order.items) {
      const prod = prodMap.get(item.productId);
      if (prod && (prod.stockQty > 0 || settings.allowNegativeStock)) {
        const tier: PriceTier = item.priceTier || 'retail';
        restored.push({
          product: prod,
          quantity: settings.allowNegativeStock ? item.quantity : Math.min(item.quantity, prod.stockQty),
          discountAmount: item.discountAmount,
          priceTier: tier,
          unitSalePrice: resolveTierUnitPrice(prod, tier, item.unitSalePrice),
        });
      }
    }
    setCart(restored);
    setSelectedCartIds({});
    setCustomerId(order.customerId);
    setInvoiceDiscount(order.discount);
    setParkedOrders((prev) => prev.filter((o) => o.id !== order.id));
    setShowParkedDrawer(false);
    setMobilePane('cart');
  };

  // Keyboard shortcuts: F8 Park, F9 Cash Quick Checkout, F10 Confirm Checkout, Escape Exit Focus Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cameraOpen) setCameraOpen(false);
        else if (customerQuickOpen) setCustomerQuickOpen(false);
        else if (receiptInvoice) setReceiptInvoice(null);
        else if (focusMode) setFocusMode(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTyping || cameraOpen || customerQuickOpen || receiptInvoice) return;

      if (e.key === 'F8') {
        e.preventDefault();
        handleParkCurrentOrder();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (liveCart.length > 0) handleCheckout('cash');
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (liveCart.length > 0) handleCheckout();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    cameraOpen,
    customerQuickOpen,
    receiptInvoice,
    focusMode,
    liveCart.length,
    handleParkCurrentOrder,
    handleCheckout,
  ]);

  const paymentOptions: Array<{ id: PaymentMethod; label: string; icon: typeof Banknote }> = [
    { id: 'cash', label: 'نقدي (كاش)', icon: Banknote },
    { id: 'instapay', label: 'إنستا باي', icon: QrCode },
    { id: 'vodafone_cash', label: 'محفظة كاش', icon: Smartphone },
    { id: 'card', label: 'فيزا / ماكينة', icon: CreditCard },
    { id: 'credit', label: 'آجل (شكك)', icon: UserCheck },
    { id: 'split', label: 'تقسيم على خزائن', icon: Wallet },
  ];

  const receiptCustomer = receiptInvoice?.customerId
    ? customers.find((c) => c.id === receiptInvoice.customerId)
    : undefined;

  return (
    <div
      className={
        focusMode
          ? 'fixed inset-0 z-40 overflow-y-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950 space-y-3'
          : 'space-y-3'
      }
    >
      {/* Top Bar Controls (Shortcuts + Focus POS toggle) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">اختصارات الكاشير السريعة:</span>
          <span className="font-mono-num">F8 تعليق</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num">F9 بيع كاش فوري</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num">F10 اعتماد الدفع</span>
          {focusMode && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-emerald-600 dark:text-emerald-400">Esc للخروج من وضع التركيز</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(!isOnline || offlineQueue.length > 0) && (
            <button
              type="button"
              onClick={() => setShowOfflineQueueModal(true)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold whitespace-nowrap ${
                offlineQueue.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <CloudOff className="h-3.5 w-3.5" />
              <span>
                {offlineQueue.length > 0
                  ? `طابور عدم الاتصال (${offlineQueue.length})`
                  : 'وضع عدم الاتصال'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{focusMode ? 'إنهاء وضع الشاشة الكاملة' : 'وضع كاشير شاشة كاملة'}</span>
          </button>
        </div>
      </div>

      {/* Mobile Catalog / Cart Switcher */}
      <div className="lg:hidden flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setMobilePane('catalog')}
          className={`flex-1 min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
            mobilePane === 'catalog'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          كتالوج الأصناف ({totalProductCount})
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('cart')}
          className={`flex-1 min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
            mobilePane === 'cart'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          سلة الفاتورة ({liveCart.length}) · <span className="font-mono-num">{formatEGP(grandTotal)}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Right Column (RTL first): Product Search, Quick Tiles & Grid */}
        <div className={`lg:col-span-7 space-y-4 ${mobilePane === 'catalog' ? 'block' : 'hidden lg:block'}`}>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleBarcodeEnter}
                  placeholder="امسح الباركود أو باركود الميزان (20/21/22) أو ابحث بالاسم (Enter للإضافة)..."
                  className="w-full min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                title="مسح الباركود بالكاميرا"
              >
                <Camera className="h-4 w-4 text-emerald-600" />
                <span className="hidden sm:inline">كاميرا</span>
              </button>
            </div>

            {infoBanner && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                {infoBanner}
              </div>
            )}

            {/* Quick Tiles Row */}
            {quickTiles.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  إضافة سريعة بنقرة واحدة:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {quickTiles.map((qt) => (
                    <button
                      key={qt.id}
                      type="button"
                      onClick={() => addToCart(qt)}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 hover:border-emerald-600 hover:bg-emerald-50/40 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
                    >
                      <span className="truncate max-w-[140px]">{qt.name}</span>
                      <span className="font-mono-num text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(resolveTierUnitPrice(qt, invoicePriceTier))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-lg px-3 py-1.5 min-h-[36px] text-xs font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat === 'all' ? 'كل التصنيفات' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleProducts.map((prod) => {
              const out = prod.stockQty <= 0;
              const blockedOut = out && !settings.allowNegativeStock;
              const low = prod.stockQty > 0 && prod.stockQty <= prod.minStockAlert;
              const displayPrice = resolveTierUnitPrice(prod, invoicePriceTier);
              return (
                <button
                  key={prod.id}
                  type="button"
                  disabled={blockedOut}
                  onClick={() => addToCart(prod)}
                  className={`flex flex-col justify-between rounded-xl border p-3.5 text-right transition-colors ${
                    blockedOut
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100/70 opacity-60 dark:border-slate-800 dark:bg-slate-900/40'
                      : out
                        ? 'border-amber-300 bg-amber-50/40 hover:border-emerald-600 dark:border-amber-800/70 dark:bg-amber-950/20'
                        : 'border-slate-200 bg-white hover:border-emerald-600 hover:bg-emerald-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500'
                  }`}
                >
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {prod.category} {prod.attributeValue ? `· ${prod.attributeValue}` : ''}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                      {prod.name}
                    </div>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="font-mono-num text-base font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(displayPrice)}
                      </div>
                      {invoicePriceTier !== 'retail' && (
                        <div className="text-[10px] text-slate-500">
                          {PRICE_TIER_LABELS[invoicePriceTier]}
                        </div>
                      )}
                    </div>
                    <div
                      className={`font-mono-num text-xs font-medium ${
                        out
                          ? settings.allowNegativeStock
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                          : low
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {out
                        ? settings.allowNegativeStock
                          ? 'نفذ (بيع بالسالب)'
                          : 'نفذ'
                        : `${formatNum(prod.stockQty)} ${prod.unit}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            ref={productSentinelRef}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          >
            <span className="font-mono-num">
              معروض {visibleProductCount} من {totalProductCount} صنف
            </span>
            {hasMoreProducts && (
              <button
                type="button"
                onClick={loadMoreProducts}
                className="font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
              >
                عرض المزيد من الأصناف...
              </button>
            )}
          </div>

          {liveCart.length > 0 && (
            <button
              type="button"
              onClick={() => setMobilePane('cart')}
              className="lg:hidden flex w-full min-h-[44px] items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <span>مراجعة السلة وإتمام الدفع ({liveCart.length} أصناف)</span>
              <span className="font-mono-num text-sm">{formatEGP(remainingToSettle)}</span>
            </button>
          )}
        </div>

        {/* Left Column: Current Invoice Cart & Egyptian Payment Checkout */}
        <div
          className={`lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4 ${
            mobilePane === 'cart' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                فاتورة البيع الحالية
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                الكاشير: {currentUser.name}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {parkedOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowParkedDrawer((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  <span>فواتير معلقة ({parkedOrders.length})</span>
                </button>
              )}
              {liveCart.length > 0 && (
                <button
                  type="button"
                  onClick={handleParkCurrentOrder}
                  title="تعليق الفاتورة مؤقتاً لخدمة عميل آخر (F8)"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <PauseCircle className="h-3.5 w-3.5 text-amber-600" />
                  <span>تعليق (F8)</span>
                </button>
              )}
              {onOpenShiftClosing && (
                <button
                  type="button"
                  onClick={onOpenShiftClosing}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Calculator className="h-3.5 w-3.5 text-emerald-600" />
                  <span>الوردية</span>
                </button>
              )}
              {liveCart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setOverrideApproval(null);
                    setActiveCustomerDiscountPct(null);
                    setInvoiceDiscount(0);
                  }}
                  className="text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400"
                >
                  إفراغ
                </button>
              )}
            </div>
          </div>

          {/* Parked / Held Carts List */}
          {showParkedDrawer && parkedOrders.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/25 space-y-2 text-xs">
              <div className="font-bold text-amber-900 dark:text-amber-300">
                الفواتير المعلقة — اضغط لاستئناف البيع:
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {parkedOrders.map((po) => (
                  <div
                    key={po.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-amber-200/80 bg-white px-2.5 py-1.5 dark:border-amber-900/40 dark:bg-slate-900"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 dark:text-white truncate">
                        {po.customerName} · {po.items.length} أصناف
                      </div>
                      <div className="font-mono-num text-[11px] text-slate-500">
                        {formatEGP(po.totalEstimate)} · {formatDateTimeAr(po.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleResumeParkedOrder(po)}
                        className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                      >
                        استئناف
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setParkedOrders((prev) => prev.filter((o) => o.id !== po.id))
                        }
                        className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Customer Selector + Quick Profile Trigger */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                العميل
              </label>
              {selectedCustomer && (
                <button
                  type="button"
                  onClick={() => setCustomerQuickOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  <Eye className="h-3 w-3" />
                  <span>ملف العميل السريع</span>
                </button>
              )}
            </div>
            <SearchableSelect
              value={customerId}
              onChange={handleCustomerChange}
              options={customerOptions}
              placeholder="عميل نقدي سريع (بدون تسجيل)"
              searchPlaceholder="ابحث باسم العميل أو رقم الموبايل..."
            />
            {selectedCustomer && (
              <div className="space-y-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    رصيد آجل:{' '}
                    <strong className="font-mono-num text-slate-800 dark:text-slate-200">
                      {formatEGP(selectedCustomer.balanceDue)}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    نقاط ولاء:{' '}
                    <strong className="font-mono-num text-amber-700 dark:text-amber-400">
                      {formatNum(selectedCustomer.loyaltyPoints || 0)}
                    </strong>
                  </span>
                  {availableStoreCredit > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        رصيد دائن:{' '}
                        <strong className="font-mono-num text-sky-700 dark:text-sky-400">
                          {formatEGP(availableStoreCredit)}
                        </strong>
                      </span>
                    </>
                  )}
                </div>
                {(selectedCustomer.defaultPriceTier && selectedCustomer.defaultPriceTier !== 'retail') ||
                (selectedCustomer.defaultDiscountPercent || 0) > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <span>
                      تسعير العميل: <strong>{PRICE_TIER_LABELS[selectedCustomer.defaultPriceTier || 'retail']}</strong>
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
                          className="font-semibold underline hover:text-emerald-800"
                        >
                          إعادة تطبيق خصم العميل ({selectedCustomer.defaultDiscountPercent}%)
                        </button>
                      )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Multi-Tier Pricing Bar */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-950/60 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {selectedCartCount > 0
                  ? `تسعير الأصناف المحددة (${selectedCartCount})`
                  : 'شريحة تسعير الفاتورة:'}
              </span>
              <div className="flex items-center gap-1 rounded-md bg-slate-200/70 p-0.5 dark:bg-slate-800">
                {(
                  [
                    ['retail', 'قطاعي'],
                    ['half_wholesale', 'نصف جملة'],
                    ['wholesale', 'جملة'],
                  ] as const
                ).map(([tierKey, tierLabel]) => {
                  const isActive = selectedCartCount === 0 && invoicePriceTier === tierKey;
                  return (
                    <button
                      key={tierKey}
                      type="button"
                      onClick={() =>
                        selectedCartCount > 0
                          ? applyTierToSelectedCart(tierKey)
                          : applyTierToAllCart(tierKey)
                      }
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900'
                      }`}
                    >
                      {tierLabel}
                    </button>
                  );
                })}
              </div>
            </div>
            {liveCart.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={liveCart.length > 0 && liveCart.every((l) => selectedCartIds[l.product.id])}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const next: Record<string, boolean> = {};
                      if (checked) liveCart.forEach((l) => (next[l.product.id] = true));
                      setSelectedCartIds(next);
                    }}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                  <span>تحديد كل أصناف الفاتورة</span>
                </label>
                {selectedCartCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCartIds({})}
                    className="text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    إلغاء التحديد
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Cart Items */}
          {liveCart.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              اختر الأصناف من القائمة أو امسح الباركود للبدء
            </div>
          ) : (
            <div className="max-h-72 space-y-2.5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {liveCart.map((line) => (
                <div key={line.product.id} className="pt-2.5 first:pt-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        aria-label={`تحديد ${line.product.name}`}
                        checked={Boolean(selectedCartIds[line.product.id])}
                        onChange={(e) =>
                          setSelectedCartIds((prev) => ({
                            ...prev,
                            [line.product.id]: e.target.checked,
                          }))
                        }
                        className="mt-1 h-4 w-4 shrink-0 accent-emerald-600 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                          {line.product.name}
                        </div>
                        <div className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          {PRICE_TIER_LABELS[line.priceTier]} · {formatEGP(line.unitSalePrice)} ×{' '}
                          {formatNum(line.quantity)} ={' '}
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {formatEGP(line.unitSalePrice * line.quantity - line.discountAmount)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateLineQty(line.product.id, -1)}
                        className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        aria-label="تقليل الكمية"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center font-mono-num text-sm font-semibold">
                        {formatNum(line.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateLineQty(line.product.id, 1)}
                        className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        aria-label="زيادة الكمية"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateLineQty(line.product.id, -line.quantity)}
                        className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                        aria-label="حذف الصنف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Item-level Tier Switcher & Direct Unit Price Override */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pr-6 text-[11px]">
                    <div className="flex items-center gap-1">
                      {(
                        [
                          ['retail', 'قطاعي'],
                          ['half_wholesale', 'ن.جملة'],
                          ['wholesale', 'جملة'],
                        ] as const
                      ).map(([tk, tl]) => (
                        <button
                          key={tk}
                          type="button"
                          onClick={() => updateLineTier(line.product.id, tk)}
                          className={`rounded px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                            line.priceTier === tk
                              ? 'bg-slate-900 text-white dark:bg-emerald-600'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {tl}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">سعر الوحدة:</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`سعر بيع ${line.product.name}`}
                        value={line.unitSalePrice}
                        onChange={(e) =>
                          updateLineCustomPrice(line.product.id, Number(e.target.value))
                        }
                        className="w-20 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-left font-mono-num text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discount, Auto-Promotion, Loyalty, Store Credit & Totals */}
          <div className="border-t border-slate-200 pt-3 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">إجمالي الأصناف</span>
              <span className="font-mono-num font-medium">{formatEGP(subtotal)}</span>
            </div>

            {promoEval.promotion && promoEval.discountAmount > 0 && (
              <label className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30 cursor-pointer">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={applyPromotion}
                    onChange={(e) => setApplyPromotion(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600 shrink-0"
                  />
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate font-semibold text-emerald-800 dark:text-emerald-300">
                    {promoEval.promotion.name}
                  </span>
                </div>
                <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                  {applyPromotion ? `-${formatEGP(promotionDiscount)}` : 'معطل'}
                </span>
              </label>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4 text-sm">
                <label className="text-slate-600 dark:text-slate-400">
                  خصم إضافي (ج.م)
                  {activeCustomerDiscountPct !== null && (
                    <span className="mr-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      (تلقائي {activeCustomerDiscountPct}%)
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  min={0}
                  value={invoiceDiscount}
                  onChange={(e) => {
                    setActiveCustomerDiscountPct(null);
                    setInvoiceDiscount(Math.max(0, Number(e.target.value)));
                  }}
                  className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-left font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              {overrideApproval && clampedManualDiscount > afterPromo * 0.1 + 0.01 && (
                <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>تم اعتماد الخصم بواسطة: {overrideApproval.authorizerName}</span>
                </div>
              )}
            </div>

            {canRedeemPoints && (
              <label className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/25 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.checked)}
                    className="h-4 w-4 accent-amber-600"
                  />
                  <Award className="h-3.5 w-3.5 text-amber-600" />
                  <span className="font-semibold text-amber-900 dark:text-amber-300">
                    استبدال نقاط الولاء ({formatNum(availablePoints)} نقطة متاحة)
                  </span>
                </div>
                <span className="font-mono-num font-bold text-amber-700 dark:text-amber-400">
                  {redeemPoints ? `-${formatEGP(loyaltyDiscount)}` : 'متاح'}
                </span>
              </label>
            )}

            {selectedCustomer && availableStoreCredit > 0 && grandTotal > 0 && (
              <label className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-2.5 py-2 text-xs dark:border-sky-900/50 dark:bg-sky-950/25 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useStoreCredit}
                    onChange={(e) => setUseStoreCredit(e.target.checked)}
                    className="h-4 w-4 accent-sky-600"
                  />
                  <span className="font-semibold text-sky-900 dark:text-sky-300">
                    استخدام الرصيد الدائن ({formatEGP(availableStoreCredit)})
                  </span>
                </div>
                <span className="font-mono-num font-bold text-sky-700 dark:text-sky-400">
                  {useStoreCredit ? `-${formatEGP(storeCreditApplied)}` : 'متاح'}
                </span>
              </label>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="font-display text-base font-bold text-slate-900 dark:text-white">
                {storeCreditApplied > 0 ? 'المتبقي للسداد' : 'المطلوب سداده'}
              </span>
              <span className="font-mono-num text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(remainingToSettle)}
              </span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              طريقة التحصيل والدفع الإلكتروني
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {paymentOptions.map((opt) => {
                const Icon = opt.icon;
                const active = paymentMethod === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(opt.id);
                      setGatewayVerifiedMsg(null);
                      setErrMsg(null);
                      if (opt.id === 'split') {
                        ensureSplitInitialized();
                      }
                    }}
                    className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {paymentMethod !== 'credit' && paymentMethod !== 'split' && matchingTreasuries.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  الخزينة / الحساب المستلم للسداد
                </label>
                <SearchableSelect
                  value={selectedTreasuryId}
                  onChange={setSelectedTreasuryId}
                  options={matchingTreasuries.map((t) => ({
                    value: t.id,
                    label: t.name,
                    sublabel: `الرصيد الحالي: ${formatEGP(t.currentBalance)}${t.accountNumber ? ` · ${t.accountNumber}` : ''}`,
                  }))}
                  searchPlaceholder="ابحث في الخزائن المسجلة..."
                />
              </div>
            )}

            {paymentMethod === 'cash' && (
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    المبلغ المدفوع من العميل
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={paidAmount}
                    placeholder={String(remainingToSettle)}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">الباقي للعميل</div>
                  <div className="font-mono-num text-lg font-bold text-slate-900 dark:text-white pt-0.5">
                    {formatEGP(changeAmount)}
                  </div>
                </div>
              </div>
            )}

            {(paymentMethod === 'instapay' ||
              paymentMethod === 'vodafone_cash' ||
              paymentMethod === 'card') && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {paymentMethod === 'instapay' && (
                    <span>
                      عنوان التحويل (IPA):{' '}
                      <strong className="font-mono-num text-slate-900 dark:text-white">
                        {paymentConfig.instapayIpa}
                      </strong>
                    </span>
                  )}
                  {paymentMethod === 'vodafone_cash' && (
                    <span>
                      رقم المحفظة:{' '}
                      <strong className="font-mono-num text-slate-900 dark:text-white">
                        {paymentConfig.vodafoneCashNumber}
                      </strong>
                    </span>
                  )}
                  {paymentMethod === 'card' && (
                    <span>
                      ربط Paymob / Fawry (عمولة ماكينة{' '}
                      <span className="font-mono-num">{paymentConfig.cardFeePercent}%</span>)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="رقم مرجع العملية / التفويض"
                    className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyGateway}
                    disabled={verifyingGateway || liveCart.length === 0}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600 whitespace-nowrap"
                  >
                    {verifyingGateway ? 'جاري التأكيد...' : 'تأكيد إلكتروني'}
                  </button>
                </div>
                {gatewayVerifiedMsg && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{gatewayVerifiedMsg}</span>
                  </div>
                )}
              </div>
            )}

            {paymentMethod === 'split' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white">
                    توزيع السداد على خزائن النظام ({splitRows.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const fallback = activeTreasuries[0]?.id || '__credit__';
                      setSplitRows((prev) => [
                        ...prev,
                        {
                          rowId: `sp-${Date.now()}-${prev.length + 1}`,
                          treasuryId: fallback,
                          amount: splitRemaining > 0 ? String(splitRemaining) : '',
                          referenceCode: '',
                        },
                      ]);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-emerald-600 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-400"
                  >
                    <Plus className="h-3 w-3" />
                    <span>إضافة خزينة للدفع</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {splitRows.map((row, idx) => {
                    const selectedTr = activeTreasuries.find((t) => t.id === row.treasuryId);
                    const needsRef = selectedTr && selectedTr.type !== 'cash_drawer';
                    return (
                      <div
                        key={row.rowId}
                        className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <SearchableSelect
                              value={row.treasuryId}
                              onChange={(val) =>
                                setSplitRows((prev) =>
                                  prev.map((r) => (r.rowId === row.rowId ? { ...r, treasuryId: val } : r))
                                )
                              }
                              options={splitTreasuryOptions}
                              searchPlaceholder="اختر الخزينة أو الحساب..."
                            />
                          </div>
                          {splitRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setSplitRows((prev) => prev.filter((r) => r.rowId !== row.rowId))
                              }
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              title="حذف الخزينة"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.amount}
                            onChange={(e) =>
                              setSplitRows((prev) =>
                                prev.map((r) => (r.rowId === row.rowId ? { ...r, amount: e.target.value } : r))
                              )
                            }
                            placeholder={`مبلغ الدفعة #${idx + 1}`}
                            className="w-32 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono-num text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                          />
                          {splitRemaining > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setSplitRows((prev) =>
                                  prev.map((r) =>
                                    r.rowId === row.rowId
                                      ? {
                                          ...r,
                                          amount: String(
                                            Number((Number(r.amount || 0) + splitRemaining).toFixed(2))
                                          ),
                                        }
                                      : r
                                  )
                                )
                              }
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              تعبئة المتبقي
                            </button>
                          )}
                          {needsRef && (
                            <input
                              type="text"
                              value={row.referenceCode}
                              onChange={(e) =>
                                setSplitRows((prev) =>
                                  prev.map((r) =>
                                    r.rowId === row.rowId ? { ...r, referenceCode: e.target.value } : r
                                  )
                                )
                              }
                              placeholder="مرجع التحويل"
                              className="flex-1 min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono-num text-[11px] dark:border-slate-700 dark:bg-slate-950"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between border-t border-emerald-200/70 pt-2 text-xs dark:border-emerald-900/50">
                  <span className="text-slate-600 dark:text-slate-300">
                    الموزع: <strong className="font-mono-num">{formatEGP(splitPaidSum)}</strong>
                  </span>
                  <span
                    className={`font-mono-num font-bold ${
                      Math.abs(splitRemaining) <= 0.05
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {Math.abs(splitRemaining) <= 0.05
                      ? 'مطابق بالكامل'
                      : splitRemaining > 0
                        ? `متبقي: ${formatEGP(splitRemaining)}`
                        : `زيادة: ${formatEGP(Math.abs(splitRemaining))}`}
                  </span>
                </div>
                {splitUsesCredit && !customerId && (
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    اختر عميلاً مسجلاً بالأعلى لترحيل الجزء الآجل على حسابه.
                  </div>
                )}
              </div>
            )}

            {(paymentMethod === 'credit' || splitUsesCredit) && customerId && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-950">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  تاريخ استحقاق السداد الآجل (اختياري)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            )}

            {paymentMethod === 'credit' && !customerId && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                اختر عميلاً مسجلاً من الأعلى لتسجيل الفاتورة على حسابه الآجل.
              </div>
            )}
          </div>

          {errMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
              {errMsg}
            </div>
          )}

          <button
            type="button"
            disabled={
              submitting ||
              liveCart.length === 0 ||
              (paymentMethod === 'credit' && !customerId) ||
              (paymentMethod === 'split' && !splitValid)
            }
            onClick={() => handleCheckout()}
            className="w-full min-h-[46px] rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'جاري إصدار الفاتورة وتحديث المخزون...'
              : `إتمام البيع وطباعة الإيصال (${formatEGP(remainingToSettle)})`}
          </button>
        </div>
      </div>

      {/* Camera Barcode Modal */}
      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          if (!processBarcodeOrSearchCode(code)) {
            setSearch(code);
          }
        }}
      />

      {/* Customer Quick Profile Modal */}
      <CustomerQuickProfileModal
        customer={customerQuickOpen ? selectedCustomer : null}
        onClose={() => setCustomerQuickOpen(false)}
      />

      {/* Manager/Owner PIN Override Modal for >10% manual discount */}
      <ManagerOverrideModal
        open={overrideModalOpen}
        discountAmount={clampedManualDiscount}
        baseAmount={afterPromo}
        apiFetch={apiFetch}
        onClose={() => {
          setOverrideModalOpen(false);
          setPendingCheckoutMethod(null);
        }}
        onApproved={(approver) => {
          setOverrideApproval({
            authorizerName: approver.authorizerName,
            maxApprovedDiscount: clampedManualDiscount,
          });
          setOverrideModalOpen(false);
          const methodToRun = pendingCheckoutMethod ?? undefined;
          setPendingCheckoutMethod(null);
          void executeCheckout(methodToRun, true);
        }}
      />

      {/* Offline Sales Queue Modal */}
      <OfflineQueueModal
        open={showOfflineQueueModal}
        queue={offlineQueue}
        syncing={syncingOfflineQueue}
        isOnline={isOnline}
        onClose={() => setShowOfflineQueueModal(false)}
        onSyncAll={() => void syncOfflineItems()}
        onSyncOne={(localId) => void syncOfflineItems([localId])}
        onRemoveOne={(localId) =>
          setOfflineQueue((prev) => prev.filter((item) => item.localId !== localId))
        }
      />

      {/* Post-Sale Thermal Receipt Modal */}
      <PosReceiptModal
        invoice={receiptInvoice}
        customer={receiptCustomer}
        settings={settings}
        activityName={activeActivity.nameAr}
        onClose={() => setReceiptInvoice(null)}
        onPrint={printDocument}
        onPreview={openPrintPreview}
      />
    </div>
  );
}
