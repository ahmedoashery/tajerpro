<template>
  <div class="space-y-5">
    <!-- Reports Mode -->
    <section v-if="mode === 'reports'" class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="sub in reportSubTabs"
            :key="sub.id"
            size="xs"
            :color="reportTab === sub.id ? 'primary' : 'neutral'"
            :variant="reportTab === sub.id ? 'solid' : 'outline'"
            @click="reportTab = sub.id"
          >
            {{ sub.label }}
          </UButton>
        </div>

        <div class="flex items-center gap-2">
          <USelectMenu
            v-model="reportPeriod"
            :items="periodOptions"
            value-key="value"
            label-key="label"
            class="w-32"
            @update:model-value="loadReports"
          />
          <UButton size="xs" icon="i-lucide-refresh-cw" :loading="loadingReports" @click="loadReports">
            تحديث التقرير
          </UButton>
        </div>
      </div>

      <!-- P&L + Overview -->
      <div v-if="reportTab === 'pnl' && reportData" class="space-y-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <UCard>
            <div class="text-xs text-slate-500">صافي المبيعات</div>
            <div class="mt-1 font-mono-num text-lg font-bold">{{ fmt(reportData.profitLoss?.netSalesRevenue) }} ج.م</div>
          </UCard>
          <UCard>
            <div class="text-xs text-slate-500">مجمل الربح التاريخي</div>
            <div class="mt-1 font-mono-num text-lg font-bold text-emerald-600">
              {{ fmt(reportData.profitLoss?.grossProfit) }} ج.م
            </div>
          </UCard>
          <UCard>
            <div class="text-xs text-slate-500">المصروفات ورسوم البطاقات</div>
            <div class="mt-1 font-mono-num text-lg font-bold text-amber-600">
              {{ fmt((reportData.profitLoss?.operatingExpensesTotal || 0) + (reportData.profitLoss?.cardFeesTotal || 0)) }} ج.م
            </div>
          </UCard>
          <UCard>
            <div class="text-xs text-slate-500">صافي الربح التشغيلي</div>
            <div class="mt-1 font-mono-num text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {{ fmt(reportData.profitLoss?.netOperatingProfit) }} ج.م
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header><div class="font-bold text-sm">ربحية الأصناف بالتكلفة التاريخية</div></template>
          <UTable :data="reportData.productProfitRows || []" :columns="prodProfitCols" />
        </UCard>
      </div>

      <!-- Slow-Moving ABC -->
      <div v-if="reportTab === 'abc' && reportData" class="space-y-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <UCard>
            <div class="text-xs text-slate-500">أصناف راكدة تماماً (90 يوم)</div>
            <div class="mt-1 font-mono-num text-lg font-bold text-rose-600">
              {{ reportData.slowMovingReport?.deadStockCount || 0 }} صنف
            </div>
          </UCard>
          <UCard>
            <div class="text-xs text-slate-500">أصناف بطيئة الدوران</div>
            <div class="mt-1 font-mono-num text-lg font-bold text-amber-600">
              {{ reportData.slowMovingReport?.slowStockCount || 0 }} صنف
            </div>
          </UCard>
          <UCard>
            <div class="text-xs text-slate-500">رأس مال مجمد بالبضاعة البطيئة</div>
            <div class="mt-1 font-mono-num text-lg font-bold">
              {{ fmt(reportData.slowMovingReport?.tiedUpCapital) }} ج.م
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header><div class="font-bold text-sm">تحليل تصنيف المخزون ABC (آخر 90 يوماً)</div></template>
          <UTable :data="reportData.slowMovingReport?.rows || []" :columns="abcCols" />
        </UCard>
      </div>

      <!-- What-If Simulator -->
      <div v-if="reportTab === 'whatif' && reportData" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-5">
          <template #header><div class="font-bold text-sm">محاكاة ماذا لو (What-If)</div></template>
          <div class="space-y-3 text-xs">
            <UFormField label="تعديل هامش الربح المستهدف (%)">
              <UInput v-model.number="whatIf.targetMarginPct" type="number" step="0.5" />
            </UFormField>
            <UFormField label="نمو/انخفاض حجم المبيعات (%)">
              <UInput v-model.number="whatIf.volumeDeltaPct" type="number" step="1" />
            </UFormField>
            <UFormField label="تغير المصروفات التشغيلية (%)">
              <UInput v-model.number="whatIf.opExDeltaPct" type="number" step="1" />
            </UFormField>
          </div>
        </UCard>
        <UCard class="lg:col-span-7">
          <template #header><div class="font-bold text-sm">النتائج المتوقعة مقارنة بالوضع الحالي</div></template>
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="rounded-lg border p-3 dark:border-slate-800">
              <div class="text-slate-500">المبيعات الحالية vs المتوقعة</div>
              <div class="mt-1 font-mono-num font-bold">
                {{ fmt(whatIfSim.baseRev) }} → <span class="text-emerald-600">{{ fmt(whatIfSim.simRev) }} ج.م</span>
              </div>
            </div>
            <div class="rounded-lg border p-3 dark:border-slate-800">
              <div class="text-slate-500">صافي الربح الحالي vs المتوقع</div>
              <div class="mt-1 font-mono-num font-bold">
                {{ fmt(whatIfSim.baseNet) }} → <span class="text-emerald-600">{{ fmt(whatIfSim.simNet) }} ج.م</span>
              </div>
            </div>
            <div class="col-span-2 rounded-lg border p-3 dark:border-slate-800">
              <div class="text-slate-500">صافي الأثر على الربحية</div>
              <div class="mt-1 font-mono-num text-base font-bold" :class="whatIfSim.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'">
                {{ whatIfSim.delta >= 0 ? '+' : '' }}{{ fmt(whatIfSim.delta) }} ج.م
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Equity Partners -->
      <div v-if="reportTab === 'equity'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-7">
          <template #header><div class="font-bold text-sm">توزيع حصص الشركاء ورأس المال</div></template>
          <div class="space-y-3 text-xs">
            <div
              v-for="row in reportData?.equityDistribution?.rows || []"
              :key="row.partner.id"
              class="rounded-lg border border-slate-200 p-3 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <div class="font-bold">{{ row.partner.name }} ({{ row.partner.roleTitle }})</div>
                <div class="text-slate-500 font-mono-num">
                  النسبة: {{ row.partner.profitSharePercent }}% · رأس المال: {{ fmt(row.partner.capitalContribution) }} ج.م
                </div>
              </div>
              <div class="text-left font-mono-num">
                <div class="text-emerald-600 font-bold">حصة الفترة: {{ fmt(row.periodProfitShare) }} ج.م</div>
                <div class="text-slate-500">المسحوب: {{ fmt(row.periodDrawings) }} · المتبقي: {{ fmt(row.netPayableBalance) }} ج.م</div>
              </div>
            </div>
          </div>
        </UCard>

        <div class="lg:col-span-5 space-y-4">
          <UCard>
            <template #header><div class="font-bold text-sm">تسجيل مسحوبات / تسوية / زيادة رأس مال</div></template>
            <form class="space-y-3 text-xs" @submit.prevent="submitDrawing">
              <USelectMenu v-model="drawingForm.partnerId" :items="partnerItems" value-key="value" label-key="label" />
              <USelectMenu v-model="drawingForm.type" :items="drawingTypeItems" value-key="value" label-key="label" />
              <UInput v-model.number="drawingForm.amount" type="number" step="0.01" placeholder="المبلغ (ج.م)" required />
              <UInput v-model="drawingForm.notes" placeholder="ملاحظات..." />
              <UButton type="submit" block color="primary" :loading="busy">تسجيل الحركة</UButton>
            </form>
          </UCard>

          <UCard>
            <template #header><div class="font-bold text-sm">إضافة شريك جديد</div></template>
            <form class="space-y-2.5 text-xs" @submit.prevent="submitNewPartner">
              <UInput v-model="newPartner.name" placeholder="اسم الشريك *" required />
              <div class="grid grid-cols-2 gap-2">
                <UInput v-model.number="newPartner.capitalContribution" type="number" placeholder="رأس المال" />
                <UInput v-model.number="newPartner.profitSharePercent" type="number" step="0.5" placeholder="نسبة الربح %" required />
              </div>
              <UButton type="submit" block variant="outline" color="primary" :loading="busy">إضافة شريك</UButton>
            </form>
          </UCard>
        </div>
      </div>

      <!-- Scheduled Reports -->
      <div v-if="reportTab === 'scheduled'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">جداول التقارير الدورية للمالك</div></template>
          <div class="space-y-2 text-xs">
            <div
              v-for="s in snapshot?.scheduledReports || []"
              :key="s.id"
              class="flex items-center justify-between rounded-lg border p-3 dark:border-slate-800"
            >
              <div>
                <div class="font-bold">{{ s.name }}</div>
                <div class="text-slate-500 font-mono-num">{{ s.frequency }} · {{ s.sendTime }}</div>
              </div>
              <UButton size="xs" color="primary" :loading="busy" @click="runScheduleNow(s.id)">
                تشغيل وإصدار ملخص الآن
              </UButton>
            </div>
          </div>
        </UCard>
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">أرشيف ملخصات التقارير الصادرة</div></template>
          <div class="space-y-2 text-xs">
            <div
              v-for="d in snapshot?.reportDigests || []"
              :key="d.id"
              class="rounded-lg border p-3 dark:border-slate-800"
            >
              <div class="font-bold">{{ d.title }}</div>
              <div class="mt-1 font-mono-num text-slate-600 dark:text-slate-300">
                المبيعات: {{ fmt(d.summaryJson?.revenue) }} ج.م · صافي الربح: {{ fmt(d.summaryJson?.netOperatingProfit) }} ج.م · الفواتير: {{ d.summaryJson?.invoiceCount }}
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- 6-Factor Shift Z-Report -->
      <div v-if="reportTab === 'shift'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">جرد وتقفيل الوردية (6 بنود نقدية)</div></template>
          <div v-if="shiftSummary" class="space-y-2.5 text-xs">
            <div class="grid grid-cols-2 gap-2 font-mono-num">
              <div class="rounded border p-2 dark:border-slate-800">+ مبيعات كاش: <strong>{{ fmt(shiftSummary.cashSales) }}</strong></div>
              <div class="rounded border p-2 dark:border-slate-800">+ تحصيل عملاء كاش: <strong>{{ fmt(shiftSummary.cashCollections) }}</strong></div>
              <div class="rounded border p-2 dark:border-slate-800">- مرتجعات كاش: <strong>{{ fmt(shiftSummary.cashReturns) }}</strong></div>
              <div class="rounded border p-2 dark:border-slate-800">- مصروفات الدرج: <strong>{{ fmt(shiftSummary.cashExpenses) }}</strong></div>
              <div class="rounded border p-2 dark:border-slate-800">- دفعات موردين كاش: <strong>{{ fmt(shiftSummary.cashSupplierPayouts) }}</strong></div>
              <div class="rounded border p-2 dark:border-slate-800">- مسحوبات شركاء: <strong>{{ fmt(shiftSummary.cashEquityDrawings) }}</strong></div>
            </div>
            <form class="space-y-2.5 pt-2" @submit.prevent="submitShiftClose">
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="عهدة بداية الوردية">
                  <UInput v-model.number="shiftForm.openingFloat" type="number" step="0.01" />
                </UFormField>
                <UFormField label="النقدية الفعلية بالدرج">
                  <UInput v-model.number="shiftForm.actualCash" type="number" step="0.01" />
                </UFormField>
              </div>
              <div class="font-mono-num font-bold text-emerald-600">
                الرصيد الدفتري المتوقع بالدرج: {{ fmt(expectedShiftCash) }} ج.م
              </div>
              <UInput v-model="shiftForm.notes" placeholder="ملاحظات الجرد..." />
              <UButton type="submit" block color="primary" :loading="busy">اعتماد وإغلاق الوردية (Z-Report)</UButton>
            </form>
          </div>
        </UCard>

        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">سجل إغلاقات الورديات السابقة</div></template>
          <div class="space-y-2 text-xs">
            <div
              v-for="cl in shiftSummary?.recentClosures || []"
              :key="cl.id"
              class="rounded-lg border p-3 dark:border-slate-800 flex justify-between"
            >
              <div>
                <div class="font-bold">{{ cl.cashierName }}</div>
                <div class="text-slate-500 font-mono-num">{{ new Date(cl.closedAt).toLocaleString('ar-EG') }}</div>
              </div>
              <div class="text-left font-mono-num">
                <div>الفعلي: {{ fmt(cl.actualCash) }} ج.م</div>
                <div :class="cl.variance === 0 ? 'text-emerald-600' : 'text-amber-600'">الفرق: {{ fmt(cl.variance) }} ج.م</div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <!-- Settings & Security Mode -->
    <section v-if="mode === 'settings'" class="space-y-5">
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">بيانات المتجر والنشاط والسياسات</div></template>
          <form class="space-y-3 text-xs" @submit.prevent="saveSettings">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField label="اسم المتجر">
                <UInput v-model="settingsForm.storeName" required />
              </UFormField>
              <UFormField label="النشاط التجاري">
                <USelectMenu
                  v-model="settingsForm.activityId"
                  :items="activityItems"
                  value-key="value"
                  label-key="label"
                />
              </UFormField>
              <UFormField label="الهاتف">
                <UInput v-model="settingsForm.phone" />
              </UFormField>
              <UFormField label="الضريبة VAT %">
                <UInput v-model.number="settingsForm.vatPercent" type="number" step="0.5" />
              </UFormField>
            </div>
            <UFormField label="العنوان">
              <UInput v-model="settingsForm.address" />
            </UFormField>
            <UFormField label="تذييل الفاتورة">
              <UInput v-model="settingsForm.receiptFooter" />
            </UFormField>
            <div class="space-y-2 pt-1">
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="settingsForm.requireLoginOnStart" type="checkbox" class="accent-emerald-600" />
                <span>إلزام تسجيل الدخول برمز PIN عند بدء البرنامج</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="settingsForm.allowNegativeStock" type="checkbox" class="accent-emerald-600" />
                <span>السماح بالبيع بالسالب عند نفاد المخزون الدفتري</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="settingsForm.loyaltyEnabled" type="checkbox" class="accent-emerald-600" />
                <span>تفعيل نظام نقاط الولاء للعملاء</span>
              </label>
            </div>
            <UButton type="submit" color="primary" :loading="busy">حفظ إعدادات المنشأة والسياسات</UButton>
          </form>
        </UCard>

        <div class="lg:col-span-6 space-y-4">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-bold text-sm">الموظفون والصلاحيات وأمان سلسلة الفواتير</span>
                <UButton size="xs" variant="outline" icon="i-lucide-shield-check" @click="checkIntegrity">
                  فحص SHA-256
                </UButton>
              </div>
            </template>
            <div class="space-y-2 text-xs">
              <UAlert
                v-if="integrityMsg"
                :color="integrityMsg.ok ? 'success' : 'error'"
                variant="soft"
                :title="integrityMsg.text"
              />
              <div
                v-for="u in snapshot?.staff || []"
                :key="u.id"
                class="flex items-center justify-between rounded-lg border p-2.5 dark:border-slate-800"
              >
                <div>
                  <div class="font-bold">{{ u.name }}</div>
                  <div class="text-slate-500">{{ u.role }} · {{ u.active ? 'نشط' : 'معطل' }}</div>
                </div>
                <UButton
                  size="xs"
                  variant="soft"
                  :color="u.active ? 'warning' : 'success'"
                  @click="toggleStaff(u)"
                >
                  {{ u.active ? 'تعطيل' : 'تفعيل' }}
                </UButton>
              </div>
              <form class="flex gap-2 pt-2" @submit.prevent="addStaff">
                <UInput v-model="newStaff.name" placeholder="اسم الموظف..." class="flex-1" required />
                <USelectMenu
                  v-model="newStaff.role"
                  :items="[{ label: 'كاشير', value: 'CASHIER' }, { label: 'مدير', value: 'MANAGER' }]"
                  value-key="value"
                  label-key="label"
                  class="w-28"
                />
                <UInput v-model="newStaff.pin" placeholder="PIN" class="w-24 font-mono-num" required />
                <UButton type="submit" size="xs" color="primary" :loading="busy">إضافة</UButton>
              </form>
            </div>
          </UCard>

          <UCard>
            <template #header><div class="font-bold text-sm">حالة الترخيص التجاري</div></template>
            <div class="text-xs space-y-2">
              <div>الباقة: <strong>{{ snapshot?.license?.plan || 'PRO_COMMERCIAL' }}</strong> · الحالة: <strong class="text-emerald-600">{{ snapshot?.license?.status || 'ACTIVE' }}</strong></div>
              <div class="font-mono-num text-slate-500 break-all">البصمة: {{ snapshot?.license?.hardwareFingerprint || '—' }}</div>
              <UButton size="xs" color="primary" variant="soft" @click="activateProLicense">
                تجديد وتوقيع ترخيص PRO سنوي
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  mode: 'reports' | 'settings';
}>();

