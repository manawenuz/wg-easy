<template>
  <div class="flex flex-col gap-1 text-sm">
    <div class="flex items-center justify-between">
      <span class="text-gray-600 dark:text-neutral-300">
        {{ periodLabel }} Quota
      </span>
      <span class="text-gray-500 dark:text-neutral-400">
        Resets {{ timeUntilReset }}
      </span>
    </div>
    <ClientsQuotaProgressBar
      :used-bytes="usedBytes"
      :limit-bytes="limitBytes"
    />
    <div class="flex justify-between text-xs text-gray-500 dark:text-neutral-400">
      <span>{{ bytes(usedBytes) }}</span>
      <span>{{ bytes(limitBytes) }}</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  usedBytes: number;
  limitBytes: number;
  period: 'daily' | 'weekly' | 'monthly';
  periodEnd: Date | string;
}>();

const periodLabel = computed(() => {
  const labels = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
  };
  return labels[props.period];
});

const timeUntilReset = computed(() => {
  const end = new Date(props.periodEnd);
  const now = new Date();
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return 'soon';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `in ${days}d`;
  if (hours > 0) return `in ${hours}h`;
  return 'soon';
});

function bytes(value: number): string {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}
</script>
