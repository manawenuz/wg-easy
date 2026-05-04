<template>
  <FormGroup>
    <FormHeading>Quota</FormHeading>
    <div v-if="quota" class="col-span-full">
      <ClientsQuotaProgress
        :used-bytes="quota.usedBytes"
        :limit-bytes="quota.limitBytes"
        :period="quota.period"
        :period-end="quota.periodEnd"
      />
    </div>
    <FormNumberField
      id="limitGB"
      v-model="form.limitGB"
      label="Limit (GB)"
      step="0.001"
    />
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ bytesHint }}
    </div>
    <div class="flex items-center gap-2">
      <FormLabel for="period">Period</FormLabel>
      <BaseSelect
        id="period"
        v-model="form.period"
        :options="[
          { label: 'Daily', value: 'daily' },
          { label: 'Weekly', value: 'weekly' },
          { label: 'Monthly', value: 'monthly' },
        ]"
      />
    </div>
    <FormSwitchField
      id="autoDisable"
      v-model="form.autoDisable"
      label="Auto-disable on exceed"
    />
    <FormPrimaryActionField
      type="button"
      :label="quota ? 'Update Quota' : 'Set Quota'"
      @click="save"
    />
    <FormSecondaryActionField
      v-if="quota"
      label="Remove Quota"
      @click="remove"
    />
  </FormGroup>
</template>

<script lang="ts" setup>
const props = defineProps<{
  clientId: number;
}>();

const { data: quota, refresh } = await useFetch(
  `/api/admin/clients/${props.clientId}/quota`
);

const form = ref({
  limitGB: 0,
  period: 'daily' as 'daily' | 'weekly' | 'monthly',
  autoDisable: true,
});

const bytesHint = computed(() => {
  const bytes = Math.round(form.value.limitGB * 1024 * 1024 * 1024);
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `≈ ${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
});

watch(
  quota,
  (q) => {
    if (q) {
      form.value.limitGB = parseFloat((q.limitBytes / (1024 * 1024 * 1024)).toFixed(3));
      form.value.period = q.period;
      form.value.autoDisable = q.autoDisable;
    }
  },
  { immediate: true }
);

const _save = useSubmit(
  `/api/admin/clients/${props.clientId}/quota`,
  {
    method: 'put',
  },
  {
    revert: async (success) => {
      if (success) {
        await refresh();
      }
    },
    successMsg: 'Quota saved',
  }
);

function save() {
  const limitBytes = Math.round(form.value.limitGB * 1024 * 1024 * 1024);
  return _save({
    limitBytes,
    period: form.value.period,
    autoDisable: form.value.autoDisable,
  });
}

const _remove = useSubmit(
  `/api/admin/clients/${props.clientId}/quota`,
  {
    method: 'delete',
  },
  {
    revert: async (success) => {
      if (success) {
        await refresh();
        form.value = {
          limitGB: 0,
          period: 'daily',
          autoDisable: true,
        };
      }
    },
    successMsg: 'Quota removed',
  }
);

function remove() {
  return _remove(undefined);
}
</script>
