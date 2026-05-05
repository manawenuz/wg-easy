<template>
  <div class="mx-auto max-w-2xl">
    <!-- Step indicator -->
    <div class="mb-6 flex items-center justify-between">
      <div
        v-for="(stepLabel, idx) in stepLabels"
        :key="idx"
        class="flex flex-1 items-center"
      >
        <div
          :class="[
            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
            currentStep > idx
              ? 'bg-green-600 text-white'
              : currentStep === idx
                ? 'bg-red-800 text-white'
                : 'bg-gray-200 text-gray-500 dark:bg-neutral-600 dark:text-neutral-400',
          ]"
        >
          {{ idx + 1 }}
        </div>
        <span
          :class="[
            'ml-2 text-sm',
            currentStep === idx
              ? 'font-medium text-gray-900 dark:text-neutral-200'
              : 'text-gray-500 dark:text-neutral-400',
          ]"
        >
          {{ stepLabel }}
        </span>
        <div
          v-if="idx < stepLabels.length - 1"
          class="mx-2 h-[2px] flex-1 bg-gray-200 dark:bg-neutral-600"
        />
      </div>
    </div>

    <!-- Step 1: Connectivity -->
    <div v-if="currentStep === 0" class="space-y-4">
      <FormGroup>
        <FormHeading>{{ t('admin.bootstrap.connectivity') }}</FormHeading>
        <FormTextField
          id="sshUser"
          v-model="form.sshUser"
          :label="t('admin.bootstrap.sshUser')"
        />
        <FormSwitchField
          id="useKey"
          v-model="useKey"
          :label="t('admin.bootstrap.useKey')"
        />
        <FormPasswordField
          v-if="!useKey"
          id="sshPassword"
          v-model="form.sshPassword"
          :label="t('admin.bootstrap.sshPassword')"
          autocomplete="new-password"
        />
        <FormTextArea
          v-else
          id="sshKey"
          v-model="form.sshKey"
          :label="t('admin.bootstrap.sshKey')"
        />
      </FormGroup>
      <div class="flex justify-end gap-2">
        <BaseSecondaryButton @click="goBack">
          {{ t('form.cancel') }}
        </BaseSecondaryButton>
        <BasePrimaryButton @click="nextStep">
          {{ t('general.continue') }}
        </BasePrimaryButton>
      </div>
    </div>

    <!-- Step 2: Identity -->
    <div v-else-if="currentStep === 1" class="space-y-4">
      <FormGroup>
        <FormHeading>{{ t('admin.bootstrap.identity') }}</FormHeading>
        <FormInfoField
          id="routerName"
          :label="t('general.name')"
          :data="router?.name ?? ''"
        />
        <FormInfoField
          id="routerHost"
          :label="t('general.host')"
          :data="router?.host ?? ''"
        />
        <FormInfoField
          id="routerEngine"
          :label="t('admin.routers.engineType')"
          :data="router?.engineType ?? ''"
        />
      </FormGroup>
      <div class="flex justify-end gap-2">
        <BaseSecondaryButton @click="prevStep">
          {{ t('form.back') }}
        </BaseSecondaryButton>
        <BasePrimaryButton @click="nextStep">
          {{ t('general.continue') }}
        </BasePrimaryButton>
      </div>
    </div>

    <!-- Step 3: Interface Config -->
    <div v-else-if="currentStep === 2" class="space-y-4">
      <FormGroup>
        <FormHeading>{{ t('admin.bootstrap.interfaceConfig') }}</FormHeading>
        <FormTextField
          id="ifaceName"
          v-model="form.ifaceName"
          :label="t('admin.bootstrap.ifaceName')"
        />
        <FormNumberField
          id="listenPort"
          v-model="form.listenPort"
          :label="t('admin.bootstrap.listenPort')"
        />
        <FormTextField
          id="ipv4Cidr"
          v-model="form.ipv4Cidr"
          :label="t('admin.bootstrap.ipv4Cidr')"
        />
        <FormTextField
          id="ipv6Cidr"
          v-model="form.ipv6Cidr"
          :label="t('admin.bootstrap.ipv6Cidr')"
        />
        <FormTextField
          id="wanInterface"
          v-model="form.wanInterface"
          :label="t('admin.bootstrap.wanInterface')"
          :description="t('admin.bootstrap.wanInterfaceDesc')"
        />
      </FormGroup>
      <div class="flex justify-end gap-2">
        <BaseSecondaryButton @click="prevStep">
          {{ t('form.back') }}
        </BaseSecondaryButton>
        <BasePrimaryButton @click="nextStep">
          {{ t('general.continue') }}
        </BasePrimaryButton>
      </div>
    </div>

    <!-- Step 4: Review & Apply -->
    <div v-else-if="currentStep === 3" class="space-y-4">
      <FormGroup>
        <FormHeading>{{ t('admin.bootstrap.review') }}</FormHeading>
        <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-neutral-600 dark:bg-neutral-800">
          <div class="grid grid-cols-2 gap-2">
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.sshUser') }}</div>
            <div>{{ form.sshUser }}</div>
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.ifaceName') }}</div>
            <div>{{ form.ifaceName }}</div>
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.listenPort') }}</div>
            <div>{{ form.listenPort }}</div>
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.ipv4Cidr') }}</div>
            <div>{{ form.ipv4Cidr }}</div>
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.ipv6Cidr') }}</div>
            <div>{{ form.ipv6Cidr || '-' }}</div>
            <div class="text-gray-500 dark:text-neutral-400">{{ t('admin.bootstrap.wanInterface') }}</div>
            <div>{{ form.wanInterface || t('admin.bootstrap.autoDetect') }}</div>
          </div>
        </div>
      </FormGroup>

      <div class="flex justify-end gap-2">
        <BaseSecondaryButton
          :disabled="isRunning"
          @click="prevStep"
        >
          {{ t('form.back') }}
        </BaseSecondaryButton>
        <BasePrimaryButton
          :disabled="isRunning"
          @click="startBootstrap"
        >
          {{ isRunning ? t('admin.bootstrap.running') : t('admin.bootstrap.start') }}
        </BasePrimaryButton>
      </div>

      <!-- Live log -->
      <div
        v-if="log.length > 0"
        class="mt-4 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-gray-900 p-4 font-mono text-sm dark:border-neutral-600"
      >
        <div
          v-for="(entry, idx) in log"
          :key="idx"
          class="mb-1"
        >
          <span
            :class="{
              'text-yellow-400': entry.status === 'pending',
              'text-green-400': entry.status === 'ok',
              'text-red-400': entry.status === 'error',
            }"
          >
            [{{ entry.status.toUpperCase() }}]
          </span>
          <span class="text-gray-300"> {{ stepName(entry.step) }}</span>
          <span v-if="entry.detail" class="text-gray-400"> — {{ entry.detail }}</span>
          <span v-if="entry.recovery" class="block text-gray-500">    → {{ entry.recovery }}</span>
        </div>
      </div>

      <div
        v-if="isDone"
        class="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300"
      >
        {{ t('admin.bootstrap.success') }}
      </div>

      <div
        v-if="isFailed"
        class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300"
      >
        {{ t('admin.bootstrap.failed') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface RouterItem {
  id: number;
  name: string;
  host: string | null;
  port: number | null;
  engineType: string;
  transport: string;
  enabled: boolean;
}

interface LogEntry {
  step: string;
  status: 'ok' | 'error' | 'pending';
  detail?: string;
  recovery?: string;
}

const props = defineProps<{
  router: RouterItem;
}>();

const { t } = useI18n();
const routerNav = useRouter();

const stepLabels = [
  t('admin.bootstrap.connectivity'),
  t('admin.bootstrap.identity'),
  t('admin.bootstrap.interfaceConfig'),
  t('admin.bootstrap.review'),
];

const currentStep = ref(0);
const useKey = ref(false);
const isRunning = ref(false);
const isDone = ref(false);
const isFailed = ref(false);
const log = ref<LogEntry[]>([]);

const form = ref({
  sshUser: 'admin',
  sshPassword: '',
  sshKey: '',
  // Must match the local interface row PK (currently always 'wg0' until
  // PRD-30-05 lands and multi-interface arrives). If the user picks a
  // different name here, syncInterface will fail to find the WG iface on the
  // router by name.
  ifaceName: 'wg0',
  listenPort: 51820,
  ipv4Cidr: '10.8.0.1/24',
  ipv6Cidr: '',
  wanInterface: '',
});

function stepName(step: string): string {
  const names: Record<string, string> = {
    connect: t('admin.bootstrap.stepConnect'),
    identity: t('admin.bootstrap.stepIdentity'),
    'wireguard-interface': t('admin.bootstrap.stepWgInterface'),
    'ip-address': t('admin.bootstrap.stepIpAddress'),
    firewall: t('admin.bootstrap.stepFirewall'),
    nat: t('admin.bootstrap.stepNat'),
    'api-user': t('admin.bootstrap.stepApiUser'),
    'api-ssl': t('admin.bootstrap.stepApiSsl'),
    fingerprint: t('admin.bootstrap.stepFingerprint'),
    persist: t('admin.bootstrap.stepPersist'),
    'test-api': t('admin.bootstrap.stepTestApi'),
    done: t('admin.bootstrap.stepDone'),
  };
  return names[step] ?? step;
}

function nextStep() {
  if (currentStep.value < stepLabels.length - 1) {
    currentStep.value++;
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

function goBack() {
  routerNav.push(`/admin/routers/${props.router.id}`);
}

function startBootstrap() {
  isRunning.value = true;
  isDone.value = false;
  isFailed.value = false;
  log.value = [];

  const body = {
    ifaceName: form.value.ifaceName,
    listenPort: form.value.listenPort,
    ipv4Cidr: form.value.ipv4Cidr,
    ipv6Cidr: form.value.ipv6Cidr || null,
    wanInterface: form.value.wanInterface || null,
    sshUser: form.value.sshUser,
    sshPassword: useKey.value ? null : form.value.sshPassword || null,
    sshKey: useKey.value ? form.value.sshKey || null : null,
  };

  const url = `/api/admin/router/${props.router.id}/bootstrap`;

  const controller = new AbortController();

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const chunk of lines) {
        const line = chunk.trim();
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        try {
          const entry: LogEntry = JSON.parse(json);
          log.value.push(entry);
          if (entry.status === 'error') {
            isFailed.value = true;
          }
          if (entry.step === 'done' && entry.status === 'ok') {
            isDone.value = true;
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  }).catch((err) => {
    log.value.push({
      step: 'bootstrap',
      status: 'error',
      detail: err instanceof Error ? err.message : 'Request failed',
      recovery: 'Check your network connection and retry.',
    });
    isFailed.value = true;
  }).finally(() => {
    isRunning.value = false;
  });
}
</script>
