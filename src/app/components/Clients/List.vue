<template>
  <div
    v-for="group in groupedClients"
    :key="group.userId ?? `c-${group.clients[0]?.id}`"
    class="border-b border-solid border-gray-100 last:border-b-0 dark:border-neutral-600"
  >
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
      <ClientCard :client="client" />
    </div>
  </div>
</template>

<script setup lang="ts">
const clientsStore = useClientsStore();

const groupedClients = computed(() => {
  const list = clientsStore.clients ?? [];
  const groups = new Map<string, { userId: number | null; clients: typeof list }>();
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
  }
  return Array.from(groups.values()).sort((a, b) => a.clients[0]!.id - b.clients[0]!.id);
});
</script>
