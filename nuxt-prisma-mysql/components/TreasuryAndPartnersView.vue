<template>
  <div class="space-y-5">
    <!-- Treasuries & Expenses Mode -->
    <section v-if="mode === 'treasuries'" class="space-y-5">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <UCard v-for="t in snapshot?.treasuries || []" :key="t.id">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold">{{ t.name }}</span>
            <UBadge size="xs" :color="t.isDefault ? 'primary' : 'neutral'" variant="soft">
              {{ treasuryTypeLabel(t.type) }}
            </UBadge>
          </div>
          <div class="mt-2 font-mono-num text-lg font-bold text-emerald-600">
            {{ fmt(t.currentBalance) }} ج.م
          </div>
          <div v-if="t.accountNumber" class="mt-1 font-mono-num text-[11px] text-slate-500">
            {{ t.accountNumber }}
          </div>
        </UCard>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">إضافة خزينة أو حساب بنكي / محفظة</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="createTreasury">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="اسم الخزينة">
                <UInput v-model="newTreasury.name" placeholder="مثال: خزينة المعرض / حساب CIB" required />
              </UFormField>
              <UFormField label="النوع">
                <USelectMenu
                  v-model="newTreasury.type"
                  :items="treasuryTypes"
                  value-key="value"
                  label-key="label"
                />
              </UFormField>
              <UFormField label="رقم الحساب / المحفظة">
                <UInput v-model="newTreasury.accountNumber" dir="ltr" />
              </UFormField>
              <UFormField label="الرصيد الافتتاحي">
                <UInput v-model.number="newTreasury.currentBalance" type="number" step="0.01" />
              </UFormField>
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="newTreasury.isDefault" type="checkbox" class="accent-emerald-600" />
              <span>تعيين كخزينة افتراضية للصرف والتحصيل</span>
            </label>
            <UButton type="submit" color="primary" :loading="busy">حفظ الخزينة</UButton>
          </form>
        </UCard>

        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">تحويل رصيد بين الخزائن</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="transferBetweenTreasuries">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="من خزينة">
                <USelectMenu v-model="transferForm.fromTreasuryId" :items="treasuryOptions" value-key="value" label-key="label" />
              </UFormField>
              <UFormField label="إلى خزينة">
                <USelectMenu v-model="transferForm.toTreasuryId" :items="treasuryOptions" value-key="value" label-key="label" />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="المبلغ (ج.م)">
                <UInput v-model.number="transferForm.amount" type="number" step="0.01" min="0.01" required />
              </UFormField>
              <UFormField label="ملاحظات التحويل">
                <UInput v-model="transferForm.notes" placeholder="توريد بنكي / تغذية درج..." />
              </UFormField>
            </div>
            <UButton type="submit" color="primary" variant="soft" :loading="busy">تنفيذ التحويل الفوري</UButton>
          </form>
        </UCard>
      </div>

      <!-- Expenses & Recurring -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">تسجيل مصروف تشغيلي / سحب</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="createExpense">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="بيان المصروف">
                <UInput v-model="expenseForm.title" placeholder="فاتورة كهرباء / شحن..." required />
              </UFormField>
              <UFormField label="التصنيف">
                <USelectMenu v-model="expenseForm.category" :items="expenseCategories" value-key="value" label-key="label" />
              </UFormField>
              <UFormField label="المبلغ (ج.م)">
                <UInput v-model.number="expenseForm.amount" type="number" step="0.01" min="0.01" required />
              </UFormField>
              <UFormField label="الخزينة المصروف منها">
                <USelectMenu v-model="expenseForm.treasuryId" :items="treasuryOptions" value-key="value" label-key="label" />
              </UFormField>
            </div>
            <UButton type="submit" color="primary" :loading="busy">تسجيل وخصم من الخزينة</UButton>
          </form>

          <div class="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div
              v-for="e in snapshot?.expenses || []"
              :key="e.id"
              class="flex items-center justify-between py-2"
            >
              <div>
                <div class="font-bold">{{ e.title }}</div>
                <div class="text-slate-500">{{ e.category }} · {{ e.treasuryName || 'الخزينة' }}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-mono-num font-bold text-rose-600">-{{ fmt(e.amount) }} ج.م</span>
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteExpense(e.id)" />
              </div>
            </div>
          </div>
        </UCard>

        <UCard class="lg:col-span-6">
          <template #header><div class="font-bold text-sm">المصروفات المتكررة المجدولة (إيجار / رواتب)</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="createRecurring">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="اسم الالتزام">
                <UInput v-model="recurringForm.title" placeholder="إيجار المحل الشهري" required />
              </UFormField>
              <UFormField label="التصنيف">
                <USelectMenu v-model="recurringForm.category" :items="expenseCategories" value-key="value" label-key="label" />
              </UFormField>
              <UFormField label="المبلغ">
                <UInput v-model.number="recurringForm.amount" type="number" step="0.01" min="0.01" required />
              </UFormField>
              <UFormField label="التكرار">
                <USelectMenu v-model="recurringForm.frequency" :items="recurringFreqs" value-key="value" label-key="label" />
              </UFormField>
            </div>
            <UButton type="submit" variant="outline" color="primary" :loading="busy">إضافة مصروف متكرر</UButton>
          </form>

          <div class="mt-4 space-y-2 text-xs">
            <div
              v-for="r in snapshot?.recurringExpenses || []"
              :key="r.id"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 dark:border-slate-800"
            >
              <div>
                <div class="font-bold">{{ r.title }} ({{ r.frequency }})</div>
                <div class="font-mono-num text-slate-500">
                  {{ fmt(r.amount) }} ج.م · الاستحقاق: {{ new Date(r.nextDueDate).toLocaleDateString('ar-EG') }}
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <UButton size="xs" color="primary" variant="soft" :loading="busy" @click="executeRecurring(r.id)">
                  صرف الآن
                </UButton>
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteRecurring(r.id)" />
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <!-- Customers & Suppliers Mode -->
    <section v-if="mode === 'partners'" class="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <!-- Customers -->
      <div class="lg:col-span-6 space-y-4">
        <UCard>
          <template #header><div class="font-bold text-sm">إضافة عميل جديد</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="createCustomer">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UInput v-model="customerForm.name" placeholder="اسم العميل *" required />
              <UInput v-model="customerForm.phone" placeholder="رقم الهاتف" dir="ltr" />
              <UInput v-model.number="customerForm.creditLimit" type="number" placeholder="الحد الائتماني للآجل" />
              <USelectMenu v-model="customerForm.defaultPriceTier" :items="tierItems" value-key="value" label-key="label" />
            </div>
            <UButton type="submit" color="primary" :loading="busy">حفظ العميل</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><div class="font-bold text-sm">دفتر العملاء والمديونيات ونقاط الولاء</div></template>
          <div class="space-y-2.5 text-xs">
            <div
              v-for="c in snapshot?.customers || []"
              :key="c.id"
              class="rounded-lg border p-3 dark:border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-bold">{{ c.name }}</div>
                  <div class="text-slate-500 font-mono-num">
                    {{ c.phone || 'بدون هاتف' }} · نقاط: {{ c.loyaltyPoints }} · رصيد دائن: {{ fmt(c.storeCreditBalance) }}
                  </div>
                </div>
                <div class="text-left font-mono-num">
                  <div :class="c.balanceDue > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600'">
                    مديونية: {{ fmt(c.balanceDue) }} ج.م
                  </div>
                  <div class="text-slate-400">مشتريات: {{ fmt(c.totalPurchases) }}</div>
                </div>
              </div>
              <div v-if="c.balanceDue > 0" class="flex items-center gap-2 pt-1">
                <UInput
                  v-model.number="collectAmounts[c.id]"
                  type="number"
                  step="0.01"
                  placeholder="مبلغ التحصيل..."
                  class="flex-1 font-mono-num"
                />
                <UButton size="xs" color="primary" :loading="busy" @click="collectCustomer(c)">
                  تحصيل للخزينة
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Suppliers -->
      <div class="lg:col-span-6 space-y-4">
        <UCard>
          <template #header><div class="font-bold text-sm">إضافة مورد جديد</div></template>
          <form class="space-y-2.5 text-xs" @submit.prevent="createSupplier">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UInput v-model="supplierForm.name" placeholder="اسم المورد *" required />
              <UInput v-model="supplierForm.phone" placeholder="رقم الهاتف" dir="ltr" />
              <UInput v-model="supplierForm.company" placeholder="الشركة / المصنع" />
              <UInput v-model="supplierForm.category" placeholder="التصنيف" />
            </div>
            <UButton type="submit" color="primary" :loading="busy">حفظ المورد</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><div class="font-bold text-sm">دفتر الموردين والمستحقات</div></template>
          <div class="space-y-2.5 text-xs">
            <div
              v-for="s in snapshot?.suppliers || []"
              :key="s.id"
              class="rounded-lg border p-3 dark:border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-bold">{{ s.name }}</div>
                  <div class="text-slate-500">{{ s.company || s.category }} · {{ s.phone }}</div>
                </div>
                <div class="font-mono-num font-bold" :class="s.balanceOwed > 0 ? 'text-amber-600' : 'text-emerald-600'">
                  مستحق له: {{ fmt(s.balanceOwed) }} ج.م
                </div>
              </div>
              <div v-if="s.balanceOwed > 0" class="flex items-center gap-2 pt-1">
                <UInput
                  v-model.number="paySupplierAmounts[s.id]"
                  type="number"
                  step="0.01"
                  placeholder="دفعة سداد..."
                  class="flex-1 font-mono-num"
                />
                <UButton size="xs" color="warning" :loading="busy" @click="paySupplier(s)">
                  سداد للمورد
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  mode: 'treasuries' | 'partners';
}>();

