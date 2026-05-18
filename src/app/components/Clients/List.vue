<template>
  <div
    v-for="group in groupedClients"
    :key="group.userId ?? `c-${group.clients[0]?.id}`"
    class="border-b border-solid border-gray-100 last:border-b-0 dark:border-neutral-600"
  >
    <div
      v-if="group.quota"
      class="px-3 pt-3 sm:px-5"
    >
      <ClientsQuotaProgress
        :used-bytes="group.quota.usedBytes"
        :limit-bytes="group.quota.limitBytes"
        :period="group.quota.period"
        :period-end="group.quota.periodEnd"
      />
    </div>
    <div
      v-for="(client, idx) in group.clients"
      :key="client.id"
      :class="[
        'relative overflow-hidden',
        idx > 0
          ? 'border-t border-dashed border-gray-100 pl-4 sm:pl-8 dark:border-neutral-700'
          : '',
      ]"
    >
      <div v-if="idx > 0" class="pointer-events-none absolute left-2 top-0 hidden h-full items-center sm:flex">
        <span class="text-xs text-gray-400 dark:text-neutral-500">↳</span>
      </div>
      <ClientCard :client="client" :show-quota="!group.quota" />
    </div>
  </div>
</template>

<script setup lang="ts">
const clientsStore = useClientsStore();

const groupedClients = computed(() => {
  const list = clientsStore.clients ?? [];
  const groups = new Map<string, { userId: number | null; clients: typeof list; quota?: typeof list[number]['quota'] }>();
  for (const c of list) {
    const key = c.userId != null ? `u-${c.userId}` : `c-${c.id}`;
    if (!groups.has(key)) {
      groups.set(key, { userId: c.userId ?? null, clients: [] });
    }
    groups.get(key)!.clients.push(c);
  }
  // Stable order: by first client's id within each group
  for (const g of groups.values()) {
    g.clients.sort((a, b) => a.id - b.id);
    // Use the first client's quota as the group quota
    const firstWithQuota = g.clients.find((c) => c.quota);
    if (firstWithQuota?.quota) {
      g.quota = firstWithQuota.quota;
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.clients[0]!.id - b.clients[0]!.id);
});
</script>
