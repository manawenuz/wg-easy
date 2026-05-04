<template>
  <FormGroup>
    <FormHeading>Speed Limit</FormHeading>

    <div class="col-span-full flex items-center gap-3">
      <span class="text-sm text-gray-600 dark:text-neutral-300">Unit:</span>
      <label class="flex cursor-pointer items-center gap-1 text-sm">
        <input
          v-model="unit"
          type="radio"
          value="kbps"
          class="rounded border-gray-300"
        />
        kbps
      </label>
      <label class="flex cursor-pointer items-center gap-1 text-sm">
        <input
          v-model="unit"
          type="radio"
          value="KB/s"
          class="rounded border-gray-300"
        />
        KB/s
      </label>
    </div>

    <FormNumberField
      id="downKbps"
      v-model="form.downKbps"
      :label="`Download (${unit})`"
    />
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ hint(form.downKbps) }}
    </div>
    <FormNumberField
      id="upKbps"
      v-model="form.upKbps"
      :label="`Upload (${unit})`"
    />
    <div class="col-span-full text-xs text-gray-500 dark:text-neutral-400">
      {{ hint(form.upKbps) }}
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

const unit = ref<'kbps' | 'KB/s'>('kbps');

const form = ref({
  downKbps: 0,
  upKbps: 0,
});

const unlimited = ref(true);

// Fetch current speed limit when clientId changes
const { data: currentLimit } = useFetch(`/api/admin/clients/${props.clientId}/speed-limit`);

watch(currentLimit, (limit) => {
  if (limit && (limit.downKbps > 0 || limit.upKbps > 0)) {
    // limit values are in kbps from the API
    if (unit.value === 'KB/s') {
      form.value.downKbps = Math.round(limit.downKbps / 8);
      form.value.upKbps = Math.round(limit.upKbps / 8);
    } else {
      form.value.downKbps = limit.downKbps;
      form.value.upKbps = limit.upKbps;
    }
    unlimited.value = false;
  } else {
    form.value = { downKbps: 0, upKbps: 0 };
    unlimited.value = true;
  }
}, { immediate: true });

watch(unit, (newUnit) => {
  // Convert displayed values when unit changes
  if (unlimited.value) return;
  if (newUnit === 'KB/s') {
    form.value.downKbps = Math.round(form.value.downKbps / 8);
    form.value.upKbps = Math.round(form.value.upKbps / 8);
  } else {
    form.value.downKbps = Math.round(form.value.downKbps * 8);
    form.value.upKbps = Math.round(form.value.upKbps * 8);
  }
});

watch(unlimited, (u) => {
  if (u) {
    form.value.downKbps = 0;
    form.value.upKbps = 0;
  }
});

function hint(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  if (unit.value === 'KB/s') {
    const kbit = kbps * 8;
    if (kbit >= 1024) return `≈ ${(kbit / 1024).toFixed(1)} Mbps (${kbps} KB/s)`;
    return `≈ ${kbit} kbps (${kbps} KB/s)`;
  }
  // unit === 'kbps'
  const kbytes = kbps / 8;
  if (kbytes >= 1024) return `≈ ${(kbytes / 1024).toFixed(1)} MB/s (${kbps} kbps)`;
  return `≈ ${kbytes.toFixed(1)} KB/s (${kbps} kbps)`;
}

const _save = useSubmit(
  `/api/admin/clients/${props.clientId}/speed-limit`,
  {
    method: 'put',
  },
  {
    revert: async (success) => {
      if (success) {
        unlimited.value = form.value.downKbps === 0 && form.value.upKbps === 0;
      }
    },
    successMsg: 'Speed limit saved',
  }
);

function save() {
  const payload = {
    downKbps: unit.value === 'KB/s' ? form.value.downKbps * 8 : form.value.downKbps,
    upKbps: unit.value === 'KB/s' ? form.value.upKbps * 8 : form.value.upKbps,
  };
  return _save(payload);
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
