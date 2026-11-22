import mysql from 'mysql2/promise';

export const MYSQL_PRODUCTION_SCHEMA_SQL = `-- TajirPro POS & Store Management — Production MySQL 8.0+ Schema
-- Supports local or external MySQL deployment with immutable historical invoice profit snapshots

CREATE DATABASE IF NOT EXISTS tajirpro_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tajirpro_pos;

CREATE TABLE IF NOT EXISTS store_settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  store_name VARCHAR(160) NOT NULL,
  activity_id VARCHAR(40) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  address VARCHAR(255) NOT NULL,
  tax_number VARCHAR(64) NOT NULL DEFAULT '',
  receipt_footer VARCHAR(255) NOT NULL,
  vat_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  allow_negative_stock TINYINT(1) NOT NULL DEFAULT 0,
  auto_print_after_sale TINYINT(1) NOT NULL DEFAULT 0,
  require_login_on_start TINYINT(1) NOT NULL DEFAULT 1,
  print_template_json JSON NOT NULL,
  license_key TEXT NOT NULL,
  payment_config_json JSON NOT NULL,
  role_permissions_json JSON NOT NULL,
  loyalty_config_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_users (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  role ENUM('owner', 'manager', 'cashier') NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS treasuries (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  type ENUM('cash_drawer','instapay','wallet','bank_pos') NOT NULL,
  account_number VARCHAR(120) NOT NULL DEFAULT '',
  current_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  category VARCHAR(100) NOT NULL,
  balance_due DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  last_supply_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  balance_due DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  credit_limit DECIMAL(12,2) NOT NULL DEFAULT 5000.00,
  total_purchases DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  loyalty_points DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  store_credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  last_purchase_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(48) PRIMARY KEY,
  sku VARCHAR(64) NOT NULL,
  barcode VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  attribute_value VARCHAR(100) NOT NULL DEFAULT '',
  activity_id VARCHAR(40) NOT NULL,
  current_cost_price DECIMAL(12,2) NOT NULL,
  current_sale_price DECIMAL(12,2) NOT NULL,
  stock_qty DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  min_stock_alert DECIMAL(12,3) NOT NULL DEFAULT 5.000,
  max_stock_limit DECIMAL(12,3) NOT NULL DEFAULT 60.000,
  supplier_id VARCHAR(48) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_products_activity (activity_id),
  INDEX idx_products_barcode (barcode),
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_price_history (
  id VARCHAR(48) PRIMARY KEY,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  old_cost_price DECIMAL(12,2) NOT NULL,
  new_cost_price DECIMAL(12,2) NOT NULL,
  old_sale_price DECIMAL(12,2) NOT NULL,
  new_sale_price DECIMAL(12,2) NOT NULL,
  changed_by VARCHAR(120) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_price_hist_product (product_id, changed_at),
  CONSTRAINT fk_price_hist_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(48) PRIMARY KEY,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  activity_id VARCHAR(40) NOT NULL DEFAULT 'grocery',
  created_at DATETIME NOT NULL,
  cashier_name VARCHAR(120) NOT NULL,
  terminal_name VARCHAR(120) NOT NULL,
  customer_id VARCHAR(48) NULL,
  customer_name VARCHAR(160) NOT NULL,
  payment_method ENUM('cash','instapay','vodafone_cash','card','credit','split') NOT NULL,
  payment_ref VARCHAR(120) NOT NULL DEFAULT '',
  subtotal DECIMAL(12,2) NOT NULL,
  discount_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(12,2) NOT NULL,
  total_cost_at_sale DECIMAL(12,2) NOT NULL,
  total_profit DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) NOT NULL,
  change_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('completed','partial_returned','returned') NOT NULL DEFAULT 'completed',
  returned_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  due_date DATE NULL,
  loyalty_points_earned DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  loyalty_points_redeemed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  store_credit_used DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  promotion_discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  exchange_for_invoice_id VARCHAR(48) NULL,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  prev_hash CHAR(64) NOT NULL,
  row_hash CHAR(64) NOT NULL,
  INDEX idx_invoices_created (created_at),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Critical: Each line item snapshots unit_cost_at_sale and unit_sale_price at invoice timestamp
CREATE TABLE IF NOT EXISTS invoice_items (
  id VARCHAR(48) PRIMARY KEY,
  invoice_id VARCHAR(48) NOT NULL,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  activity_id VARCHAR(40) NOT NULL DEFAULT 'grocery',
  unit VARCHAR(40) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  returned_quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  unit_cost_at_sale DECIMAL(12,2) NOT NULL,
  unit_sale_price DECIMAL(12,2) NOT NULL,
  price_tier VARCHAR(24) NOT NULL DEFAULT 'retail',
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL,
  line_profit DECIMAL(12,2) NOT NULL,
  INDEX idx_invoice_items_inv (invoice_id),
  CONSTRAINT fk_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_payment_allocations (
  id VARCHAR(48) PRIMARY KEY,
  invoice_id VARCHAR(48) NOT NULL,
  treasury_id VARCHAR(48) NULL,
  treasury_name VARCHAR(160) NOT NULL,
  method ENUM('cash','instapay','vodafone_cash','card','credit') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  reference_code VARCHAR(120) NOT NULL DEFAULT '',
  INDEX idx_alloc_inv (invoice_id),
  CONSTRAINT fk_alloc_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id VARCHAR(48) PRIMARY KEY,
  invoice_id VARCHAR(48) NULL,
  invoice_number VARCHAR(64) NOT NULL,
  treasury_id VARCHAR(48) NULL,
  treasury_name VARCHAR(160) NOT NULL DEFAULT '',
  method ENUM('cash','instapay','vodafone_cash','card','credit') NOT NULL,
  provider VARCHAR(80) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount DECIMAL(12,2) NOT NULL,
  reference_code VARCHAR(120) NOT NULL DEFAULT '',
  status ENUM('settled','pending','refunded') NOT NULL DEFAULT 'settled',
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id VARCHAR(48) PRIMARY KEY,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  delta_qty DECIMAL(12,3) NOT NULL,
  after_qty DECIMAL(12,3) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  terminal_name VARCHAR(120) NOT NULL,
  actor_name VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_movements_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id VARCHAR(48) PRIMARY KEY,
  purchase_number VARCHAR(64) NOT NULL UNIQUE,
  supplier_id VARCHAR(48) NOT NULL,
  supplier_name VARCHAR(160) NOT NULL,
  activity_id VARCHAR(40) NOT NULL DEFAULT 'grocery',
  created_at DATETIME NOT NULL,
  actor_name VARCHAR(120) NOT NULL,
  supplier_invoice_ref VARCHAR(80) NOT NULL DEFAULT '',
  grand_total DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  remaining_debt DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_source ENUM('cash','bank_transfer','credit') NOT NULL DEFAULT 'cash',
  notes VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_items (
  id VARCHAR(48) PRIMARY KEY,
  purchase_id VARCHAR(48) NOT NULL,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  new_sale_price DECIMAL(12,2) NULL,
  batch_code VARCHAR(64) NOT NULL DEFAULT '',
  expiry_date DATE NULL,
  line_total DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_purchase_items_order FOREIGN KEY (purchase_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_expenses (
  id VARCHAR(48) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_source ENUM('cash_drawer','bank_instapay','wallet') NOT NULL DEFAULT 'cash_drawer',
  actor_name VARCHAR(120) NOT NULL,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  INDEX idx_expenses_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shift_closures (
  id VARCHAR(48) PRIMARY KEY,
  closed_at DATETIME NOT NULL,
  period_start_at DATETIME NOT NULL,
  cashier_id VARCHAR(48) NOT NULL,
  cashier_name VARCHAR(120) NOT NULL,
  opening_float DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_sales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_collections DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_returns DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_expenses DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_supplier_payouts DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_equity_drawings DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  expected_cash DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  actual_cash DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  variance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  instapay_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  wallet_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  card_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  credit_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  invoice_count INT NOT NULL DEFAULT 0,
  returned_count INT NOT NULL DEFAULT 0,
  notes VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_batches (
  id VARCHAR(48) PRIMARY KEY,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  batch_code VARCHAR(64) NOT NULL,
  expiry_date DATE NULL,
  qty DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  supplier_id VARCHAR(48) NULL,
  purchase_id VARCHAR(48) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_batches_product (product_id, expiry_date),
  CONSTRAINT fk_batches_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_promotions (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  rule_type ENUM('percent','fixed','bogo_qty') NOT NULL DEFAULT 'percent',
  value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  min_subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  min_qty DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  category VARCHAR(80) NOT NULL DEFAULT 'all',
  product_id VARCHAR(48) NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_returns (
  id VARCHAR(48) PRIMARY KEY,
  invoice_id VARCHAR(48) NOT NULL,
  created_at DATETIME NOT NULL,
  actor_name VARCHAR(120) NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  return_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cash_refunded DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  credit_debt_reduced DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  store_credit_added DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  treasury_id VARCHAR(48) NULL,
  treasury_name VARCHAR(160) NOT NULL DEFAULT '',
  exchange_invoice_id VARCHAR(48) NULL,
  exchange_invoice_number VARCHAR(64) NULL,
  CONSTRAINT fk_inv_ret_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_return_items (
  id VARCHAR(48) PRIMARY KEY,
  return_id VARCHAR(48) NOT NULL,
  invoice_item_id VARCHAR(48) NOT NULL,
  product_id VARCHAR(48) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  refund_amount DECIMAL(12,2) NOT NULL,
  cost_recovered DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_inv_ret_items_ret FOREIGN KEY (return_id) REFERENCES invoice_returns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id VARCHAR(48) PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  actor_user_id VARCHAR(48) NOT NULL,
  actor_name VARCHAR(120) NOT NULL,
  action VARCHAR(255) NOT NULL,
  category VARCHAR(40) NOT NULL,
  target VARCHAR(120) NOT NULL DEFAULT '',
  details TEXT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scheduled_report_configs (
  id VARCHAR(48) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  frequency ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
  day_of_week TINYINT NOT NULL DEFAULT 6,
  send_time VARCHAR(5) NOT NULL DEFAULT '21:00',
  channel ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  recipient_emails_json JSON NOT NULL,
  activity_filter VARCHAR(40) NOT NULL DEFAULT 'all',
  include_profits TINYINT(1) NOT NULL DEFAULT 1,
  include_alerts TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME NULL,
  last_run_period_key VARCHAR(32) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scheduled_report_digests (
  id VARCHAR(48) PRIMARY KEY,
  schedule_id VARCHAR(48) NOT NULL,
  schedule_name VARCHAR(160) NOT NULL,
  frequency ENUM('daily','weekly') NOT NULL,
  period_key VARCHAR(32) NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary_json JSON NOT NULL,
  channel ENUM('in_app','email','both') NOT NULL,
  in_app_delivered TINYINT(1) NOT NULL DEFAULT 1,
  email_status ENUM('sent','failed','skipped_not_configured','not_requested') NOT NULL DEFAULT 'not_requested',
  email_error TEXT NOT NULL,
  recipient_emails_json JSON NOT NULL,
  read_by_user_ids_json JSON NOT NULL,
  is_manual_run TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX idx_scheduled_digests_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_quotations (
  id VARCHAR(48) PRIMARY KEY,
  quotation_number VARCHAR(32) NOT NULL UNIQUE,
  activity_id VARCHAR(40) NOT NULL,
  customer_id VARCHAR(48) NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL DEFAULT '',
  status ENUM('active','converted','expired','cancelled') NOT NULL DEFAULT 'active',
  items_json JSON NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  valid_until DATE NOT NULL,
  notes TEXT NOT NULL,
  created_by VARCHAR(120) NOT NULL DEFAULT '',
  converted_invoice_id VARCHAR(48) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_quotations_created (created_at)
) ENGINE=InnoDB;
`;

