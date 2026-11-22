import type { Product } from '../shared/types';

export interface ScaleBarcodeMatch {
  product: Product;
  quantity: number;
  mode: 'weight' | 'price';
  itemCode: string;
}

/**
 * Parses standard retail EAN-13 variable-measure scale barcodes (prefixes 20, 21, 22):
 * Layout: PP CCCCC VVVVV X
 * - Prefix 20 / 21: VVVVV = weight in grams (quantity = grams / 1000 kg)
 * - Prefix 22:      VVVVV = total price in piasters (quantity = totalPrice / unitSalePrice)
 */
export function matchScaleBarcode(rawCode: string, products: Product[]): ScaleBarcodeMatch | null {
  const code = rawCode.trim();
  if (!/^\d{13}$/.test(code)) return null;
  const prefix = code.slice(0, 2);
  if (prefix !== '20' && prefix !== '21' && prefix !== '22') return null;

  const itemCode = code.slice(2, 7);
  const rawMeasure = Number(code.slice(7, 12));
  if (!Number.isFinite(rawMeasure) || rawMeasure <= 0) return null;

  const numericItemCode = String(Number(itemCode));
  const product = products.find((p) => {
    const b = p.barcode.trim();
    const s = p.sku.trim();
    if (b === itemCode || b === numericItemCode) return true;
    if (b.length >= 7 && (b.startsWith('20') || b.startsWith('21') || b.startsWith('22')) && b.slice(2, 7) === itemCode) {
      return true;
    }
    if (s === itemCode || s.endsWith(itemCode) || s.endsWith(`-${numericItemCode}`)) return true;
    return false;
  });

  if (!product) return null;

  if (prefix === '22') {
    const totalPriceEgp = rawMeasure / 100;
    const unitPrice = product.currentSalePrice > 0 ? product.currentSalePrice : 1;
    const quantity = Number(Math.max(0.01, totalPriceEgp / unitPrice).toFixed(3));
    return { product, quantity, mode: 'price', itemCode };
  }

  const quantity = Number(Math.max(0.001, rawMeasure / 1000).toFixed(3));
  return { product, quantity, mode: 'weight', itemCode };
}