const emit = defineEmits<{
  notify: [msg: string];
}>();

const { snapshot, apiFetch, refresh } = useTajirStore();

const busy = ref(false);
const reportTab = ref<'pnl' | 'abc' | 'whatif' | 'equity' | 'scheduled' | 'shift'>('pnl');
const reportPeriod = ref<'daily' | 'monthly' | 'yearly'>('monthly');
const reportData = ref<any>(null);
const loadingReports = ref(false);
const shiftSummary = ref<any>(null);

const reportSubTabs = [
  { id: 'pnl' as const, label: 'الأرباح والخسائر (P&L)' },
  { id: 'abc' as const, label: 'الأصناف الراكدة ABC' },
  { id: 'whatif' as const, label: 'محاكاة ماذا لو' },
  { id: 'equity' as const, label: 'الشركاء والمسحوبات' },
  { id: 'scheduled' as const, label: 'التقارير المجدولة' },
  { id: 'shift' as const, label: 'تقفيل الوردية (Z-Report)' },
];

const periodOptions = [
  { label: 'يومي', value: 'daily' },
  { label: 'شهري', value: 'monthly' },
  { label: 'سنوي', value: 'yearly' },
];

const prodProfitCols = [
  { accessorKey: 'productName', header: 'الصنف' },
  { accessorKey: 'qtySold', header: 'الكمية المباعة' },
  { accessorKey: 'revenue', header: 'الإيراد' },
  { accessorKey: 'historicalCost', header: 'التكلفة التاريخية' },
  { accessorKey: 'historicalProfit', header: 'الربح التاريخي' },
  { accessorKey: 'marginPercent', header: 'الهامش %' },
];

