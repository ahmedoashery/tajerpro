import type {
  ExpenseCategory,
  PaymentMethod,
  PermissionKey,
  RolePermissionsMap,
  StaffUser,
  TreasuryType,
  UserRole,
} from '../shared/types';

export function getEffectivePermissions(
  user: StaffUser | null | undefined,
  rolePermissions: RolePermissionsMap
): Record<PermissionKey, boolean> {
  const base: Record<PermissionKey, boolean> = {
    ...(rolePermissions[user?.role || 'cashier'] || rolePermissions.cashier),
  };
  if (user?.effectivePermissions) {
    return user.effectivePermissions;
  }
  const custom = user?.customPermissions;
  if (custom) {
    for (const key of Object.keys(custom) as PermissionKey[]) {
      if (custom[key] !== undefined) {
        base[key] = Boolean(custom[key]);
      }
    }
  }
  if (user?.id === 'usr-owner') {
    base.manage_security_rbac = true;
  }
  return base;
}

export function formatEGP(amount: number): string {
  return `${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

export function formatNum(val: number): string {
  return Number(val || 0).toLocaleString('en-US', {
    maximumFractionDigits: 3,
  });
}

export function formatDateTimeAr(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDateAr(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleDateString('ar-EG', {
    month: 'short',
    day: 'numeric',
  });
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'نقدي (كاش)',
  instapay: 'إنستا باي (InstaPay)',
  vodafone_cash: 'محفظة إلكترونية',
  card: 'بطاقة بنكية / فيزا',
  credit: 'آجل على العميل',
  split: 'دفع مقسّم (أكثر من خزينة)',
};

export const TREASURY_TYPE_LABELS: Record<TreasuryType, string> = {
  cash_drawer: 'خزينة نقدية / درج كاشير',
  instapay: 'حساب إنستا باي / بنك',
  wallet: 'محفظة إلكترونية (فودافون/اتصالات كاش)',
  bank_pos: 'ماكينة فيزا / بوابة Paymob-Fawry',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'مالك المحل',
  manager: 'مدير الفرع',
  cashier: 'موظف مبيعات / كاشير',
};

export const PERMISSION_LABELS: Record<PermissionKey, { title: string; desc: string }> = {
  pos_sell: {
    title: 'إصدار فواتير البيع (الكاشير)',
    desc: 'البيع من شاشة الكاشير وتحصيل المدفوعات',
  },
  invoice_return: {
    title: 'عمل مرتجع للفواتير',
    desc: 'إلغاء فاتورة سابقة وإرجاع البضاعة للمخزون',
  },
  view_profits_costs: {
    title: 'الاطلاع على التكلفة وصافي الأرباح',
    desc: 'عرض أسعار الشراء الحقيقية وهوامش الربح',
  },
  edit_prices_stock: {
    title: 'تعديل الأسعار وإدارة المخزون',
    desc: 'إضافة أصناف، تغيير أسعار البيع/الشراء، وتوريد كميات',
  },
  view_reports: {
    title: 'الوصول إلى نظام التقارير الشامل',
    desc: 'تقارير المبيعات اليومية/الشهرية/السنوية وحالة المخزون',
  },
  manage_partners: {
    title: 'إدارة العملاء والآجل والموردين',
    desc: 'تحصيل مستحقات العملاء وسداد فواتير الموردين',
  },
  manage_payments: {
    title: 'إعدادات بوابات الدفع الإلكتروني',
    desc: 'تعديل حسابات إنستا باي وفودافون كاش و Paymob / Fawry',
  },
  manage_purchases: {
    title: 'فواتير المشتريات وتوريد الموردين',
    desc: 'إصدار فواتير توريد بضاعة وتحديث أرصدة الموردين والتكلفة',
  },
  manage_expenses: {
    title: 'إدارة المصروفات والخزينة اليومية',
    desc: 'تسجيل مصروفات التشغيل والرواتب والإيجار وسحوبات الخزينة',
  },
  manage_settings: {
    title: 'إدارة الإعدادات ونماذج الطباعة',
    desc: 'تعديل إعدادات المتجر، الضريبة، وتخصيص قوالب الفواتير والتقارير',
  },
  manage_data_xlsx: {
    title: 'إدارة البيانات والاستيراد والتصدير XLSX',
    desc: 'استيراد وتصدير جداول البضاعة والحسابات بصيغة Excel والنسخ الاحتياطي',
  },
  manage_security_rbac: {
    title: 'إدارة الصلاحيات والترخيص وقاعدة البيانات',
    desc: 'تعديل صلاحيات الموظفين، تفعيل الترخيص، وربط MySQL',
  },
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: 'إيجار المحل',
  utilities: 'كهرباء ومياه وإنترنت',
  salaries: 'رواتب ومكافآت',
  shipping: 'نقل ومشال وشحن',
  maintenance: 'صيانة وتشغيل',
  taxes: 'ضرائب وتراخيص',
  owner_draw: 'مسحوبات المالك',
  misc: 'مصروفات نثرية',
};

export const EXPENSE_SOURCE_LABELS: Record<'cash_drawer' | 'bank_instapay' | 'wallet', string> = {
  cash_drawer: 'درج الكاشير / الخزينة',
  bank_instapay: 'حساب بنكي / إنستا باي',
  wallet: 'محفظة إلكترونية',
};

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escapeCell = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent =
    '\uFEFF' + [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
