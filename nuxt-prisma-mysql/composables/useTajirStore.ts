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

export function useTajirStore() {
  const serverUrl = useState<string>('tajir_server_url', () => '');
  const snapshot = useState<any>('tajir_snapshot', () => null);
  const currentUserId = useState<string>('tajir_actor_id', () => 'usr-owner');
  const loading = useState<boolean>('tajir_loading', () => false);
  const errorMsg = useState<string | null>('tajir_error', () => null);

  const currentUser = computed(() => {
    const staff = snapshot.value?.staff || [];
    return staff.find((u: any) => u.id === currentUserId.value) || staff[0] || null;
  });

  const currentPermissions = computed<Record<string, boolean>>(() => {
    if (!snapshot.value || !currentUser.value) return {};
    return snapshot.value.rolePermissions?.[currentUser.value.role] || {};
  });

  async function apiFetch<T = any>(path: string, options: any = {}): Promise<T> {
    const base = serverUrl.value.replace(/\/+$/, '');
    const url = base ? `${base}${path}` : path;
    return await $fetch<T>(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-actor-user-id': currentUserId.value,
      },
    });
  }

  async function refresh() {
    loading.value = true;
    errorMsg.value = null;
    try {
      snapshot.value = await apiFetch('/api/bootstrap');
    } catch (err: any) {
      errorMsg.value = err?.data?.message || err?.message || 'تعذر الاتصال بخادم Nuxt / MySQL';
    } finally {
      loading.value = false;
    }
  }

  return {
    serverUrl,
    snapshot,
    currentUser,
    currentUserId,
    currentPermissions,
    loading,
    errorMsg,
    apiFetch,
    refresh,
  };
}