const abcCols = [
  { accessorKey: 'productName', header: 'الصنف' },
  { accessorKey: 'abcClass', header: 'فئة ABC' },
  { accessorKey: 'healthTag', header: 'الحالة' },
  { accessorKey: 'stockQty', header: 'الرصيد' },
  { accessorKey: 'qtySoldLast90d', header: 'مباع 90 يوم' },
  { accessorKey: 'stockCostValue', header: 'قيمة التكلفة' },
];

const whatIf = reactive({
  targetMarginPct: 22,
  volumeDeltaPct: 10,
  opExDeltaPct: 0,
});

const whatIfSim = computed(() => {
  const pnl = reportData.value?.profitLoss || {};
  const baseRev = Number(pnl.netSalesRevenue || 0);
  const baseNet = Number(pnl.netOperatingProfit || 0);
  const baseExp = Number(pnl.operatingExpensesTotal || 0);
  const simRev = baseRev * (1 + whatIf.volumeDeltaPct / 100);
  const simGross = simRev * (whatIf.targetMarginPct / 100);
  const simExp = baseExp * (1 + whatIf.opExDeltaPct / 100);
  const simNet = simGross - simExp;
  return {
    baseRev,
    baseNet,
    simRev,
    simNet,
    delta: simNet - baseNet,
  };
});