export async function testExternalMysqlConnection(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}): Promise<{ ok: boolean; message: string; serverVersion?: string }> {
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 4000,
    });
    const [rows] = await conn.query('SELECT VERSION() AS version');
    const first = Array.isArray(rows) && rows[0] ? (rows[0] as { version?: string }) : null;
    return {
      ok: true,
      message: 'تم الاتصال بخادم MySQL الخارجي بنجاح.',
      serverVersion: first?.version || 'MySQL',
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'تعذر الاتصال بخادم MySQL';
    return {
      ok: false,
      message: `فشل الاتصال بخادم MySQL (${errorMessage}). تأكد من تشغيل الخادم وصحة البيانات.`,
    };
  } finally {
    if (conn) {
      await conn.end().catch(() => undefined);
    }
  }
}

export async function provisionExternalMysqlSchema(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      multipleStatements: true,
      connectTimeout: 5000,
    });
    const targetDb = config.database.replace(/[^a-zA-Z0-9_]/g, '') || 'tajirpro_pos';
    const sql = MYSQL_PRODUCTION_SCHEMA_SQL.replace(/tajirpro_pos/g, targetDb);
    await conn.query(sql);
    return {
      ok: true,
      message: `تم بناء وتهيئة جميع جداول قاعدة البيانات "${targetDb}" على خادم MySQL بنجاح.`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'تعذر تهيئة جداول MySQL';
    return {
      ok: false,
      message: `فشل تهيئة الجداول (${errorMessage}).`,
    };
  } finally {
    if (conn) {
      await conn.end().catch(() => undefined);
    }
  }
}

