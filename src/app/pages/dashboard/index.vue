<template>
  <main>
    <Panel>
      <PanelHead>
        <PanelHeadTitle>
          {{ $t('pages.dashboard') }}
        </PanelHeadTitle>
      </PanelHead>

      <div v-if="dashboardStore.clients && dashboardStore.clients.length > 0">
        <div
          v-for="client in dashboardStore.clients"
          :key="client.id"
          class="relative overflow-hidden border-b border-solid border-gray-100 last:border-b-0 dark:border-neutral-600"
        >
          <div
            class="flex flex-col justify-between gap-3 px-3 py-3 sm:flex-row md:py-5"
          >
            <div class="flex w-full items-center gap-3 md:gap-4">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-500 dark:bg-neutral-600 dark:text-neutral-300"
              >
                {{ client.name.charAt(0).toUpperCase() }}
              </div>
              <div class="flex w-full flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ client.name }}</span>
                  <span
                    v-if="!client.enabled"
                    class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-neutral-600 dark:text-neutral-300"
                  >
                    {{ $t('client.disabled') }}
                  </span>
                  <span
                    v-else-if="client.lastHandshakeAt"
                    class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300"
                  >
                    {{ $t('client.connected') }}
                  </span>
                  <span
                    v-else
                    class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-neutral-600 dark:text-neutral-300"
                  >
                    {{ $t('client.disconnected') }}
                  </span>
                </div>
                <div
                  class="flex flex-col text-xs text-gray-500 dark:text-neutral-400"
                >
                  <div>{{ client.ipv4 }}</div>
                  <div v-if="client.lastHandshakeAt">
                    {{ $t('client.lastSeen') }}
                    {{ timeago(new Date(client.lastHandshakeAt)) }}
                  </div>
                  <div v-if="client.expiresAt">
                    {{ $t('client.expires') }}
                    {{ new Date(client.expiresAt).toLocaleDateString() }}
                  </div>
                </div>
                <div
                  v-if="client.quota"
                  class="mt-1 flex items-center gap-2"
                >
                  <div
                    class="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-600"
                  >
                    <div
                      class="h-full rounded-full bg-red-800 transition-all"
                      :style="{
                        width: `${Math.min(100, (client.quota.usedBytes / client.quota.limitBytes) * 100)}%`,
                      }"
                    />
                  </div>
                  <span class="text-xs text-gray-500 dark:text-neutral-400">
                    {{ bytes(client.quota.usedBytes) }} /
                    {{ bytes(client.quota.limitBytes) }}
                  </span>
                </div>
                <div
                  v-if="client.speedLimit && (client.speedLimit.upKbps > 0 || client.speedLimit.downKbps > 0)"
                  class="flex items-center gap-1"
                >
                  <span
                    class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  >
                    ↓ {{ formatKbps(client.speedLimit.downKbps) }}
                  </span>
                  <span
                    class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  >
                    ↑ {{ formatKbps(client.speedLimit.upKbps) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2">
              <NuxtLink
                :to="`/dashboard/clients/${client.id}`"
                class="rounded bg-gray-100 p-2 align-middle transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-300 dark:hover:bg-red-800 dark:hover:text-white"
                :title="$t('client.details')"
              >
                <IconsInfo class="w-5" />
              </NuxtLink>
              <a
                :href="`/api/dashboard/clients/${client.id}/configuration`"
                download
                class="inline-block rounded bg-gray-100 p-2 align-middle transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-300 dark:hover:bg-red-800 dark:hover:text-white"
                :title="$t('client.downloadConfig')"
              >
                <IconsDownload class="w-5" />
              </a>
              <ClientsQRCodeDialog
                :qr-code="`/api/dashboard/clients/${client.id}/qrcode.svg`"
              >
                <div
                  class="rounded bg-gray-100 p-2 align-middle transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-300 dark:hover:bg-red-800 dark:hover:text-white"
                  :title="$t('client.showQR')"
                >
                  <IconsQRCode class="w-5" />
                </div>
              </ClientsQRCodeDialog>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="
          dashboardStore.clients && dashboardStore.clients.length === 0
        "
        class="p-8 text-center text-gray-500 dark:text-neutral-400"
      >
        <p>{{ $t('dashboard.noClients') }}</p>
        <p class="mt-2 text-sm">{{ $t('dashboard.contactAdmin') }}</p>
      </div>

      <!-- Loading skeleton -->
      <div v-else class="divide-y divide-gray-100 dark:divide-neutral-600">
        <div
          v-for="n in 3"
          :key="n"
          class="flex animate-pulse items-center gap-3 px-3 py-3 md:py-5"
        >
          <div class="h-10 w-10 shrink-0 rounded-full bg-gray-200 dark:bg-neutral-600" />
          <div class="flex w-full flex-col gap-2">
            <div class="h-4 w-1/3 rounded bg-gray-200 dark:bg-neutral-600" />
            <div class="h-3 w-1/2 rounded bg-gray-200 dark:bg-neutral-600" />
          </div>
        </div>
      </div>
    </Panel>
  </main>
</template>

<script setup lang="ts">
import { format as timeago } from 'timeago.js';

function formatKbps(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  const kbytes = kbps / 8;
  if (kbytes >= 1024) return `${(kbytes / 1024).toFixed(1)} MB/s (${kbps} kbps)`;
  return `${kbytes.toFixed(1)} KB/s (${kbps} kbps)`;
}

const dashboardStore = useDashboardStore();

dashboardStore.refreshClients();

useHead({
  title: 'Dashboard',
});

definePageMeta({
  layout: 'dashboard',
});
</script>
