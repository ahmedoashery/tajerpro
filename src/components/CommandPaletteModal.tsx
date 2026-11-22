import {
  ArrowLeft,
  Boxes,
  Calculator,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { BootstrapSnapshot, RolePermissionsMap, StaffUser } from '../shared/types';
import { formatEGP, formatNum, getEffectivePermissions } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: BootstrapSnapshot;
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  onNavigate: (tab: NavTabId, options?: { forceNew?: boolean }) => void;
  onOpenShiftClosing: () => void;
  onOpenStoreProfile: () => void;
  onOpenServerConfig: () => void;
  onOpenUserSwitch: () => void;
}

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  icon: typeof Search;
  action: () => void;
}

export function CommandPaletteModal({
  open,
  onClose,
  snapshot,
  currentUser,
  rolePermissions,
  onNavigate,
  onOpenShiftClosing,
  onOpenStoreProfile,
  onOpenServerConfig,
  onOpenUserSwitch,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 140);
  const [activeIdx, setActiveIdx] = useState(0);

  const perms = getEffectivePermissions(currentUser, rolePermissions);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = debounced.trim().toLowerCase();
    const list: PaletteItem[] = [];

    const navEntries: Array<{
      id: NavTabId;
      title: string;
      subtitle: string;
      icon: typeof Search;
      allowed: boolean;
      forceNew?: boolean;
    }> = [
      { id: 'dashboard', title: 'ملخص المحل اليومي', subtitle: 'لوحة الأداء والتنبيهات', icon: Store, allowed: true },
      { id: 'pos', title: 'شاشة الكاشير والبيع', subtitle: 'إصدار فاتورة بيع سريعة (F2)', icon: ShoppingCart, allowed: Boolean(perms.pos_sell) },
      { id: 'sales_invoice', title: 'فاتورة مبيعات (جدول الأصناف)', subtitle: 'جدول أصناف بقائمة بحث وتخصيص الأسعار (F3)', icon: FileSpreadsheet, allowed: Boolean(perms.pos_sell) },
      { id: 'inventory', title: 'المخزون والأسعار والجرد', subtitle: 'إدارة الأصناف والباركود', icon: Boxes, allowed: true },
      { id: 'purchases', title: 'المشتريات وفواتير التوريد', subtitle: 'توريد بضاعة من الموردين', icon: Truck, allowed: Boolean(perms.manage_purchases) },
      { id: 'expenses', title: 'المصروفات والخزينة اليومية', subtitle: 'تسجيل المصاريف وصافي الربح', icon: Wallet, allowed: Boolean(perms.manage_expenses) },
      { id: 'invoices', title: 'الفواتير والأرباح التاريخية', subtitle: 'عرض التفاصيل والمرتجعات', icon: FileText, allowed: true },
      { id: 'partners_payments', title: 'العملاء والآجل والدفع الإلكتروني', subtitle: 'التحصيل وبوابات الدفع', icon: Users, allowed: Boolean(perms.manage_partners) },
      { id: 'settings_data', title: 'الإعدادات والبيانات والنماذج', subtitle: 'الخزائن، XLSX، قوالب الطباعة والصور PNG', icon: Settings, allowed: Boolean(perms.manage_settings || perms.manage_data_xlsx) },
      { id: 'security_license', title: 'الصلاحيات والمستخدمين والترخيص', subtitle: 'إدارة الأدوار وسجل التدقيق', icon: ShieldCheck, allowed: Boolean(perms.manage_security_rbac) },
    ];

    for (const nav of navEntries) {
      if (!nav.allowed) continue;
      list.push({
        id: `nav-${nav.id}`,
        group: 'الشاشات والموديولات',
        title: nav.title,
        subtitle: nav.subtitle,
        icon: nav.icon,
        action: () => {
          onNavigate(nav.id, nav.forceNew ? { forceNew: true } : undefined);
          onClose();
        },
      });
    }

    list.push(
      {
        id: 'act-shift',
        group: 'إجراءات سريعة',
        title: 'تقفيل الوردية وجرد الدرج (Z-Report)',
        subtitle: 'مطابقة النقدية وطباعة تقرير الوردية',
        icon: Calculator,
        action: () => {
          onClose();
          onOpenShiftClosing();
        },
      },
      {
        id: 'act-store',
        group: 'إجراءات سريعة',
        title: 'بيانات المحل وترويسة الطباعة',
        subtitle: 'تعديل اسم المتجر والهاتف والضريبة',
        icon: Store,
        action: () => {
          onClose();
          onOpenStoreProfile();
        },
      },
      {
        id: 'act-server',
        group: 'إجراءات سريعة',
        title: 'إعدادات الخادم وقاعدة البيانات',
        subtitle: 'SQLite / MySQL وعنوان خادم الشبكة',
        icon: Server,
        action: () => {
          onClose();
          onOpenServerConfig();
        },
      },
      {
        id: 'act-user',
        group: 'إجراءات سريعة',
        title: 'تبديل الموظف (PIN)',
        subtitle: 'الدخول بحساب موظف آخر',
        icon: KeyRound,
        action: () => {
          onClose();
          onOpenUserSwitch();
        },
      }
    );

    if (q) {
      for (const p of snapshot.products) {
        if (p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.sku.toLowerCase().includes(q)) {
          list.push({
            id: `prod-${p.id}`,
            group: 'أصناف المخزون',
            title: p.name,
            subtitle: `السعر: ${formatEGP(p.currentSalePrice)} · المتاح: ${formatNum(p.stockQty)} ${p.unit} · باركود: ${p.barcode}`,
            icon: Boxes,
            action: () => {
              onNavigate('inventory');
              onClose();
            },
          });
        }
      }

      for (const inv of snapshot.invoices) {
        if (inv.invoiceNumber.toLowerCase().includes(q) || inv.customerName.toLowerCase().includes(q)) {
          list.push({
            id: `inv-${inv.id}`,
            group: 'الفواتير',
            title: `${inv.invoiceNumber} — ${inv.customerName}`,
            subtitle: `الإجمالي: ${formatEGP(inv.grandTotal)} · الكاشير: ${inv.cashierName}`,
            icon: FileText,
            action: () => {
              onNavigate('invoices');
              onClose();
            },
          });
        }
      }
      if (perms.manage_partners) {
        for (const c of snapshot.customers) {
          if (c.name.toLowerCase().includes(q) || c.phone.includes(q)) {
            list.push({
              id: `cust-${c.id}`,
              group: 'العملاء',
              title: c.name,
              subtitle: `هاتف: ${c.phone || '—'} · الرصيد: ${formatEGP(c.balanceDue)}`,
              icon: Users,
              action: () => {
                onNavigate('partners_payments');
                onClose();
              },
            });
          }
        }
        for (const s of snapshot.suppliers) {
          if (s.name.toLowerCase().includes(q) || s.phone.includes(q) || s.category.toLowerCase().includes(q)) {
            list.push({
              id: `sup-${s.id}`,
              group: 'الموردين',
              title: s.name,
              subtitle: `${s.category || 'مورد'} · المستحق له: ${formatEGP(s.balanceDue)}`,
              icon: Truck,
              action: () => {
                onNavigate('partners_payments');
                onClose();
              },
            });
          }
        }
      }
    }

    const filtered = q
      ? list.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.subtitle.toLowerCase().includes(q) ||
            item.group.toLowerCase().includes(q)
        )
      : list;

    return filtered.slice(0, 18);
  }, [
    debounced,
    perms,
    snapshot.products,
    snapshot.invoices,
    snapshot.customers,
    snapshot.suppliers,
    onNavigate,
    onClose,
    onOpenShiftClosing,
    onOpenStoreProfile,
    onOpenServerConfig,
    onOpenUserSwitch,
  ]);

  useEffect(() => {
    setActiveIdx(0);
  }, [items.length]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter' && items[activeIdx]) {
      e.preventDefault();
      items[activeIdx].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="no-print fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/65 p-4 pt-16 sm:pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 text-emerald-600 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن شاشة، أمر سريع، صنف بالباركود، أو رقم فاتورة..."
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
          <span className="hidden sm:inline font-mono-num text-[11px] text-slate-400">ESC</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              لا توجد نتائج مطابقة للبحث.
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === activeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={item.action}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right transition-colors ${
                    isActive
                      ? 'bg-emerald-50/90 dark:bg-emerald-500/15'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                        {item.title}
                      </div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400">{item.group}</span>
                    <ArrowLeft className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
