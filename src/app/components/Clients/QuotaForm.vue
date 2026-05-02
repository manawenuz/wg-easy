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
      id="limitBytes"
      v-model="form.limitBytes"
      label="Limit (Bytes)"
    />
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
  limitBytes: 0,
  period: 'daily' as 'daily' | 'weekly' | 'monthly',
  autoDisable: true,
});

watch(
  quota,
  (q) => {
    if (q) {
      form.value.limitBytes = q.limitBytes;
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
  return _save(form.value);
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
          limitBytes: 0,
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
