export function useDebouncedRef<T>(source: Ref<T>, delay = 220): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(source, (val) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = val;
    }, delay);
  });
  return debounced;
}

export function normalizeServerUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  if (typeof window !== 'undefined' && cleaned === window.location.origin) {
    return '';
  }
  return cleaned;
}

export function useTajirStore() {
  const serverUrl = useState<string>('tajir_server_url', () => '');
  const authToken = useState<string>('tajir_auth_token', () => '');
  const snapshot = useState<any>('tajir_snapshot', () => null);
  const currentUserId = useState<string>('tajir_actor_id', () => 'usr-owner');
  const loading = useState<boolean>('tajir_loading', () => false);
  const errorMsg = useState<string | null>('tajir_error', () => null);

  if (import.meta.client) {
    const savedToken = sessionStorage.getItem('tajirpro_nuxt_token');
    if (savedToken && !authToken.value) {
      authToken.value = savedToken;
    }
    const savedServer = localStorage.getItem('tajirpro_nuxt_server');
    if (savedServer && !serverUrl.value) {
      const normalized = normalizeServerUrl(savedServer);
      if (normalized) serverUrl.value = normalized;
      else localStorage.removeItem('tajirpro_nuxt_server');
    }
  }

  const currentUser = computed(() => {
    if (snapshot.value?.currentUser) return snapshot.value.currentUser;
    const staff = snapshot.value?.staff || [];
    return staff.find((u: any) => u.id === currentUserId.value) || staff[0] || null;
  });

  const currentPermissions = computed<Record<string, boolean>>(() => {
    if (!snapshot.value || !currentUser.value) return {};
    if (currentUser.value.effectivePermissions) {
      return currentUser.value.effectivePermissions;
    }
    return {
      ...(snapshot.value.rolePermissions?.[currentUser.value.role] || {}),
      ...(currentUser.value.customPermissions || {}),
    };
  });

  function setServerUrl(next: string) {
    const norm = normalizeServerUrl(next);
    serverUrl.value = norm;
    if (import.meta.client) {
      if (norm) localStorage.setItem('tajirpro_nuxt_server', norm);
      else localStorage.removeItem('tajirpro_nuxt_server');
    }
  }

  function setAuthToken(token: string) {
    authToken.value = token;
    if (import.meta.client) {
      if (token) sessionStorage.setItem('tajirpro_nuxt_token', token);
      else sessionStorage.removeItem('tajirpro_nuxt_token');
    }
  }

  async function apiFetch<T = any>(path: string, options: any = {}): Promise<T> {
    const base = normalizeServerUrl(serverUrl.value);
    const url = base ? `${base}${path}` : path;
    const headers: Record<string, string> = {
      ...(options.headers || {}),
      'x-actor-user-id': currentUserId.value,
    };
    if (authToken.value) {
      headers.Authorization = `Bearer ${authToken.value}`;
    }
    return await $fetch<T>(url, {
      ...options,
      headers,
    });
  }

  async function loginWithPin(userId: string, pin: string) {
    const res = await apiFetch<{ token: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: { userId, pin },
    });
    currentUserId.value = res.user.id;
    setAuthToken(res.token);
    await refresh();
    return res;
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken('');
    await refresh();
  }

  async function refresh() {
    loading.value = true;
    errorMsg.value = null;
    try {
      snapshot.value = await apiFetch('/api/bootstrap');
      if (snapshot.value?.currentUser?.id) {
        currentUserId.value = snapshot.value.currentUser.id;
      }
    } catch (err: any) {
      errorMsg.value =
        err?.data?.statusMessage ||
        err?.data?.message ||
        err?.message ||
        'تعذر الاتصال بخادم Nuxt / MySQL';
    } finally {
      loading.value = false;
    }
  }

  return {
    serverUrl,
    authToken,
    snapshot,
    currentUser,
    currentUserId,
    currentPermissions,
    loading,
    errorMsg,
    setServerUrl,
    setAuthToken,
    apiFetch,
    loginWithPin,
    logout,
    refresh,
  };
}
