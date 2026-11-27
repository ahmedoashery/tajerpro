<template>
  <div class="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <!-- Lock Gate Screen when requireLoginOnStart = true and unauthenticated -->
    <div
      v-if="snapshot?.locked"
      class="flex flex-1 flex-col items-center justify-center p-6 text-center"
    >
      <UCard class="w-full max-w-md space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <UIcon name="i-lucide-lock" class="h-6 w-6" />
        </div>
        <h1 class="text-lg font-extrabold">
          {{ snapshot?.settings?.storeName || 'تاجر برو' }}
        </h1>
        <p class="text-xs text-slate-500">
          تم تفعيل قفل الأمان عند بدء التشغيل. يرجى تسجيل الدخول برمز PIN الموظف أو صاحب المحل للمتابعة.
        </p>
        <div class="flex justify-center gap-2 pt-2">
          <UButton color="primary" icon="i-lucide-key-round" @click="loginModalOpen = true">
            تسجيل الدخول بالرمز السري (PIN)
          </UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-refresh-cw" @click="refresh">
            تحديث
          </UButton>
        </div>
      </UCard>
      <LoginServerModal v-model:open="loginModalOpen" />
    </div>

    <!-- Main Application Shell -->
    <template v-else>
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
          <UBadge v-if="activeActivityName" size="xs" color="neutral" variant="soft">
            {{ activeActivityName }}
          </UBadge>
        </div>

        <div class="flex items-center gap-2">
          <UBadge v-if="lowAlertTotal > 0" color="warning" variant="soft">
            نواقص: {{ lowAlertTotal }}
          </UBadge>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="loading" @click="refresh">
            تحديث
          </UButton>
          <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-printer" @click="printPage">
            طباعة
          </UButton>
          <UButton size="xs" variant="soft" color="primary" icon="i-lucide-key-round" @click="loginModalOpen = true">
            {{ currentUser?.name || 'الدخول والخادم' }}
          </UButton>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Collapsible Desktop Sidebar -->
        <aside
          v-if="sidebarVisible"
          class="no-print flex w-56 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <nav class="space-y-1">
            <UButton
              v-for="tab in visibleTabs"
              :key="tab.id"
              block
              size="sm"
              class="justify-start"
              :variant="activeView === tab.id ? 'soft' : 'ghost'"
              :color="activeView === tab.id ? 'primary' : 'neutral'"
              :icon="tab.icon"
              @click="activeView = tab.id"
            >
              {{ tab.label }}
            </UButton>
          </nav>

          <div class="mt-auto rounded-lg border border-slate-200 p-2.5 text-[11px] dark:border-slate-800">
            <div class="font-semibold">منصة التشغيل السحابية:</div>
            <div class="mt-1 text-slate-500">Nuxt + Prisma + MySQL (Vercel)</div>
          </div>
        </aside>

        <!-- Workspace Content -->
        <main class="flex-1 overflow-y-auto p-4 sm:p-5">
          <!-- Connection Error Banner -->
          <UAlert
            v-if="errorMsg"
            color="error"
            variant="soft"
            class="mb-4 no-print"
            :title="errorMsg"
            description="تأكد من إعداد متغير DATABASE_URL لخادم MySQL في إعدادات Vercel أو افتح إعدادات الخادم للربط."
          >
            <template #actions>
              <UButton size="xs" color="error" @click="loginModalOpen = true">فتح إعدادات الخادم</UButton>
            </template>
          </UAlert>

          <!-- Operation Feedback Banner -->
          <UAlert
            v-if="toast"
            :color="toast.type === 'error' ? 'error' : 'success'"
            variant="soft"
            class="mb-4 no-print"
            :title="toast.message"
            :close="{ color: 'neutral', variant: 'ghost', onClick: () => (toast = null) }"
          />

          <!-- 1. Dashboard View -->
          <section v-if="activeView === 'dashboard'" class="space-y-5">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <UCard>
                <div class="text-xs text-slate-500">مبيعات اليوم</div>
                <div class="mt-1 font-mono-num text-xl font-bold">{{ fmt(dashboard.todayRevenue) }} ج.م</div>
                <div class="mt-0.5 text-[11px] text-slate-400 font-mono-num">{{ dashboard.todayInvoiceCount || 0 }} فاتورة</div>
              </UCard>
              <UCard v-if="currentPermissions.view_profits_costs">
                <div class="text-xs text-slate-500">صافي ربح اليوم</div>
                <div class="mt-1 font-mono-num text-xl font-bold text-emerald-600">{{ fmt(dashboard.todayProfit) }} ج.م</div>
                <div class="mt-0.5 text-[11px] text-slate-400 font-mono-num">بعد المصروفات: {{ fmt(dashboard.todayNetAfterExpenses) }}</div>
              </UCard>
              <UCard>
                <div class="text-xs text-slate-500">مصروفات اليوم</div>
                <div class="mt-1 font-mono-num text-xl font-bold text-amber-600">{{ fmt(dashboard.todayExpenses) }} ج.م</div>
                <div class="mt-0.5 text-[11px] text-slate-400 font-mono-num">الشهر: {{ fmt(dashboard.monthExpenses) }} ج.م</div>
              </UCard>
              <UCard>
                <div class="text-xs text-slate-500">إجمالي السيولة بالخزائن</div>
                <div class="mt-1 font-mono-num text-xl font-bold text-emerald-700 dark:text-emerald-400">
                  {{ fmt(dashboard.totalTreasuriesLiquidity) }} ج.م
                </div>
                <div class="mt-0.5 text-[11px] text-slate-400 font-mono-num">الدرج النقدي: {{ fmt(dashboard.cashDrawerBalance) }}</div>
              </UCard>
            </div>

            <!-- Owner Anomaly Alerts -->
            <div v-if="(snapshot?.ownerAlerts || []).length > 0" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UAlert
                v-for="al in snapshot.ownerAlerts"
                :key="al.id"
                :color="al.severity === 'danger' ? 'error' : al.severity === 'warning' ? 'warning' : 'info'"
                variant="soft"
                :title="`${al.title}${al.metricValue ? ' (' + al.metricValue + ')' : ''}`"
                :description="al.message"
              />
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <!-- Low Stock & Expiring Batches -->
              <UCard class="lg:col-span-6">
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-sm">نواقص وحد الطلب وتنبيهات المخزون</span>
                    <UBadge color="warning" variant="soft">{{ lowAlertTotal }}</UBadge>
                  </div>
                </template>
                <UTable :data="lowStockRows" :columns="lowStockColumns" />

                <div v-if="expiringBatches.length > 0" class="mt-4 border-t pt-3 text-xs space-y-1.5 dark:border-slate-800">
                  <div class="font-bold text-amber-600">تشغيلات تقترب صلاحيتها من الانتهاء (30 يوم):</div>
                  <div v-for="b in expiringBatches" :key="b.id" class="flex justify-between font-mono-num">
                    <span>{{ b.productName }} ({{ b.batchCode }})</span>
                    <span>متبقي: {{ b.qty }} · {{ b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('ar-EG') : '-' }}</span>
                  </div>
                </div>
              </UCard>

              <!-- Auto-Reorder Suggestions Grouped by Supplier -->
              <UCard class="lg:col-span-6">
                <template #header>
                  <div class="font-bold text-sm">اقتراحات إعادة الطلب التلقائية حسب المورد</div>
                </template>
                <div v-if="(snapshot?.reorderSuggestions || []).length === 0" class="text-xs text-slate-500">
                  جميع الأصناف فوق حد الأمان حالياً.
                </div>
                <div v-else class="space-y-3 text-xs">
                  <div
                    v-for="grp in snapshot.reorderSuggestions"
                    :key="grp.supplierId"
                    class="rounded-lg border p-3 dark:border-slate-800 space-y-1.5"
                  >
                    <div class="flex items-center justify-between font-bold">
                      <span>{{ grp.supplierName }}</span>
                      <span class="font-mono-num text-emerald-600">تكلفة متوقعة: {{ fmt(grp.totalEstimatedCost) }} ج.م</span>
                    </div>
                    <div v-for="it in grp.items" :key="it.productId" class="flex justify-between text-slate-500 font-mono-num">
                      <span>{{ it.productName }} (حالي: {{ it.currentStock }})</span>
                      <span>مقترح طلب: +{{ it.suggestedQty }} {{ it.unit }}</span>
                    </div>
                  </div>
                </div>
              </UCard>
            </div>
          </section>

          <!-- 2. POS View -->
          <section v-if="activeView === 'pos'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div class="lg:col-span-7 space-y-3">
              <div class="flex flex-wrap gap-2">
                <UInput
                  v-model="posSearch"
                  icon="i-lucide-search"
                  placeholder="ابحث بالاسم أو امسح الباركود واضغط Enter..."
                  class="flex-1 min-w-[220px]"
                  @keydown.enter.prevent="handleBarcodeEnter"
                />
                <USelectMenu
                  v-model="posPriceTier"
                  :items="priceTierItems"
                  value-key="value"
                  label-key="label"
                  class="w-36"
                  @update:model-value="syncCartTierPrices"
                />
              </div>

              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <UCard
                  v-for="p in filteredPosProducts"
                  :key="p.id"
                  class="cursor-pointer transition hover:ring-1 hover:ring-emerald-500"
                  @click="addToCart(p)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <div class="font-bold text-sm">{{ p.name }}</div>
                      <div class="text-[11px] text-slate-500 font-mono-num">
                        {{ p.sku }} · متاح: {{ p.stockQty }} {{ p.unit }}
                      </div>
                    </div>
                    <div class="text-left font-mono-num">
                      <div class="font-bold text-emerald-600">{{ effectiveUnitPrice(p, posPriceTier).toFixed(2) }} ج.م</div>
                      <div v-if="posPriceTier !== 'RETAIL'" class="text-[10px] text-slate-400">
                        قطاعي: {{ p.salePrice }}
                      </div>
                    </div>
                  </div>
                </UCard>
              </div>
            </div>

            <div class="lg:col-span-5">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-sm">سلة الكاشير</span>
                    <UButton v-if="cart.length > 0" size="xs" variant="ghost" color="error" @click="clearCart">
                      تفريغ
                    </UButton>
                  </div>
                </template>

                <div class="space-y-3 text-xs">
                  <!-- Customer Selection -->
                  <UFormField label="العميل">
                    <USelectMenu
                      v-model="selectedCustomerId"
                      :items="customerSelectItems"
                      value-key="value"
                      label-key="label"
                      @update:model-value="onSelectCustomer"
                    />
                  </UFormField>

                  <div
                    v-if="selectedCustomer"
                    class="flex items-center justify-between rounded bg-slate-100 px-2.5 py-1.5 text-[11px] dark:bg-slate-800 font-mono-num"
                  >
                    <span>نقاط الولاء: {{ selectedCustomer.loyaltyPoints }}</span>
                    <span>رصيد دائن: {{ fmt(selectedCustomer.storeCreditBalance) }} ج.م</span>
                    <span>آجل حالي: {{ fmt(selectedCustomer.balanceDue) }}</span>
                  </div>

                  <!-- Cart Lines -->
                  <div v-if="cart.length === 0" class="py-6 text-center text-slate-400">
                    اختر أصنافاً من القائمة لإضافتها إلى الفاتورة
                  </div>
                  <div v-else class="max-h-60 space-y-2 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    <div v-for="(line, idx) in cart" :key="line.product.id" class="pt-2 space-y-1">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-bold">{{ line.product.name }}</span>
                        <div class="flex items-center gap-1">
                          <UButton size="xs" variant="outline" color="neutral" @click="adjustCartQty(idx, -1)">-</UButton>
                          <span class="w-8 text-center font-mono-num font-bold">{{ line.quantity }}</span>
                          <UButton size="xs" variant="outline" color="neutral" @click="adjustCartQty(idx, 1)">+</UButton>
                          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="cart.splice(idx, 1)" />
                        </div>
                      </div>
                      <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono-num">
                        <span>السعر: {{ line.unitPrice.toFixed(2) }}</span>
                        <div class="flex items-center gap-1">
                          <span>خصم بند:</span>
                          <UInput v-model.number="line.discountAmount" type="number" min="0" step="0.5" size="xs" class="w-16" />
                        </div>
                        <span class="font-bold text-slate-800 dark:text-slate-200">
                          {{ Math.max(0, line.unitPrice * line.quantity - line.discountAmount).toFixed(2) }} ج.م
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Discounts, Loyalty, Store Credit -->
                  <div class="grid grid-cols-2 gap-2 border-t pt-2 dark:border-slate-800">
                    <UFormField label="خصم إضافي على الفاتورة">
                      <UInput v-model.number="invoiceDiscount" type="number" min="0" step="1" class="font-mono-num" />
                    </UFormField>
                    <UFormField v-if="selectedCustomer && snapshot?.settings?.loyaltyEnabled" label="استبدال نقاط ولاء">
                      <UInput
                        v-model.number="redeemPoints"
                        type="number"
                        min="0"
                        :max="selectedCustomer.loyaltyPoints"
                        class="font-mono-num"
                      />
                    </UFormField>
                    <UFormField v-if="selectedCustomer && selectedCustomer.storeCreditBalance > 0" label="استخدام رصيد دائن">
                      <UInput
                        v-model.number="useStoreCredit"
                        type="number"
                        min="0"
                        :max="selectedCustomer.storeCreditBalance"
                        step="0.5"
                        class="font-mono-num"
                      />
                    </UFormField>
                  </div>

                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="applyPromotions" type="checkbox" class="accent-emerald-600" />
                    <span>تطبيق العروض الترويجية التلقائية الفعّالة</span>
                  </label>

                  <!-- Payment Method -->
                  <UFormField label="طريقة السداد">
                    <USelectMenu v-model="paymentMethod" :items="paymentMethods" value-key="value" label-key="label" />
                  </UFormField>

                  <UInput v-if="paymentMethod !== 'CASH' && paymentMethod !== 'CREDIT' && paymentMethod !== 'SPLIT'" v-model="paymentRef" placeholder="رقم مرجع التحويل / الإيصال" dir="ltr" />

                  <!-- Split Payment Rows -->
                  <div v-if="paymentMethod === 'SPLIT'" class="space-y-2 rounded-lg border p-2.5 dark:border-slate-800">
                    <div class="flex items-center justify-between font-bold">
                      <span>توزيع الدفع المختلط</span>
                      <UButton size="xs" variant="soft" @click="addSplitRow">+ إضافة دفعة</UButton>
                    </div>
                    <div v-for="(al, sIdx) in splitAllocations" :key="sIdx" class="grid grid-cols-12 gap-1 items-center">
                      <USelectMenu
                        v-model="al.method"
                        :items="splitMethodItems"
                        value-key="value"
                        label-key="label"
                        class="col-span-4"
                      />
                      <USelectMenu
                        v-model="al.treasuryId"
                        :items="treasurySelectItems"
                        value-key="value"
                        label-key="label"
                        class="col-span-4"
                      />
                      <UInput v-model.number="al.amount" type="number" step="0.01" class="col-span-3 font-mono-num" />
                      <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="col-span-1" @click="splitAllocations.splice(sIdx, 1)" />
                    </div>
                  </div>

                  <!-- Summary -->
                  <div class="space-y-1 border-t pt-2 dark:border-slate-800 font-mono-num">
                    <div class="flex justify-between text-slate-500">
                      <span>المجموع قبل الخصم:</span>
                      <span>{{ cartSubtotal.toFixed(2) }} ج.م</span>
                    </div>
                    <div v-if="estimatedPromoDiscount > 0" class="flex justify-between text-emerald-600">
                      <span>خصم العروض المتوقع:</span>
                      <span>-{{ estimatedPromoDiscount.toFixed(2) }} ج.م</span>
                    </div>
                    <div v-if="estimatedVat > 0" class="flex justify-between text-slate-500">
                      <span>ضريبة VAT ({{ snapshot?.settings?.vatPercent || 0 }}%):</span>
                      <span>{{ estimatedVat.toFixed(2) }} ج.م</span>
                    </div>
                    <div class="flex items-center justify-between pt-1 text-base font-bold">
                      <span>الصافي للدفع:</span>
                      <span class="text-emerald-600">{{ estimatedGrandTotal.toFixed(2) }} ج.م</span>
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <UButton
                      color="primary"
                      :disabled="cart.length === 0"
                      :loading="busy"
                      @click="submitCheckout"
                    >
                      إتمام البيع
                    </UButton>
                    <UButton
                      variant="outline"
                      color="neutral"
                      :disabled="cart.length === 0"
                      :loading="busy"
                      @click="saveAsQuotation"
                    >
                      حفظ كعرض سعر
                    </UButton>
                  </div>
                </div>
              </UCard>
            </div>
          </section>

          <!-- 3. Quotations View -->
          <section v-if="activeView === 'quotations'" class="space-y-4">
            <UCard>
              <template #header><div class="font-bold text-sm">عروض الأسعار المحفوظة</div></template>
              <div v-if="(snapshot?.quotations || []).length === 0" class="text-xs text-slate-500">
                لا توجد عروض أسعار حالياً. يمكنك حفظ أي سلة كعرض سعر من نقطة البيع.
              </div>
              <div v-else class="space-y-2.5 text-xs">
                <div
                  v-for="q in snapshot.quotations"
                  :key="q.id"
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 dark:border-slate-800"
                >
                  <div>
                    <div class="font-mono-num font-bold">
                      {{ q.quotationNumber }} — {{ q.customerName }}
                      <UBadge size="xs" :color="q.status === 'ACTIVE' ? 'primary' : q.status === 'CONVERTED' ? 'success' : 'neutral'" variant="soft" class="mr-1">
                        {{ q.status }}
                      </UBadge>
                    </div>
                    <div class="text-slate-500 font-mono-num mt-0.5">
                      الإجمالي: {{ fmt(q.grandTotal) }} ج.م · عدد البنود: {{ q.items?.length || 0 }}
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <UButton
                      v-if="q.status === 'ACTIVE'"
                      size="xs"
                      color="primary"
                      @click="loadQuotationToPos(q)"
                    >
                      تحويل إلى الكاشير
                    </UButton>
                    <UButton
                      v-if="q.status === 'ACTIVE'"
                      size="xs"
                      variant="outline"
                      color="warning"
                      @click="cancelQuotation(q.id)"
                    >
                      إلغاء
                    </UButton>
                    <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteQuotation(q.id)" />
                  </div>
                </div>
              </div>
            </UCard>
          </section>

          <!-- 4. Inventory, Batches (FEFO) & Promotions -->
          <section v-if="activeView === 'inventory'" class="space-y-5">
            <div class="flex flex-wrap gap-1.5">
              <UButton
                size="xs"
                :variant="invSubTab === 'products' ? 'solid' : 'outline'"
                :color="invSubTab === 'products' ? 'primary' : 'neutral'"
                @click="invSubTab = 'products'"
              >
                الأصناف والمستويات السعرية
              </UButton>
              <UButton
                size="xs"
                :variant="invSubTab === 'batches' ? 'solid' : 'outline'"
                :color="invSubTab === 'batches' ? 'primary' : 'neutral'"
                @click="invSubTab = 'batches'"
              >
                التشغيلات والصلاحية (FEFO)
              </UButton>
              <UButton
                size="xs"
                :variant="invSubTab === 'promotions' ? 'solid' : 'outline'"
                :color="invSubTab === 'promotions' ? 'primary' : 'neutral'"
                @click="invSubTab = 'promotions'"
              >
                العروض والخصومات التلقائية
              </UButton>
            </div>

            <!-- Products Sub-tab -->
            <div v-if="invSubTab === 'products'" class="space-y-4">
              <UCard>
                <template #header><div class="font-bold text-sm">إضافة صنف جديد (قطاعي / نص جملة / جملة)</div></template>
                <form class="grid grid-cols-1 gap-2 sm:grid-cols-4 text-xs" @submit.prevent="createProduct">
                  <UInput v-model="newProd.name" placeholder="اسم الصنف *" required />
                  <UInput v-model="newProd.sku" placeholder="كود SKU *" dir="ltr" required />
                  <UInput v-model="newProd.barcode" placeholder="الباركود *" dir="ltr" required />
                  <UInput v-model="newProd.category" placeholder="التصنيف" required />
                  <UInput v-model="newProd.unit" placeholder="الوحدة (قطعة/كجم)" required />
                  <UInput v-model.number="newProd.costPrice" type="number" step="0.01" placeholder="سعر التكلفة *" required />
                  <UInput v-model.number="newProd.salePrice" type="number" step="0.01" placeholder="سعر القطاعي *" required />
                  <UInput v-model.number="newProd.halfWholesalePrice" type="number" step="0.01" placeholder="سعر نص جملة" />
                  <UInput v-model.number="newProd.wholesalePrice" type="number" step="0.01" placeholder="سعر الجملة" />
                  <UInput v-model.number="newProd.stockQty" type="number" step="0.01" placeholder="الرصيد الافتتاحي" required />
                  <UInput v-model.number="newProd.minStockAlert" type="number" step="1" placeholder="حد الطلب" />
                  <UButton type="submit" color="primary" :loading="busy">إضافة الصنف</UButton>
                </form>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="font-bold text-sm">قائمة الأصناف والتحكم الفوري</span>
                    <UInput v-model="invFilter" icon="i-lucide-search" placeholder="تصفية بالاسم أو الكود..." class="w-64" />
                  </div>
                </template>
                <div class="space-y-2 text-xs">
                  <div
                    v-for="p in filteredInventory"
                    :key="p.id"
                    class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 dark:border-slate-800"
                  >
                    <div>
                      <div class="font-bold">{{ p.name }} <span class="text-slate-400 font-mono-num">({{ p.sku }})</span></div>
                      <div class="text-slate-500 font-mono-num">
                        قطاعي: {{ fmt(p.salePrice) }} · نص جملة: {{ fmt(p.halfWholesalePrice) }} · جملة: {{ fmt(p.wholesalePrice) }} · تكلفة: {{ fmt(p.costPrice) }}
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5 font-mono-num">
                      <UBadge :color="p.stockQty <= p.minStockAlert ? 'warning' : 'success'" variant="soft">
                        الرصيد: {{ p.stockQty }} {{ p.unit }}
                      </UBadge>
                      <UButton size="xs" variant="outline" color="neutral" @click="adjustProductStock(p, 1)">+1</UButton>
                      <UButton size="xs" variant="outline" color="neutral" @click="adjustProductStock(p, -1)">-1</UButton>
                      <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteProduct(p.id)" />
                    </div>
                  </div>
                </div>
              </UCard>
            </div>

            <!-- Batches FEFO Sub-tab -->
            <div v-if="invSubTab === 'batches'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <UCard class="lg:col-span-5">
                <template #header><div class="font-bold text-sm">إضافة تشغيلة جديدة (تاريخ صلاحية)</div></template>
                <form class="space-y-2.5 text-xs" @submit.prevent="createBatch">
                  <UFormField label="الصنف">
                    <USelectMenu v-model="batchForm.productId" :items="productSelectItems" value-key="value" label-key="label" />
                  </UFormField>
                  <UFormField label="رقم التشغيلة">
                    <UInput v-model="batchForm.batchCode" placeholder="B-2026-01" dir="ltr" required />
                  </UFormField>
                  <div class="grid grid-cols-2 gap-2">
                    <UFormField label="الكمية">
                      <UInput v-model.number="batchForm.qty" type="number" step="0.01" min="0.01" required />
                    </UFormField>
                    <UFormField label="تاريخ الانتهاء">
                      <UInput v-model="batchForm.expiryDate" type="date" dir="ltr" />
                    </UFormField>
                  </div>
                  <UButton type="submit" color="primary" block :loading="busy">تسجيل التشغيلة وزيادة المخزون</UButton>
                </form>
              </UCard>

              <UCard class="lg:col-span-7">
                <template #header><div class="font-bold text-sm">التشغيلات المسجلة (مرتبة حسب الأقرب انتهاءً FEFO)</div></template>
                <div class="space-y-2 text-xs">
                  <div
                    v-for="b in snapshot?.batches || []"
                    :key="b.id"
                    class="flex items-center justify-between rounded-lg border p-2.5 dark:border-slate-800"
                  >
                    <div>
                      <div class="font-bold">{{ b.productName }} — <span class="font-mono-num">{{ b.batchCode }}</span></div>
                      <div class="font-mono-num text-slate-500">
                        الكمية المتبقية: {{ b.qty }} · الانتهاء: {{ b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('ar-EG') : 'مفتوحة' }}
                      </div>
                    </div>
                    <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteBatch(b.id)" />
                  </div>
                </div>
              </UCard>
            </div>

            <!-- Promotions Sub-tab -->
            <div v-if="invSubTab === 'promotions'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <UCard class="lg:col-span-5">
                <template #header><div class="font-bold text-sm">إنشاء عرض ترويجي تلقائي</div></template>
                <form class="space-y-2.5 text-xs" @submit.prevent="createPromotion">
                  <UFormField label="اسم العرض">
                    <UInput v-model="promoForm.name" placeholder="خصم 5% فوق 1000 ج.م" required />
                  </UFormField>
                  <div class="grid grid-cols-2 gap-2">
                    <UFormField label="نوع الخصم">
                      <USelectMenu
                        v-model="promoForm.ruleType"
                        :items="[{ label: 'نسبة مئوية %', value: 'PERCENT' }, { label: 'مبلغ ثابت ج.م', value: 'FIXED' }]"
                        value-key="value"
                        label-key="label"
                      />
                    </UFormField>
                    <UFormField label="القيمة">
                      <UInput v-model.number="promoForm.value" type="number" step="0.5" min="0" required />
                    </UFormField>
                    <UFormField label="حد أدنى للفاتورة">
                      <UInput v-model.number="promoForm.minSubtotal" type="number" step="10" min="0" />
                    </UFormField>
                    <UFormField label="حد أدنى للكمية">
                      <UInput v-model.number="promoForm.minQty" type="number" step="1" min="0" />
                    </UFormField>
                  </div>
                  <UButton type="submit" color="primary" block :loading="busy">تفعيل العرض</UButton>
                </form>
              </UCard>

              <UCard class="lg:col-span-7">
                <template #header><div class="font-bold text-sm">العروض المسجلة</div></template>
                <div class="space-y-2 text-xs">
                  <div
                    v-for="pr in snapshot?.promotions || []"
                    :key="pr.id"
                    class="flex items-center justify-between rounded-lg border p-2.5 dark:border-slate-800"
                  >
                    <div>
                      <div class="font-bold">{{ pr.name }}</div>
                      <div class="font-mono-num text-slate-500">
                        {{ pr.ruleType === 'PERCENT' ? pr.value + '%' : pr.value + ' ج.م' }} · حد أدنى: {{ pr.minSubtotal }} ج.م
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <UButton size="xs" :color="pr.active ? 'success' : 'neutral'" variant="soft" @click="togglePromo(pr)">
                        {{ pr.active ? 'نشط' : 'متوقف' }}
                      </UButton>
                      <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deletePromo(pr.id)" />
                    </div>
                  </div>
                </div>
              </UCard>
            </div>
          </section>

          <!-- 5. Purchases View -->
          <section v-if="activeView === 'purchases'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <UCard class="lg:col-span-6">
              <template #header><div class="font-bold text-sm">تسجيل فاتورة مشتريات وتوريد للمخزون</div></template>
              <form class="space-y-3 text-xs" @submit.prevent="submitPurchase">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <UFormField label="المورد">
                    <USelectMenu v-model="poForm.supplierId" :items="supplierSelectItems" value-key="value" label-key="label" />
                  </UFormField>
                  <UFormField label="طريقة الدفع للمورد">
                    <USelectMenu v-model="poForm.paymentSource" :items="poPaymentSources" value-key="value" label-key="label" />
                  </UFormField>
                  <UFormField label="الخزينة">
                    <USelectMenu v-model="poForm.treasuryId" :items="treasurySelectItems" value-key="value" label-key="label" />
                  </UFormField>
                  <UFormField label="المبلغ المدفوع الآن">
                    <UInput v-model.number="poForm.paidAmount" type="number" step="0.01" min="0" class="font-mono-num" />
                  </UFormField>
                </div>

                <div class="space-y-2 rounded-lg border p-2.5 dark:border-slate-800">
                  <div class="flex items-center justify-between font-bold">
                    <span>بنود فاتورة الشراء</span>
                    <UButton size="xs" variant="soft" @click="addPoLine">+ إضافة صنف</UButton>
                  </div>
                  <div v-for="(line, lIdx) in poForm.items" :key="lIdx" class="grid grid-cols-12 gap-1.5 items-center border-b pb-2 dark:border-slate-800">
                    <USelectMenu
                      v-model="line.productId"
                      :items="productSelectItems"
                      value-key="value"
                      label-key="label"
                      class="col-span-5"
                    />
                    <UInput v-model.number="line.quantity" type="number" min="0.01" step="0.01" placeholder="الكمية" class="col-span-2 font-mono-num" />
                    <UInput v-model.number="line.unitCost" type="number" min="0" step="0.01" placeholder="التكلفة" class="col-span-2 font-mono-num" />
                    <UInput v-model="line.batchCode" placeholder="تشغيلة" class="col-span-2 font-mono-num" />
                    <UButton
                      v-if="poForm.items.length > 1"
                      size="xs"
                      variant="ghost"
                      color="error"
                      icon="i-lucide-trash-2"
                      class="col-span-1"
                      @click="poForm.items.splice(lIdx, 1)"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between font-bold font-mono-num">
                  <span>إجمالي فاتورة التوريد:</span>
                  <span class="text-emerald-600">{{ poGrandTotal.toFixed(2) }} ج.م</span>
                </div>
                <UButton type="submit" block color="primary" :loading="busy">اعتماد التوريد وتحديث التكلفة المرجحة</UButton>
              </form>
            </UCard>

            <UCard class="lg:col-span-6">
              <template #header><div class="font-bold text-sm">سجل فواتير المشتريات ومرتجعات الموردين</div></template>
              <div class="space-y-2.5 text-xs">
                <div
                  v-for="po in snapshot?.purchases || []"
                  :key="po.id"
                  class="rounded-lg border p-3 dark:border-slate-800 space-y-2"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="font-mono-num font-bold">{{ po.purchaseNumber }} — {{ po.supplierName }}</div>
                      <div class="text-slate-500 font-mono-num">
                        الإجمالي: {{ fmt(po.grandTotal) }} · المدفوع: {{ fmt(po.paidAmount) }} · متبقي: {{ fmt(po.remainingDebt) }}
                      </div>
                    </div>
                    <UButton
                      v-if="po.returnedTotal < po.grandTotal"
                      size="xs"
                      color="warning"
                      variant="soft"
                      :loading="busy"
                      @click="returnFullPurchase(po)"
                    >
                      إرجاع للمورد
                    </UButton>
                  </div>
                </div>
              </div>
            </UCard>
          </section>

          <!-- 6. Invoices Master-Detail View -->
          <section v-if="activeView === 'invoices'" class="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div class="no-print lg:col-span-5 space-y-3">
              <UInput v-model="invSearch" icon="i-lucide-search" placeholder="بحث برقم الفاتورة أو العميل..." />
              <UCard>
                <div class="max-h-[70vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  <button
                    v-for="inv in filteredInvoices"
                    :key="inv.id"
                    type="button"
                    class="flex w-full items-center justify-between py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 rounded"
                    :class="selectedInvoice?.id === inv.id ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : ''"
                    @click="selectInvoice(inv)"
                  >
                    <div>
                      <div class="font-mono-num font-bold">
                        {{ inv.invoiceNumber }}
                        <UBadge
                          v-if="inv.status !== 'COMPLETED'"
                          size="xs"
                          :color="inv.status === 'RETURNED' ? 'error' : 'warning'"
                          variant="soft"
                          class="mr-1"
                        >
                          {{ inv.status }}
                        </UBadge>
                      </div>
                      <div class="text-slate-500">{{ inv.customerName }} · {{ inv.paymentMethod }}</div>
                    </div>
                    <div class="font-mono-num font-bold">{{ fmt(inv.grandTotal) }} ج.م</div>
                  </button>
                </div>
              </UCard>
            </div>

            <div class="lg:col-span-7">
              <UCard
                v-if="selectedInvoice"
                class="print-only-sheet"
                :class="{ 'print-thermal-80': printMode === 'thermal80' }"
              >
                <template #header>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="font-bold font-mono-num">{{ selectedInvoice.invoiceNumber }}</div>
                    <div class="no-print flex flex-wrap items-center gap-1.5">
                      <UButton
                        size="xs"
                        :variant="printMode === 'a4' ? 'solid' : 'outline'"
                        color="neutral"
                        @click="printMode = 'a4'"
                      >
                        A4
                      </UButton>
                      <UButton
                        size="xs"
                        :variant="printMode === 'thermal80' ? 'solid' : 'outline'"
                        color="neutral"
                        @click="printMode = 'thermal80'"
                      >
                        حراري 80mm
                      </UButton>
                      <UButton size="xs" icon="i-lucide-printer" @click="printPage">طباعة</UButton>
                      <UButton
                        v-if="selectedInvoice.status !== 'RETURNED' && currentPermissions.invoice_return"
                        size="xs"
                        color="warning"
                        variant="soft"
                        @click="partialReturnOpen = !partialReturnOpen"
                      >
                        مرتجع جزئي
                      </UButton>
                      <UButton
                        v-if="selectedInvoice.status === 'COMPLETED' && currentPermissions.invoice_return"
                        size="xs"
                        color="error"
                        variant="soft"
                        :loading="busy"
                        @click="returnFullInvoice(selectedInvoice.id)"
                      >
                        مرتجع كامل
                      </UButton>
                    </div>
                  </div>
                </template>

                <div class="space-y-3 text-xs">
                  <div class="flex flex-wrap justify-between gap-2 text-slate-600 dark:text-slate-300">
                    <span>العميل: <strong>{{ selectedInvoice.customerName }}</strong></span>
                    <span>الدفع: <strong>{{ selectedInvoice.paymentMethod }}</strong></span>
                    <span>الكاشير: {{ selectedInvoice.cashierName }}</span>
                  </div>

                  <UTable :data="selectedInvoice.items" :columns="invoiceItemColumns" />

                  <!-- Partial Return Inline Panel -->
                  <div
                    v-if="partialReturnOpen && selectedInvoice.status !== 'RETURNED'"
                    class="no-print rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20 space-y-2"
                  >
                    <div class="font-bold text-amber-700 dark:text-amber-400">تحديد كميات المرتجع الجزئي:</div>
                    <div v-for="it in selectedInvoice.items" :key="it.id" class="flex items-center justify-between gap-2">
                      <span>{{ it.productName }} (متاح للإرجاع: {{ Math.max(0, it.quantity - it.returnedQuantity) }})</span>
                      <UInput
                        v-model.number="partialQtys[it.id]"
                        type="number"
                        min="0"
                        :max="Math.max(0, it.quantity - it.returnedQuantity)"
                        step="1"
                        class="w-24 font-mono-num"
                      />
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <USelectMenu
                        v-model="partialRefundMode"
                        :items="[
                          { label: 'رد نقدي من الخزينة', value: 'cash' },
                          { label: 'إضافة لرصيد العميل الدائن', value: 'store_credit' },
                        ]"
                        value-key="value"
                        label-key="label"
                        class="w-56"
                      />
                      <UButton size="xs" color="warning" :loading="busy" @click="submitPartialReturn">
                        تأكيد المرتجع الجزئي
                      </UButton>
                    </div>
                  </div>

                  <div class="flex flex-wrap justify-between gap-2 pt-2 border-t dark:border-slate-800 font-bold">
                    <span>الإجمالي النهائي: <span class="font-mono-num">{{ fmt(selectedInvoice.grandTotal) }} ج.م</span></span>
                    <span v-if="selectedInvoice.returnedTotal > 0" class="text-rose-600 font-mono-num">
                      المرتجعات: -{{ fmt(selectedInvoice.returnedTotal) }} ج.م
                    </span>
                    <span v-if="currentPermissions.view_profits_costs" class="text-emerald-600 font-mono-num">
                      الربح التاريخي: {{ fmt(selectedInvoice.netProfit) }} ج.م
                    </span>
                  </div>
                </div>
              </UCard>
            </div>
          </section>

          <!-- 7 & 8. Treasuries & Partners View -->
          <TreasuryAndPartnersView
            v-if="activeView === 'treasuries' || activeView === 'partners'"
            :mode="activeView"
            @notify="notifySuccess"
            @error="notifyError"
          />

          <!-- 9 & 10. Reports & Settings View -->
          <ReportsAndSettingsView
            v-if="activeView === 'reports' || activeView === 'settings'"
            :mode="activeView"
            @notify="notifySuccess"
          />
        </main>
      </div>

      <!-- Desktop Bottom Status Bar -->
      <footer class="no-print flex h-7 items-center justify-between border-t border-slate-200 bg-white px-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <span>المستخدم: {{ currentUser?.name || 'غير مسجل' }} ({{ currentUser?.role || '-' }})</span>
        <span class="font-mono-num">Prisma ORM · MySQL 8.0 · Nuxt UI · Vercel Ready</span>
      </footer>

      <LoginServerModal v-model:open="loginModalOpen" />
    </template>
  </div>
