<template>
  <main>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-xl font-semibold">{{ t('admin.users.title') }}</h2>
      <BaseDialog>
        <template #trigger>
          <BasePrimaryButton>{{ t('admin.users.invite') }}</BasePrimaryButton>
        </template>
        <template #title>{{ t('admin.users.createTitle') }}</template>
        <template #description>
          <div class="flex flex-col gap-3">
            <FormTextField
              id="username"
              v-model="newUser.username"
              :label="t('admin.users.username')"
            />
            <FormPasswordField
              id="password"
              v-model="newUser.password"
              :label="t('admin.users.password')"
              autocomplete="new-password"
            />
            <FormTextField
              id="email"
              v-model="newUser.email"
              :label="t('admin.users.email')"
            />
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('admin.users.role') }}</label>
              <BaseSelect
                v-model="newUser.role"
                :options="roleOptions"
              />
            </div>
          </div>
        </template>
        <template #actions>
          <DialogClose as-child>
            <BaseSecondaryButton>{{ t('dialog.cancel') }}</BaseSecondaryButton>
          </DialogClose>
          <DialogClose as-child>
            <BasePrimaryButton @click="createUser">{{ t('form.save') }}</BasePrimaryButton>
          </DialogClose>
        </template>
      </BaseDialog>
    </div>

    <div
      v-if="data"
      class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-600"
    >
      <table class="w-full text-left text-sm">
        <thead
          class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <tr>
            <th class="px-4 py-3">{{ t('admin.users.username') }}</th>
            <th class="px-4 py-3">{{ t('admin.users.name') }}</th>
            <th class="px-4 py-3">{{ t('admin.users.role') }}</th>
            <th class="px-4 py-3">{{ t('admin.users.status') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="u in organizedUsers" :key="u.id">
            <tr
              :class="[
                'border-b dark:border-neutral-600',
                u.isSubAccount ? 'bg-gray-50 dark:bg-neutral-800' : '',
              ]"
            >
              <td class="px-4 py-3">
                <div :class="u.isSubAccount ? 'pl-6' : ''">
                  <span v-if="u.isSubAccount" class="mr-2 text-gray-400">↳</span>
                  {{ u.username }}
                </div>
              </td>
              <td class="px-4 py-3">{{ u.name }}</td>
              <td class="px-4 py-3">
                <AdminRoleBadge :role="u.role" />
              </td>
              <td class="px-4 py-3">
                <span
                  :class="
                    u.enabled
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  "
                >
                  {{ u.enabled ? t('admin.users.enabled') : t('admin.users.disabled') }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-2">
                  <NuxtLink
                    :to="`/admin/users/${u.id}`"
                    class="text-red-700 hover:underline dark:text-red-400"
                  >
                    {{ t('admin.users.edit') }}
                  </NuxtLink>
                  <AdminSubAccountDialog
                    v-if="!u.isSubAccount && u.role === roles.CLIENT"
                    :parent-user-id="u.id"
                    :parent-name="u.name || u.username"
                    @save="(data) => createSubAccount(u.id, data)"
                  >
                    <button
                      :title="t('admin.users.addSubAccount')"
                      :aria-label="t('admin.users.addSubAccount')"
                      class="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-neutral-700"
                    >
                      <svg class="h-5 w-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </AdminSubAccountDialog>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </main>
</template>

<script setup lang="ts">
import { roles } from '#shared/utils/permissions';

const { t } = useI18n();
const toast = useToast();

const { data, refresh } = await useFetch('/api/admin/users', { method: 'get' });

const newUser = ref({
  username: '',
  password: '',
  email: '',
  role: String(roles.ADMIN),
});

const roleOptions = computed(() => [
  { label: 'Admin', value: String(roles.ADMIN) },
  { label: 'Operator', value: String(roles.OPERATOR) },
  { label: 'Viewer', value: String(roles.VIEWER) },
  { label: 'End User', value: String(roles.CLIENT) },
]);

// Organize users to show hierarchy
const organizedUsers = computed(() => {
  if (!data.value) return [];

  const users = [...data.value];
  const organized: any[] = [];

  // First add all parent users (those without parentUserId)
  const parents = users.filter((u: any) => !u.parentUserId);

  for (const parent of parents) {
    organized.push({ ...parent, isSubAccount: false });

    // Then add their sub-accounts
    const subAccounts = users.filter((u: any) => u.parentUserId === parent.id);
    for (const sub of subAccounts) {
      organized.push({ ...sub, isSubAccount: true });
    }
  }

  return organized;
});

async function createUser() {
  await $fetch('/api/admin/users', {
    method: 'post',
    body: {
      username: newUser.value.username,
      password: newUser.value.password,
      email: newUser.value.email || null,
      role: Number(newUser.value.role),
    },
  });
  newUser.value = { username: '', password: '', email: '', role: String(roles.ADMIN) };
  await refresh();
}

async function createSubAccount(_parentId: number, data: { name: string; userId: number }) {
  try {
    await $fetch('/api/client', {
      method: 'POST',
      body: { name: data.name, userId: data.userId, expiresAt: null },
    });
    toast.showToast({ type: 'success', message: t('client.created') });
    await refresh();
  } catch (error: any) {
    const msg = error?.data?.message || error?.statusMessage || error?.message || 'Unknown error';
    toast.showToast({ type: 'error', message: msg });
  }
}
</script>
