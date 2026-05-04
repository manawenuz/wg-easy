<template>
  <!-- Transfer TX -->
  <div class="min-w-20 md:min-w-24">
    <span
      class="flex gap-1"
      :title="client.transferTx ? $t('client.totalDownload') + bytes(client.transferTx) : ''"
    >
      <IconsArrowDown class="mt-0.5 inline h-3 align-middle" />
      <div>
        <span class="text-gray-700 dark:text-neutral-200">
          {{ client.transferTxCurrent !== undefined ? bytes(client.transferTxCurrent) + '/s' : '—' }}
        </span>
        <!-- Total TX -->
        <br /><span class="font-regular text-[0.85em]">{{ client.transferTx ? bytes(client.transferTx) : '—' }}</span>
      </div>
    </span>
  </div>

  <!-- Transfer RX -->
  <div class="min-w-20 md:min-w-24">
    <span
      class="flex gap-1"
      :title="client.transferRx ? $t('client.totalUpload') + bytes(client.transferRx) : ''"
    >
      <IconsArrowUp class="mt-0.5 inline h-3 align-middle" />
      <div>
        <span class="text-gray-700 dark:text-neutral-200">
          {{ client.transferRxCurrent !== undefined ? bytes(client.transferRxCurrent) + '/s' : '—' }}
        </span>
        <!-- Total RX -->
        <br /><span class="font-regular text-[0.85em]">{{ client.transferRx ? bytes(client.transferRx) : '—' }}</span>
      </div>
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  client: LocalClient;
}>();
</script>
