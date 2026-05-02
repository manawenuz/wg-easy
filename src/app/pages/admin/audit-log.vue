<template>
  <main>
    <h2 class="mb-4 text-xl font-semibold">{{ t('admin.auditLog.title') }}</h2>

    <div
      v-if="data"
      class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <table class="w-full text-left text-sm">
        <thead
          class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <tr>
            <th class="px-4 py-3">{{ t('admin.auditLog.ts') }}</th>
            <th class="px-4 py-3">{{ t('admin.auditLog.actor') }}</th>
            <th class="px-4 py-3">{{ t('admin.auditLog.action') }}</th>
            <th class="px-4 py-3">{{ t('admin.auditLog.target') }}</th>
            <th class="px-4 py-3">{{ t('admin.auditLog.result') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in data.items"
            :key="item.id"
            class="border-b dark:border-neutral-600"
          >
            <td class="px-4 py-3">{{ formatDate(item.ts) }}</td>
            <td class="px-4 py-3">{{ item.actorUserId ?? 'system' }}</td>
            <td class="px-4 py-3">{{ item.action }}</td>
            <td class="px-4 py-3">
              <pre class="text-xs">{{ JSON.stringify(item.target, null, 2) }}</pre>
            </td>
            <td class="px-4 py-3">
              <span
                :class="
                  item.result === 'ok'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                "
              >
                {{ item.result }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data && data.total > limit" class="mt-4 flex gap-2">
      <BaseSecondaryButton
        :disabled="offset === 0"
        @click="offset -= limit"
      >
        {{ t('admin.auditLog.prev') }}
      </BaseSecondaryButton>
      <BaseSecondaryButton
        :disabled="offset + limit >= data.total"
        @click="offset += limit"
      >
        {{ t('admin.auditLog.next') }}
      </BaseSecondaryButton>
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();

const limit = ref(50);
const offset = ref(0);

interface AuditLogResponse {
  items: Array<{
    id: number;
    actorUserId: number | null;
    action: string;
    target: object | null;
    result: 'ok' | 'error';
    ts: string | Date;
  }>;
  total: number;
}

const { data } = useFetch<AuditLogResponse>('/api/admin/audit-log', {
  method: 'get',
  query: computed(() => ({
    limit: limit.value,
    offset: offset.value,
  })),
});

function formatDate(ts: string | Date | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}
</script>
