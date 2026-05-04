<template>
  <main>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-xl font-semibold">{{ t('admin.routers.title') }}</h2>
      <BaseDialog>
        <template #trigger>
          <BasePrimaryButton>{{ t('admin.routers.add') }}</BasePrimaryButton>
        </template>
        <template #title>{{ t('admin.routers.createTitle') }}</template>
        <template #description>
          <div class="flex flex-col gap-3">
            <FormTextField
              id="name"
              v-model="newRouter.name"
              :label="t('general.name')"
            />
            <FormTextField
              id="host"
              v-model="newRouter.host"
              :label="t('general.host')"
            />
            <FormNumberField
              id="port"
              v-model="newRouter.port"
              :label="t('general.port')"
            />
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('admin.routers.engineType') }}</label>
              <BaseSelect
                v-model="newRouter.engineType"
                :options="engineOptions"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('admin.routers.transport') }}</label>
              <BaseSelect
                v-model="newRouter.transport"
                :options="transportOptions"
              />
            </div>
            <FormTextField
              id="apiUser"
              v-model="newRouter.apiUser"
              :label="t('admin.routers.apiUser')"
            />
            <FormPasswordField
              id="apiPassword"
              v-model="newRouter.apiPassword"
              :label="t('admin.routers.apiPassword')"
              autocomplete="new-password"
            />
            <template v-if="newRouter.transport === 'ssh'">
              <FormTextField
                id="sshUser"
                v-model="newRouter.sshUser"
                :label="t('admin.routers.sshUser')"
              />
              <FormTextField
                id="sshKey"
                v-model="newRouter.sshKey"
                :label="t('admin.routers.sshKey')"
              />
              <FormPasswordField
                id="sshPassphrase"
                v-model="newRouter.sshPassphrase"
                :label="t('admin.routers.sshPassphrase')"
                autocomplete="new-password"
              />
            </template>
          </div>
        </template>
        <template #actions>
          <DialogClose as-child>
            <BaseSecondaryButton>{{ t('dialog.cancel') }}</BaseSecondaryButton>
          </DialogClose>
          <DialogClose as-child>
            <BasePrimaryButton @click="createRouter">{{ t('form.save') }}</BasePrimaryButton>
          </DialogClose>
        </template>
      </BaseDialog>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="pending"
      class="animate-pulse overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <div class="h-10 bg-gray-50 dark:bg-neutral-800" />
      <div class="divide-y divide-gray-100 dark:divide-neutral-600">
        <div v-for="n in 3" :key="n" class="h-12 bg-white dark:bg-neutral-700" />
      </div>
    </div>

    <div
      v-else-if="data && data.length > 0"
      class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <table class="w-full text-left text-sm">
        <thead
          class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <tr>
            <th class="px-4 py-3">{{ t('general.name') }}</th>
            <th class="px-4 py-3">{{ t('general.host') }}</th>
            <th class="px-4 py-3">{{ t('general.port') }}</th>
            <th class="px-4 py-3">{{ t('admin.routers.engineType') }}</th>
            <th class="px-4 py-3">{{ t('admin.routers.status') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in data"
            :key="r.id"
            class="border-b dark:border-neutral-600"
          >
            <td class="px-4 py-3">{{ r.name }}</td>
            <td class="px-4 py-3">{{ r.host }}</td>
            <td class="px-4 py-3">{{ r.port }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1.5">
                {{ r.engineType }}
                <span
                  v-if="r.dockerized"
                  class="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                >
                  <IconsDocker class="size-2.5" />
                  {{ t('admin.interface.dockerized') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3">
              <span
                :class="
                  r.enabled
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                "
              >
                {{ r.enabled ? t('admin.routers.enabled') : t('admin.routers.disabled') }}
              </span>
            </td>
            <td class="px-4 py-3">
              <NuxtLink
                :to="`/admin/routers/${r.id}`"
                class="text-red-700 hover:underline dark:text-red-400"
              >
                {{ t('admin.routers.edit') }}
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-else
      class="rounded-lg border border-gray-200 p-8 text-center text-gray-500 dark:border-neutral-600 dark:text-neutral-400"
    >
      <p>{{ t('admin.routers.noRouters') }}</p>
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();
const toast = useToast();

interface RouterItem {
  id: number;
  name: string;
  host: string | null;
  port: number | null;
  engineType: string;
  transport: string;
  enabled: boolean;
}

const { data, refresh, pending, error } = await useFetch<RouterItem[]>('/api/admin/router', { method: 'get' });

watch(error, (err) => {
  if (err) {
    toast.showToast({
      type: 'error',
      message: err.statusMessage || t('admin.routers.loadError'),
    });
  }
});

const newRouter = ref({
  name: '',
  host: '',
  port: 8728,
  engineType: 'mikrotik',
  transport: 'routeros-api',
  apiUser: '',
  apiPassword: '',
  sshUser: '',
  sshKey: '',
  sshPassphrase: '',
});

const engineOptions = computed(() => [
  { label: 'MikroTik', value: 'mikrotik' },
]);

const transportOptions = computed(() => [
  { label: 'RouterOS API', value: 'routeros-api' },
  { label: 'SSH', value: 'ssh' },
]);

async function createRouter() {
  try {
    await $fetch('/api/admin/router', {
      method: 'post',
      body: {
        name: newRouter.value.name,
        host: newRouter.value.host || null,
        port: newRouter.value.port,
        engineType: newRouter.value.engineType,
        transport: newRouter.value.transport,
        credentials: {
          apiUser: newRouter.value.apiUser,
          apiPassword: newRouter.value.apiPassword,
          sshUser: newRouter.value.sshUser || undefined,
          sshKey: newRouter.value.sshKey || undefined,
          sshPassphrase: newRouter.value.sshPassphrase || undefined,
        },
      },
    });
    toast.showToast({
      type: 'success',
      message: t('admin.routers.createSuccess'),
    });
    newRouter.value = {
      name: '',
      host: '',
      port: 8728,
      engineType: 'mikrotik',
      transport: 'routeros-api',
      apiUser: '',
      apiPassword: '',
      sshUser: '',
      sshKey: '',
      sshPassphrase: '',
    };
    await refresh();
  } catch (e: any) {
    const message = e?.data?.message || e?.message || t('admin.routers.createError');
    toast.showToast({
      type: 'error',
      message,
    });
  }
}
</script>