</template>

<script setup lang="ts">
type NavView =
  | 'dashboard'
  | 'pos'
  | 'quotations'
  | 'inventory'
  | 'purchases'
  | 'invoices'
  | 'treasuries'
  | 'partners'
  | 'reports'
  | 'settings';

const { snapshot, currentUser, currentPermissions, loading, errorMsg, apiFetch, refresh } = useTajirStore();

onMounted(() => {
  refresh();
});

const sidebarVisible = ref(true);
const activeView = ref<NavView>('dashboard');
const loginModalOpen = ref(false);
const busy = ref(false);
const toast = ref<{ type: 'success' | 'error'; message: string } | null>(null);

function notifySuccess(message: string) {
  toast.value = { type: 'success', message };
}
function notifyError(message: string) {
  toast.value = { type: 'error', message };
}

function handleErr(err: any) {
  notifyError(err?.data?.statusMessage || err?.data?.message || err?.message || 'حدث خطأ غير متوقع');
}

const visibleTabs = computed(() => {
  const p = currentPermissions.value;
  const all: Array<{ id: NavView; label: string; icon: string; allow: boolean }> = [
    { id: 'dashboard', label: 'لوحة المتابعة', icon: 'i-lucide-layout-dashboard', allow: true },
    { id: 'pos', label: 'نقطة البيع (الكاشير)', icon: 'i-lucide-shopping-cart', allow: p.pos_sell !== false },
    { id: 'quotations', label: 'عروض الأسعار', icon: 'i-lucide-clipboard-list', allow: p.pos_sell !== false },
    { id: 'inventory', label: 'المخزون والعروض', icon: 'i-lucide-boxes', allow: p.edit_prices_stock !== false },
    { id: 'purchases', label: 'المشتريات والتوريد', icon: 'i-lucide-truck', allow: p.manage_purchases !== false },
    { id: 'invoices', label: 'الفواتير والمرتجعات', icon: 'i-lucide-file-text', allow: true },
    { id: 'treasuries', label: 'الخزائن والمصروفات', icon: 'i-lucide-vault', allow: p.manage_payments !== false || p.manage_expenses !== false },
    { id: 'partners', label: 'العملاء والموردون', icon: 'i-lucide-users', allow: p.manage_partners !== false },
    { id: 'reports', label: 'التقارير والوردية', icon: 'i-lucide-bar-chart-3', allow: p.view_reports !== false },
    { id: 'settings', label: 'الإعدادات والأمان', icon: 'i-lucide-settings', allow: p.manage_settings !== false },
  ];
  return all.filter((t) => t.allow);
});

