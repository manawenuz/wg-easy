<template>
  <div>
    <div class="flex items-center">
      <FormLabel :for="id">{{ label }}</FormLabel>
      <BaseTooltip v-if="description" :text="description">
        <IconsInfo class="size-4" />
      </BaseTooltip>
    </div>

    <div
      v-if="pending"
      class="mt-2 text-sm text-gray-500 dark:text-neutral-400"
    >
      {{ $t('general.loading') }}
    </div>

    <div
      v-else-if="!engines || engines.length === 0"
      class="mt-2 text-sm text-gray-500 dark:text-neutral-400"
    >
      No engines available.
    </div>

    <div
      v-else
      class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
      role="radiogroup"
      :aria-label="label"
    >
      <button
        v-for="engine in engines"
        :key="engine.id"
        type="button"
        role="radio"
        :aria-checked="selected === engine.id"
        class="relative rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-red-800"
        :class="cardClasses(engine)"
        :disabled="isEngineDisabled(engine)"
        @click="selectEngine(engine.id)"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              class="font-semibold"
              :class="
                isEngineDisabled(engine)
                  ? 'text-gray-500 dark:text-neutral-500'
                  : 'text-gray-900 dark:text-neutral-200'
              "
            >
              {{ engine.name }}
            </span>
            <span
              v-if="engine.id === 'wireguard'"
              class="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
            >
              {{ $t('general.recommended') }}
            </span>
            <span
              v-if="engine.dockerized"
              class="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              :title="$t('admin.interface.dockerizedTooltip')"
            >
              <IconsDocker class="size-3" />
              {{ $t('admin.interface.dockerized') }}
            </span>
          </div>
          <IconsCheckCircle
            v-if="selected === engine.id"
            class="size-5 text-red-800 dark:text-red-400"
          />
        </div>
        <p class="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          {{ engine.description }}
        </p>
        <InterfacesEngineCapabilityHints :capabilities="engine.capabilities" />
        <div
          v-if="!engine.available"
          class="mt-2 flex items-center gap-1"
        >
          <IconsWarning class="size-3.5 text-red-600 dark:text-red-400" />
          <BaseTooltip
            :text="$t('admin.interface.engineUnavailableTooltip')"
          >
            <span class="text-xs font-medium text-red-600 dark:text-red-400">
              {{ $t('admin.interface.notInstalled') }}
            </span>
          </BaseTooltip>
        </div>
        <p
          v-else-if="isEngineDisabledByRouter(engine)"
          class="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400"
        >
          {{ $t('admin.interface.notCompatible') }}
        </p>
      </button>
    </div>

    <DialogRoot v-model:open="showConfirm">
      <DialogPortal>
        <DialogOverlay
          class="fixed inset-0 z-30 bg-gray-500 opacity-75 dark:bg-black dark:opacity-50"
        />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-[100] max-h-[85vh] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-6 shadow-2xl focus:outline-none dark:bg-neutral-700"
        >
          <DialogTitle
            class="m-0 text-lg font-semibold text-gray-900 dark:text-neutral-200"
          >
            Change Engine?
          </DialogTitle>
          <DialogDescription
            class="mb-5 mt-2 text-sm leading-normal text-gray-500 dark:text-neutral-300"
          >
            Changing the engine will require clients to regenerate and
            re-download their configurations.
          </DialogDescription>
          <div class="mt-6 flex flex-wrap justify-end gap-2">
            <BaseSecondaryButton @click="cancelChange">
              {{ $t('dialog.cancel') }}
            </BaseSecondaryButton>
            <BasePrimaryButton @click="confirmChange">
              {{ $t('dialog.change') }}
            </BasePrimaryButton>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<script lang="ts" setup>
interface EngineInfo {
  id: string;
  name: string;
  description: string;
  available: boolean;
  dockerized: boolean;
  capabilities: {
    obfuscation: string;
    speedLimit: string;
    multiPeerSync: boolean;
    livePeerStats: boolean;
  };
  platform: 'linux' | 'mikrotik';
}

const props = defineProps<{
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  routerEngineType?: string;
}>();

const selected = defineModel<string>();

const { data: engines, pending } = useFetch<EngineInfo[]>('/api/admin/engines');

const showConfirm = ref(false);
const pendingEngine = ref<string | null>(null);

const isMikrotikRouter = computed(() => props.routerEngineType === 'mikrotik');

function isEngineDisabledByRouter(engine: EngineInfo): boolean {
  if (isMikrotikRouter.value) {
    return engine.platform !== 'mikrotik';
  }
  return engine.platform === 'mikrotik';
}

function isEngineDisabled(engine: EngineInfo): boolean {
  if (props.disabled) return true;
  if (!engine.available) return true;
  return isEngineDisabledByRouter(engine);
}

function cardClasses(engine: EngineInfo): string {
  if (isEngineDisabled(engine)) {
    return 'border border-gray-200 dark:border-neutral-600 bg-gray-50 dark:bg-neutral-800 opacity-60 cursor-not-allowed grayscale';
  }
  if (selected.value === engine.id) {
    return 'border-2 border-red-800 bg-red-50 dark:bg-red-900/20 cursor-pointer';
  }
  return 'border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 hover:border-red-400 dark:hover:border-red-600 cursor-pointer';
}

function selectEngine(id: string) {
  const engine = engines.value?.find((e) => e.id === id);
  if (!engine || isEngineDisabled(engine)) {
    return;
  }

  if (selected.value && selected.value !== id) {
    pendingEngine.value = id;
    showConfirm.value = true;
    return;
  }

  selected.value = id;
}

function confirmChange() {
  if (pendingEngine.value) {
    selected.value = pendingEngine.value;
  }
  showConfirm.value = false;
  pendingEngine.value = null;
}

function cancelChange() {
  showConfirm.value = false;
  pendingEngine.value = null;
}
</script>
