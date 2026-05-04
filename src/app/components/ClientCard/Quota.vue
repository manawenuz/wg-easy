<template>
  <div
    v-if="client.quota"
    class="mt-1 flex items-center gap-2"
  >
    <div
      class="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-600"
      :title="`${bytes(client.quota.usedBytes)} / ${bytes(client.quota.limitBytes)}`"
    >
      <div
        class="h-full rounded-full transition-all"
        :class="barColorClass"
        :style="{
          width: `${Math.min(100, (client.quota.usedBytes / client.quota.limitBytes) * 100)}%`,
        }"
      />
    </div>
    <span class="shrink-0 text-xs text-gray-500 dark:text-neutral-400">
      {{ bytes(client.quota.usedBytes) }} / {{ bytes(client.quota.limitBytes) }}
    </span>
    <span
      v-if="client.quota.usedBytes >= client.quota.limitBytes"
      class="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300"
    >
      Over Limit
    </span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  client: LocalClient;
}>();

const barColorClass = computed(() => {
  const pct =
    props.client.quota!.limitBytes <= 0
      ? 0
      : (props.client.quota!.usedBytes / props.client.quota!.limitBytes) * 100;
  if (pct >= 100) return 'bg-red-600';
  if (pct >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
});

function bytes(value: number): string {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}
</script>