async function loadReports() {
  loadingReports.value = true;
  try {
    const [rep, shift] = await Promise.all([
      apiFetch(`/api/reports?period=${reportPeriod.value}`),
      apiFetch('/api/shifts/summary'),
    ]);
    reportData.value = rep;
    shiftSummary.value = shift;
  } finally {
    loadingReports.value = false;
  }
}

watch(
  () => props.mode,
  (m) => {
    if (m === 'reports') loadReports();
  },
  { immediate: true }
);

const partnerItems = computed(() =>
  (snapshot.value?.equityPartners || []).map((p: any) => ({ label: p.name, value: p.id }))
);
const drawingTypeItems = [
  { label: 'مسحوبات شريك', value: 'DRAW' },
  { label: 'تسوية أرباح', value: 'SETTLEMENT' },
  { label: 'زيادة رأس مال', value: 'CAPITAL_ADD' },
];
const drawingForm = reactive({
  partnerId: '',
  type: 'DRAW',
  amount: 0,
  notes: '',
});
const newPartner = reactive({
  name: '',
  capitalContribution: 0,
  profitSharePercent: 10,
});

watch(
  partnerItems,
  (items) => {
    if (!drawingForm.partnerId && items[0]) drawingForm.partnerId = items[0].value;
  },
  { immediate: true }
);