const activeActivityName = computed(() => {
  const actId = snapshot.value?.settings?.activityId;
  return snapshot.value?.activities?.find((a: any) => a.id === actId)?.nameAr || '';
});

// Dashboard KPIs
const dashboard = computed(() => snapshot.value?.dashboard || {});
const lowStockRows = computed(() =>
  (snapshot.value?.products || []).filter((p: any) => Number(p.stockQty) <= Number(p.minStockAlert))
);
const lowAlertTotal = computed(() => lowStockRows.value.length);
const expiringBatches = computed(() => {
  const limit = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return (snapshot.value?.batches || []).filter(
    (b: any) => Number(b.qty) > 0 && b.expiryDate && new Date(b.expiryDate).getTime() <= limit
  );
});

const lowStockColumns = [
  { accessorKey: 'name', header: 'الصنف' },
  { accessorKey: 'stockQty', header: 'الكمية الحالية' },
  { accessorKey: 'minStockAlert', header: 'حد الطلب' },
];

// Select options shared across tabs
const treasurySelectItems = computed(() =>
  (snapshot.value?.treasuries || []).map((t: any) => ({
    label: `${t.name} (${fmt(t.currentBalance)})`,
    value: t.id,
  }))
);
const productSelectItems = computed(() =>
  (snapshot.value?.products || []).map((p: any) => ({
    label: `${p.name} (${p.sku})`,
    value: p.id,
  }))
);
const customerSelectItems = computed(() => [
  { label: 'عميل نقدي (مباشر)', value: '' },
  ...(snapshot.value?.customers || []).map((c: any) => ({
    label: `${c.name}${c.phone ? ' — ' + c.phone : ''}`,
    value: c.id,
  })),
]);
const supplierSelectItems = computed(() =>
  (snapshot.value?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))
);

