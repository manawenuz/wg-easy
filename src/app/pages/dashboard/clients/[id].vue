<template>
  <main>
    <Panel>
      <PanelHead>
        <PanelHeadTitle>
          <NuxtLink to="/dashboard" class="hover:underline">
            {{ $t('pages.dashboard') }}
          </NuxtLink>
          <span class="text-gray-400 dark:text-neutral-500"> / </span>
          {{ client?.name }}
        </PanelHeadTitle>
      </PanelHead>

      <div v-if="client">
        <div class="p-4">
          <div class="mb-4 flex flex-col gap-2 text-sm text-gray-600 dark:text-neutral-300">
            <div class="flex items-center gap-2">
              <span
                v-if="!client.enabled"
                class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-neutral-600 dark:text-neutral-300"
              >
                {{ $t('client.disabled') }}
              </span>
              <span
                v-else-if="client.lastHandshakeAt"
                class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300"
              >
                {{ $t('client.connected') }}
              </span>
              <span
                v-else
                class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-neutral-600 dark:text-neutral-300"
              >
                {{ $t('client.disconnected') }}
              </span>
            </div>
            <div>{{ $t('client.address') }}: {{ client.ipv4 }}</div>
            <div v-if="client.expiresAt">
              {{ $t('client.expires') }}:
              {{ new Date(client.expiresAt).toLocaleDateString() }}
            </div>
            <div
              v-if="client.quota"
              class="flex items-center gap-2"
            >
              <span>{{ $t('client.quota') }}:</span>
              <div
                class="h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-600"
              >
                <div
                  class="h-full rounded-full bg-red-800 transition-all"
                  :style="{
                    width: `${Math.min(100, (client.quota.usedBytes / client.quota.limitBytes) * 100)}%`,
                  }"
                />
              </div>
              <span>
                {{ bytes(client.quota.usedBytes) }} /
                {{ bytes(client.quota.limitBytes) }}
              </span>
            </div>
            <div
              v-if="client.speedLimit && (client.speedLimit.upKbps > 0 || client.speedLimit.downKbps > 0)"
              class="flex items-center gap-2"
            >
              <span>Speed Limit:</span>
              <span
                class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              >
                ↓ {{ formatKbps(client.speedLimit.downKbps) }}
              </span>
              <span
                class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              >
                ↑ {{ formatKbps(client.speedLimit.upKbps) }}
              </span>
            </div>
          </div>

          <div class="mb-3 flex gap-2">
            <button
              v-for="r in ranges"
              :key="r"
              class="rounded px-3 py-1 text-sm transition"
              :class="
                range === r
                  ? 'bg-red-800 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-500'
              "
              @click="range = r"
            >
              {{ r }}
            </button>
          </div>

          <div class="h-64 w-full">
            <ClientOnly>
              <apexchart
                v-if="chartSeries.length > 0"
                width="100%"
                height="100%"
                type="area"
                :options="chartOptions"
                :series="chartSeries"
              />
              <div
                v-else
                class="flex h-full items-center justify-center text-sm text-gray-400 dark:text-neutral-500"
              >
                {{ $t('dashboard.noUsageData') }}
              </div>
            </ClientOnly>
          </div>

          <div class="mt-4 flex gap-2">
            <a
              :href="`/api/dashboard/clients/${client.id}/configuration`"
              download
              class="inline-flex items-center gap-2 rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-200 dark:hover:bg-red-800 dark:hover:text-white"
            >
              <IconsDownload class="w-4" />
              {{ $t('client.downloadConfig') }}
            </a>
            <ClientsQRCodeDialog
              :qr-code="`/api/dashboard/clients/${client.id}/qrcode.svg`"
            >
              <button
                class="inline-flex items-center gap-2 rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-200 dark:hover:bg-red-800 dark:hover:text-white"
              >
                <IconsQRCode class="w-4" />
                {{ $t('client.showQR') }}
              </button>
            </ClientsQRCodeDialog>
          </div>
        </div>
      </div>

      <div
        v-else-if="dashboardStore.clients !== null"
        class="p-8 text-center text-gray-500 dark:text-neutral-400"
      >
        {{ $t('client.notFound') }}
      </div>

      <div v-else class="p-5 text-gray-200 dark:text-red-300">
        <IconsLoading class="mx-auto w-5 animate-spin" />
      </div>
    </Panel>
  </main>
</template>

<script setup lang="ts">
function formatKbps(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  const kbytes = kbps / 8;
  if (kbytes >= 1024) return `${(kbytes / 1024).toFixed(1)} MB/s (${kbps} kbps)`;
  return `${kbytes.toFixed(1)} KB/s (${kbps} kbps)`;
}

const route = useRoute();
const dashboardStore = useDashboardStore();
const { t } = useI18n();

const clientId = Number(route.params.id);
const range = ref<'24h' | '7d' | '30d'>('24h');
const ranges: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d'];

await dashboardStore.refreshClients();

const client = computed(() =>
  dashboardStore.clients?.find((c) => c.id === clientId)
);

const buckets = ref<{ ts: number; rxBytes: number; txBytes: number }[]>([]);

async function loadUsage() {
  if (!client.value) return;
  buckets.value = await dashboardStore.getUsage(client.value.id, range.value);
}

watch(range, loadUsage, { immediate: true });

const chartOptions = computed(() => ({
  chart: {
    type: 'area' as const,
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: false },
  },
  theme: {
    mode: (useColorMode().value === 'dark' ? 'dark' : 'light') as
      | 'dark'
      | 'light',
  },
  colors: ['#ef4444', '#3b82f6'],
  stroke: { curve: 'straight' as const, width: 1.5 },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0,
      opacityFrom: 0.4,
      opacityTo: 0.05,
      stops: [0, 100],
    },
  },
  dataLabels: { enabled: false },
  xaxis: {
    type: 'datetime' as const,
    labels: { style: { colors: '#9ca3af' } },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: '#9ca3af' },
      formatter: (val: number) => bytes(val, 1),
    },
  },
  grid: {
    borderColor: useColorMode().value === 'dark' ? '#404040' : '#e5e7eb',
    strokeDashArray: 4,
  },
  tooltip: {
    theme: useColorMode().value === 'dark' ? 'dark' : 'light',
    x: { format: 'dd MMM HH:mm' },
    y: {
      formatter: (val: number) => bytes(val),
    },
  },
  legend: {
    labels: { colors: '#9ca3af' },
  },
}));

const chartSeries = computed(() => [
  {
    name: t('client.download'),
    data: buckets.value.map((b) => ({
      x: b.ts,
      y: b.rxBytes,
    })),
  },
  {
    name: t('client.upload'),
    data: buckets.value.map((b) => ({
      x: b.ts,
      y: b.txBytes,
    })),
  },
]);

useHead({
  title: client.value?.name ?? 'Client',
});

definePageMeta({
  layout: 'dashboard',
});
</script>
