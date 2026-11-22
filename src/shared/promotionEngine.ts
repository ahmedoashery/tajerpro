import type { Product, StorePromotion } from './types.ts';

export interface EvaluatedPromotionItem {
  productId: string;
  category: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PromotionEvaluationResult {
  promotion: StorePromotion | null;
  discountAmount: number;
  reason: string;
}

export function evaluatePromotionDiscount(
  promo: StorePromotion,
  items: EvaluatedPromotionItem[],
  nowIso = new Date().toISOString()
): number {
  if (!promo.active) return 0;
  if (promo.startsAt && nowIso < promo.startsAt) return 0;
  if (promo.endsAt && nowIso > promo.endsAt) return 0;

  const matching = items.filter((it) => {
    if (promo.productId) return it.productId === promo.productId;
    if (promo.category && promo.category !== 'all') return it.category === promo.category;
    return true;
  });

  if (matching.length === 0) return 0;

  const matchingSubtotal = matching.reduce((s, it) => s + Math.max(0, it.lineTotal), 0);
  const matchingQty = matching.reduce((s, it) => s + Math.max(0, it.quantity), 0);
  const totalCartSubtotal = items.reduce((s, it) => s + Math.max(0, it.lineTotal), 0);

  if (promo.minSubtotal > 0 && totalCartSubtotal < promo.minSubtotal) return 0;
  if (promo.minQty > 0 && matchingQty < promo.minQty) return 0;

  let discount = 0;
  if (promo.ruleType === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(promo.value || 0)));
    discount = (matchingSubtotal * pct) / 100;
  } else if (promo.ruleType === 'fixed') {
    discount = Math.min(matchingSubtotal, Math.max(0, Number(promo.value || 0)));
  } else if (promo.ruleType === 'bogo_qty') {
    // Buy X get Y free: value = free units per bundle, minQty = bundle trigger (e.g., Buy 2 Get 1 Free -> minQty=3 or buy >= minQty)
    const triggerQty = Math.max(2, Math.floor(promo.minQty || 2));
    const freeUnitsPerGroup = Math.max(1, Number(promo.value || 1));
    for (const it of matching) {
      const groups = Math.floor(it.quantity / triggerQty);
      if (groups > 0) {
        discount += Math.min(it.lineTotal, groups * freeUnitsPerGroup * it.unitPrice);
      }
    }
  }

  return Number(Math.max(0, Math.min(totalCartSubtotal, discount)).toFixed(2));
}

export function findBestPromotion(
  promotions: StorePromotion[],
  items: EvaluatedPromotionItem[],
  nowIso = new Date().toISOString()
): PromotionEvaluationResult {
  let bestPromo: StorePromotion | null = null;
  let bestDiscount = 0;

  for (const promo of promotions) {
    const disc = evaluatePromotionDiscount(promo, items, nowIso);
    if (disc > bestDiscount) {
      bestDiscount = disc;
      bestPromo = promo;
    }
  }

  if (!bestPromo || bestDiscount <= 0) {
    return { promotion: null, discountAmount: 0, reason: '' };
  }

  return {
    promotion: bestPromo,
    discountAmount: bestDiscount,
    reason: `عرض تلقائي: ${bestPromo.name} (-${bestDiscount.toFixed(2)} ج.م)`,
  };
}

export function buildPromotionItemsFromCart(
  cartItems: Array<{ product: Product; quantity: number; unitSalePrice: number; lineTotal: number }>
): EvaluatedPromotionItem[] {
  return cartItems.map((c) => ({
    productId: c.product.id,
    category: c.product.category,
    quantity: c.quantity,
    unitPrice: c.unitSalePrice,
    lineTotal: c.lineTotal,
  }));
}
