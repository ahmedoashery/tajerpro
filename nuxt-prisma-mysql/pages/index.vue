<template>
  <div class="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <!-- Desktop Top Menu Bar -->
    <header class="no-print flex h-11 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="sidebarVisible ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'"
          @click="sidebarVisible = !sidebarVisible"
        >
          {{ sidebarVisible ? 'إخفاء الجانبي' : 'إظهار الجانبي' }}
        </UButton>
        <span class="font-bold text-sm text-emerald-700 dark:text-emerald-400">
          تاجر برو — {{ snapshot?.settings?.storeName || 'نظام إدارة المحلات' }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <UBadge v-if="lowAlertTotal > 0" color="warning" variant="soft">
          تنبيهات المخزون: {{ lowAlertTotal }}
        </UBadge>
        <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-printer" @click="printPage">
          طباعة
        </UButton>
        <UButton size="xs" variant="soft" color="primary" icon="i-lucide-key-round" @click="loginModalOpen = true">
          {{ currentUser?.name || 'تسجيل الدخول والخادم' }}
        </UButton>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- Collapsible Desktop Sidebar -->
      <aside
        v-if="sidebarVisible"
        class="no-print flex w-60 shrink-0 flex-col border-l border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <nav class="space-y-1">
          <UButton
            v-for="tab in visibleTabs"
            :key="tab.id"
            block
            class="justify-start"
            :variant="activeView === tab.id ? 'soft' : 'ghost'"
            :color="activeView === tab.id ? 'primary' : 'neutral'"
            :icon="tab.icon"
            @click="activeView = tab.id"
          >
            {{ tab.label }}
          </UButton>
        </nav>

        <div class="mt-auto rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
          <div class="font-semibold">حزمة التشغيل:</div>
          <div class="mt-1 text-slate-500">Nuxt 3 + Nuxt UI + Prisma + MySQL</div>
        </div>
      </aside>

      <!-- Workspace Content -->
      <main class="flex-1 overflow-y-auto p-4 sm:p-6">
        <UAlert
          v-if="errorMsg"
          color="error"
          variant="soft"
          class="mb-4 no-print"
          :title="errorMsg"
          description="تأكد من إعداد DATABASE_URL لخادم MySQL أو افتح إعدادات الخادم لتوجيه الاتصال."
        >
          <template #actions>
            <UButton size="xs" color="error" @click="loginModalOpen = true">فتح إعدادات الخادم</UButton>
          </template>
        </UAlert>

        <!-- Dashboard View -->
        <section v-if="activeView === 'dashboard'" class="space-y-6">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <UCard>
              <div class="text-xs text-slate-500">إجمالي الفواتير</div>
              <div class="mt-1 font-mono-num text-xl font-bold">{{ snapshot?.invoices?.length || 0 }}</div>
            </UCard>
            <UCard>
              <div class="text-xs text-slate-500">الأصناف المسجلة</div>
              <div class="mt-1 font-mono-num text-xl font-bold">{{ snapshot?.products?.length || 0 }}</div>
            </UCard>
            <UCard>
              <div class="text-xs text-slate-500">نواقص وحد الطلب</div>
              <div class="mt-1 font-mono-num text-xl font-bold text-amber-600">{{ lowAlertTotal }}</div>
            </UCard>
            <UCard v-if="currentPermissions.view_profits_costs">
              <div class="text-xs text-slate-500">صافي الأرباح التاريخية</div>
              <div class="mt-1 font-mono-num text-xl font-bold text-emerald-600">{{ totalHistoricalProfit }} ج.م</div>
            </UCard>
          </div>

          <UCard>
            <template #header>
              <div class="font-bold text-sm">تنبيهات حد الطلب ونفاد المخزون الفورية</div>
            </template>
            <UTable :data="lowStockRows" :columns="lowStockColumns" />
          </UCard>
        </section>

        <!-- POS View -->
        <section v-if="activeView === 'pos'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div class="lg:col-span-7 space-y-3">
            <UInput v-model="posSearch" icon="i-lucide-search" placeholder="ابحث بالاسم أو الباركود..." />
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UCard
                v-for="p in filteredPosProducts"
                :key="p.id"
                class="cursor-pointer hover:ring-1 hover:ring-emerald-500"
                @click="addToCart(p)"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-bold text-sm">{{ p.name }}</div>
                    <div class="text-xs text-slate-500 font-mono-num">{{ p.sku }} · متاح: {{ p.stockQty }}</div>
                  </div>
                  <div class="font-mono-num font-bold text-emerald-600">{{ p.salePrice }} ج.م</div>
                </div>
              </UCard>
            </div>
          </div>

          <div class="lg:col-span-5">
            <UCard>
              <template #header>
                <div class="font-bold text-sm">سلة الكاشير</div>
              </template>
              <div class="space-y-2">
                <div v-for="line in cart" :key="line.product.id" class="flex items-center justify-between text-xs border-b pb-2">
                  <span>{{ line.product.name }} × {{ line.quantity }}</span>
                  <span class="font-mono-num font-bold">{{ (line.product.salePrice * line.quantity).toFixed(2) }} ج.م</span>
                </div>
                <USelectMenu v-model="paymentMethod" :items="paymentMethods" value-key="value" label-key="label" />
                <div class="flex items-center justify-between pt-2 font-bold">
                  <span>الإجمالي:</span>
                  <span class="font-mono-num text-lg text-emerald-600">{{ cartTotal.toFixed(2) }} ج.م</span>
                </div>
                <UButton block color="primary" :disabled="cart.length === 0" :loading="checkingOut" @click="submitCheckout">
                  إتمام البيع وتحديث المخزون
                </UButton>
              </div>
            </UCard>
          </div>
        </section>

        <!-- Master-Detail Invoices View -->
        <section v-if="activeView === 'invoices'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div class="no-print lg:col-span-6 space-y-3">
            <UInput v-model="invSearch" icon="i-lucide-search" placeholder="بحث برقم الفاتورة أو العميل..." />
            <UCard>
              <div class="divide-y divide-slate-100 dark:divide-slate-800">
                <button
                  v-for="inv in filteredInvoices"
                  :key="inv.id"
                  type="button"
                  class="flex w-full items-center justify-between py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 rounded"
                  @click="selectedInvoice = inv"
                >
                  <div>
                    <div class="font-mono-num font-bold">{{ inv.invoiceNumber }}</div>
                    <div class="text-slate-500">{{ inv.customerName }}</div>
                  </div>
                  <div class="font-mono-num font-bold">{{ inv.grandTotal }} ج.م</div>
                </button>
              </div>
            </UCard>
          </div>

          <div class="lg:col-span-6">
            <UCard v-if="selectedInvoice" class="print-only-sheet">
              <template #header>
                <div class="flex items-center justify-between">
                  <div class="font-bold font-mono-num">{{ selectedInvoice.invoiceNumber }}</div>
                  <UButton class="no-print" size="xs" icon="i-lucide-printer" @click="printPage">طباعة A4</UButton>
                </div>
              </template>
              <div class="space-y-3 text-xs">
                <div>العميل: {{ selectedInvoice.customerName }} · الدفع: {{ selectedInvoice.paymentMethod }}</div>
                <UTable :data="selectedInvoice.items" :columns="invoiceItemColumns" />
                <div class="flex justify-between font-bold pt-2 border-t">
                  <span>الصافي: <span class="font-mono-num">{{ selectedInvoice.grandTotal }} ج.م</span></span>
                  <span v-if="currentPermissions.view_profits_costs" class="text-emerald-600">
                    الربح التاريخي: <span class="font-mono-num">{{ selectedInvoice.netProfit }} ج.م</span>
                  </span>
                </div>
              </div>
            </UCard>
          </div>
        </section>

        <!-- Inventory View -->
        <section v-if="activeView === 'inventory'" class="space-y-3">
          <UInput v-model="invFilter" icon="i-lucide-search" placeholder="تصفية المخزون..." />
          <UCard>
            <UTable :data="filteredInventory" :columns="inventoryColumns" />
          </UCard>
        </section>
      </main>
    </div>

    <!-- Desktop Bottom Status Bar -->
    <footer class="no-print flex h-7 items-center justify-between border-t border-slate-200 bg-white px-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900">
      <span>المستخدم: {{ currentUser?.name || 'غير مسجل' }} ({{ currentUser?.role || '-' }})</span>
      <span class="font-mono-num">Prisma ORM · MySQL 8.0 · Nuxt UI</span>
    </footer>

    <LoginServerModal v-model:open="loginModalOpen" />
  </div>
</template>

<script setup lang="ts">
const { snapshot, currentUser, currentPermissions, errorMsg, apiFetch, refresh } = useTajirStore();

onMounted(() => {
  refresh();
});

const sidebarVisible = ref(true);
const activeView = ref<'dashboard' | 'pos' | 'invoices' | 'inventory'>('dashboard');
const loginModalOpen = ref(false);

const visibleTabs = computed(() => [
  { id: 'dashboard' as const, label: 'لوحة المتابعة', icon: 'i-lucide-layout-dashboard' },
  { id: 'pos' as const, label: 'نقطة البيع (الكاشير)', icon: 'i-lucide-shopping-cart' },
  { id: 'inventory' as const, label: 'المخزون والأسعار', icon: 'i-lucide-boxes' },
  { id: 'invoices' as const, label: 'الفواتير والأرباح', icon: 'i-lucide-file-text' },
]);

const lowStockRows = computed(() =>
  (snapshot.value?.products || []).filter((p: any) => p.stockQty <= p.minStockAlert)
);
const lowAlertTotal = computed(() => lowStockRows.value.length);
const totalHistoricalProfit = computed(() =>
  (snapshot.value?.invoices || [])
    .filter((i: any) => i.status === 'COMPLETED')
    .reduce((sum: number, i: any) => sum + Number(i.netProfit || 0), 0)
    .toFixed(2)
);

const lowStockColumns = [
  { accessorKey: 'name', header: 'الصنف' },
  { accessorKey: 'stockQty', header: 'الكمية الحالية' },
  { accessorKey: 'minStockAlert', header: 'حد الطلب' },
];

// POS State with Debounced Search
const posSearch = ref('');
const debouncedPosSearch = useDebouncedRef(posSearch, 200);
const filteredPosProducts = computed(() => {
  const q = debouncedPosSearch.value.trim().toLowerCase();
  const list = snapshot.value?.products || [];
  if (!q) return list;
  return list.filter((p: any) => p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.sku.toLowerCase().includes(q));
});

const cart = ref<Array<{ product: any; quantity: number }>>([]);
const paymentMethod = ref('CASH');
const checkingOut = ref(false);
const paymentMethods = [
  { label: 'نقدي (كاش)', value: 'CASH' },
  { label: 'إنستا باي (InstaPay)', value: 'INSTAPAY' },
  { label: 'فودافون كاش', value: 'VODAFONE_CASH' },
  { label: 'فيزا / ميزة', value: 'CARD' },
  { label: 'آجل', value: 'CREDIT' },
];

function addToCart(product: any) {
  const existing = cart.value.find((c) => c.product.id === product.id);
  if (existing) existing.quantity += 1;
  else cart.value.push({ product, quantity: 1 });
}

const cartTotal = computed(() =>
  cart.value.reduce((sum, l) => sum + Number(l.product.salePrice) * l.quantity, 0)
);

async function submitCheckout() {
  checkingOut.value = true;
  try {
    await apiFetch('/api/pos/checkout', {
      method: 'POST',
      body: {
        activityId: snapshot.value?.settings?.activityId || 'grocery',
        paymentMethod: paymentMethod.value,
        items: cart.value.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
          discountAmount: 0,
        })),
      },
    });
    cart.value = [];
    await refresh();
  } finally {
    checkingOut.value = false;
  }
}