// POS State
const posSearch = ref('');
const debouncedPosSearch = useDebouncedRef(posSearch, 180);
const posPriceTier = ref<'RETAIL' | 'HALF_WHOLESALE' | 'WHOLESALE'>('RETAIL');
const priceTierItems = [
  { label: 'سعر القطاعي', value: 'RETAIL' },
  { label: 'نص جملة', value: 'HALF_WHOLESALE' },
  { label: 'سعر الجملة', value: 'WHOLESALE' },
];

const filteredPosProducts = computed(() => {
  const q = debouncedPosSearch.value.trim().toLowerCase();
  const list = snapshot.value?.products || [];
  if (!q) return list;
  return list.filter(
    (p: any) =>
      p.name.toLowerCase().includes(q) ||
      p.barcode.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q)
  );
});

const selectedCustomerId = ref<string>('');
const selectedCustomer = computed(() =>
  (snapshot.value?.customers || []).find((c: any) => c.id === selectedCustomerId.value) || null
);

interface CartLine {
  product: any;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
}
const cart = ref<CartLine[]>([]);
const invoiceDiscount = ref(0);
const redeemPoints = ref(0);
const useStoreCredit = ref(0);
const applyPromotions = ref(true);
const fromQuotationId = ref<string | null>(null);
const paymentMethod = ref<'CASH' | 'INSTAPAY' | 'VODAFONE_CASH' | 'CARD' | 'CREDIT' | 'SPLIT'>('CASH');
const paymentRef = ref('');

