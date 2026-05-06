<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <AdminTrafficGroupDialog mode="create" @save="handleCreate">
        <BasePrimaryButton>
          {{ $t('admin.trafficGroups.createGroup') }}
        </BasePrimaryButton>
      </AdminTrafficGroupDialog>
    </div>

    <div v-if="loading" class="text-center py-8">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="groups.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
      {{ $t('admin.trafficGroups.noGroups') }}
    </div>

    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-neutral-600">
        <thead class="bg-gray-50 dark:bg-neutral-800">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ $t('admin.trafficGroups.name') }}
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ $t('admin.trafficGroups.speedLimits') }}
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ $t('admin.trafficGroups.quota') }}
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ $t('admin.trafficGroups.clients') }}
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ $t('admin.trafficGroups.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white dark:divide-neutral-600 dark:bg-neutral-700">
          <tr v-for="group in groups" :key="group.id">
            <td class="whitespace-nowrap px-6 py-4">
              <div class="flex items-center gap-2">
                <AdminTrafficGroupBadge
                  :name="group.name"
                  :color-light="group.colorLight"
                  :color-dark="group.colorDark"
                />
                <span v-if="group.isDefault" class="text-xs text-gray-500 dark:text-gray-400">
                  ({{ $t('admin.trafficGroups.default') }})
                </span>
              </div>
            </td>
            <td class="whitespace-nowrap px-6 py-4 text-sm">
              <span v-if="group.upKbps && group.downKbps">
                ↑ {{ group.upKbps }} Kbps / ↓ {{ group.downKbps }} Kbps
              </span>
              <span v-else class="text-gray-500 dark:text-gray-400">
                {{ $t('admin.trafficGroups.unlimited') }}
              </span>
            </td>
            <td class="whitespace-nowrap px-6 py-4 text-sm">
              <span v-if="group.quotaLimitBytes">
                {{ formatBytes(group.quotaLimitBytes) }} / {{ group.quotaPeriod }}
              </span>
              <span v-else class="text-gray-500 dark:text-gray-400">
                {{ $t('admin.trafficGroups.noQuota') }}
              </span>
            </td>
            <td class="whitespace-nowrap px-6 py-4 text-sm">
              {{ group.clientCount }}
            </td>
            <td class="whitespace-nowrap px-6 py-4 text-sm">
              <div class="flex gap-2">
                <AdminTrafficGroupDialog mode="edit" :group="group" @save="(data) => handleUpdate(group.id, data)">
                  <BaseSecondaryButton class="text-xs">
                    {{ $t('admin.trafficGroups.edit') }}
                  </BaseSecondaryButton>
                </AdminTrafficGroupDialog>
                <BaseSecondaryButton
                  v-if="!group.isDefault"
                  class="text-xs"
                  @click="handleSetDefault(group.id)"
                >
                  {{ $t('admin.trafficGroups.setDefault') }}
                </BaseSecondaryButton>
                <BaseSecondaryButton
                  v-if="!group.isDefault"
                  class="text-xs text-red-600 dark:text-red-400"
                  @click="handleDelete(group.id)"
                >
                  {{ $t('admin.trafficGroups.delete') }}
                </BaseSecondaryButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();

interface TrafficGroup {
  id: number;
  name: string;
  colorLight: string;
  colorDark: string;
  upKbps: number | null;
  downKbps: number | null;
  quotaLimitBytes: number | null;
  quotaPeriod: string | null;
  quotaAutoDisable: boolean;
  isDefault: boolean;
  clientCount: number;
}

const groups = ref<TrafficGroup[]>([]);
const loading = ref(true);

async function loadGroups() {
  loading.value = true;
  try {
    const response = await $fetch<TrafficGroup[]>('/api/admin/traffic-groups');
    groups.value = response;
  } catch (error) {
    console.error('Failed to load traffic groups:', error);
  } finally {
    loading.value = false;
  }
}

async function handleCreate(data: any) {
  try {
    await $fetch('/api/admin/traffic-groups', {
      method: 'POST',
      body: data,
    });
    await loadGroups();
  } catch (error) {
    console.error('Failed to create traffic group:', error);
  }
}

async function handleUpdate(id: number, data: any) {
  try {
    await $fetch(`/api/admin/traffic-groups/${id}`, {
      method: 'PATCH',
      body: data,
    });
    await loadGroups();
  } catch (error) {
    console.error('Failed to update traffic group:', error);
  }
}

async function handleSetDefault(id: number) {
  try {
    await $fetch(`/api/admin/traffic-groups/${id}/set-default`, {
      method: 'POST',
    });
    await loadGroups();
  } catch (error) {
    console.error('Failed to set default traffic group:', error);
  }
}

async function handleDelete(id: number) {
  if (!confirm(t('admin.trafficGroups.confirmDelete'))) {
    return;
  }

  try {
    await $fetch(`/api/admin/traffic-groups/${id}`, {
      method: 'DELETE',
    });
    await loadGroups();
  } catch (error) {
    console.error('Failed to delete traffic group:', error);
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

onMounted(() => {
  loadGroups();
});
</script>
