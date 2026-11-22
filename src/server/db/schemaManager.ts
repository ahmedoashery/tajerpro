import type Database from 'better-sqlite3';

/**
 * SchemaManager owns SQLite DDL initialization, idempotent migrations,
 * legacy tier backfills, and query performance indexes (Single Responsibility).
 */
export class SchemaManager {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public initialize(): void {
    this.createCoreTables();
    this.runMigrations();
    this.backfillLegacyPriceTiers();
    this.upgradeAuditLogsIfLegacy();
    this.createIndexes();
  }

  private createCoreTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        store_name TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        tax_number TEXT NOT NULL DEFAULT '',
        receipt_footer TEXT NOT NULL,
        license_key TEXT NOT NULL,
        payment_config_json TEXT NOT NULL,
        mysql_config_json TEXT NOT NULL,
        role_permissions_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS staff_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        category TEXT NOT NULL,
        balance_due REAL NOT NULL DEFAULT 0,
        last_supply_at TEXT
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        balance_due REAL NOT NULL DEFAULT 0,
        total_purchases REAL NOT NULL DEFAULT 0,
        last_purchase_at TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        attribute_value TEXT NOT NULL DEFAULT '',
        activity_id TEXT NOT NULL,
        current_cost_price REAL NOT NULL,
        current_sale_price REAL NOT NULL,
        half_wholesale_price REAL NOT NULL DEFAULT 0,
        wholesale_price REAL NOT NULL DEFAULT 0,
        stock_qty REAL NOT NULL DEFAULT 0,
        min_stock_alert REAL NOT NULL DEFAULT 5,
        max_stock_limit REAL NOT NULL DEFAULT 60,
        supplier_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS product_price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        old_cost_price REAL NOT NULL,
        new_cost_price REAL NOT NULL,
        old_sale_price REAL NOT NULL,
        new_sale_price REAL NOT NULL,
        changed_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        activity_id TEXT NOT NULL DEFAULT 'grocery',
        created_at TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        terminal_name TEXT NOT NULL,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        payment_ref TEXT NOT NULL DEFAULT '',
        subtotal REAL NOT NULL,
        discount_total REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL,
        total_cost_at_sale REAL NOT NULL,
        total_profit REAL NOT NULL,
        paid_amount REAL NOT NULL,
        change_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        notes TEXT NOT NULL DEFAULT '',
        prev_hash TEXT NOT NULL,
        row_hash TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        activity_id TEXT NOT NULL DEFAULT 'grocery',
        unit TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_cost_at_sale REAL NOT NULL,
        unit_sale_price REAL NOT NULL,
        price_tier TEXT NOT NULL DEFAULT 'retail',
        discount_amount REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL,
        line_profit REAL NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payment_transactions (
        id TEXT PRIMARY KEY,
        invoice_id TEXT,
        invoice_number TEXT NOT NULL,
        method TEXT NOT NULL,
        provider TEXT NOT NULL,
        amount REAL NOT NULL,
        fee_amount REAL NOT NULL DEFAULT 0,
        net_amount REAL NOT NULL,
        reference_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'settled',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        delta_qty REAL NOT NULL,
        after_qty REAL NOT NULL,
        reason TEXT NOT NULL,
        terminal_name TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shift_closures (
        id TEXT PRIMARY KEY,
        closed_at TEXT NOT NULL,
        period_start_at TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        opening_float REAL NOT NULL DEFAULT 0,
        cash_sales REAL NOT NULL DEFAULT 0,
        expected_cash REAL NOT NULL DEFAULT 0,
        actual_cash REAL NOT NULL DEFAULT 0,
        variance REAL NOT NULL DEFAULT 0,
        instapay_total REAL NOT NULL DEFAULT 0,
        wallet_total REAL NOT NULL DEFAULT 0,
        card_total REAL NOT NULL DEFAULT 0,
        credit_total REAL NOT NULL DEFAULT 0,
        invoice_count INTEGER NOT NULL DEFAULT 0,
        returned_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        purchase_number TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        activity_id TEXT NOT NULL DEFAULT 'grocery',
        created_at TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        supplier_invoice_ref TEXT NOT NULL DEFAULT '',
        grand_total REAL NOT NULL,
        paid_amount REAL NOT NULL DEFAULT 0,
        remaining_debt REAL NOT NULL DEFAULT 0,
        payment_source TEXT NOT NULL DEFAULT 'cash',
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        new_sale_price REAL,
        line_total REAL NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS store_expenses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_source TEXT NOT NULL DEFAULT 'cash_drawer',
        actor_name TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS treasuries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        account_number TEXT NOT NULL DEFAULT '',
        current_balance REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoice_payment_allocations (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        treasury_id TEXT,
        treasury_name TEXT NOT NULL,
        method TEXT NOT NULL,
        amount REAL NOT NULL,
        fee_amount REAL NOT NULL DEFAULT 0,
        reference_code TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS document_templates (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        paper_size TEXT NOT NULL DEFAULT 'a4',
        style TEXT NOT NULL DEFAULT 'modern_emerald',
        accent_color TEXT NOT NULL DEFAULT '#059669',
        header_title TEXT NOT NULL DEFAULT '',
        header_subtitle TEXT NOT NULL DEFAULT '',
        footer_note TEXT NOT NULL DEFAULT '',
        show_logo INTEGER NOT NULL DEFAULT 1,
        show_tax_number INTEGER NOT NULL DEFAULT 1,
        show_barcode INTEGER NOT NULL DEFAULT 1,
        show_split_payments INTEGER NOT NULL DEFAULT 1,
        show_signature_line INTEGER NOT NULL DEFAULT 1,
        columns_json TEXT NOT NULL DEFAULT '[]',
        sample_rows_json TEXT NOT NULL DEFAULT '[]',
        preview_png_data_url TEXT NOT NULL DEFAULT '',
        xlsx_file_name TEXT NOT NULL,
        png_file_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS equity_partners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        role_title TEXT NOT NULL DEFAULT 'شريك',
        capital_contribution REAL NOT NULL DEFAULT 0,
        profit_share_percent REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equity_drawings (
        id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL,
        partner_name TEXT NOT NULL,
        amount REAL NOT NULL,
        treasury_id TEXT,
        treasury_name TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'draw',
        notes TEXT NOT NULL DEFAULT '',
        actor_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (partner_id) REFERENCES equity_partners(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS custom_report_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_batches (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        batch_code TEXT NOT NULL,
        expiry_date TEXT,
        qty REAL NOT NULL DEFAULT 0,
        cost_price REAL NOT NULL DEFAULT 0,
        supplier_id TEXT,
        purchase_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS store_promotions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        rule_type TEXT NOT NULL DEFAULT 'percent',
        value REAL NOT NULL DEFAULT 0,
        min_subtotal REAL NOT NULL DEFAULT 0,
        min_qty REAL NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'all',
        product_id TEXT,
        starts_at TEXT,
        ends_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoice_returns (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        return_total REAL NOT NULL DEFAULT 0,
        cash_refunded REAL NOT NULL DEFAULT 0,
        credit_debt_reduced REAL NOT NULL DEFAULT 0,
        store_credit_added REAL NOT NULL DEFAULT 0,
        treasury_id TEXT,
        treasury_name TEXT NOT NULL DEFAULT '',
        exchange_invoice_id TEXT,
        exchange_invoice_number TEXT,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS invoice_return_items (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL,
        invoice_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        refund_amount REAL NOT NULL,
        cost_recovered REAL NOT NULL,
        FOREIGN KEY (return_id) REFERENCES invoice_returns(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS purchase_returns (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        return_total REAL NOT NULL DEFAULT 0,
        debt_reduced REAL NOT NULL DEFAULT 0,
        cash_refunded REAL NOT NULL DEFAULT 0,
        treasury_id TEXT,
        treasury_name TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (purchase_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS purchase_return_items (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL,
        purchase_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        refund_amount REAL NOT NULL,
        FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_source TEXT NOT NULL DEFAULT 'cash_drawer',
        treasury_id TEXT,
        treasury_name TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL DEFAULT 'monthly',
        next_due_date TEXT NOT NULL,
        last_paid_at TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_report_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        frequency TEXT NOT NULL DEFAULT 'daily',
        day_of_week INTEGER NOT NULL DEFAULT 6,
        send_time TEXT NOT NULL DEFAULT '21:00',
        channel TEXT NOT NULL DEFAULT 'in_app',
        recipient_emails_json TEXT NOT NULL DEFAULT '[]',
        activity_filter TEXT NOT NULL DEFAULT 'all',
        include_profits INTEGER NOT NULL DEFAULT 1,
        include_alerts INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_run_period_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_report_digests (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        schedule_name TEXT NOT NULL,
        frequency TEXT NOT NULL,
        period_key TEXT NOT NULL,
        from_date TEXT NOT NULL,
        to_date TEXT NOT NULL,
        title TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        channel TEXT NOT NULL,
        in_app_delivered INTEGER NOT NULL DEFAULT 1,
        email_status TEXT NOT NULL DEFAULT 'not_requested',
        email_error TEXT NOT NULL DEFAULT '',
        recipient_emails_json TEXT NOT NULL DEFAULT '[]',
        read_by_user_ids_json TEXT NOT NULL DEFAULT '[]',
        is_manual_run INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sales_quotations (
        id TEXT PRIMARY KEY,
        quotation_number TEXT UNIQUE NOT NULL,
        activity_id TEXT NOT NULL,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        items_json TEXT NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        discount_total REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        valid_until TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        converted_invoice_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private safeAlter(sql: string): void {
    try {
      this.db.exec(sql);
    } catch {
      // Column already exists
    }
  }

  private runMigrations(): void {
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN role_permissions_json TEXT NOT NULL DEFAULT '{}'`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN vat_percent REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN auto_print_after_sale INTEGER NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN require_login_on_start INTEGER NOT NULL DEFAULT 1`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN print_template_json TEXT NOT NULL DEFAULT '{}'`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN auth_secret TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN credit_limit REAL NOT NULL DEFAULT 5000`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE suppliers ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE products ADD COLUMN max_stock_limit REAL NOT NULL DEFAULT 60`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN activity_id TEXT NOT NULL DEFAULT 'grocery'`);
    this.safeAlter(`ALTER TABLE invoice_items ADD COLUMN activity_id TEXT NOT NULL DEFAULT 'grocery'`);
    this.safeAlter(`ALTER TABLE payment_transactions ADD COLUMN treasury_id TEXT`);
    this.safeAlter(`ALTER TABLE payment_transactions ADD COLUMN treasury_name TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE store_expenses ADD COLUMN treasury_id TEXT`);
    this.safeAlter(`ALTER TABLE store_expenses ADD COLUMN treasury_name TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE staff_users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1`);
    this.safeAlter(`ALTER TABLE staff_users ADD COLUMN custom_permissions_json TEXT NOT NULL DEFAULT '{}'`);
    this.safeAlter(`ALTER TABLE purchase_orders ADD COLUMN treasury_id TEXT`);
    this.safeAlter(`ALTER TABLE purchase_orders ADD COLUMN treasury_name TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE payment_transactions ADD COLUMN partner_id TEXT`);
    this.safeAlter(`ALTER TABLE store_expenses ADD COLUMN receipt_ref TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE shift_closures ADD COLUMN cash_expenses REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE products ADD COLUMN half_wholesale_price REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE products ADD COLUMN wholesale_price REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoice_items ADD COLUMN price_tier TEXT NOT NULL DEFAULT 'retail'`);
    this.safeAlter(`ALTER TABLE invoice_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN returned_total REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN due_date TEXT`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN loyalty_points_earned REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN loyalty_points_redeemed REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN store_credit_used REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN promotion_discount REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE invoices ADD COLUMN exchange_for_invoice_id TEXT`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN loyalty_points REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN store_credit_balance REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE store_settings ADD COLUMN loyalty_config_json TEXT NOT NULL DEFAULT '{}'`);
    this.safeAlter(`ALTER TABLE purchase_items ADD COLUMN batch_code TEXT NOT NULL DEFAULT ''`);
    this.safeAlter(`ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT`);
    this.safeAlter(`ALTER TABLE shift_closures ADD COLUMN cash_collections REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE shift_closures ADD COLUMN cash_returns REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE shift_closures ADD COLUMN cash_supplier_payouts REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE shift_closures ADD COLUMN cash_equity_drawings REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN default_price_tier TEXT NOT NULL DEFAULT 'retail'`);
    this.safeAlter(`ALTER TABLE customers ADD COLUMN default_discount_percent REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE purchase_orders ADD COLUMN returned_total REAL NOT NULL DEFAULT 0`);
    this.safeAlter(`ALTER TABLE purchase_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0`);
  }

  private backfillLegacyPriceTiers(): void {
    this.db.exec(`
      UPDATE products
      SET
        half_wholesale_price = ROUND(CASE WHEN current_cost_price > 0 THEN MAX(current_cost_price, current_sale_price * 0.94) ELSE current_sale_price * 0.94 END, 2),
        wholesale_price = ROUND(CASE WHEN current_cost_price > 0 THEN MAX(current_cost_price, current_sale_price * 0.88) ELSE current_sale_price * 0.88 END, 2)
      WHERE wholesale_price <= 0 AND half_wholesale_price <= 0 AND current_sale_price > 0;
    `);
  }

  private upgradeAuditLogsIfLegacy(): void {
    const audCols = this.db.prepare(`PRAGMA table_info(security_audit_logs)`).all() as Array<{ name: string }>;
    if (!audCols.some((c) => c.name === 'timestamp')) {
      this.db.exec(`
        DROP TABLE IF EXISTS security_audit_logs;
        CREATE TABLE security_audit_logs (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          action TEXT NOT NULL,
          category TEXT NOT NULL,
          target TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL DEFAULT ''
        );
      `);
    }
  }

  private createIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_products_activity ON products(activity_id);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
      CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_allocs_invoice ON invoice_payment_allocations(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payment_tx_created_at ON payment_transactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_payment_tx_invoice ON payment_transactions(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payment_tx_partner ON payment_transactions(partner_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON store_expenses(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_treasury ON store_expenses(treasury_id);
      CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchase_orders(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_items_po ON purchase_items(purchase_id);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON security_audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_equity_drawings_partner ON equity_drawings(partner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches(product_id, expiry_date ASC);
      CREATE INDEX IF NOT EXISTS idx_invoice_returns_invoice ON invoice_returns(invoice_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_purchase_returns_po ON purchase_returns(purchase_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_due ON recurring_expenses(next_due_date ASC);
      CREATE INDEX IF NOT EXISTS idx_scheduled_digests_created ON scheduled_report_digests(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quotations_created ON sales_quotations(created_at DESC);
    `);
  }
}