const paymentMethods = [
  { label: 'نقدي (كاش)', value: 'CASH' },
  { label: 'إنستا باي (InstaPay)', value: 'INSTAPAY' },
  { label: 'فودافون كاش', value: 'VODAFONE_CASH' },
  { label: 'فيزا / ميزة', value: 'CARD' },
  { label: 'آجل على العميل', value: 'CREDIT' },
  { label: 'دفع مختلط (Split)', value: 'SPLIT' },
];

const splitMethodItems = [
  { label: 'كاش', value: 'CASH' },
  { label: 'إنستا باي', value: 'INSTAPAY' },
  { label: 'فودافون كاش', value: 'VODAFONE_CASH' },
  { label: 'فيزا', value: 'CARD' },
  { label: 'آجل', value: 'CREDIT' },
];
const splitAllocations = ref<Array<{ method: string; treasuryId: string; amount: number }>>([]);

function addSplitRow() {
  splitAllocations.value.push({
    method: 'CASH',
    treasuryId: treasurySelectItems.value[0]?.value || '',
    amount: Math.max(0, Number(estimatedGrandTotal.value.toFixed(2))),
  });
}

function effectiveUnitPrice(product: any, tier: string): number {
  if (tier === 'HALF_WHOLESALE' && Number(product.halfWholesalePrice) > 0) {
    return Number(product.halfWholesalePrice);
  }
  if (tier === 'WHOLESALE' && Number(product.wholesalePrice) > 0) {
    return Number(product.wholesalePrice);
  }
  return Number(product.salePrice || 0);
}