const emit = defineEmits<{
  notify: [msg: string];
  error: [msg: string];
}>();

const { snapshot, apiFetch, refresh } = useTajirStore();
const busy = ref(false);

const treasuryOptions = computed(() =>
  (snapshot.value?.treasuries || []).map((t: any) => ({
    label: `${t.name} (${Number(t.currentBalance || 0).toFixed(2)})`,
    value: t.id,
  }))
);

const treasuryTypes = [
  { label: 'درج نقدي (كاش)', value: 'CASH_DRAWER' },
  { label: 'حساب بنكي', value: 'BANK_ACCOUNT' },
  { label: 'ماكينة فيزا POS', value: 'BANK_POS' },
  { label: 'محفظة إلكترونية', value: 'WALLET' },
  { label: 'إنستا باي', value: 'INSTAPAY' },
];

const expenseCategories = [
  { label: 'إيجار', value: 'RENT' },
  { label: 'كهرباء / مياه / إنترنت', value: 'UTILITIES' },
  { label: 'رواتب', value: 'SALARIES' },
  { label: 'شحن ونقل', value: 'SHIPPING' },
  { label: 'صيانة', value: 'MAINTENANCE' },
  { label: 'تسويق', value: 'MARKETING' },
  { label: 'مسحوبات شخصية', value: 'OWNER_DRAW' },
  { label: 'مصروفات أخرى', value: 'OTHER' },
];

