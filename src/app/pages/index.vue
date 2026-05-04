<template>
  <main>
    <Panel v-if="clientsStore.clients && clientsStore.clients.length > 0">
      <PanelHead>
        <PanelHeadTitle>
          {{ $t('client.aggregateBandwidth') }}
        </PanelHeadTitle>
      </PanelHead>
      <PanelBody>
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
      </PanelBody>
    </Panel>

    <Panel class="mt-4">
      <PanelHead>
        <PanelHeadTitle>
          {{ $t('pages.clients') }}
        </PanelHeadTitle>
        <PanelHeadBoat>
          <ClientsSearch />
          <div class="flex gap-2">
            <ClientsSort />
            <ClientsNew />
          </div>
        </PanelHeadBoat>
      </PanelHead>

      <div>
        <ClientsList
          v-if="clientsStore.clients && clientsStore.clients.length > 0"
        />
      </div>
      <ClientsEmpty
        v-if="clientsStore.clients && clientsStore.clients.length === 0"
      />
      <div
        v-if="clientsStore.clients === null"
        class="p-5 text-gray-200 dark:text-red-300"
      >
        <IconsLoading class="mx-auto w-5 animate-spin" />
      </div>
    </Panel>
  </main>
</template>

<script setup lang="ts">
const globalStore = useGlobalStore();
const clientsStore = useClientsStore();
const { t } = useI18n();

const range = ref<'24h' | '7d' | '30d'>('24h');
const ranges: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d'];
const buckets = ref<{ ts: number; rxBytes: number; txBytes: number }[]>([]);

async function loadUsage() {
  const data = await $fetch('/api/admin/usage', {
    params: { range: range.value },
  });
  buckets.value = (data as { buckets: typeof buckets.value }).buckets;
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

// TODO?: use hover card to show more detailed info without leaving the page
// or do something like a accordion

const intervalId = ref<NodeJS.Timeout | null>(null);

clientsStore.refresh();

onMounted(() => {
  // TODO?: replace with websocket or similar
  intervalId.value = setInterval(() => {
    clientsStore
      .refresh({
        updateCharts: globalStore.uiShowCharts,
      })
      .catch(console.error);
  }, 1000);
});

onUnmounted(() => {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
    intervalId.value = null;
  }
});
</script>
