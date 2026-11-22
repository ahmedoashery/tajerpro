import type { PriceTier, Product } from './types.ts';

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  retail: 'قطاعي',
  half_wholesale: 'نصف جملة',
  wholesale: 'جملة',
  custom: 'سعر مخصص',
};

export function resolveTierUnitPrice(
  prod: Pick<Product, 'currentSalePrice' | 'halfWholesalePrice' | 'wholesalePrice'>,
  tier: PriceTier,
  customPrice?: number
): number {
  if (tier === 'wholesale') {
    return prod.wholesalePrice > 0 ? prod.wholesalePrice : prod.currentSalePrice;
  }
  if (tier === 'half_wholesale') {
    return prod.halfWholesalePrice > 0 ? prod.halfWholesalePrice : prod.currentSalePrice;
  }
  if (
    tier === 'custom' &&
    customPrice !== undefined &&
    Number.isFinite(customPrice) &&
    customPrice >= 0
  ) {
    return Number(customPrice.toFixed(2));
  }
  return prod.currentSalePrice;
}