async function submitDrawing() {
  if (!drawingForm.partnerId || drawingForm.amount <= 0) return;
  busy.value = true;
  try {
    await apiFetch(`/api/equity-partners/${drawingForm.partnerId}/drawings`, {
      method: 'POST',
      body: drawingForm,
    });
    drawingForm.amount = 0;
    drawingForm.notes = '';
    await Promise.all([refresh(), loadReports()]);
    emit('notify', 'تم تسجيل حركة الشريك وتحديث الخزينة بنجاح');
  } finally {
    busy.value = false;
  }
}

async function submitNewPartner() {
  busy.value = true;
  try {
    await apiFetch('/api/equity-partners', { method: 'POST', body: newPartner });
    newPartner.name = '';
    await Promise.all([refresh(), loadReports()]);
    emit('notify', 'تمت إضافة الشريك بنجاح');
  } finally {
    busy.value = false;
  }
}

async function runScheduleNow(id: string) {
  busy.value = true;
  try {
    await apiFetch(`/api/scheduled-reports/${id}/run-now`, { method: 'POST' });
    await refresh();
    emit('notify', 'تم إصدار ملخص التقرير الدوري فوراً');
  } finally {
    busy.value = false;
  }
}

const shiftForm = reactive({
  openingFloat: 1000,
  actualCash: 0,
  notes: '',
});