// Invoices Master-Detail
const invSearch = ref('');
const debouncedInvSearch = useDebouncedRef(invSearch, 200);
const filteredInvoices = computed(() => {
  const q = debouncedInvSearch.value.trim().toLowerCase();
  const list = snapshot.value?.invoices || [];
  if (!q) return list;
  return list.filter((i: any) => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q));
});
const selectedInvoice = ref<any>(null);
watch(filteredInvoices, (list) => {
  if (!selectedInvoice.value && list.length > 0) selectedInvoice.value = list[0];
}, { immediate: true });

const invoiceItemColumns = [
  { accessorKey: 'productName', header: 'الصنف' },
  { accessorKey: 'quantity', header: 'الكمية' },
  { accessorKey: 'unitPriceSnapshot', header: 'سعر البيع' },
  { accessorKey: 'lineTotal', header: 'الإجمالي' },
];

// Inventory filter
const invFilter = ref('');
const debouncedInvFilter = useDebouncedRef(invFilter, 200);
const filteredInventory = computed(() => {
  const q = debouncedInvFilter.value.trim().toLowerCase();
  const list = snapshot.value?.products || [];
  if (!q) return list;
  return list.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
});
const inventoryColumns = [
  { accessorKey: 'sku', header: 'SKU' },
  { accessorKey: 'name', header: 'الصنف' },
  { accessorKey: 'category', header: 'التصنيف' },
  { accessorKey: 'salePrice', header: 'سعر البيع' },
  { accessorKey: 'stockQty', header: 'الرصيد' },
];

function printPage() {
  if (typeof window !== 'undefined') window.print();
}
</script>
