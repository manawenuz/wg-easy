<template>
  <main v-if="data">
    <Panel>
      <PanelHead>
        <PanelHeadTitle>
          {{ data.name }}
        </PanelHeadTitle>
      </PanelHead>
      <PanelBody>
        <FormElement @submit.prevent="submit">
          <FormGroup>
            <FormHeading>
              {{ $t('form.sectionGeneral') }}
            </FormHeading>
            <FormTextField
              id="name"
              v-model="data.name"
              :label="$t('general.name')"
            />
            <FormSwitchField
              id="enabled"
              v-model="data.enabled"
              :label="$t('client.enabled')"
            />
            <FormDateField
              id="expiresAt"
              v-model="data.expiresAt"
              :description="$t('client.expireDateDesc')"
              :label="$t('client.expireDate')"
            />
          </FormGroup>
          <FormGroup>
            <FormHeading>{{ $t('client.trafficGroup') }}</FormHeading>
            <div class="col-span-full">
              <select
                v-model="data.trafficGroupId"
                class="w-full rounded border border-gray-300 px-3 py-2 dark:border-neutral-600 dark:bg-neutral-800"
              >
                <option v-for="group in trafficGroups" :key="group.id" :value="group.id">
                  {{ group.name }}<span v-if="group.isDefault"> ({{ $t('admin.trafficGroups.default') }})</span>
                </option>
              </select>
            </div>
          </FormGroup>
          <FormGroup>
            <FormHeading>{{ $t('client.address') }}</FormHeading>
            <FormTextField
              id="ipv4Address"
              v-model="data.ipv4Address"
              label="IPv4"
            />
            <FormTextField
              id="ipv6Address"
              v-model="data.ipv6Address"
              label="IPv6"
            />
            <FormInfoField
              id="endpoint"
              :data="data.endpoint ?? $t('client.notConnected')"
              :label="$t('client.endpoint')"
              :description="$t('client.endpointDesc')"
            />
          </FormGroup>
          <FormGroup>
            <FormHeading :description="$t('client.allowedIpsDesc')">
              {{ $t('general.allowedIps') }}
            </FormHeading>
            <FormNullArrayField v-model="data.allowedIps" name="allowedIps" />
          </FormGroup>
          <FormGroup>
            <FormHeading :description="$t('client.serverAllowedIpsDesc')">
              {{ $t('client.serverAllowedIps') }}
            </FormHeading>
            <FormArrayField
              v-model="data.serverAllowedIps"
              name="serverAllowedIps"
            />
          </FormGroup>
          <FormGroup v-if="globalStore.information?.firewallEnabled">
            <FormHeading :description="$t('client.firewallIpsDesc')">
              {{ $t('client.firewallIps') }}
            </FormHeading>
            <FormNullArrayField v-model="data.firewallIps" name="firewallIps" />
          </FormGroup>
          <FormGroup>
            <FormHeading :description="$t('client.dnsDesc')">
              {{ $t('general.dns') }}
            </FormHeading>
            <FormNullArrayField v-model="data.dns" name="dns" />
          </FormGroup>
          <FormGroup>
            <FormHeading>{{ $t('form.sectionAdvanced') }}</FormHeading>
            <FormNumberField
              id="mtu"
              v-model="data.mtu"
              :description="$t('client.mtuDesc')"
              :label="$t('general.mtu')"
            />
            <FormNumberField
              id="persistentKeepalive"
              v-model="data.persistentKeepalive"
              :description="$t('client.persistentKeepaliveDesc')"
              :label="$t('general.persistentKeepalive')"
            />
          </FormGroup>
          <FormGroup v-if="globalStore.information?.isAwg">
            <FormHeading>{{ $t('awg.obfuscationParameters') }}</FormHeading>

            <FormNullNumberField
              id="jC"
              v-model="data.jC"
              :label="$t('awg.jCLabel')"
              :description="$t('awg.jCDescription')"
            />
            <FormNullNumberField
              id="Jmin"
              v-model="data.jMin"
              :label="$t('awg.jMinLabel')"
              :description="$t('awg.jMinDescription')"
            />
            <FormNullNumberField
              id="Jmax"
              v-model="data.jMax"
              :label="$t('awg.jMaxLabel')"
              :description="$t('awg.jMaxDescription')"
            />

            <div class="col-span-full text-sm">* {{ $t('awg.mtuNote') }}</div>

            <FormNullTextField
              id="i1"
              v-model="data.i1"
              :label="$t('awg.i1Label')"
              :description="$t('awg.i1Description')"
            />
            <FormNullTextField
              id="i2"
              v-model="data.i2"
              :label="$t('awg.i2Label')"
              :description="$t('awg.i2Description')"
            />
            <FormNullTextField
              id="i3"
              v-model="data.i3"
              :label="$t('awg.i3Label')"
              :description="$t('awg.i3Description')"
            />
            <FormNullTextField
              id="i4"
              v-model="data.i4"
              :label="$t('awg.i4Label')"
              :description="$t('awg.i4Description')"
            />
            <FormNullTextField
              id="i5"
              v-model="data.i5"
              :label="$t('awg.i5Label')"
              :description="$t('awg.i5Description')"
            />
          </FormGroup>
          <FormGroup>
            <FormHeading :description="$t('client.hooksDescription')">
              {{ $t('client.hooks') }}
            </FormHeading>
            <FormTextArea
              id="PreUp"
              v-model="data.preUp"
              :description="$t('client.hooksLeaveEmpty')"
              :label="$t('hooks.preUp')"
            />
            <FormTextArea
              id="PostUp"
              v-model="data.postUp"
              :description="$t('client.hooksLeaveEmpty')"
              :label="$t('hooks.postUp')"
            />
            <FormTextArea
              id="PreDown"
              v-model="data.preDown"
              :description="$t('client.hooksLeaveEmpty')"
              :label="$t('hooks.preDown')"
            />
            <FormTextArea
              id="PostDown"
              v-model="data.postDown"
              :description="$t('client.hooksLeaveEmpty')"
              :label="$t('hooks.postDown')"
            />
          </FormGroup>
          <ClientsQuotaForm :client-id="data.id" />
          <ClientsSpeedLimitForm :client-id="Number(id)" />
          <FormGroup>
            <FormHeading>{{ $t('form.actions') }}</FormHeading>
            <FormPrimaryActionField type="submit" :label="$t('form.save')" />
            <FormSecondaryActionField
              :label="$t('form.revert')"
              @click="revert"
            />
            <ClientsDeleteDialog
              trigger-class="col-span-2"
              :client-name="data.name"
              @delete="deleteClient"
            >
              <FormSecondaryActionField
                :label="$t('client.delete')"
                class="w-full"
                type="button"
                tabindex="-1"
                as="span"
              />
            </ClientsDeleteDialog>
            <ClientsConfigDialog
              trigger-class="col-span-2"
              :client-id="data.id"
            >
              <FormSecondaryActionField
                :label="$t('client.viewConfig')"
                class="w-full"
                type="button"
                tabindex="-1"
                as="span"
              />
            </ClientsConfigDialog>
          </FormGroup>
        </FormElement>

        <div class="mt-8 border-t border-gray-200 p-4 dark:border-neutral-700">
          <FormHeading>{{ $t('client.usage') }}</FormHeading>

          <div class="mb-3 mt-4 flex gap-2">
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
        </div>
      </PanelBody>
    </Panel>
  </main>
