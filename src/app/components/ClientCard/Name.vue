<template>
  <div class="flex items-center gap-2">
    <div
      class="break-all text-sm text-gray-700 md:text-base dark:text-neutral-200"
      :title="$t('client.createdOn') + $d(new Date(client.createdAt))"
    >
      {{ client.name }}
    </div>
    <AdminTrafficGroupBadge
      v-if="client.trafficGroup"
      :name="client.trafficGroup.name"
      :color-light="client.trafficGroup.colorLight"
      :color-dark="client.trafficGroup.colorDark"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  client: LocalClient;
}>();
</script>
