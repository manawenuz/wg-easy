<template>
  <BaseDialog :trigger-class="triggerClass">
    <template #trigger>
      <slot />
    </template>
    <template #title>
      {{ $t('client.new') }}
    </template>
    <template #description>
      <div class="flex flex-col gap-3">
        <FormTextField id="name" v-model="name" :label="$t('client.name')" />
        <FormDateField
          id="expiresAt"
          v-model="expiresAt"
          :label="$t('client.expireDate')"
        />
        <FormElement>
          <FormLabel>{{ $t('client.trafficGroup') }}</FormLabel>
          <select
            v-model="trafficGroupId"
            class="w-full rounded border border-gray-300 px-3 py-2 dark:border-neutral-600 dark:bg-neutral-800"
          >
            <option v-for="group in trafficGroups" :key="group.id" :value="group.id">
              {{ group.name }}
              <span v-if="group.isDefault">({{ $t('admin.trafficGroups.default') }})</span>
            </option>
          </select>
        </FormElement>
      </div>
    </template>
    <template #actions>
      <DialogClose as-child>
        <BaseSecondaryButton>{{ $t('dialog.cancel') }}</BaseSecondaryButton>
      </DialogClose>
      <DialogClose as-child>
        <BasePrimaryButton @click="createClient">
          {{ $t('client.create') }}
        </BasePrimaryButton>
      </DialogClose>
    </template>
  </BaseDialog>
</template>

<script lang="ts" setup>
// Owner picker (existing/new end-user) is deferred — see PRD-60-05 follow-up.
// The server auto-creates an end-user named after the client when no owner
// is supplied, so a name-only form is enough to get a working peer.

const name = ref<string>('');
const expiresAt = ref<string | null>(null);
const trafficGroupId = ref<number | undefined>(undefined);
const trafficGroups = ref<any[]>([]);
const clientsStore = useClientsStore();
const { t } = useI18n();

defineProps<{ triggerClass?: string }>();

async function loadTrafficGroups() {
  try {
    const response = await $fetch<any[]>('/api/admin/traffic-groups');
    trafficGroups.value = response;
    // Pre-select default group
    const defaultGroup = response.find((g) => g.isDefault);
    if (defaultGroup) {
      trafficGroupId.value = defaultGroup.id;
    }
  } catch (error) {
    console.error('Failed to load traffic groups:', error);
  }
}

function createClient() {
  return _createClient({
    name: name.value,
    expiresAt: expiresAt.value,
    trafficGroupId: trafficGroupId.value,
  });
}

const _createClient = useSubmit(
  '/api/client',
  { method: 'post' },
  {
    revert: () => clientsStore.refresh(),
    successMsg: t('client.created'),
  }
);

onMounted(() => {
  loadTrafficGroups();
});
</script>
