<template>
  <div
    class="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-600"
  >
    <div
      class="h-full rounded-full transition-all"
      :class="barColorClass"
      :style="{ width: `${percentage}%` }"
    />
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  usedBytes: number;
  limitBytes: number;
}>();

const percentage = computed(() => {
  if (props.limitBytes <= 0) return 0;
  return Math.min(100, (props.usedBytes / props.limitBytes) * 100);
});

const barColorClass = computed(() => {
  const pct = percentage.value;
  if (pct >= 100) return 'bg-red-600';
  if (pct >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
});
</script>