const recurringFreqs = [
  { label: 'يومي', value: 'DAILY' },
  { label: 'أسبوعي', value: 'WEEKLY' },
  { label: 'شهري', value: 'MONTHLY' },
];

const tierItems = [
  { label: 'قطاعي', value: 'RETAIL' },
  { label: 'نص جملة', value: 'HALF_WHOLESALE' },
  { label: 'جملة', value: 'WHOLESALE' },
];

const newTreasury = reactive({
  name: '',
  type: 'CASH_DRAWER',
  accountNumber: '',
  currentBalance: 0,
  isDefault: false,
});

const transferForm = reactive({
  fromTreasuryId: '',
  toTreasuryId: '',
  amount: 0,
  notes: '',
});

const expenseForm = reactive({
  title: '',
  category: 'UTILITIES',
  amount: 0,
  treasuryId: '',
});

const recurringForm = reactive({
  title: '',
  category: 'RENT',
  amount: 0,
  frequency: 'MONTHLY',
});

const customerForm = reactive({
  name: '',
  phone: '',
  creditLimit: 0,
  defaultPriceTier: 'RETAIL',
});

const supplierForm = reactive({
  name: '',
  phone: '',
  company: '',
  category: 'توريد عام',
});

const collectAmounts = reactive<Record<string, number>>({});
const paySupplierAmounts = reactive<Record<string, number>>({});

watch(
  treasuryOptions,
  (opts) => {
    if (opts.length > 0) {
      if (!transferForm.fromTreasuryId) transferForm.fromTreasuryId = opts[0].value;
      if (!transferForm.toTreasuryId && opts[1]) transferForm.toTreasuryId = opts[1].value;
      if (!expenseForm.treasuryId) expenseForm.treasuryId = opts[0].value;
    }
  },
  { immediate: true }
);

