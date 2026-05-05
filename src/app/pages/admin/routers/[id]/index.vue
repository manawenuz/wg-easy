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
          :label="t('admin.routers.sshPort')"
        />
        <FormNumberField
          id="apiPort"
          v-model="form.apiPort"
          :label="t('admin.routers.apiPort')"
        />
        <FormSwitchField
          id="tlsRequired"
          v-model="form.tlsRequired"
          :label="t('admin.routers.tlsRequired')"
        />
        <p v-if="!form.tlsRequired" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {{ t('admin.routers.tlsWarningPlaintext') }}
        </p>
        <div class="mt-4 flex flex-col gap-1">
          <label class="text-sm font-medium">{{ t('admin.routers.fingerprint') }}</label>
          <div class="flex gap-2">
            <FormTextField
              id="tlsFingerprintSha256"
              v-model="form.tlsFingerprintSha256"
              class="flex-1"
              :placeholder="t('admin.routers.fingerprintPlaceholder')"
            />
            <BaseSecondaryButton class="px-3" @click="fetchFingerprint">
              {{ t('admin.routers.fetchFingerprint') }}
            </BaseSecondaryButton>
          </div>
        </div>
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
        <template v-if="routerData?.transport === 'ssh'">
          <FormTextField
            id="sshUser"
            v-model="form.sshUser"
            :label="t('admin.routers.sshUser')"
          />
          <FormTextField
            id="sshKey"
            v-model="form.sshKey"
            :label="t('admin.routers.sshKey')"
          />
          <FormPasswordField
            id="sshPassphrase"
            v-model="form.sshPassphrase"
            :label="t('admin.routers.sshPassphrase')"
            autocomplete="new-password"
          />
        </template>
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
              <th class="px-4 py-3">{{ t('form.actions') }}</th>
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
              <td class="px-4 py-3">
                <InterfacesObfuscationForm
                  v-if="iface.engineType === 'mikrotik'"
                  :interface-name="iface.name"
                  :router-id="id"
                  @saved="refreshInterfaces"
                />
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
  apiPort: number | null;
  tlsRequired: boolean | null;
  tlsFingerprintSha256: string | null;
  engineType: string;
  transport: string;
  enabled: boolean;
}

interface InterfaceItem {
  name: string;
  port: number;
  enabled: boolean;
  engineType: string;
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

const { data: interfaces, refresh: refreshInterfaces } = await useFetch<InterfaceItem[]>(
  `/api/admin/interfaces`,
  { method: 'get', query: { routerId: id } }
);

const form = ref({
  name: '',
  host: '',
  port: 22,
  apiPort: 8729,
  tlsRequired: true,
  tlsFingerprintSha256: '',
  enabled: true,
  apiUser: '',
  apiPassword: '',
  sshUser: '',
  sshKey: '',
  sshPassphrase: '',
});

watch(
  () => routerData.value,
  (val) => {
    if (!val) return;
    form.value = {
      name: val.name ?? '',
      host: val.host ?? '',
      port: val.port ?? 22,
      apiPort: val.apiPort ?? 8729,
      tlsRequired: val.tlsRequired ?? true,
      tlsFingerprintSha256: val.tlsFingerprintSha256 ?? '',
      enabled: val.enabled ?? true,
      apiUser: '',
      apiPassword: '',
      sshUser: '',
      sshKey: '',
      sshPassphrase: '',
    };
  },
  { immediate: true }
);

async function fetchFingerprint() {
  if (!form.value.host) {
    alert(t('admin.routers.hostRequired'));
    return;
  }
  try {
    const res = await $fetch('/api/admin/router/fingerprint', {
      method: 'post',
      body: {
        host: form.value.host,
        port: form.value.apiPort,
      },
    });
    form.value.tlsFingerprintSha256 = res.spki;
    alert(t('admin.routers.testSuccess'));
  } catch (e: any) {
    alert(e?.data?.statusMessage || e?.message || t('admin.routers.testFailed'));
  }
}

async function submit() {
  const body: Record<string, unknown> = {};
  if (form.value.name !== routerData.value?.name) body.name = form.value.name;
  if (form.value.host !== (routerData.value?.host ?? '')) body.host = form.value.host || null;
  if (form.value.port !== (routerData.value?.port ?? 22)) body.port = form.value.port;
  if (form.value.apiPort !== (routerData.value?.apiPort ?? 8729)) body.apiPort = form.value.apiPort;
  if (form.value.tlsRequired !== routerData.value?.tlsRequired) body.tlsRequired = form.value.tlsRequired;
  if (form.value.tlsFingerprintSha256 !== (routerData.value?.tlsFingerprintSha256 ?? ''))
    body.tlsFingerprintSha256 = form.value.tlsFingerprintSha256 || null;
  if (form.value.enabled !== routerData.value?.enabled) body.enabled = form.value.enabled;

  if (form.value.apiUser || form.value.apiPassword || form.value.sshUser || form.value.sshKey || form.value.sshPassphrase) {
    body.credentials = {
      apiUser: form.value.apiUser,
      apiPassword: form.value.apiPassword,
      sshUser: form.value.sshUser || undefined,
      sshKey: form.value.sshKey || undefined,
      sshPassphrase: form.value.sshPassphrase || undefined,
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
      port: routerData.value.port ?? 22,
      apiPort: routerData.value.apiPort ?? 8729,
      tlsRequired: routerData.value.tlsRequired ?? true,
      tlsFingerprintSha256: routerData.value.tlsFingerprintSha256 ?? '',
      enabled: routerData.value.enabled ?? true,
      apiUser: '',
      apiPassword: '',
      sshUser: '',
      sshKey: '',
      sshPassphrase: '',
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