const expectedShiftCash = computed(() => {
  const s = shiftSummary.value;
  if (!s) return shiftForm.openingFloat;
  return (
    shiftForm.openingFloat +
    Number(s.cashSales || 0) +
    Number(s.cashCollections || 0) -
    Number(s.cashReturns || 0) -
    Number(s.cashExpenses || 0) -
    Number(s.cashSupplierPayouts || 0) -
    Number(s.cashEquityDrawings || 0)
  );
});

async function submitShiftClose() {
  busy.value = true;
  try {
    await apiFetch('/api/shifts/close', { method: 'POST', body: shiftForm });
    await loadReports();
    emit('notify', 'تم إغلاق الوردية واعتماد تقرير Z-Report');
  } finally {
    busy.value = false;
  }
}

// Settings State
const settingsForm = reactive({
  storeName: '',
  activityId: 'grocery',
  phone: '',
  address: '',
  vatPercent: 0,
  receiptFooter: '',
  requireLoginOnStart: false,
  allowNegativeStock: false,
  loyaltyEnabled: true,
});

watch(
  () => snapshot.value?.settings,
  (s) => {
    if (!s) return;
    settingsForm.storeName = s.storeName || '';
    settingsForm.activityId = s.activityId || 'grocery';
    settingsForm.phone = s.phone || '';
    settingsForm.address = s.address || '';
    settingsForm.vatPercent = Number(s.vatPercent || 0);
    settingsForm.receiptFooter = s.receiptFooter || '';
    settingsForm.requireLoginOnStart = Boolean(s.requireLoginOnStart);
    settingsForm.allowNegativeStock = Boolean(s.allowNegativeStock);
    settingsForm.loyaltyEnabled = Boolean(s.loyaltyEnabled);
  },
  { immediate: true }
);

const activityItems = computed(() =>
  (snapshot.value?.activities || []).map((a: any) => ({ label: a.nameAr, value: a.id }))
);

async function saveSettings() {
  busy.value = true;
  try {
    await apiFetch('/api/settings', { method: 'POST', body: settingsForm });
    await refresh();
    emit('notify', 'تم حفظ إعدادات المنشأة والنشاط والسياسات');
  } finally {
    busy.value = false;
  }
}

const newStaff = reactive({ name: '', role: 'CASHIER', pin: '' });
const integrityMsg = ref<{ ok: boolean; text: string } | null>(null);

async function addStaff() {
  busy.value = true;
  try {
    await apiFetch('/api/security/staff', { method: 'POST', body: newStaff });
    newStaff.name = '';
    newStaff.pin = '';
    await refresh();
    emit('notify', 'تمت إضافة الموظف بنجاح');
  } finally {
    busy.value = false;
  }
}

async function toggleStaff(u: any) {
  await apiFetch(`/api/security/staff/${u.id}`, {
    method: 'PATCH',
    body: { active: !u.active },
  });
  await refresh();
  emit('notify', `تم تحديث حالة الموظف ${u.name}`);
}

async function checkIntegrity() {
  const res = await apiFetch('/api/security/integrity');
  integrityMsg.value = {
    ok: res.chainIntact,
    text: res.chainIntact
      ? `سلسلة الفواتير SHA-256 سليمة (${res.validInvoices} / ${res.totalInvoicesChecked})`
      : `تم اكتشاف خلل في ${res.brokenInvoiceIds.length} فواتير`,
  };
}

async function activateProLicense() {
  await apiFetch('/api/security/license/activate', {
    method: 'POST',
    body: { plan: 'PRO_COMMERCIAL', durationDays: 365, maxTerminals: 10 },
  });
  await refresh();
  emit('notify', 'تم تفعيل الترخيص السنوي الموثق');
}

function fmt(val: unknown): string {
  return Number(val || 0).toFixed(2);
}
</script>
