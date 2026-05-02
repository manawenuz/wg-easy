<template>
  <main v-if="routerData">
    <FormElement @submit.prevent="submit">
      <FormGroup>
        <FormHeading>{{ t('admin.routers.detail') }}</FormHeading>
        <FormInfoField
          id="id"
          :label="t('admin.routers.id')"
          :data="String(routerData.id)"
        />
        <FormTextField
          id="name"
          v-model="form.name"
          :label="t('general.name')"
        />
        <FormTextField
          id="host"
          v-model="form.host"
          :label="t('general.host')"
        />
        <FormNumberField
          id="port"
          v-model="form.port"
          :label="t('general.port')"
        />
        <FormSwitchField
          id="enabled"
          v-model="form.enabled"
          :label="t('admin.routers.enabled')"
        />
      </FormGroup>

      <FormGroup>
        <FormHeading>{{ t('admin.routers.credentials') }}</FormHeading>
        <FormTextField
          id="apiUser"
          v-model="form.apiUser"
          :label="t('admin.routers.apiUser')"
        />
        <FormPasswordField
          id="apiPassword"
          v-model="form.apiPassword"
          :label="t('admin.routers.apiPassword')"
          autocomplete="new-password"
        />
      </FormGroup>

      <FormGroup>
        <FormHeading>{{ t('form.actions') }}</FormHeading>
        <FormPrimaryActionField type="submit" :label="t('form.save')" />
        <FormSecondaryActionField :label="t('form.revert')" @click="revert" />
        <FormSecondaryActionField
          :label="t('admin.routers.testConnection')"
          @click="testConnection"
        />
        <FormSecondaryActionField
          v-if="routerData?.transport === 'ssh'"
          :label="t('admin.bootstrap.title')"
          @click="goToBootstrap"
        />
        <FormSecondaryActionField
          :label="t('admin.routers.delete')"
          class="text-red-600"
          @click="deleteRouter"
        />
      </FormGroup>
    </FormElement>

    <div v-if="interfaces && interfaces.length > 0" class="mt-6">
      <h3 class="mb-2 text-lg font-semibold">{{ t('admin.routers.interfaces') }}</h3>
      <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600">
        <table class="w-full text-left text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-neutral-800 dark:text-neutral-300">
            <tr>
              <th class="px-4 py-3">{{ t('admin.interface.device') }}</th>
              <th class="px-4 py-3">{{ t('general.port') }}</th>
              <th class="px-4 py-3">{{ t('admin.routers.status') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="iface in interfaces"
              :key="iface.name"
              class="border-b dark:border-neutral-600"
            >
              <td class="px-4 py-3">{{ iface.name }}</td>
              <td class="px-4 py-3">{{ iface.port }}</td>
              <td class="px-4 py-3">
                <span
                  :class="
                    iface.enabled
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  "
                >
                  {{ iface.enabled ? t('admin.routers.enabled') : t('admin.routers.disabled') }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();
const route = useRoute();
const routerNav = useRouter();
const id = Number(route.params.id);

interface RouterItem {
  id: number;
  name: string;
  host: string | null;
  port: number | null;
  engineType: string;
  transport: string;
  enabled: boolean;
}

interface InterfaceItem {
  name: string;
  port: number;
  enabled: boolean;
}

const { data: routerList, refresh: refreshRouter } = await useFetch<RouterItem[]>(
  `/api/admin/router`,
  { method: 'get' }
);

// Filter the specific router from the list since there's no single GET endpoint
const routerData = computed(() => {
  if (!routerList.value) return null;
  return routerList.value.find((r) => r.id === id) ?? null;
});

const { data: interfaces } = await useFetch<InterfaceItem[]>(
  `/api/admin/interfaces`,
  { method: 'get', query: { routerId: id } }
);

const form = ref({
  name: '',
  host: '',
  port: 8728,
  enabled: true,
  apiUser: '',
  apiPassword: '',
});

watch(
  () => routerData.value,
  (val) => {
    if (!val) return;
    form.value = {
      name: val.name ?? '',
      host: val.host ?? '',
      port: val.port ?? 8728,
      enabled: val.enabled ?? true,
      apiUser: '',
      apiPassword: '',
    };
  },
  { immediate: true }
);

async function submit() {
  const body: Record<string, unknown> = {};
  if (form.value.name !== routerData.value?.name) body.name = form.value.name;
  if (form.value.host !== (routerData.value?.host ?? '')) body.host = form.value.host || null;
  if (form.value.port !== (routerData.value?.port ?? 8728)) body.port = form.value.port;
  if (form.value.enabled !== routerData.value?.enabled) body.enabled = form.value.enabled;

  if (form.value.apiUser || form.value.apiPassword) {
    body.credentials = {
      apiUser: form.value.apiUser,
      apiPassword: form.value.apiPassword,
    };
  }

  if (Object.keys(body).length > 0) {
    await $fetch(`/api/admin/router/${id}`, { method: 'patch', body });
  }

  await refreshRouter();
}

async function revert() {
  await refreshRouter();
  if (routerData.value) {
    form.value = {
      name: routerData.value.name ?? '',
      host: routerData.value.host ?? '',
      port: routerData.value.port ?? 8728,
      enabled: routerData.value.enabled ?? true,
      apiUser: '',
      apiPassword: '',
    };
  }
}

async function testConnection() {
  try {
    const result = await $fetch(`/api/admin/router/${id}/test`, { method: 'post' });
    alert(`${t('admin.routers.testSuccess')}: ${result.version} (${result.peersCount} peers)`);
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'data' in err
        ? String((err as { data?: { statusMessage?: string } }).data?.statusMessage ?? '')
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    alert(`${t('admin.routers.testFailed')}: ${message}`);
  }
}

function goToBootstrap() {
  routerNav.push(`/admin/routers/${id}/bootstrap`);
}

async function deleteRouter() {
  if (!confirm(t('admin.routers.deleteConfirm'))) return;
  await $fetch(`/api/admin/router/${id}`, { method: 'delete' });
  routerNav.push('/admin/routers');
}
</script>
