<template>
  <div class="mt-2 flex flex-wrap gap-1.5">
    <span
      v-if="capabilities.obfuscation !== 'none'"
      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-neutral-600 dark:text-neutral-300"
    >
      {{ $t('admin.obfuscation.title') }}
    </span>
    <span
      v-if="capabilities.speedLimit !== 'none'"
      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-neutral-600 dark:text-neutral-300"
    >
      Speed Limit
    </span>
    <span
      v-if="capabilities.multiPeerSync"
      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-neutral-600 dark:text-neutral-300"
    >
      Multi-peer sync
    </span>
    <span
      v-if="capabilities.livePeerStats"
      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-neutral-600 dark:text-neutral-300"
    >
      Live stats
    </span>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  capabilities: {
    obfuscation: string;
    speedLimit: string;
    multiPeerSync: boolean;
    livePeerStats: boolean;
  };
}>();
</script>
