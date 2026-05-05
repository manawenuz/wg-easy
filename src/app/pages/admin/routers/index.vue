<template>
  <main>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-xl font-semibold">{{ t('admin.routers.title') }}</h2>
      <BaseDialog content-class="max-w-2xl">
        <template #trigger>
          <BasePrimaryButton>{{ t('admin.routers.add') }}</BasePrimaryButton>
        </template>
        <template #title>{{ t('admin.routers.createTitle') }}</template>
        <template #description>
          <div class="flex flex-col gap-3 text-gray-900 dark:text-neutral-100">
            <FormTextField
              id="name"
              v-model="newRouter.name"
              :label="t('general.name')"
            />
            <FormTextField
              id="host"
              v-model="newRouter.host"
              :label="t('general.host')"
            />
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('admin.routers.engineType') }}</label>
              <BaseSelect
                v-model="newRouter.engineType"
                :options="engineOptions"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('admin.routers.transport') }}</label>
              <BaseSelect
                v-model="connectionMode"
                :options="connectionModeOptions"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-neutral-400">
                {{ connectionModeHelp }}
              </p>
            </div>
            <FormNumberField
              :id="isSsh ? 'port' : 'apiPort'"
              v-model="primaryPort"
              :label="isSsh ? t('general.port') : t('admin.routers.apiPort')"
            />
            <template v-if="!isSsh">
              <FormTextField
                id="apiUser"
                v-model="newRouter.apiUser"
                :label="t('admin.routers.apiUser')"
              />
              <div class="flex items-end gap-2">
                <FormPasswordField
                  id="apiPassword"
                  v-model="newRouter.apiPassword"
                  class="flex-1"
                  :label="t('admin.routers.apiPassword')"
                  autocomplete="new-password"
                />
                <BaseSecondaryButton class="px-3" @click="newRouter.apiPassword = generatePassword()">
                  {{ t('admin.routers.regenerate') }}
                </BaseSecondaryButton>
              </div>
              <p v-if="!tlsRequired" class="text-xs text-amber-600 dark:text-amber-400">
                {{ t('admin.routers.tlsWarningPlaintext') }}
              </p>
              <div v-if="tlsRequired" class="flex flex-col gap-1">
                <label class="text-sm font-medium">{{ t('admin.routers.fingerprint') }}</label>
                <div class="flex gap-2">
                  <FormTextField
                    id="tlsFingerprintSha256"
                    v-model="newRouter.tlsFingerprintSha256"
                    class="flex-1"
                    :placeholder="t('admin.routers.fingerprintPlaceholder')"
                  />
                  <BaseSecondaryButton class="px-3" @click="fetchFingerprint">
                    {{ t('admin.routers.fetchFingerprint') }}
                  </BaseSecondaryButton>
                </div>
              </div>
            </template>
            <template v-else>
              <FormTextField
                id="sshUser"
                v-model="newRouter.sshUser"
                :label="t('admin.routers.sshUser')"
              />
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">{{ t('admin.routers.sshKey') }}</label>
                <div class="flex gap-2">
                  <input
                    ref="sshKeyFileInput"
                    type="file"
                    class="hidden"
                    accept=".pem,.key,id_rsa,id_ed25519,*"
                    @change="onSshKeyFile"
                  />
                  <BaseSecondaryButton class="px-3" @click="(sshKeyFileInput as any)?.click()">
                    {{ t('admin.routers.sshKeyChoose') }}
                  </BaseSecondaryButton>
                  <span class="self-center text-xs text-gray-500 dark:text-neutral-400">
                    {{ sshKeyStatus }}
                  </span>
                </div>
                <textarea
                  v-model="newRouter.sshKey"
                  class="mt-1 h-24 rounded border border-gray-300 bg-white p-2 font-mono text-xs dark:border-neutral-500 dark:bg-neutral-800 dark:text-neutral-100"
                  :placeholder="'-----BEGIN OPENSSH PRIVATE KEY-----\n...'"
                />
              </div>
              <FormPasswordField
                id="sshPassphrase"
                v-model="newRouter.sshPassphrase"
                :label="t('admin.routers.sshPassphrase')"
                autocomplete="new-password"
              />
              <FormPasswordField
                v-if="!newRouter.sshKey"
                id="sshPassword"
                v-model="newRouter.apiPassword"
                :label="t('admin.routers.sshPassword')"
                autocomplete="new-password"
              />
            </template>

            <details class="mt-2 rounded border border-gray-200 p-3 dark:border-neutral-500">
              <summary class="cursor-pointer text-sm font-medium">
                {{ t('admin.routers.helperTitle') }}
              </summary>
              <p class="mt-2 text-xs text-gray-600 dark:text-neutral-300">
                {{ t('admin.routers.helperDesc') }}
              </p>
              <pre class="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug dark:bg-neutral-800">{{ rscScript }}</pre>
              <div class="mt-2 flex flex-wrap gap-2">
                <BaseSecondaryButton class="px-3 py-1 text-xs" @click="downloadRsc">
                  {{ t('admin.routers.rscDownload') }}
                </BaseSecondaryButton>
                <BaseSecondaryButton class="px-3 py-1 text-xs" @click="copyHelper">
                  {{ t('admin.routers.helperCopy') }}
                </BaseSecondaryButton>
              </div>
              <p class="mt-2 text-[11px] text-gray-500 dark:text-neutral-400">
                {{ t('admin.routers.rscHowto') }}
              </p>
            </details>
          </div>
        </template>
        <template #actions>
          <DialogClose as-child>
            <BaseSecondaryButton>{{ t('dialog.cancel') }}</BaseSecondaryButton>
          </DialogClose>
          <DialogClose as-child>
            <BasePrimaryButton @click="createRouter">{{ t('form.save') }}</BasePrimaryButton>
          </DialogClose>
        </template>
      </BaseDialog>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="pending"
      class="animate-pulse overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <div class="h-10 bg-gray-50 dark:bg-neutral-800" />
      <div class="divide-y divide-gray-100 dark:divide-neutral-600">
        <div v-for="n in 3" :key="n" class="h-12 bg-white dark:bg-neutral-700" />
      </div>
    </div>

    <div
      v-else-if="data && data.length > 0"
      class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <table class="w-full text-left text-sm">
        <thead
          class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <tr>
            <th class="px-4 py-3">{{ t('general.name') }}</th>
            <th class="px-4 py-3">{{ t('general.host') }}</th>
            <th class="px-4 py-3">{{ t('general.port') }}</th>
            <th class="px-4 py-3">{{ t('admin.routers.engineType') }}</th>
            <th class="px-4 py-3">{{ t('admin.routers.status') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in data"
            :key="r.id"
            class="border-b dark:border-neutral-600"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                {{ r.name }}
                <span
                  v-if="activeRouterId === r.id"
                  class="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
                >
                  {{ t('admin.routers.active') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3">{{ r.host }}</td>
            <td class="px-4 py-3">{{ r.port }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1.5">
                {{ r.engineType }}
                <span
                  v-if="r.dockerized"
                  class="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                >
                  <IconsDocker class="size-2.5" />
                  {{ t('admin.interface.dockerized') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <!-- Health dot (only meaningful when enabled) -->
                <span
                  v-if="r.enabled"
                  :title="r.lastSeenError ?? (r.lastSeenOkAt ? `Last OK: ${new Date(r.lastSeenOkAt).toLocaleString()}` : 'No data yet')"
                  :class="[
                    'inline-block h-2.5 w-2.5 rounded-full',
                    r.consecutiveFailures === 0 && r.lastSeenOkAt ? 'bg-green-500' :
                    r.consecutiveFailures <= 2 ? 'bg-yellow-400' : 'bg-red-500'
                  ]"
                />
                <span
                  :class="r.enabled ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                >
                  {{ r.enabled ? t('admin.routers.enabled') : t('admin.routers.disabled') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <NuxtLink
                  :to="`/admin/routers/${r.id}`"
                  class="text-red-700 hover:underline dark:text-red-400"
                >
                  {{ t('admin.routers.edit') }}
                </NuxtLink>
                <button
                  v-if="r.id !== 0 && activeRouterId !== r.id && r.enabled"
                  type="button"
                  class="text-red-700 hover:underline dark:text-red-400"
                  @click="activateRouter(r)"
                >
                  {{ t('admin.routers.activate') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-else
      class="rounded-lg border border-gray-200 p-8 text-center text-gray-500 dark:border-neutral-600 dark:text-neutral-400"
    >
      <p>{{ t('admin.routers.noRouters') }}</p>
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();
const toast = useToast();

interface RouterItem {
  id: number;
  name: string;
  host: string | null;
  port: number | null;
  engineType: string;
  transport: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastSeenOkAt: string | null;
  lastSeenError: string | null;
}

const { data, refresh, pending, error } = await useFetch<RouterItem[]>('/api/admin/router', { method: 'get' });

const { data: activeInterface, refresh: refreshIface } = await useFetch<{ routerId: number }>('/api/admin/interface', { method: 'get' });
const activeRouterId = computed(() => activeInterface.value?.routerId ?? 0);

async function activateRouter(r: RouterItem) {
  if (!confirm(t('admin.routers.activateConfirm', { name: r.name }))) return;
  try {
    await $fetch(`/api/admin/router/${r.id}/activate`, { method: 'post' });
    toast.showToast({ type: 'success', message: t('admin.routers.activateSuccess', { name: r.name }) });
    await refreshIface();
  } catch (e: any) {
    toast.showToast({
      type: 'error',
      message: e?.data?.statusMessage || e?.message || t('admin.routers.activateFailed'),
    });
  }
}

watch(error, (err) => {
  if (err) {
    toast.showToast({
      type: 'error',
      message: err.statusMessage || t('admin.routers.loadError'),
    });
  }
});

type ConnectionMode = 'api-tls' | 'api-plain' | 'ssh';

function generatePassword(len = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_';
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint32Array(len);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function emptyRouter() {
  return {
    name: '',
    host: '',
    port: 22,
    apiPort: 8729,
    tlsRequired: true,
    tlsFingerprintSha256: '',
    engineType: 'mikrotik',
    transport: 'routeros-api',
    apiUser: 'wg-easy',
    apiPassword: generatePassword(),
    sshUser: 'wg-easy',
    sshKey: '',
    sshPassphrase: '',
  };
}

const newRouter = ref(emptyRouter());
const connectionMode = ref<ConnectionMode>('api-tls');
const sshKeyFileInput = ref<HTMLInputElement | null>(null);
const sshKeyFilename = ref<string>('');

const isSsh = computed(() => connectionMode.value === 'ssh');
const tlsRequired = computed(() => connectionMode.value === 'api-tls');

const primaryPort = computed({
  get: () => (isSsh.value ? newRouter.value.port : newRouter.value.apiPort),
  set: (v: number) => {
    if (isSsh.value) newRouter.value.port = v;
    else newRouter.value.apiPort = v;
  },
});

watch(connectionMode, (mode) => {
  if (mode === 'api-tls') {
    newRouter.value.transport = 'routeros-api';
    newRouter.value.tlsRequired = true;
    newRouter.value.apiPort = 8729;
  } else if (mode === 'api-plain') {
    newRouter.value.transport = 'routeros-api';
    newRouter.value.tlsRequired = false;
    newRouter.value.apiPort = 8728;
  } else {
    newRouter.value.transport = 'ssh';
    newRouter.value.port = 22;
  }
});

const sshKeyStatus = computed(() => {
  if (sshKeyFilename.value) return sshKeyFilename.value;
  if (newRouter.value.sshKey) return t('admin.routers.sshKeyPasted');
  return t('admin.routers.sshKeyNone');
});

async function onSshKeyFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  newRouter.value.sshKey = text;
  sshKeyFilename.value = file.name;
}

const connectionModeOptions = computed(() => [
  { label: t('admin.routers.modeApiTls'), value: 'api-tls' },
  { label: t('admin.routers.modeApiPlain'), value: 'api-plain' },
  { label: t('admin.routers.modeSsh'), value: 'ssh' },
]);

const connectionModeHelp = computed(() => {
  if (connectionMode.value === 'api-tls') return t('admin.routers.modeApiTlsHelp');
  if (connectionMode.value === 'api-plain') return t('admin.routers.modeApiPlainHelp');
  return t('admin.routers.modeSshHelp');
});

const rscScript = computed(() => {
  const mode = connectionMode.value;
  const isSshMode = mode === 'ssh';
  const user = isSshMode
    ? newRouter.value.sshUser || 'wg-easy'
    : newRouter.value.apiUser || 'wg-easy';
  const password = newRouter.value.apiPassword || generatePassword();
  const apiPort = newRouter.value.apiPort || (mode === 'api-tls' ? 8729 : 8728);
  const sshPort = newRouter.value.port || 22;

  const lines: string[] = [
    '# wg-easy MikroTik bootstrap script (.rsc)',
    `# Mode: ${mode}`,
    `# Generated: ${new Date().toISOString()}`,
    '#',
    '# Upload this file via Winbox/WebFig -> Files, then run on the MikroTik:',
    `#   /import file-name=wg-easy-bootstrap.rsc`,
    '# Idempotent: safe to re-run; duplicates are removed first.',
    '',
    '# --- 1) Group with least-privilege policies ---',
    '/user/group',
    ':if ([:len [find name=wg-easy]] > 0) do={ remove [find name=wg-easy] }',
    'add name=wg-easy policy=read,write,test,api,ssh,sensitive comment="wg-easy automation"',
    '',
    '# --- 2) User ---',
    '/user',
    ':if ([:len [find name=wg-easy]] > 0) do={ remove [find name=wg-easy] }',
  ];

  if (isSshMode) {
    lines.push(
      `add name=wg-easy group=wg-easy password="${password}" comment="wg-easy SSH"`,
      '# Note: SSH key import requires uploading the .pub key to Files first',
      '# (Winbox -> Files -> drag-drop "wg-easy.pub"), then run:',
      '#   /user/ssh-keys/import public-key-file=wg-easy.pub user=wg-easy',
      '# Until then, password auth above is used.',
    );
  } else {
    lines.push(`add name=wg-easy group=wg-easy password="${password}" comment="wg-easy API"`);
  }

  lines.push(
    '',
    '# --- 3) Certificates for API-SSL ---',
    '/certificate',
    ':if ([:len [find name=api-ssl-cert]] = 0) do={',
    '  add name=api-ssl-cert common-name=RouterOS key-usage=key-cert-sign,crl-sign',
    '  sign api-ssl-cert',
    '}',
    ':if ([:len [find name=api-ssl-server]] = 0) do={',
    '  add name=api-ssl-server common-name=api-ssl-server key-usage=tls-server',
    '  :do { sign api-ssl-server ca=api-ssl-cert } on-error={ sign api-ssl-server }',
    '}',
    '',
    '# --- 4) Services ---',
    '/ip/service',
  );

  if (mode === 'api-tls') {
    lines.push(
      'set [find name=api-ssl] certificate=api-ssl-server',
      `set [find name=api-ssl] port=${apiPort}`,
      'set [find name=api-ssl] disabled=no',
      'set [find name=api] disabled=yes',
    );
  } else if (mode === 'api-plain') {
    lines.push(
      `set [find name=api] port=${apiPort}`,
      'set [find name=api] disabled=no',
      'set [find name=api-ssl] disabled=yes',
    );
  } else {
    lines.push(
      `set [find name=ssh] port=${sshPort}`,
      'set [find name=ssh] disabled=no',
    );
  }

  lines.push(
    '',
    '# --- 5) Firewall: allow wg-easy to reach the management port ---',
    '# Adjust src-address=<wg-easy host or subnet> to lock this down.',
    '/ip/firewall/filter',
  );

  if (mode === 'api-tls') {
    lines.push(
      `:if ([:len [find comment="wg-easy: api-ssl"]] = 0) do={ add chain=input action=accept protocol=tcp dst-port=${apiPort} comment="wg-easy: api-ssl" place-before=0 }`,
    );
  } else if (mode === 'api-plain') {
    lines.push(
      `:if ([:len [find comment="wg-easy: api"]] = 0) do={ add chain=input action=accept protocol=tcp dst-port=${apiPort} comment="wg-easy: api" place-before=0 }`,
    );
  } else {
    lines.push(
      `:if ([:len [find comment="wg-easy: ssh"]] = 0) do={ add chain=input action=accept protocol=tcp dst-port=${sshPort} comment="wg-easy: ssh" place-before=0 }`,
    );
  }

  lines.push(
    '',
    '# --- 6) WireGuard interface (created here so wg-easy can sync peers) ---',
    '/interface/wireguard',
    ':if ([:len [find name=wg0]] = 0) do={',
    '  add name=wg0 listen-port=51820 mtu=1420',
    '}',
    '/ip/address',
    ':if ([:len [find interface=wg0]] = 0) do={',
    '  add interface=wg0 address=10.8.0.1/24',
    '}',
    '/ipv6/address',
    ':if ([:len [find interface=wg0]] = 0) do={',
    '  :do { add interface=wg0 address=fdcc:ad94:bacf:61a4::1/64 advertise=no } on-error={}',
    '}',
    '',
    '# --- 7) Allow WireGuard UDP from the internet ---',
    '/ip/firewall/filter',
    ':if ([:len [find comment="wg-easy: wireguard"]] = 0) do={ add chain=input action=accept protocol=udp dst-port=51820 comment="wg-easy: wireguard" place-before=0 }',
    '',
    ':put "wg-easy bootstrap complete."',
    `:put "User=wg-easy  ${isSshMode ? `SSH-port=${sshPort}` : `API-port=${apiPort} (mode=${mode})`}"`,
    ':put "Now go to wg-easy -> Routers -> Test Connection."',
  );

  return lines.join('\n');
});

function downloadRsc() {
  const blob = new Blob([rscScript.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (newRouter.value.name || 'wg-easy').replace(/[^a-zA-Z0-9_.-]/g, '_');
  a.download = `${safeName}-bootstrap.rsc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyHelper() {
  try {
    await navigator.clipboard.writeText(rscScript.value);
    toast.showToast({ type: 'success', message: t('admin.routers.helperCopied') });
  } catch {
    toast.showToast({ type: 'error', message: t('admin.routers.helperCopyFailed') });
  }
}

async function fetchFingerprint() {
  if (!newRouter.value.host) {
    toast.showToast({ type: 'error', message: t('admin.routers.hostRequired') });
    return;
  }
  try {
    const res = await $fetch('/api/admin/router/fingerprint', {
      method: 'post',
      body: {
        host: newRouter.value.host,
        port: newRouter.value.apiPort,
      },
    });
    newRouter.value.tlsFingerprintSha256 = res.spki;
    toast.showToast({ type: 'success', message: t('admin.routers.testSuccess') });
  } catch (e: any) {
    toast.showToast({
      type: 'error',
      message: e?.data?.statusMessage || e?.message || t('admin.routers.testFailed'),
    });
  }
}

const engineOptions = computed(() => [
  { label: 'MikroTik', value: 'mikrotik' },
]);

async function createRouter() {
  try {
    const sshKeyB64 = newRouter.value.sshKey
      ? typeof window !== 'undefined' && window.btoa
        ? window.btoa(unescape(encodeURIComponent(newRouter.value.sshKey)))
        : newRouter.value.sshKey
      : undefined;

    await $fetch('/api/admin/router', {
      method: 'post',
      body: {
        name: newRouter.value.name,
        host: newRouter.value.host || null,
        port: newRouter.value.port,
        apiPort: newRouter.value.apiPort,
        tlsRequired: newRouter.value.tlsRequired,
        tlsFingerprintSha256: newRouter.value.tlsFingerprintSha256 || null,
        engineType: newRouter.value.engineType,
        transport: newRouter.value.transport,
        credentials: {
          apiUser: isSsh.value ? undefined : newRouter.value.apiUser,
          apiPassword: newRouter.value.apiPassword || undefined,
          sshUser: isSsh.value ? newRouter.value.sshUser || undefined : undefined,
          sshKey: isSsh.value ? sshKeyB64 : undefined,
          sshPassphrase: isSsh.value ? newRouter.value.sshPassphrase || undefined : undefined,
        },
      },
    });
    toast.showToast({
      type: 'success',
      message: t('admin.routers.createSuccess'),
    });
    newRouter.value = emptyRouter();
    sshKeyFilename.value = '';
    connectionMode.value = 'api-tls';
    await refresh();
  } catch (e: any) {
    const message = e?.data?.message || e?.message || t('admin.routers.createError');
    toast.showToast({
      type: 'error',
      message,
    });
  }
}
</script>