function runOp(fn: () => Promise<void>) {
  busy.value = true;
  fn()
    .catch((err: any) => {
      emit('error', err?.data?.statusMessage || err?.message || 'حدث خطأ أثناء تنفيذ العملية');
    })
    .finally(() => {
      busy.value = false;
    });
}

function createTreasury() {
  runOp(async () => {
    await apiFetch('/api/treasuries', { method: 'POST', body: newTreasury });
    newTreasury.name = '';
    newTreasury.accountNumber = '';
    newTreasury.currentBalance = 0;
    await refresh();
    emit('notify', 'تمت إضافة الخزينة بنجاح');
  });
}

function transferBetweenTreasuries() {
  runOp(async () => {
    await apiFetch('/api/treasuries/transfer', { method: 'POST', body: transferForm });
    transferForm.amount = 0;
    transferForm.notes = '';
    await refresh();
    emit('notify', 'تم تنفيذ التحويل بين الخزائن بنجاح');
  });
}

function createExpense() {
  runOp(async () => {
    await apiFetch('/api/expenses', {
      method: 'POST',
      body: { ...expenseForm, paymentSource: 'CASH_DRAWER' },
    });
    expenseForm.title = '';
    expenseForm.amount = 0;
    await refresh();
    emit('notify', 'تم تسجيل المصروف وخصم قيمته من الخزينة');
  });
}

function deleteExpense(id: string) {
  runOp(async () => {
    await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    await refresh();
    emit('notify', 'تم حذف المصروف واسترداد قيمته للخزينة');
  });
}

function createRecurring() {
  runOp(async () => {
    await apiFetch('/api/expenses/recurring', { method: 'POST', body: recurringForm });
    recurringForm.title = '';
    recurringForm.amount = 0;
    await refresh();
    emit('notify', 'تمت جدولة المصروف المتكرر');
  });
}

function executeRecurring(id: string) {
  runOp(async () => {
    await apiFetch(`/api/expenses/recurring/${id}/execute`, { method: 'POST', body: {} });
    await refresh();
    emit('notify', 'تم صرف المصروف المتكرر وتحديث موعد الاستحقاق القادم');
  });
}

function deleteRecurring(id: string) {
  runOp(async () => {
    await apiFetch(`/api/expenses/recurring/${id}`, { method: 'DELETE' });
    await refresh();
    emit('notify', 'تم إلغاء المصروف المتكرر');
  });
}

function createCustomer() {
  runOp(async () => {
    await apiFetch('/api/customers', { method: 'POST', body: customerForm });
    customerForm.name = '';
    customerForm.phone = '';
    customerForm.creditLimit = 0;
    await refresh();
    emit('notify', 'تمت إضافة العميل بنجاح');
  });
}

function collectCustomer(c: any) {
  const amount = Number(collectAmounts[c.id] || c.balanceDue || 0);
  if (amount <= 0) return;
  runOp(async () => {
    await apiFetch(`/api/customers/${c.id}/collect`, { method: 'POST', body: { amount } });
    collectAmounts[c.id] = 0;
    await refresh();
    emit('notify', `تم تحصيل ${amount.toFixed(2)} ج.م من العميل ${c.name}`);
  });
}

function createSupplier() {
  runOp(async () => {
    await apiFetch('/api/suppliers', { method: 'POST', body: supplierForm });
    supplierForm.name = '';
    supplierForm.phone = '';
    supplierForm.company = '';
    await refresh();
    emit('notify', 'تمت إضافة المورد بنجاح');
  });
}

function paySupplier(s: any) {
  const amount = Number(paySupplierAmounts[s.id] || s.balanceOwed || 0);
  if (amount <= 0) return;
  runOp(async () => {
    await apiFetch(`/api/suppliers/${s.id}/pay`, { method: 'POST', body: { amount } });
    paySupplierAmounts[s.id] = 0;
    await refresh();
    emit('notify', `تم سداد ${amount.toFixed(2)} ج.م للمورد ${s.name}`);
  });
}

function treasuryTypeLabel(type: string) {
  const map: Record<string, string> = {
    CASH_DRAWER: 'درج نقدي',
    BANK_ACCOUNT: 'بنك',
    BANK_POS: 'فيزا POS',
    WALLET: 'محفظة',
    INSTAPAY: 'إنستا باي',
  };
  return map[type] || type;
}

function fmt(val: unknown) {
  return Number(val || 0).toFixed(2);
}
</script>
