<template>
  <div class="flex items-center">
    <FormLabel :for="id">
      {{ label }}
    </FormLabel>
    <BaseTooltip v-if="description" :text="description">
      <IconsInfo class="size-4" />
    </BaseTooltip>
  </div>
  <BaseSelect
    :id="id"
    v-model="selected"
    :options="options"
    :disabled="disabled"
  />
</template>

<script lang="ts" setup>
defineProps<{
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}>();

const selected = defineModel<string>();

const options = computed(() => {
  const base = [
    { label: 'WireGuard', value: 'wireguard' },
    { label: 'AmneziaWG', value: 'amneziawg' },
  ];
  return base;
});
</script>