</template>

<script lang="ts" setup>
const globalStore = useGlobalStore();
const { t } = useI18n();

const route = useRoute();
const id = route.params.id as string;

const { data: _data, refresh } = await useFetch(`/api/client/${id}`, {
  method: 'get',
});
const data = toRef(_data.value);

const trafficGroups = ref<Array<{ id: number; name: string; isDefault: boolean }>>([]);
$fetch('/api/admin/traffic-groups')
  .then((r: any) => { trafficGroups.value = r; })
  .catch(() => { /* not an admin — selector stays empty */ });

const range = ref<'24h' | '7d' | '30d'>('24h');
const ranges: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d'];
const buckets = ref<{ ts: number; rxBytes: number; txBytes: number }[]>([]);

async function loadUsage() {
  const data = await $fetch(`/api/admin/clients/${id}/usage`, {
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

const _submit = useSubmit(
  `/api/client/${id}`,
  {
    method: 'post',
  },
  {
    revert: async (success) => {
      if (success) {
        await navigateTo('/');
      } else {
        await revert();
      }
    },
  }
);

function submit() {
  return _submit(data.value);
}

async function revert() {
  await refresh();
  data.value = toRef(_data.value).value;
}

const _deleteClient = useSubmit(
  `/api/client/${id}`,
  {
    method: 'delete',
  },
  {
    revert: async () => {
      await navigateTo('/');
    },
  }
);

function deleteClient() {
  return _deleteClient(undefined);
}
</script>
