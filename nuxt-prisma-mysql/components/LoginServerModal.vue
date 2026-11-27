<template>
  <UModal v-model:open="open" title="بوابة الدخول وإعدادات الخادم و MySQL" class="max-w-xl">
    <template #body>
      <UTabs v-model="activeTab" :items="tabItems" class="w-full">
        <template #login>
          <form class="space-y-4 pt-3" @submit.prevent="submitPin">
            <UFormField label="حساب الموظف أو صاحب المحل">
              <USelectMenu
                v-model="selectedUserId"
                :items="staffItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>

            <UFormField label="الرمز السري (PIN)">
              <UInput v-model="pin" type="password" placeholder="أدخل رمز PIN..." required class="w-full font-mono-num" />
            </UFormField>

            <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="text-slate-500">تعبئة سريعة للتجربة:</span>
              <UButton size="xs" variant="outline" color="neutral" @click="quickFill('usr-owner', '1234')">
                المالك (1234)
              </UButton>
              <UButton size="xs" variant="outline" color="neutral" @click="quickFill('usr-manager', '2222')">
                المدير (2222)
              </UButton>
              <UButton size="xs" variant="outline" color="neutral" @click="quickFill('usr-cashier', '1111')">
                الكاشير (1111)
              </UButton>
            </div>

            <UAlert v-if="loginErr" color="error" variant="soft" :title="loginErr" />

            <div class="flex items-center justify-between pt-2">
              <div class="flex items-center gap-2">
                <UButton variant="soft" color="neutral" icon="i-lucide-server" @click="activeTab = 'server'">
                  إعدادات الخادم و MySQL
                </UButton>
                <UButton
                  v-if="authToken"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="handleLogout"
                >
                  تسجيل خروج
                </UButton>
              </div>
              <UButton type="submit" color="primary" :loading="verifying">دخول موثق للنظام</UButton>
            </div>
          </form>
        </template>

        <template #server>
          <div class="space-y-4 pt-3 text-xs">
            <UFormField label="عنوان خادم Nuxt (اتركه فارغاً للنطاق الحالي)">
              <UInput v-model="draftServerUrl" dir="ltr" placeholder="https://tajirpro.vercel.app" class="w-full" />
            </UFormField>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <UFormField label="MySQL Host">
                <UInput v-model="mysql.host" dir="ltr" class="w-full" />
              </UFormField>
              <UFormField label="Port">
                <UInput v-model.number="mysql.port" type="number" dir="ltr" class="w-full" />
              </UFormField>
              <UFormField label="Database Name">
                <UInput v-model="mysql.database" dir="ltr" class="w-full" />
              </UFormField>
              <UFormField label="User">
                <UInput v-model="mysql.user" dir="ltr" class="w-full" />
              </UFormField>
              <UFormField label="Password" class="sm:col-span-2">
                <UInput v-model="mysql.password" type="password" dir="ltr" class="w-full" />
              </UFormField>
              <label class="sm:col-span-2 flex items-center gap-2 cursor-pointer">
                <input v-model="mysql.ssl" type="checkbox" class="accent-emerald-600" />
                <span>تفعيل اتصال SSL/TLS (مطلوب لقواعد MySQL السحابية مع Vercel)</span>
              </label>
            </div>

            <UAlert
              v-if="mysqlStatus"
              :color="mysqlStatus.ok ? 'success' : 'warning'"
              variant="soft"
              :title="mysqlStatus.message"
            />

            <div class="flex flex-wrap justify-end gap-2">
              <UButton variant="outline" color="neutral" :loading="testingMysql" @click="testMysql(false)">
                اختبار MySQL
              </UButton>
              <UButton color="primary" :loading="testingMysql" @click="testMysql(true)">
                اعتماد الخادم و MySQL
              </UButton>
            </div>
          </div>
        </template>
      </UTabs>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });
const { snapshot, currentUserId, serverUrl, authToken, setServerUrl, apiFetch, loginWithPin, logout, refresh } =
  useTajirStore();

const activeTab = ref('login');
const selectedUserId = ref(currentUserId.value);
const pin = ref('');
const verifying = ref(false);
const loginErr = ref('');

const draftServerUrl = ref(serverUrl.value);
const testingMysql = ref(false);
const mysqlStatus = ref<{ ok: boolean; message: string } | null>(null);
const mysql = reactive({
  host: '127.0.0.1',
  port: 3306,
  database: 'tajirpro_pos',
  user: 'tajirpro_user',
  password: '',
  ssl: false,
});

const tabItems = [
  { label: 'دخول الموظف (PIN)', value: 'login', slot: 'login' },
  { label: 'إعدادات الخادم و MySQL', value: 'server', slot: 'server' },
];

const staffItems = computed(() => {
  const list = snapshot.value?.staff || [
    { id: 'usr-owner', name: 'الحاج محمود (المالك)', role: 'OWNER' },
    { id: 'usr-manager', name: 'أحمد سعيد (المدير)', role: 'MANAGER' },
    { id: 'usr-cashier', name: 'كريم عادل (كاشير)', role: 'CASHIER' },
  ];
  return list.map((u: any) => ({
    label: `${u.name} (${u.role})`,
    value: u.id,
  }));
});

watch(open, (val) => {
  if (val) {
    selectedUserId.value = currentUserId.value || staffItems.value[0]?.value || 'usr-owner';
    draftServerUrl.value = serverUrl.value;
    loginErr.value = '';
  }
});

function quickFill(uid: string, demoPin: string) {
  selectedUserId.value = uid;
  pin.value = demoPin;
}

async function submitPin() {
  verifying.value = true;
  loginErr.value = '';
  try {
    await loginWithPin(selectedUserId.value, pin.value);
    pin.value = '';
    open.value = false;
  } catch (err: any) {
    loginErr.value = err?.data?.statusMessage || err?.message || 'رمز الدخول غير صحيح';
  } finally {
    verifying.value = false;
  }
}

async function handleLogout() {
  await logout();
  open.value = false;
}

async function testMysql(applyRuntime: boolean) {
  testingMysql.value = true;
  mysqlStatus.value = null;
  try {
    setServerUrl(draftServerUrl.value);
    const res = await apiFetch('/api/server/test-mysql', {
      method: 'POST',
      body: { ...mysql, applyRuntime },
    });
    mysqlStatus.value = res;
    if (applyRuntime && res.ok) {
      await refresh();
    }
  } catch (err: any) {
    mysqlStatus.value = { ok: false, message: err?.message || 'فشل الاتصال بـ MySQL' };
  } finally {
    testingMysql.value = false;
  }
}
</script>
