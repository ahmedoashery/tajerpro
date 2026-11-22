import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BootstrapSnapshot,
  Product,
  RealtimeEvent,
  ScheduledReportDigest,
  StaffUser,
  StoreNotification,
} from '../shared/types';
import { formatNum, getEffectivePermissions } from '../utils/formatters';

const SERVER_URL_STORAGE_KEY = 'tajirpro_server_url';
const AUTH_TOKEN_STORAGE_KEY = 'tajirpro_auth_token';

export function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function getInitialServerUrl(): string {
  try {
    const stored = normalizeServerUrl(localStorage.getItem(SERVER_URL_STORAGE_KEY) || '');
    if (stored) return stored;
  } catch {
    // Ignore storage error
  }
  const envDefault = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL;
  return envDefault ? normalizeServerUrl(String(envDefault)) : '';
}

function getInitialAuthToken(): string {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function buildApiUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildWsUrl(base: string): string {
  if (base) {
    const parsed = new URL(base);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function buildAlertFromProduct(p: Product, createdAt?: string): StoreNotification | null {
  if (p.stockQty <= 0) {
    return {
      id: `notif-out-${p.id}`,
      severity: 'out_of_stock',
      productId: p.id,
      productName: p.name,
      currentQty: p.stockQty,
      minStockAlert: p.minStockAlert,
      unit: p.unit,
      title: `نفاد صنف من المخزن: ${p.name}`,
      message: `الرصيد الحالي 0 ${p.unit} — يرجى التوريد الفوري لتفادي توقف البيع.`,
      createdAt: createdAt || p.updatedAt || new Date().toISOString(),
      read: false,
    };
  }
  if (p.stockQty <= p.minStockAlert) {
    return {
      id: `notif-low-${p.id}`,
      severity: 'low_stock',
      productId: p.id,
      productName: p.name,
      currentQty: p.stockQty,
      minStockAlert: p.minStockAlert,
      unit: p.unit,
      title: `تنبيه حد الطلب: ${p.name}`,
      message: `الكمية المتبقية ${formatNum(p.stockQty)} ${p.unit} (وصلت لحد التنبيه ${formatNum(p.minStockAlert)} ${p.unit}).`,
      createdAt: createdAt || p.updatedAt || new Date().toISOString(),
      read: false,
    };
  }
  return null;
}

export function useStoreSync() {
  const [serverUrl, setServerUrlState] = useState<string>(getInitialServerUrl);
  const [authToken, setAuthTokenState] = useState<string>(getInitialAuthToken);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(getInitialAuthToken()));
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const [urgentAlert, setUrgentAlert] = useState<StoreNotification | null>(null);
  const [notifications, setNotifications] = useState<StoreNotification[]>([]);
  const [reportDigests, setReportDigests] = useState<ScheduledReportDigest[]>([]);

  const currentUserIdRef = useRef<string | null>(null);
  const canViewReportsRef = useRef<boolean>(false);
  const serverUrlRef = useRef<string>(serverUrl);
  serverUrlRef.current = serverUrl;
  const authTokenRef = useRef<string>(authToken);
  authTokenRef.current = authToken;
  const toastTimerRef = useRef<number | null>(null);
  const alertTimerRef = useRef<number | null>(null);

  const setServerUrl = useCallback((nextUrl: string) => {
    const clean = normalizeServerUrl(nextUrl);
    try {
      if (clean) localStorage.setItem(SERVER_URL_STORAGE_KEY, clean);
      else localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    } catch {
      // Ignore storage error
    }
    serverUrlRef.current = clean;
    setServerUrlState(clean);
  }, []);

  const persistAuthToken = useCallback((token: string) => {
    try {
      if (token) sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      else sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage error
    }
    authTokenRef.current = token;
    setAuthTokenState(token);
  }, []);

  const showToast = useCallback((msg: string) => {
    setLiveToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setLiveToast(null);
    }, 3800);
  }, []);

  const triggerUrgentAlert = useCallback((notif: StoreNotification) => {
    setUrgentAlert(notif);
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    alertTimerRef.current = window.setTimeout(() => {
      setUrgentAlert(null);
    }, 6500);
  }, []);

  const syncInitialNotifications = useCallback((products: Product[]) => {
    setNotifications((prev) => {
      const readIds = new Set(prev.filter((n) => n.read).map((n) => n.id));
      const generated: StoreNotification[] = [];
      for (const p of products) {
        const alert = buildAlertFromProduct(p);
        if (alert) {
          generated.push({ ...alert, read: readIds.has(alert.id) });
        }
      }
      return generated.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'out_of_stock' ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
    });
  }, []);

  const refreshBootstrap = useCallback(async () => {
    try {
      const token = authTokenRef.current;
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(buildApiUrl(serverUrlRef.current, '/api/bootstrap'), { headers });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          `تعذر تحميل بيانات المتجر (HTTP ${res.status}): لم يرجع الخادم استجابة JSON صالحة. تأكد من تشغيل الخادم الخلفي أو ربط رابط الخادم من الإعدادات بالأسفل.`
        );
      }
      const rawPayload = (await res.json()) as BootstrapSnapshot & { error?: string };
      if (!res.ok) {
        throw new Error(rawPayload?.error || `تعذر تحميل بيانات المتجر (HTTP ${res.status})`);
      }
      const data = rawPayload as BootstrapSnapshot;
      setSnapshot(data);
      syncInitialNotifications(data.products || []);
      setReportDigests(data.reportDigests || []);

      if (data.authenticated) {
        setIsAuthenticated(true);
        currentUserIdRef.current = data.currentUser.id;
        setCurrentUser(data.currentUser);
        const eff = getEffectivePermissions(data.currentUser, data.rolePermissions);
        canViewReportsRef.current = Boolean(eff.view_reports);
      } else {
        if (token) {
          persistAuthToken('');
        }
        setIsAuthenticated(false);
        currentUserIdRef.current = data.currentUser?.id || null;
        setCurrentUser(data.currentUser || null);
        canViewReportsRef.current = false;
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [syncInitialNotifications, persistAuthToken]);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    // Vercel serverless hosting does not support persistent WebSocket upgrades on same-origin
    if (!serverUrl && typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
      setWsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUnmount = false;
    let everConnected = false;
    let consecutiveFailures = 0;

    const connect = () => {
      if (closedByUnmount) return;
      ws = new WebSocket(buildWsUrl(serverUrl));

      ws.onopen = () => {
        everConnected = true;
        consecutiveFailures = 0;
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (closedByUnmount) return;
        consecutiveFailures += 1;
        // Stop retrying if host has no WebSocket upgrade endpoint (e.g. serverless)
        if (!everConnected && consecutiveFailures >= 3) {
          return;
        }
        const delayMs = Math.min(30_000, 2200 * Math.pow(2, Math.min(consecutiveFailures - 1, 4)));
        reconnectTimer = window.setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as RealtimeEvent;
          if (event.type === 'connected' || event.type === 'presence:updated') {
            setSnapshot((prev) =>
              prev ? { ...prev, connectedTerminals: event.connectedTerminals } : prev
            );
          } else if (event.type === 'stock:updated') {
            const updatedProd = event.product;
            const alert = buildAlertFromProduct(updatedProd, event.movement.createdAt);

            setSnapshot((prev) => {
              if (!prev) return prev;
              const exists = prev.products.some((p) => p.id === updatedProd.id);
              const nextProducts =
                updatedProd.activityId === prev.settings.activityId
                  ? exists
                    ? prev.products.map((p) => (p.id === updatedProd.id ? updatedProd : p))
                    : [...prev.products, updatedProd]
                  : prev.products;
              const nextAll = prev.allProducts.some((p) => p.id === updatedProd.id)
                ? prev.allProducts.map((p) => (p.id === updatedProd.id ? updatedProd : p))
                : [...prev.allProducts, updatedProd];
              const alreadyMoved = prev.movements.some((m) => m.id === event.movement.id);
              const nextMovements = alreadyMoved
                ? prev.movements
                : [event.movement, ...prev.movements].slice(0, 60);

              const lowStockCount = nextProducts.filter(
                (p) => p.stockQty > 0 && p.stockQty <= p.minStockAlert
              ).length;
              const outOfStockCount = nextProducts.filter((p) => p.stockQty <= 0).length;

              return {
                ...prev,
                products: nextProducts,
                allProducts: nextAll,
                movements: nextMovements,
                dashboard: {
                  ...prev.dashboard,
                  lowStockCount,
                  outOfStockCount,
                },
              };
            });

            setNotifications((prev) => {
              const withoutProduct = prev.filter((n) => n.productId !== updatedProd.id);
              if (!alert) return withoutProduct;
              return [alert, ...withoutProduct];
            });

            if (alert && event.movement.deltaQty < 0) {
              triggerUrgentAlert(alert);
            }
          } else if (event.type === 'invoice:created') {
            setSnapshot((prev) => {
              if (!prev) return prev;
              const exists = prev.invoices.some((i) => i.id === event.invoice.id);
              const nextInvoices = exists ? prev.invoices : [event.invoice, ...prev.invoices];
              return { ...prev, invoices: nextInvoices, dashboard: event.dashboard };
            });
            showToast(`تحديث لحظي: فاتورة جديدة ${event.invoice.invoiceNumber} (${event.invoice.grandTotal} ج.م)`);
          } else if (event.type === 'invoice:returned') {
            setSnapshot((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                invoices: prev.invoices.map((i) => (i.id === event.invoice.id ? event.invoice : i)),
                dashboard: event.dashboard,
              };
            });
            showToast(`تم تسجيل مرتجع الفاتورة ${event.invoice.invoiceNumber} وإعادة المخزون لحظياً`);
          } else if (event.type === 'price:changed') {
            setSnapshot((prev) => {
              if (!prev) return prev;
              const histExists = prev.priceHistory.some((h) => h.id === event.historyEntry.id);
              return {
                ...prev,
                products: prev.products.map((p) => (p.id === event.product.id ? event.product : p)),
                allProducts: prev.allProducts.map((p) => (p.id === event.product.id ? event.product : p)),
                priceHistory: histExists ? prev.priceHistory : [event.historyEntry, ...prev.priceHistory],
              };
            });
          } else if (event.type === 'digest:created') {
            if (canViewReportsRef.current) {
              setReportDigests((prev) => {
                const exists = prev.some((d) => d.id === event.digest.id);
                return exists ? prev : [event.digest, ...prev].slice(0, 50);
              });
              showToast(`وصل ملخص تقرير دوري للمديرين: ${event.digest.scheduleName}`);
            }
          } else if (event.type === 'state:refresh') {
            refreshBootstrap();
          }
        } catch {
          // Ignore malformed frame
        }
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [serverUrl, refreshBootstrap, showToast, triggerUrgentAlert]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissUrgentAlert = useCallback(() => {
    setUrgentAlert(null);
  }, []);

  const unreadDigestCount = useMemo(() => {
    const uid = currentUser?.id || 'usr-owner';
    return reportDigests.filter((d) => d.inAppDelivered && !d.readByUserIds.includes(uid)).length;
  }, [reportDigests, currentUser?.id]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length + unreadDigestCount,
    [notifications, unreadDigestCount]
  );

  const apiFetch = useCallback(
    async <T = unknown>(url: string, options?: RequestInit): Promise<T> => {
      const headers = new Headers(options?.headers || {});
      if (!headers.has('Content-Type') && options?.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (authTokenRef.current && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${authTokenRef.current}`);
      }
      const res = await fetch(buildApiUrl(serverUrlRef.current, url), { ...options, headers });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : { error: await res.text().catch(() => '') };
      if (!res.ok) {
        const isLoginAttempt =
          url.includes('/api/auth/login') || url.includes('/api/security/verify-pin');
        const hasAdminPin = headers.has('x-admin-pin');
        if (res.status === 401 && !isLoginAttempt && !hasAdminPin) {
          persistAuthToken('');
          setIsAuthenticated(false);
          refreshBootstrap();
        }
        throw new Error(
          (data as { error?: string })?.error || 'حدث خطأ أثناء تنفيذ العملية'
        );
      }
      return data as T;
    },
    [persistAuthToken, refreshBootstrap]
  );

  const loginWithPin = useCallback(
    async (userId: string, pin: string): Promise<StaffUser> => {
      const res = await apiFetch<{ user: StaffUser; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ userId, pin }),
      });
      persistAuthToken(res.token);
      currentUserIdRef.current = res.user.id;
      setCurrentUser(res.user);
      setIsAuthenticated(true);
      showToast(`مرحباً ${res.user.name} — تم تسجيل الدخول بنجاح`);
      await refreshBootstrap();
      return res.user;
    },
    [apiFetch, persistAuthToken, refreshBootstrap, showToast]
  );

  const logoutSession = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore offline logout
    }
    persistAuthToken('');
    setIsAuthenticated(false);
    await refreshBootstrap();
    showToast('تم تسجيل الخروج وقفْل الجلسة');
  }, [apiFetch, persistAuthToken, refreshBootstrap, showToast]);

  const markDigestRead = useCallback(
    async (digestId: string) => {
      const uid = currentUserIdRef.current || 'usr-owner';
      setReportDigests((prev) =>
        prev.map((d) =>
          d.id === digestId && !d.readByUserIds.includes(uid)
            ? { ...d, readByUserIds: [...d.readByUserIds, uid] }
            : d
        )
      );
      try {
        await apiFetch(`/api/scheduled-reports/digests/${digestId}/read`, { method: 'POST' });
      } catch {
        // Optimistic local read update already applied
      }
    },
    [apiFetch]
  );

  const markAllDigestsRead = useCallback(async () => {
    const uid = currentUserIdRef.current || 'usr-owner';
    setReportDigests((prev) =>
      prev.map((d) =>
        d.readByUserIds.includes(uid) ? d : { ...d, readByUserIds: [...d.readByUserIds, uid] }
      )
    );
    try {
      await apiFetch('/api/scheduled-reports/digests/read-all', { method: 'POST' });
    } catch {
      // ignore network failure on read marker
    }
  }, [apiFetch]);

  return {
    serverUrl,
    setServerUrl,
    authToken,
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
    unreadDigestCount,
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
  };
}
