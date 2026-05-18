<template>
  <FormGroup>
    <FormHeading>{{ $t('admin.users.quota.title') }}</FormHeading>
    <div v-if="quota" class="col-span-full">
      <ClientsQuotaProgress
        :used-bytes="quota.usedBytes"
        :limit-bytes="quota.limitBytes"
        :period="quota.period"
        :period-end="quota.periodEnd"
      />
    </div>
    <div class="flex items-center">
      <FormLabel for="limit">{{ $t('admin.users.quota.limit') }}</FormLabel>
    </div>
    <div class="flex gap-2">
      <BaseInput
        id="limit"
        v-model="form.limit"
        type="number"
        step="0.001"
        class="w-full"
      />
      <BaseSelect v-model="form.unit" :options="unitOptions" />
    </div>
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ bytesHint }}
    </div>
    <div class="flex items-center gap-2">
      <FormLabel for="period">{{ $t('admin.users.quota.period') }}</FormLabel>
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
      :label="$t('admin.users.quota.autoDisable')"
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
  userId: number;
}>();

const { data: quota, refresh } = await useFetch(
  `/api/admin/users/${props.userId}/quota`
);

type Unit = 'MB' | 'GB' | 'TB';

const multipliers: Record<Unit, number> = {
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

function fromBytes(bytes: number): { limit: number; unit: Unit } {
  if (bytes >= 1024 ** 4) return { limit: parseFloat((bytes / 1024 ** 4).toFixed(3)), unit: 'TB' };
  if (bytes >= 1024 ** 3) return { limit: parseFloat((bytes / 1024 ** 3).toFixed(3)), unit: 'GB' };
  return { limit: parseFloat((bytes / 1024 ** 2).toFixed(3)), unit: 'MB' };
}

const unitOptions = [
  { label: 'MB', value: 'MB' },
  { label: 'GB', value: 'GB' },
  { label: 'TB', value: 'TB' },
];

const form = ref({
  limit: 0,
  unit: 'GB' as Unit,
  period: 'daily' as 'daily' | 'weekly' | 'monthly',
  autoDisable: true,
});

const bytesHint = computed(() => {
  const bytes = Math.round(Number(form.value.limit) * multipliers[form.value.unit]);
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
      const converted = fromBytes(q.limitBytes);
      form.value.limit = converted.limit;
      form.value.unit = converted.unit;
      form.value.period = q.period;
      form.value.autoDisable = q.autoDisable;
    }
  },
  { immediate: true }
);

const _save = useSubmit(
  `/api/admin/users/${props.userId}/quota`,
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
  const limitBytes = Math.round(Number(form.value.limit) * multipliers[form.value.unit]);
  return _save({
    limitBytes,
    period: form.value.period,
    autoDisable: form.value.autoDisable,
  });
}

const _remove = useSubmit(
  `/api/admin/users/${props.userId}/quota`,
  {
    method: 'delete',
  },
  {
    revert: async (success) => {
      if (success) {
        await refresh();
        form.value = {
          limit: 0,
          unit: 'GB',
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