function syncCartTierPrices() {
  for (const l of cart.value) {
    l.unitPrice = effectiveUnitPrice(l.product, posPriceTier.value);
  }
}

function onSelectCustomer() {
  if (selectedCustomer.value?.defaultPriceTier) {
    posPriceTier.value = selectedCustomer.value.defaultPriceTier;
    syncCartTierPrices();
  }
  redeemPoints.value = 0;
  useStoreCredit.value = 0;
}

function addToCart(product: any) {
  const unitPrice = effectiveUnitPrice(product, posPriceTier.value);
  const existing = cart.value.find((c) => c.product.id === product.id);
  if (existing) existing.quantity += 1;
  else cart.value.push({ product, quantity: 1, unitPrice, discountAmount: 0 });
}

function handleBarcodeEnter() {
  const q = posSearch.value.trim().toLowerCase();
  if (!q) return;
  const exact = (snapshot.value?.products || []).find(
    (p: any) => p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q
  );
  if (exact) {
    addToCart(exact);
    posSearch.value = '';
  }
}

function adjustCartQty(idx: number, delta: number) {
  const next = cart.value[idx].quantity + delta;
  if (next <= 0) cart.value.splice(idx, 1);
  else cart.value[idx].quantity = next;
}

function clearCart() {
  cart.value = [];
  invoiceDiscount.value = 0;
  redeemPoints.value = 0;
  useStoreCredit.value = 0;
  fromQuotationId.value = null;
}

