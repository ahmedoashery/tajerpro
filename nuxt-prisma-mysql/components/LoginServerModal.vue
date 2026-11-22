<template>
  <UModal v-model:open="open" title="تسجيل الدخول وإعدادات الخادم و MySQL" class="max-w-xl">
    <template #body>
      <UTabs v-model="activeTab" :items="tabItems" class="w-full">
        <template #login>
          <form class="space-y-4 pt-3" @submit.prevent="submitPin">
            <UFormField label="حساب الموظف">
              <USelectMenu
                v-model="selectedUserId"
                :items="staffItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>

            <UFormField label="الرمز السري (PIN)" hint="المالك: 1234 · المدير: 2222 · الكاشير: 1111">
              <UInput v-model="pin" type="password" placeholder="أدخل رمز PIN..." required class="w-full" />
            </UFormField>

            <UAlert v-if="loginErr" color="error" variant="soft" :title="loginErr" />

            <div class="flex items-center justify-between pt-2">
              <UButton variant="soft" color="neutral" icon="i-lucide-server" @click="activeTab = 'server'">
                إعدادات الخادم و MySQL
              </UButton>
              <UButton type="submit" color="primary" :loading="verifying">دخول للنظام</UButton>
            </div>
          </form>
        </template>

        <template #server>
          <div class="space-y-4 pt-3 text-xs">
            <UFormField label="عنوان خادم Nuxt (اتركه فارغاً للنطاق الحالي)">
              <UInput v-model="draftServerUrl" dir="ltr" placeholder="https://pos.yourstore.com" class="w-full" />
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
const { snapshot, currentUserId, serverUrl, apiFetch, refresh } = useTajirStore();

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
});

const tabItems = [
  { label: 'دخول الموظف (PIN)', value: 'login', slot: 'login' },
  { label: 'إعدادات الخادم و MySQL', value: 'server', slot: 'server' },
];

const staffItems = computed(() =>
  (snapshot.value?.staff || []).map((u: any) => ({
    label: `${u.name} (${u.role})`,
    value: u.id,
  }))
);

async function submitPin() {
  verifying.value = true;
  loginErr.value = '';
  try {
    const res = await apiFetch('/api/auth/verify-pin', {
      method: 'POST',
      body: { userId: selectedUserId.value, pin: pin.value },
    });
    currentUserId.value = res.user.id;
    pin.value = '';
    open.value = false;
  } catch (err: any) {
    loginErr.value = err?.data?.statusMessage || 'رمز الدخول غير صحيح';
  } finally {
    verifying.value = false;
  }
}

async function testMysql(applyRuntime: boolean) {
  testingMysql.value = true;
  mysqlStatus.value = null;
  try {
    serverUrl.value = draftServerUrl.value.trim();
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
