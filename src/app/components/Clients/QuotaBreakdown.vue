<template>
  <FormGroup v-if="breakdown && breakdown.members.length > 1">
    <FormHeading>{{ $t('admin.users.quota.breakdown.title') }}</FormHeading>
    <div class="space-y-2">
      <div
        v-for="member in breakdown.members"
        :key="member.userId"
        class="flex items-center justify-between rounded border border-gray-200 p-3 dark:border-neutral-600"
      >
        <div>
          <div class="font-medium">{{ member.name }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400">
            {{ member.clientIds.length }} {{ $t('admin.users.quota.breakdown.clients') }}
          </div>
        </div>
        <div class="text-sm font-mono">{{ formatBytes(member.usedBytes) }}</div>
      </div>
      <div class="flex items-center justify-between border-t border-gray-200 pt-2 font-medium dark:border-neutral-600">
        <span>Total</span>
        <span>{{ formatBytes(totalUsed) }} / {{ formatBytes(breakdown.limitBytes) }}</span>
      </div>
    </div>
  </FormGroup>
</template>

<script setup lang="ts">
const props = defineProps<{
  userId: number;
}>();

const { data: breakdown } = await useFetch(
  `/api/admin/users/${props.userId}/quota-breakdown`,
  { method: 'get' }
);

const totalUsed = computed(
  () => breakdown.value?.members.reduce((sum, m) => sum + m.usedBytes, 0) ?? 0
);

function formatBytes(value: number): string {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}
</script>
