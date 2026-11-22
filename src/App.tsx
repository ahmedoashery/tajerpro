import { AlertTriangle, Loader2, Menu, PackageX, Server, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { DashboardView } from './components/DashboardView';
import { DesktopMenuBar } from './components/DesktopMenuBar';
import { DesktopSalesInvoiceView } from './components/DesktopSalesInvoiceView';
import { DigestViewerModal } from './components/DigestViewerModal';
import { ExpensesView } from './components/ExpensesView';
import { HelpCenterModal, type HelpModalTab } from './components/HelpCenterModal';
import { InventoryView } from './components/InventoryView';
import { InvoicesView } from './components/InvoicesView';
import { LoginModal } from './components/LoginModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PartnersPaymentsView } from './components/PartnersPaymentsView';
import { PosView } from './components/PosView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PurchasesView } from './components/PurchasesView';
import { ReportsView } from './components/ReportsView';
import { SecurityRbacLicenseView } from './components/SecurityRbacLicenseView';
import { ServerConfigModal, type ServerConfigTab } from './components/ServerConfigModal';
import { SettingsAndDataView } from './components/SettingsAndDataView';
import { ShiftClosingModal } from './components/ShiftClosingModal';
import { type NavTabId, Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { StoreProfileModal } from './components/StoreProfileModal';
import {
  type InventoryTargetModal,
  type PartnersTargetTab,
  type SettingsTargetTab,
  SystemQuickMenuBar,
} from './components/SystemQuickMenuBar';
import { TabStrip, type WorkspaceTab } from './components/TabStrip';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { PrintProvider } from './context/PrintContext';
import { useStoreSync } from './hooks/useStoreSync';
import type {
  AutoReorderSupplierGroup,
  ReportSubTab,
  ScheduledReportDigest,
  StoreActivityId,
} from './shared/types';
import { getEffectivePermissions } from './utils/formatters';

const DEFAULT_TAB_TITLES: Record<NavTabId, string> = {
  dashboard: 'ملخص المحل',
  pos: 'الكاشير',
  sales_invoice: 'فاتورة مبيعات (جدول)',
  inventory: 'المخزون والأسعار',
  purchases: 'المشتريات والتوريد',
  invoices: 'الفواتير والأرباح',
  expenses: 'المصروفات والخزينة',
  reports: 'التقارير الشاملة',
  partners_payments: 'العملاء والدفع',
  security_license: 'الصلاحيات والترخيص',
  settings_data: 'الإعدادات والبيانات',
};

function AppShell() {
  const {
    serverUrl,
    setServerUrl,
    isAuthenticated,
    snapshot,
    currentUser,
    loading,
    error,
    wsConnected,
    liveToast,
    urgentAlert,
    notifications,
    reportDigests,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    markDigestRead,
    markAllDigestsRead,
    dismissUrgentAlert,
    showToast,
    refreshBootstrap,
    apiFetch,
    loginWithPin,
    logoutSession,
  } = useStoreSync();

  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'tab-home', viewId: 'dashboard', title: 'ملخص المحل', pinned: true },
    { id: 'tab-pos-1', viewId: 'pos', title: 'الكاشير #1', pinned: false },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-home');
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tajirpro_dark_mode') === '1';
    } catch {
      return false;
    }
  });

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginLockedMode, setLoginLockedMode] = useState(false);
  const [showServerConfigModal, setShowServerConfigModal] = useState(false);
  const [serverConfigTab, setServerConfigTab] = useState<ServerConfigTab>('server');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showStoreProfileModal, setShowStoreProfileModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpModalTab, setHelpModalTab] = useState<HelpModalTab>('guide');
  const [prefillPurchaseDraft, setPrefillPurchaseDraft] = useState<AutoReorderSupplierGroup | null>(null);
  const [invModalReq, setInvModalReq] = useState<{ modal: InventoryTargetModal; seq: number } | null>(null);
  const [partnersTabReq, setPartnersTabReq] = useState<{ tab: PartnersTargetTab; seq: number } | null>(null);
  const [reportsTabReq, setReportsTabReq] = useState<{ tab: ReportSubTab; seq: number } | null>(null);
  const [settingsTabReq, setSettingsTabReq] = useState<{ tab: SettingsTargetTab; seq: number } | null>(null);
  const [salesInvoiceModeReq, setSalesInvoiceModeReq] = useState<{
    mode: 'editor' | 'quotations';
    seq: number;
  } | null>(null);
  const [activeDigest, setActiveDigest] = useState<ScheduledReportDigest | null>(null);

  const openServerConfigWithTab = useCallback((tab: ServerConfigTab = 'server') => {
    setServerConfigTab(tab);
    setShowServerConfigModal(true);
  }, []);

  const handleOpenDigest = useCallback(
    (digest: ScheduledReportDigest) => {
      setActiveDigest(digest);
      void markDigestRead(digest.id);
    },
    [markDigestRead]
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('tajirpro_dark_mode', darkMode ? '1' : '0');
    } catch {
      // ignore storage quota errors
    }
  }, [darkMode]);

  const openOrFocusTab = useCallback(
    (viewId: NavTabId, options?: { forceNew?: boolean; customTitle?: string }) => {
      if (snapshot && currentUser) {
        const perms = getEffectivePermissions(currentUser, snapshot.rolePermissions);
        if (viewId === 'reports' && !perms.view_reports) return;
        if (viewId === 'partners_payments' && !perms.manage_partners) return;
        if ((viewId === 'pos' || viewId === 'sales_invoice') && !perms.pos_sell) return;
        if (viewId === 'purchases' && !perms.manage_purchases) return;
        if (viewId === 'expenses' && !perms.manage_expenses) return;
        if (viewId === 'security_license' && !perms.manage_security_rbac) return;
        if (viewId === 'settings_data' && !(perms.manage_settings || perms.manage_data_xlsx)) return;
      }

      setTabs((prev) => {
        if (!options?.forceNew) {
          const existing = prev.find((t) => t.viewId === viewId);
          if (existing) {
            setActiveTabId(existing.id);
            return prev;
          }
        }
        const sameViewCount = prev.filter((t) => t.viewId === viewId).length;
        const baseTitle = options?.customTitle || DEFAULT_TAB_TITLES[viewId];
        const title =
          viewId === 'pos' || sameViewCount > 0 ? `${baseTitle} #${sameViewCount + 1}` : baseTitle;
        const nextTab: WorkspaceTab = {
          id: `tab-${viewId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          viewId,
          title,
          pinned: false,
        };
        setActiveTabId(nextTab.id);
        return [...prev, nextTab];
      });
    },
    [snapshot, currentUser]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const target = prev.find((t) => t.id === tabId);
        if (!target || target.pinned || prev.length <= 1) return prev;
        const idx = prev.findIndex((t) => t.id === tabId);
        const nextTabs = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = nextTabs[Math.max(0, idx - 1)] || nextTabs[0];
          if (fallback) setActiveTabId(fallback.id);
        }
        return nextTabs;
      });
    },
    [activeTabId]
  );

  const togglePinTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t))
    );
  }, []);

  const duplicateTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const src = prev.find((t) => t.id === tabId);
      if (!src) return prev;
      const sameViewCount = prev.filter((t) => t.viewId === src.viewId).length;
      const dup: WorkspaceTab = {
        id: `tab-${src.viewId}-${Date.now().toString(36)}`,
        viewId: src.viewId,
        title: `${DEFAULT_TAB_TITLES[src.viewId]} #${sameViewCount + 1}`,
        pinned: false,
      };
      setActiveTabId(dup.id);
      return [...prev, dup];
    });
  }, []);

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id === tabId || t.pinned);
      if (!next.some((t) => t.id === activeTabId)) {
        setActiveTabId(tabId);
      }
      return next;
    });
  }, [activeTabId]);

  const closeUnpinnedTabs = useCallback(() => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.pinned);
      const safe = next.length > 0 ? next : [prev[0]];
      if (!safe.some((t) => t.id === activeTabId)) {
        setActiveTabId(safe[0].id);
      }
      return safe;
    });
  }, [activeTabId]);

  // Enforce RBAC permissions across open tabs on role/permission switch
  useEffect(() => {
    if (!snapshot || !currentUser) return;
    const perms = getEffectivePermissions(currentUser, snapshot.rolePermissions);
    setTabs((prev) => {
      const allowedTabs = prev.filter((t) => {
        if (t.viewId === 'reports' && !perms.view_reports) return false;
        if (t.viewId === 'partners_payments' && !perms.manage_partners) return false;
        if ((t.viewId === 'pos' || t.viewId === 'sales_invoice') && !perms.pos_sell) return false;
        if (t.viewId === 'purchases' && !perms.manage_purchases) return false;
        if (t.viewId === 'expenses' && !perms.manage_expenses) return false;
        if (t.viewId === 'security_license' && !perms.manage_security_rbac) return false;
        if (t.viewId === 'settings_data' && !(perms.manage_settings || perms.manage_data_xlsx)) {
          return false;
        }
        return true;
      });
      if (allowedTabs.length === 0) {
        const home: WorkspaceTab = { id: 'tab-home', viewId: 'dashboard', title: 'ملخص المحل', pinned: true };
        setActiveTabId(home.id);
        return [home];
      }
      if (!allowedTabs.some((t) => t.id === activeTabId)) {
        setActiveTabId(allowedTabs[0].id);
      }
      return allowedTabs;
    });
  }, [snapshot, currentUser, activeTabId]);

  // Desktop keyboard shortcuts (Ctrl+K search, Ctrl+B sidebar, F2 POS, Alt+0..9 workspaces)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (e.key === 'F2') {
        e.preventDefault();
        openOrFocusTab('pos');
      } else if (e.key === 'F3') {
        e.preventDefault();
        openOrFocusTab('sales_invoice');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openOrFocusTab('pos', { forceNew: true });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setLoginLockedMode(false);
        setShowLoginModal(true);
      } else if (e.altKey) {
        const map: Record<string, NavTabId> = {
          '1': 'dashboard',
          '2': 'pos',
          '3': 'inventory',
          '4': 'invoices',
          '5': 'reports',
          '6': 'partners_payments',
          '7': 'security_license',
          '8': 'purchases',
          '9': 'expenses',
          '0': 'settings_data',
        };
        if (map[e.key]) {
          e.preventDefault();
          openOrFocusTab(map[e.key]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openOrFocusTab]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          <span>جاري تجهيز نظام إدارة المحل والمخزون اللحظي...</span>
        </div>
      </div>
    );
  }

  if (error || !snapshot || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center dark:border-rose-900/50 dark:bg-slate-900 space-y-4">
          <div className="font-display text-lg font-bold text-rose-600">تعذر الاتصال بالخادم</div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            في حال النشر على استضافة واجهات مثل Vercel، تأكد من نشر التحديث الأخير أو ربط رابط خادم البيانات (Render / Railway) من زر تغيير عنوان الخادم بالأسفل.
          </p>
          <div className="text-xs font-mono-num text-slate-500" dir="ltr">
            {serverUrl || window.location.origin}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={refreshBootstrap}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={() => setShowServerConfigModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <Server className="h-3.5 w-3.5 text-emerald-600" />
              <span>تغيير عنوان الخادم وإعدادات الاتصال</span>
            </button>
          </div>
        </div>

        <ServerConfigModal
          open={showServerConfigModal}
          initialTab={serverConfigTab}
          onClose={() => setShowServerConfigModal(false)}
          serverUrl={serverUrl}
          onChangeServerUrl={setServerUrl}
          settings={snapshot?.settings ?? null}
          license={snapshot?.license ?? null}
          canManageSecurity={false}
          apiFetch={apiFetch}
          onSaved={(msg) => {
            showToast(msg);
            refreshBootstrap();
          }}
        />
      </div>
    );
  }

  // Startup / Locked Auth Gate: blocks workspace until verified PIN login when required
  const mustShowLockGate = Boolean(
    snapshot.locked || (snapshot.settings.requireLoginOnStart && !isAuthenticated)
  );

  if (mustShowLockGate) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
        <LoginModal
          open={true}
          lockedMode={true}
          onClose={() => {}}
          staff={snapshot.staff}
          currentUserId={currentUser.id}
          settings={snapshot.settings}
          license={snapshot.license}
          serverUrl={serverUrl}
          onLoginSubmit={loginWithPin}
          onSuccessLogin={() => {
            setLoginLockedMode(false);
            setShowLoginModal(false);
          }}
          onOpenServerConfig={(tab) => openServerConfigWithTab(tab || 'server')}
        />

        <ServerConfigModal
          open={showServerConfigModal}
          initialTab={serverConfigTab}
          onClose={() => setShowServerConfigModal(false)}
          serverUrl={serverUrl}
          onChangeServerUrl={setServerUrl}
          settings={snapshot.settings}
          license={snapshot.license}
          canManageSecurity={false}
          apiFetch={apiFetch}
          onSaved={(msg) => {
            showToast(msg);
            refreshBootstrap();
          }}
        />
      </div>
    );
  }

  const activeActivity =
    snapshot.activities.find((a) => a.id === snapshot.settings.activityId) || snapshot.activities[0];
  const userPerms = getEffectivePermissions(currentUser, snapshot.rolePermissions);
  const activeTabObj = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleSwitchActivity = async (activityId: StoreActivityId) => {
    await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ activityId }),
    });
    await refreshBootstrap();
    showToast('تم تكييف النظام والكتالوج على النشاط التجاري المختار');
  };

  const handleOpenUserSwitch = () => {
    setLoginLockedMode(false);
    setShowLoginModal(true);
  };

  const handleLockScreen = async () => {
    await logoutSession();
    setLoginLockedMode(true);
    setShowLoginModal(true);
  };

  const handleDownloadBackup = async () => {
    const data = await apiFetch('/api/database/export-backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tajirpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تنزيل النسخة الاحتياطية الكاملة بنجاح');
  };

  const lowStockTotal = snapshot.dashboard.lowStockCount + snapshot.dashboard.outOfStockCount;

  return (
    <div className="app-desktop-shell print-shell-reset flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Quick System Division Menu Bar (ملف - تكويد - عمليات - تقارير - إعدادات - مساعدة) */}
      <SystemQuickMenuBar
        currentUser={currentUser}
        rolePermissions={snapshot.rolePermissions}
        sidebarVisible={sidebarVisible}
        darkMode={darkMode}
        onOpenTab={openOrFocusTab}
        onOpenInventoryModal={(modal) => {
          openOrFocusTab('inventory');
          setInvModalReq({ modal, seq: Date.now() });
        }}
        onOpenPartnersTab={(tab) => {
          openOrFocusTab('partners_payments');
          setPartnersTabReq({ tab, seq: Date.now() });
        }}
        onOpenReportsTab={(tab) => {
          openOrFocusTab('reports');
          setReportsTabReq({ tab, seq: Date.now() });
        }}
        onOpenSettingsTab={(tab) => {
          openOrFocusTab('settings_data');
          setSettingsTabReq({ tab, seq: Date.now() });
        }}
        onOpenQuotations={() => {
          openOrFocusTab('sales_invoice');
          setSalesInvoiceModeReq({ mode: 'quotations', seq: Date.now() });
        }}
        onOpenShiftClosing={() => setShowShiftModal(true)}
        onOpenStoreProfile={() => setShowStoreProfileModal(true)}
        onOpenServerConfig={() => openServerConfigWithTab('server')}
        onOpenUserSwitch={handleOpenUserSwitch}
        onLockScreen={handleLockScreen}
        onPrintCurrent={() => window.print()}
        onDownloadBackup={handleDownloadBackup}
        onCloseUnpinnedTabs={closeUnpinnedTabs}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onToggleDark={() => setDarkMode((d) => !d)}
        onOpenHelp={(tab) => {
          setHelpModalTab(tab);
          setShowHelpModal(true);
        }}
      />

      {/* Top Quick Toolbar */}
      <div className="no-print flex items-center bg-white dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="فتح القائمة الجانبية"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <DesktopMenuBar
            storeName={snapshot.settings.storeName}
            sidebarVisible={sidebarVisible}
            darkMode={darkMode}
            currentUser={currentUser}
            rolePermissions={snapshot.rolePermissions}
            notifications={notifications}
            reportDigests={reportDigests}
            unreadCount={unreadNotificationCount}
            onToggleSidebar={() => setSidebarVisible((v) => !v)}
            onToggleDark={() => setDarkMode((d) => !d)}
            onOpenTab={openOrFocusTab}
            onOpenUserSwitch={handleOpenUserSwitch}
            onOpenServerConfig={() => setShowServerConfigModal(true)}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
            onDownloadBackup={handleDownloadBackup}
            onMarkRead={markNotificationRead}
            onMarkAllRead={() => {
              markAllNotificationsRead();
              if (userPerms.view_reports) void markAllDigestsRead();
            }}
            onOpenDigest={handleOpenDigest}
            onOpenScheduledReports={() => {
              openOrFocusTab('reports');
              setReportsTabReq({ tab: 'scheduled_reports', seq: Date.now() });
            }}
          />
        </div>
      </div>

      {/* Desktop Body: Optional Collapsible Sidebar + Multi-Tab Viewport */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTabObj.viewId}
          onSelectTab={(viewId) => openOrFocusTab(viewId)}
          settings={snapshot.settings}
          activeActivity={activeActivity}
          currentUser={currentUser}
          rolePermissions={snapshot.rolePermissions}
          lowStockCount={lowStockTotal}
          desktopVisible={sidebarVisible}
          onToggleDesktopSidebar={() => setSidebarVisible((v) => !v)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onOpenUserSwitch={handleOpenUserSwitch}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabObj.id}
            currentUser={currentUser}
            rolePermissions={snapshot.rolePermissions}
            onActivateTab={setActiveTabId}
            onCloseTab={closeTab}
            onTogglePinTab={togglePinTab}
            onDuplicateTab={duplicateTab}
            onCloseOtherTabs={closeOtherTabs}
            onCloseUnpinnedTabs={closeUnpinnedTabs}
            onOpenNewTab={openOrFocusTab}
          />

          <main className="print-shell-reset flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="mx-auto w-full max-w-[1440px]">
              {/* Immediate Real-Time Low Stock / Out-of-Stock Alert Banner */}
              {urgentAlert && (
                <div
                  role="alert"
                  className={`no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                    urgentAlert.severity === 'out_of_stock'
                      ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200'
                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {urgentAlert.severity === 'out_of_stock' ? (
                      <PackageX className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <div>
                      <span className="font-bold">{urgentAlert.title}: </span>
                      <span>{urgentAlert.message}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        markNotificationRead(urgentAlert.id);
                        dismissUrgentAlert();
                        openOrFocusTab('inventory');
                      }}
                      className="rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-slate-800"
                    >
                      توريد الآن
                    </button>
                    <button
                      type="button"
                      onClick={dismissUrgentAlert}
                      className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                      aria-label="إغلاق التنبيه"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {liveToast && (
                <div className="no-print mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {liveToast}
                </div>
              )}

              {/* Keep open tabs mounted so switching between tabs preserves carts & filters */}
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabObj.id;
                return (
                  <div key={tab.id} className={isActive ? 'block' : 'hidden'}>
                    <AppErrorBoundary
                      resetKey={tab.id}
                      viewTitle={tab.title}
                      onGoHome={() => openOrFocusTab('dashboard')}
                    >
                    {tab.viewId === 'dashboard' && (
                      <DashboardView
                        dashboard={snapshot.dashboard}
                        settings={snapshot.settings}
                        activities={snapshot.activities}
                        products={snapshot.products}
                        movements={snapshot.movements}
                        currentUser={currentUser}
                        canViewProfits={Boolean(userPerms?.view_profits_costs)}
                        canEditStock={Boolean(userPerms?.edit_prices_stock)}
                        apiFetch={apiFetch}
                        onNavigate={(viewId) => openOrFocusTab(viewId)}
                        onSwitchActivity={handleSwitchActivity}
                        onQuickRestocked={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                        onOpenShiftClosing={() => setShowShiftModal(true)}
                      />
                    )}

                    {tab.viewId === 'pos' && (
                      <PosView
                        products={snapshot.products}
                        customers={snapshot.customers}
                        treasuries={snapshot.treasuries}
                        promotions={snapshot.promotions || []}
                        activeActivity={activeActivity}
                        settings={snapshot.settings}
                        paymentConfig={snapshot.paymentConfig}
                        currentUser={currentUser}
                        apiFetch={apiFetch}
                        onCheckoutSuccess={() => {
                          refreshBootstrap();
                        }}
                        onOpenShiftClosing={() => setShowShiftModal(true)}
                      />
                    )}

                    {tab.viewId === 'sales_invoice' && (
                      <DesktopSalesInvoiceView
                        products={snapshot.products}
                        customers={snapshot.customers}
                        treasuries={snapshot.treasuries}
                        promotions={snapshot.promotions || []}
                        quotations={snapshot.quotations || []}
                        requestedMode={salesInvoiceModeReq}
                        activeActivity={activeActivity}
                        settings={snapshot.settings}
                        paymentConfig={snapshot.paymentConfig}
                        currentUser={currentUser}
                        apiFetch={apiFetch}
                        onCheckoutSuccess={(inv) => {
                          showToast(`تم اعتماد الفاتورة ${inv.invoiceNumber} بنجاح`);
                          refreshBootstrap();
                        }}
                        onQuotationMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'inventory' && (
                      <InventoryView
                        products={snapshot.products}
                        batches={snapshot.batches || []}
                        promotions={snapshot.promotions || []}
                        priceHistory={snapshot.priceHistory}
                        movements={snapshot.movements}
                        suppliers={snapshot.suppliers}
                        activeActivity={activeActivity}
                        settings={snapshot.settings}
                        currentUser={currentUser}
                        canEditStockAndPrices={Boolean(userPerms.edit_prices_stock)}
                        canViewCosts={Boolean(userPerms.view_profits_costs)}
                        apiFetch={apiFetch}
                        requestedModal={invModalReq}
                        onOpenDataHub={
                          userPerms.manage_settings || userPerms.manage_data_xlsx
                            ? () => openOrFocusTab('settings_data')
                            : undefined
                        }
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'purchases' && (
                      <PurchasesView
                        purchases={snapshot.purchases}
                        products={snapshot.products}
                        suppliers={snapshot.suppliers}
                        treasuries={snapshot.treasuries}
                        reorderSuggestions={snapshot.reorderSuggestions || []}
                        prefillDraft={prefillPurchaseDraft}
                        onClearPrefillDraft={() => setPrefillPurchaseDraft(null)}
                        settings={snapshot.settings}
                        currentUser={currentUser}
                        canManagePurchases={Boolean(userPerms.manage_purchases)}
                        canViewCosts={Boolean(userPerms.view_profits_costs)}
                        apiFetch={apiFetch}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'invoices' && (
                      <InvoicesView
                        invoices={snapshot.invoices}
                        allProducts={snapshot.allProducts}
                        customers={snapshot.customers}
                        treasuries={snapshot.treasuries}
                        settings={snapshot.settings}
                        activeActivityName={activeActivity.nameAr}
                        currentUser={currentUser}
                        canViewProfits={Boolean(userPerms.view_profits_costs)}
                        canReturnInvoice={Boolean(userPerms.invoice_return)}
                        apiFetch={apiFetch}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'expenses' && (
                      <ExpensesView
                        expenses={snapshot.expenses}
                        recurringExpenses={snapshot.recurringExpenses || []}
                        treasuries={snapshot.treasuries}
                        dashboard={snapshot.dashboard}
                        settings={snapshot.settings}
                        templates={snapshot.templates}
                        currentUser={currentUser}
                        canManageExpenses={Boolean(userPerms.manage_expenses)}
                        canViewProfits={Boolean(userPerms.view_profits_costs)}
                        apiFetch={apiFetch}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'reports' && (
                      <ReportsView
                        activities={snapshot.activities}
                        currentActivityId={snapshot.settings.activityId}
                        settings={snapshot.settings}
                        currentUser={currentUser}
                        rolePermissions={snapshot.rolePermissions}
                        canViewProfits={Boolean(userPerms.view_profits_costs)}
                        expenses={snapshot.expenses}
                        customers={snapshot.customers}
                        suppliers={snapshot.suppliers}
                        treasuries={snapshot.treasuries}
                        equityPartners={snapshot.equityPartners || []}
                        equityDrawings={snapshot.equityDrawings || []}
                        customReportPresets={snapshot.customReportPresets || []}
                        apiFetch={apiFetch}
                        requestedSubTab={reportsTabReq}
                        onOpenDigest={handleOpenDigest}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'partners_payments' && (
                      <PartnersPaymentsView
                        customers={snapshot.customers}
                        suppliers={snapshot.suppliers}
                        transactions={snapshot.transactions}
                        treasuries={snapshot.treasuries}
                        templates={snapshot.templates}
                        paymentConfig={snapshot.paymentConfig}
                        settings={snapshot.settings}
                        currentUser={currentUser}
                        canManagePayments={Boolean(userPerms.manage_payments)}
                        apiFetch={apiFetch}
                        requestedSubTab={partnersTabReq}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}

                    {tab.viewId === 'settings_data' && (
                      <SettingsAndDataView
                        settings={snapshot.settings}
                        activities={snapshot.activities}
                        activeActivity={activeActivity}
                        treasuries={snapshot.treasuries}
                        templates={snapshot.templates}
                        paymentConfig={snapshot.paymentConfig}
                        license={snapshot.license}
                        serverUrl={serverUrl}
                        products={snapshot.products}
                        allProducts={snapshot.allProducts}
                        customers={snapshot.customers}
                        suppliers={snapshot.suppliers}
                        expenses={snapshot.expenses}
                        currentUser={currentUser}
                        canManageSettings={Boolean(userPerms.manage_settings)}
                        canManagePayments={Boolean(userPerms.manage_payments)}
                        canManageDataXlsx={Boolean(userPerms.manage_data_xlsx)}
                        canViewProfits={Boolean(userPerms.view_profits_costs)}
                        apiFetch={apiFetch}
                        requestedSubTab={settingsTabReq}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                        onOpenServerConfig={openServerConfigWithTab}
                      />
                    )}

                    {tab.viewId === 'security_license' && (
                      <SecurityRbacLicenseView
                        staff={snapshot.staff}
                        currentUser={currentUser}
                        rolePermissions={snapshot.rolePermissions}
                        license={snapshot.license}
                        settings={snapshot.settings}
                        auditLogs={snapshot.auditLogs}
                        apiFetch={apiFetch}
                        onOpenUserSwitch={handleOpenUserSwitch}
                        onOpenServerConfig={() => openServerConfigWithTab('database')}
                        onMutated={(msg) => {
                          showToast(msg);
                          refreshBootstrap();
                        }}
                      />
                    )}
                    </AppErrorBoundary>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav
        activeTab={activeTabObj.viewId}
        currentUser={currentUser}
        rolePermissions={snapshot.rolePermissions}
        lowStockCount={lowStockTotal}
        onSelectTab={(viewId) => openOrFocusTab(viewId)}
        onOpenMore={() => setMobileMenuOpen(true)}
      />

      {/* Desktop Bottom Status Bar */}
      <StatusBar
        wsConnected={wsConnected}
        connectedTerminals={snapshot.connectedTerminals}
        settings={snapshot.settings}
        activeActivity={activeActivity}
        currentUser={currentUser}
        license={snapshot.license}
        lowStockTotal={lowStockTotal}
        openTabCount={tabs.length}
        sidebarVisible={sidebarVisible}
        onOpenTab={(viewId) => openOrFocusTab(viewId)}
        onOpenUserSwitch={handleOpenUserSwitch}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onOpenServerConfig={(t) => openServerConfigWithTab(t)}
      />

      {/* Offline Indicator */}
      <OfflineIndicator />

      {/* Login / Staff Switch & Server Config Entry */}
      <LoginModal
        open={showLoginModal}
        lockedMode={loginLockedMode}
        onClose={() => setShowLoginModal(false)}
        staff={snapshot.staff}
        currentUserId={currentUser.id}
        settings={snapshot.settings}
        license={snapshot.license}
        serverUrl={serverUrl}
        onLoginSubmit={loginWithPin}
        onSuccessLogin={() => {
          setLoginLockedMode(false);
          setShowLoginModal(false);
        }}
        onOpenServerConfig={(t) => openServerConfigWithTab(t || 'server')}
      />

      {/* Full Server & Database Control Modal */}
      <ServerConfigModal
        open={showServerConfigModal}
        initialTab={serverConfigTab}
        onClose={() => setShowServerConfigModal(false)}
        serverUrl={serverUrl}
        onChangeServerUrl={setServerUrl}
        settings={snapshot.settings}
        license={snapshot.license}
        canManageSecurity={Boolean(isAuthenticated && userPerms.manage_security_rbac)}
        apiFetch={apiFetch}
        onSaved={(msg) => {
          showToast(msg);
          refreshBootstrap();
        }}
      />

      {/* Shift Closing (Z-Report) Modal */}
      <ShiftClosingModal
        open={showShiftModal}
        onClose={() => setShowShiftModal(false)}
        currentUser={currentUser}
        settings={snapshot.settings}
        apiFetch={apiFetch}
        onShiftClosed={(msg) => {
          showToast(msg);
          refreshBootstrap();
        }}
      />

      {/* Store Profile & Print Header Modal */}
      <StoreProfileModal
        open={showStoreProfileModal}
        onClose={() => setShowStoreProfileModal(false)}
        settings={snapshot.settings}
        canEdit={Boolean(userPerms.manage_settings)}
        apiFetch={apiFetch}
        onSaved={(msg) => {
          showToast(msg);
          refreshBootstrap();
        }}
      />

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPaletteModal
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        snapshot={snapshot}
        currentUser={currentUser}
        rolePermissions={snapshot.rolePermissions}
        onNavigate={(viewId) => openOrFocusTab(viewId)}
        onOpenShiftClosing={() => setShowShiftModal(true)}
        onOpenStoreProfile={() => setShowStoreProfileModal(true)}
        onOpenServerConfig={() => openServerConfigWithTab('server')}
        onOpenUserSwitch={handleOpenUserSwitch}
      />

      {/* Help Center, System Map & Shortcuts Modal */}
      <HelpCenterModal
        open={showHelpModal}
        initialTab={helpModalTab}
        onClose={() => setShowHelpModal(false)}
        settings={snapshot.settings}
        activeActivity={activeActivity}
        license={snapshot.license}
        onOpenTab={(viewId) => openOrFocusTab(viewId)}
      />

      {/* Manager Scheduled Report Digest Viewer */}
      <DigestViewerModal
        digest={activeDigest}
        canViewProfits={Boolean(userPerms.view_profits_costs)}
        onClose={() => setActiveDigest(null)}
        onNavigateTab={(viewId) => openOrFocusTab(viewId)}
      />
    </div>
  );
}

export default function App() {
  return (
    <PrintProvider>
      <AppShell />
    </PrintProvider>
  );
}
