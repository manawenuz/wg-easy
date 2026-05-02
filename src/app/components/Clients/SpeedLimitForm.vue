<template>
  <FormGroup>
    <FormHeading>Speed Limit</FormHeading>
    <FormNumberField
      id="downKbps"
      v-model="form.downKbps"
      label="Download (KB/s)"
    />
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ mbpsHint(form.downKbps) }}
    </div>
    <FormNumberField
      id="upKbps"
      v-model="form.upKbps"
      label="Upload (KB/s)"
    />
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ mbpsHint(form.upKbps) }}
    </div>
    <div class="flex items-center gap-2">
      <input
        id="unlimited"
        v-model="unlimited"
        type="checkbox"
        class="rounded border-gray-300"
      />
      <label for="unlimited" class="text-sm text-gray-600 dark:text-neutral-300">Unlimited</label>
    </div>
    <FormPrimaryActionField
      type="button"
      label="Set Limit"
      @click="save"
    />
    <FormSecondaryActionField
      label="Remove Limit"
      @click="remove"
    />
  </FormGroup>
</template>

<script lang="ts" setup>
const props = defineProps<{
  clientId: number;
}>();

const form = ref({
  downKbps: 0,
  upKbps: 0,
});

const unlimited = ref(true);

watch(unlimited, (u) => {
  if (u) {
    form.value.downKbps = 0;
    form.value.upKbps = 0;
  }
});

function mbpsHint(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  return `≈ ${(kbps / 1024).toFixed(2)} MB/s`;
}

const _save = useSubmit(
  `/api/admin/clients/${props.clientId}/speed-limit`,
  {
    method: 'put',
  },
  {
    revert: async (success) => {
      if (success) {
        form.value = { downKbps: 0, upKbps: 0 };
        unlimited.value = true;
      }
    },
    successMsg: 'Speed limit saved',
  }
);

function save() {
  return _save(form.value);
}

const _remove = useSubmit(
  `/api/admin/clients/${props.clientId}/speed-limit`,
  {
    method: 'delete',
  },
  {
    revert: async (success) => {
      if (success) {
        form.value = { downKbps: 0, upKbps: 0 };
        unlimited.value = true;
      }
    },
    successMsg: 'Speed limit removed',
  }
);

function remove() {
  return _remove(undefined);
}
</script>
