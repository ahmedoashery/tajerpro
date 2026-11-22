import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ProductBatch, PromotionRuleType, StorePromotion } from '../../shared/types.ts';
import { roundMoney, sanitizeText } from '../security/requestValidation.ts';

/**
 * Repository owning FEFO Product Batches (expiry tracking) and Store Promotions.
 */
export class BatchAndPromotionRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public ensureDefaultBatchesAndPromotions(): void {
    const batchCount = (
      this.db.prepare('SELECT COUNT(*) AS c FROM product_batches').get() as { c: number }
    ).c;
    if (Number(batchCount || 0) === 0) {
      const now = new Date();
      const isoDaysFromNow = (days: number) =>
        new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const created = now.toISOString();

      const seedBatches: Array<[string, string, string, string, number, number, string | null]> = [
        ['prd-grocery-1', 'لبن جهينة كامل الدسم', 'LOT-JH-104', isoDaysFromNow(12), 20, 39, 'sup-1'],
        ['prd-grocery-1', 'لبن جهينة كامل الدسم', 'LOT-JH-119', isoDaysFromNow(75), 28, 39, 'sup-1'],
        ['prd-grocery-4', 'جبنة عبور لاند فيتا', 'LOT-OB-220', isoDaysFromNow(18), 16, 41, 'sup-1'],
        ['prd-grocery-8', 'عصير بيتي تروبيكانا مانجو', 'LOT-BT-088', isoDaysFromNow(9), 4, 24, 'sup-1'],
        ['prd-cosmetics-1', 'غسول لاروش بوزيه للبشرة الدهنية', 'LOT-LR-501', isoDaysFromNow(240), 12, 440, 'sup-2'],
      ];

      const checkProd = this.db.prepare('SELECT id FROM products WHERE id = ?');
      const ins = this.db.prepare(
        `INSERT OR IGNORE INTO product_batches (id, product_id, product_name, batch_code, expiry_date, qty, cost_price, supplier_id, purchase_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      );
      seedBatches.forEach(([pid, pname, code, exp, qty, cost, sup], idx) => {
        if (checkProd.get(pid)) {
          ins.run(`bat-seed-${idx + 1}`, pid, pname, code, exp, qty, cost, sup, created);
        }
      });
    }

    const promoCount = (
      this.db.prepare('SELECT COUNT(*) AS c FROM store_promotions').get() as { c: number }
    ).c;
    if (Number(promoCount || 0) === 0) {
      const created = new Date().toISOString();
      const insPromo = this.db.prepare(
        `INSERT OR IGNORE INTO store_promotions (id, name, active, rule_type, value, min_subtotal, min_qty, category, product_id, starts_at, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`
      );
      insPromo.run('prm-vip-500', 'خصم 5% على الفاتورة فوق 500 ج.م', 1, 'percent', 5, 500, 0, 'all', created);
      insPromo.run('prm-pasta-3', 'اشتري 3 مكرونة واحصل على خصم 10 ج.م', 1, 'fixed', 10, 0, 3, 'مكرونة وبقوليات', created);
    }
  }

  private mapBatchRow(r: Record<string, unknown>): ProductBatch {
    return {
      id: String(r.id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      batchCode: String(r.batch_code),
      expiryDate: r.expiry_date ? String(r.expiry_date) : null,
      qty: Number(r.qty || 0),
      costPrice: Number(r.cost_price || 0),
      supplierId: r.supplier_id ? String(r.supplier_id) : null,
      purchaseId: r.purchase_id ? String(r.purchase_id) : null,
      createdAt: String(r.created_at),
    };
  }

  public listBatches(productId?: string): ProductBatch[] {
    const rows = productId
      ? (this.db
          .prepare(
            `SELECT * FROM product_batches
             WHERE product_id = ?
             ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC, expiry_date ASC, created_at ASC`
          )
          .all(productId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(
            `SELECT * FROM product_batches
             ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC, expiry_date ASC, created_at DESC`
          )
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapBatchRow(r));
  }

  public createBatch(input: {
    productId: string;
    batchCode: string;
    expiryDate?: string | null;
    qty: number;
    costPrice?: number;
    supplierId?: string | null;
    purchaseId?: string | null;
    syncProductStock?: boolean;
  }): ProductBatch {
    const prod = this.db
      .prepare('SELECT id, name, current_cost_price, stock_qty, supplier_id FROM products WHERE id = ?')
      .get(input.productId) as
      | { id: string; name: string; current_cost_price: number; stock_qty: number; supplier_id: string | null }
      | undefined;
    if (!prod) throw new Error('الصنف غير موجود.');

    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('كمية التشغيلة يجب أن تكون أكبر من صفر.');
    const code = sanitizeText(input.batchCode, 64) || `LOT-${Date.now().toString().slice(-6)}`;
    const expiryDate = input.expiryDate && String(input.expiryDate).trim() ? String(input.expiryDate).trim().slice(0, 10) : null;
    const costPrice =
      input.costPrice !== undefined && Number.isFinite(Number(input.costPrice))
        ? roundMoney(Number(input.costPrice))
        : Number(prod.current_cost_price || 0);
    const id = `bat-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO product_batches (id, product_id, product_name, batch_code, expiry_date, qty, cost_price, supplier_id, purchase_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          prod.id,
          prod.name,
          code,
          expiryDate,
          Number(qty.toFixed(3)),
          costPrice,
          input.supplierId ?? prod.supplier_id ?? null,
          input.purchaseId ?? null,
          now
        );

      if (input.syncProductStock) {
        const nextStock = Number((Number(prod.stock_qty) + qty).toFixed(3));
        this.db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(nextStock, now, prod.id);
      }
    });
    tx();

    const row = this.db.prepare('SELECT * FROM product_batches WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapBatchRow(row);
  }

  public deleteBatch(id: string): void {
    this.db.prepare('DELETE FROM product_batches WHERE id = ?').run(id);
  }

  /**
   * FEFO consumption: deducts sold qty starting from earliest non-null expiry date.
   */
  public consumeFefoBatches(productId: string, qtyToConsume: number): void {
    let remaining = Number(qtyToConsume);
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    const batches = this.db
      .prepare(
        `SELECT id, qty FROM product_batches
         WHERE product_id = ? AND qty > 0
         ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC, expiry_date ASC, created_at ASC`
      )
      .all(productId) as Array<{ id: string; qty: number }>;

    const upd = this.db.prepare('UPDATE product_batches SET qty = ? WHERE id = ?');
    for (const batch of batches) {
      if (remaining <= 0.0001) break;
      const take = Math.min(remaining, Number(batch.qty));
      const next = Number(Math.max(0, Number(batch.qty) - take).toFixed(3));
      upd.run(next, batch.id);
      remaining = Number((remaining - take).toFixed(3));
    }
  }

  /**
   * Restores returned quantity onto the most recent active or historical batch for that product.
   */
  public restoreBatchQty(productId: string, qtyToRestore: number): void {
    const qty = Number(qtyToRestore);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const latestBatch = this.db
      .prepare(
        `SELECT id, qty FROM product_batches
         WHERE product_id = ?
         ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC, expiry_date DESC, created_at DESC
         LIMIT 1`
      )
      .get(productId) as { id: string; qty: number } | undefined;

    if (latestBatch) {
      const next = Number((Number(latestBatch.qty) + qty).toFixed(3));
      this.db.prepare('UPDATE product_batches SET qty = ? WHERE id = ?').run(next, latestBatch.id);
    }
  }

  public getExpiringSoonBatches(withinDays = 30): ProductBatch[] {
    const cutoff = new Date(Date.now() + withinDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = this.db
      .prepare(
        `SELECT * FROM product_batches
         WHERE qty > 0 AND expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date <= ?
         ORDER BY expiry_date ASC`
      )
      .all(cutoff) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapBatchRow(r));
  }

  private mapPromoRow(r: Record<string, unknown>): StorePromotion {
    return {
      id: String(r.id),
      name: String(r.name),
      active: Boolean(r.active),
      ruleType: String(r.rule_type) as PromotionRuleType,
      value: Number(r.value || 0),
      minSubtotal: Number(r.min_subtotal || 0),
      minQty: Number(r.min_qty || 0),
      category: String(r.category || 'all'),
      productId: r.product_id ? String(r.product_id) : null,
      startsAt: r.starts_at ? String(r.starts_at) : null,
      endsAt: r.ends_at ? String(r.ends_at) : null,
      createdAt: String(r.created_at),
    };
  }

  public listPromotions(): StorePromotion[] {
    const rows = this.db
      .prepare('SELECT * FROM store_promotions ORDER BY active DESC, created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPromoRow(r));
  }

  public createPromotion(input: {
    name: string;
    ruleType: PromotionRuleType;
    value: number;
    minSubtotal?: number;
    minQty?: number;
    category?: string;
    productId?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    active?: boolean;
  }): StorePromotion {
    const name = sanitizeText(input.name, 140);
    if (!name) throw new Error('اسم العرض الترويجي مطلوب.');
    const value = Number(input.value || 0);
    if (!Number.isFinite(value) || value <= 0) throw new Error('قيمة العرض يجب أن تكون أكبر من صفر.');
    if (input.ruleType === 'percent' && value > 90) {
      throw new Error('نسبة الخصم لا يمكن أن تتجاوز 90%.');
    }

    const id = `prm-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO store_promotions (id, name, active, rule_type, value, min_subtotal, min_qty, category, product_id, starts_at, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        input.active === false ? 0 : 1,
        input.ruleType || 'percent',
        roundMoney(value),
        roundMoney(Math.max(0, Number(input.minSubtotal || 0))),
        Math.max(0, Number(input.minQty || 0)),
        sanitizeText(input.category || 'all', 80) || 'all',
        input.productId || null,
        input.startsAt ? String(input.startsAt).trim() : null,
        input.endsAt ? String(input.endsAt).trim() : null,
        now
      );

    const row = this.db.prepare('SELECT * FROM store_promotions WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapPromoRow(row);
  }

  public updatePromotion(
    id: string,
    patch: Partial<Omit<StorePromotion, 'id' | 'createdAt'>>
  ): StorePromotion {
    const existingRow = this.db.prepare('SELECT * FROM store_promotions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) throw new Error('العرض الترويجي غير موجود.');
    const existing = this.mapPromoRow(existingRow);

    const nextActive = patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active ? 1 : 0;
    const nextName = patch.name !== undefined ? sanitizeText(patch.name, 140) || existing.name : existing.name;
    const nextValue = patch.value !== undefined ? roundMoney(Math.max(0.01, Number(patch.value))) : existing.value;
    const nextMinSubtotal =
      patch.minSubtotal !== undefined ? roundMoney(Math.max(0, Number(patch.minSubtotal))) : existing.minSubtotal;
    const nextMinQty = patch.minQty !== undefined ? Math.max(0, Number(patch.minQty)) : existing.minQty;
    const nextRule = patch.ruleType || existing.ruleType;
    const nextCat = patch.category !== undefined ? sanitizeText(patch.category, 80) || 'all' : existing.category;
    const nextProd = patch.productId !== undefined ? patch.productId : existing.productId;

    this.db
      .prepare(
        `UPDATE store_promotions
         SET name = ?, active = ?, rule_type = ?, value = ?, min_subtotal = ?, min_qty = ?, category = ?, product_id = ?, starts_at = ?, ends_at = ?
         WHERE id = ?`
      )
      .run(
        nextName,
        nextActive,
        nextRule,
        nextValue,
        nextMinSubtotal,
        nextMinQty,
        nextCat,
        nextProd,
        patch.startsAt !== undefined ? patch.startsAt : existing.startsAt,
        patch.endsAt !== undefined ? patch.endsAt : existing.endsAt,
        id
      );

    const updated = this.db.prepare('SELECT * FROM store_promotions WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapPromoRow(updated);
  }

  public deletePromotion(id: string): void {
    this.db.prepare('DELETE FROM store_promotions WHERE id = ?').run(id);
  }
}