const cartSubtotal = computed(() =>
  cart.value.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
);
const cartItemDiscounts = computed(() =>
  cart.value.reduce((sum, l) => sum + Number(l.discountAmount || 0), 0)
);
const estimatedPromoDiscount = computed(() => {
  if (!applyPromotions.value || cart.value.length === 0) return 0;
  const totalQty = cart.value.reduce((s, i) => s + i.quantity, 0);
  let best = 0;
  for (const pr of snapshot.value?.promotions || []) {
    if (!pr.active) continue;
    if (cartSubtotal.value < Number(pr.minSubtotal) || totalQty < Number(pr.minQty)) continue;
    const cand = pr.ruleType === 'PERCENT' ? (cartSubtotal.value * Number(pr.value)) / 100 : Number(pr.value);
    if (cand > best) best = cand;
  }
  return Math.min(Math.max(0, cartSubtotal.value - cartItemDiscounts.value), best);
});
const loyaltyDiscountEgp = computed(() => {
  const val = Number(snapshot.value?.settings?.pointValueEgp || 1);
  return Math.max(0, Number(redeemPoints.value || 0)) * val;
});
const taxableEstimate = computed(() =>
  Math.max(0, cartSubtotal.value - cartItemDiscounts.value - Number(invoiceDiscount.value || 0) - estimatedPromoDiscount.value - loyaltyDiscountEgp.value)
);
const estimatedVat = computed(() => {
  const pct = Number(snapshot.value?.settings?.vatPercent || 0);
  return (taxableEstimate.value * pct) / 100;
});
const estimatedGrandTotal = computed(() =>
  Math.max(0, taxableEstimate.value + estimatedVat.value - Number(useStoreCredit.value || 0))
);

async function submitCheckout() {
  busy.value = true;
  try {
    const res = await apiFetch('/api/pos/checkout', {
      method: 'POST',
      body: {
        activityId: snapshot.value?.settings?.activityId || 'grocery',
        customerId: selectedCustomerId.value || null,
        paymentMethod: paymentMethod.value,
        paymentRef: paymentRef.value,
        discountTotal: Number(invoiceDiscount.value || 0),
        applyPromotions: applyPromotions.value,
        redeemPoints: Number(redeemPoints.value || 0),
        useStoreCredit: Number(useStoreCredit.value || 0),
        fromQuotationId: fromQuotationId.value,
        allocations: paymentMethod.value === 'SPLIT' ? splitAllocations.value : undefined,
        items: cart.value.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
          priceTier: posPriceTier.value,
          discountAmount: Number(l.discountAmount || 0),
        })),
      },
    });
    clearCart();
    paymentRef.value = '';
    splitAllocations.value = [];
    await refresh();
    selectedInvoice.value = res.invoice;
    notifySuccess(`تم إصدار الفاتورة ${res.invoice.invoiceNumber} وتحديث المخزون والخزينة بنجاح`);
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function saveAsQuotation() {
  busy.value = true;
  try {
    const cus = selectedCustomer.value;
    const res = await apiFetch('/api/quotations', {
      method: 'POST',
      body: {
        activityId: snapshot.value?.settings?.activityId || 'grocery',
        customerId: cus?.id || null,
        customerName: cus?.name || 'عميل عرض سعر',
        customerPhone: cus?.phone || '',
        discountTotal: Number(invoiceDiscount.value || 0),
        items: cart.value.map((l) => ({
          productId: l.product.id,
          productName: l.product.name,
          sku: l.product.sku,
          unit: l.product.unit,
          priceTier: posPriceTier.value,
          quantity: l.quantity,
          unitSalePrice: l.unitPrice,
          discountAmount: Number(l.discountAmount || 0),
          lineTotal: Math.max(0, l.unitPrice * l.quantity - Number(l.discountAmount || 0)),
        })),
      },
    });
    clearCart();
    await refresh();
    notifySuccess(`تم حفظ عرض السعر ${res.quotation.quotationNumber}`);
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

// Quotations Actions
function loadQuotationToPos(q: any) {
  clearCart();
  selectedCustomerId.value = q.customerId || '';
  fromQuotationId.value = q.id;
  invoiceDiscount.value = Number(q.discountTotal || 0);
  const products = snapshot.value?.products || [];
  for (const it of q.items || []) {
    const prod = products.find((p: any) => p.id === it.productId);
    if (prod) {
      cart.value.push({
        product: prod,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitSalePrice || prod.salePrice),
        discountAmount: Number(it.discountAmount || 0),
      });
    }
  }
  activeView.value = 'pos';
  notifySuccess(`تم تحميل عرض السعر ${q.quotationNumber} إلى شاشة الكاشير`);
}

async function cancelQuotation(id: string) {
  try {
    await apiFetch(`/api/quotations/${id}`, { method: 'PATCH', body: { status: 'CANCELLED' } });
    await refresh();
    notifySuccess('تم إلغاء عرض السعر');
  } catch (err) {
    handleErr(err);
  }
}

async function deleteQuotation(id: string) {
  try {
    await apiFetch(`/api/quotations/${id}`, { method: 'DELETE' });
    await refresh();
    notifySuccess('تم حذف عرض السعر');
  } catch (err) {
    handleErr(err);
  }
}

// Inventory, Batches, Promotions
const invSubTab = ref<'products' | 'batches' | 'promotions'>('products');
const invFilter = ref('');
const debouncedInvFilter = useDebouncedRef(invFilter, 180);
const filteredInventory = computed(() => {
  const q = debouncedInvFilter.value.trim().toLowerCase();
  const list = snapshot.value?.products || [];
  if (!q) return list;
  return list.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q));
});

const newProd = reactive({
  name: '',
  sku: '',
  barcode: '',
  category: 'بقالة',
  unit: 'قطعة',
  costPrice: 0,
  salePrice: 0,
  halfWholesalePrice: 0,
  wholesalePrice: 0,
  stockQty: 10,
  minStockAlert: 5,
});

async function createProduct() {
  busy.value = true;
  try {
    await apiFetch('/api/products', {
      method: 'POST',
      body: {
        ...newProd,
        activityId: snapshot.value?.settings?.activityId || 'grocery',
      },
    });
    newProd.name = '';
    newProd.sku = '';
    newProd.barcode = '';
    await refresh();
    notifySuccess('تمت إضافة الصنف إلى المخزون بنجاح');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function adjustProductStock(p: any, stockDelta: number) {
  try {
    await apiFetch(`/api/products/${p.id}`, { method: 'PATCH', body: { stockDelta } });
    await refresh();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteProduct(id: string) {
  try {
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    await refresh();
    notifySuccess('تم حذف الصنف بنجاح');
  } catch (err) {
    handleErr(err);
  }
}

const batchForm = reactive({
  productId: '',
  batchCode: '',
  qty: 10,
  expiryDate: '',
});
watch(productSelectItems, (items) => {
  if (!batchForm.productId && items[0]) batchForm.productId = items[0].value;
}, { immediate: true });

async function createBatch() {
  busy.value = true;
  try {
    await apiFetch('/api/batches', {
      method: 'POST',
      body: {
        ...batchForm,
        expiryDate: batchForm.expiryDate || null,
      },
    });
    batchForm.batchCode = '';
    await refresh();
    notifySuccess('تمت إضافة التشغيلة وزيادة رصيد الصنف');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function deleteBatch(id: string) {
  try {
    await apiFetch(`/api/batches/${id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    handleErr(err);
  }
}

const promoForm = reactive({
  name: '',
  ruleType: 'PERCENT',
  value: 5,
  minSubtotal: 500,
  minQty: 0,
});

async function createPromotion() {
  busy.value = true;
  try {
    await apiFetch('/api/promotions', { method: 'POST', body: promoForm });
    promoForm.name = '';
    await refresh();
    notifySuccess('تمت إضافة العرض الترويجي بنجاح');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function togglePromo(pr: any) {
  try {
    await apiFetch(`/api/promotions/${pr.id}`, { method: 'PATCH', body: { active: !pr.active } });
    await refresh();
  } catch (err) {
    handleErr(err);
  }
}

async function deletePromo(id: string) {
  try {
    await apiFetch(`/api/promotions/${id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    handleErr(err);
  }
}

// Purchases
const poPaymentSources = [
  { label: 'نقدي من الخزينة', value: 'CASH_DRAWER' },
  { label: 'تحويل بنكي', value: 'BANK' },
  { label: 'آجل على المورد', value: 'CREDIT' },
];
const poForm = reactive({
  supplierId: '',
  paymentSource: 'CASH_DRAWER',
  treasuryId: '',
  paidAmount: 0,
  items: [{ productId: '', quantity: 10, unitCost: 20, batchCode: '' }],
});

watch(supplierSelectItems, (items) => {
  if (!poForm.supplierId && items[0]) poForm.supplierId = items[0].value;
}, { immediate: true });
watch(treasurySelectItems, (items) => {
  if (!poForm.treasuryId && items[0]) poForm.treasuryId = items[0].value;
}, { immediate: true });
watch(productSelectItems, (items) => {
  if (poForm.items[0] && !poForm.items[0].productId && items[0]) poForm.items[0].productId = items[0].value;
}, { immediate: true });

const poGrandTotal = computed(() =>
  poForm.items.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0)
);

function addPoLine() {
  poForm.items.push({
    productId: productSelectItems.value[0]?.value || '',
    quantity: 5,
    unitCost: 10,
    batchCode: '',
  });
}

async function submitPurchase() {
  busy.value = true;
  try {
    const paid = poForm.paymentSource === 'CREDIT' ? poForm.paidAmount : poForm.paidAmount || poGrandTotal.value;
    await apiFetch('/api/purchases', {
      method: 'POST',
      body: {
        ...poForm,
        paidAmount: paid,
        activityId: snapshot.value?.settings?.activityId || 'grocery',
      },
    });
    await refresh();
    notifySuccess('تم اعتماد فاتورة المشتريات وتحديث التكلفة والمخزون');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function returnFullPurchase(po: any) {
  const items = (po.items || [])
    .map((i: any) => ({ purchaseItemId: i.id, quantity: Math.max(0, Number(i.quantity) - Number(i.returnedQuantity || 0)) }))
    .filter((i: any) => i.quantity > 0);
  if (items.length === 0) return;
  busy.value = true;
  try {
    await apiFetch(`/api/purchases/${po.id}/return`, { method: 'POST', body: { items } });
    await refresh();
    notifySuccess(`تم إرجاع بضاعة الفاتورة ${po.purchaseNumber} للمورد`);
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

// Invoices Master-Detail & Returns
const invSearch = ref('');
const debouncedInvSearch = useDebouncedRef(invSearch, 180);
const filteredInvoices = computed(() => {
  const q = debouncedInvSearch.value.trim().toLowerCase();
  const list = snapshot.value?.invoices || [];
  if (!q) return list;
  return list.filter((i: any) => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q));
});
const selectedInvoice = ref<any>(null);
const printMode = ref<'a4' | 'thermal80'>('a4');
const partialReturnOpen = ref(false);
const partialRefundMode = ref<'cash' | 'store_credit'>('cash');
const partialQtys = reactive<Record<string, number>>({});

watch(filteredInvoices, (list) => {
  if (!selectedInvoice.value && list.length > 0) selectInvoice(list[0]);
  else if (selectedInvoice.value) {
    const refreshed = list.find((i: any) => i.id === selectedInvoice.value.id);
    if (refreshed) selectedInvoice.value = refreshed;
  }
}, { immediate: true });

function selectInvoice(inv: any) {
  selectedInvoice.value = inv;
  partialReturnOpen.value = false;
  for (const it of inv.items || []) {
    partialQtys[it.id] = 0;
  }
}

const invoiceItemColumns = [
  { accessorKey: 'productName', header: 'الصنف' },
  { accessorKey: 'quantity', header: 'الكمية' },
  { accessorKey: 'unitPriceSnapshot', header: 'السعر' },
  { accessorKey: 'lineTotal', header: 'الإجمالي' },
];

async function returnFullInvoice(id: string) {
  busy.value = true;
  try {
    await apiFetch(`/api/invoices/${id}/return`, { method: 'POST', body: {} });
    await refresh();
    notifySuccess('تم تنفيذ المرتجع الكامل ورد المخزون');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

async function submitPartialReturn() {
  if (!selectedInvoice.value) return;
  const items = (selectedInvoice.value.items || [])
    .map((it: any) => ({ invoiceItemId: it.id, quantity: Number(partialQtys[it.id] || 0) }))
    .filter((x: any) => x.quantity > 0);
  if (items.length === 0) return;

  busy.value = true;
  try {
    await apiFetch(`/api/invoices/${selectedInvoice.value.id}/partial-return`, {
      method: 'POST',
      body: { refundMode: partialRefundMode.value, items },
    });
    partialReturnOpen.value = false;
    await refresh();
    notifySuccess('تم تسجيل المرتجع الجزئي وتحديث الحسابات والمخزون');
  } catch (err) {
    handleErr(err);
  } finally {
    busy.value = false;
  }
}

function printPage() {
  if (typeof window !== 'undefined') window.print();
}

function fmt(val: unknown) {
  return Number(val || 0).toFixed(2);
}
</script>
