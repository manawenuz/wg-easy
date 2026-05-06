<template>
  <main v-if="user && acls">
    <FormElement @submit.prevent="submit">
      <FormGroup>
        <FormHeading>{{ t('admin.users.detail') }}</FormHeading>
        <FormInfoField
          id="username"
          :label="t('admin.users.username')"
          :data="user.username"
        />
        <FormInfoField
          id="name"
          :label="t('admin.users.name')"
          :data="user.name"
        />
        <FormInfoField
          v-if="user.parentUserId"
          id="parentUser"
          :label="t('admin.users.parentUser')"
        >
          <NuxtLink
            :to="`/admin/users/${user.parentUserId}`"
            class="text-red-700 hover:underline dark:text-red-400"
          >
            {{ t('admin.users.viewParent') }}
          </NuxtLink>
        </FormInfoField>
        <div>
          <label class="mb-1 block text-sm font-medium">{{ t('admin.users.role') }}</label>
          <BaseSelect v-model="form.role" :options="roleOptions" />
        </div>
        <FormSwitchField
          id="enabled"
          v-model="form.enabled"
          :label="t('admin.users.enabled')"
        />
        <FormTextField
          id="email"
          v-model="form.email"
          :label="t('admin.users.email')"
        />
        <FormPasswordField
          id="password"
          v-model="form.password"
          :label="t('admin.users.newPassword')"
          autocomplete="new-password"
        />
      </FormGroup>

      <FormGroup v-if="user.subAccounts && user.subAccounts.length > 0">
        <FormHeading>{{ t('admin.users.subAccounts') }}</FormHeading>
        <div class="space-y-2">
          <div
            v-for="sub in user.subAccounts"
            :key="sub.id"
            class="flex items-center justify-between rounded border border-gray-200 p-3 dark:border-neutral-600"
          >
            <div>
              <div class="font-medium">{{ sub.name }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ sub.username }}</div>
            </div>
            <NuxtLink
              :to="`/admin/users/${sub.id}`"
              class="text-red-700 hover:underline dark:text-red-400"
            >
              {{ t('admin.users.edit') }}
            </NuxtLink>
          </div>
        </div>
      </FormGroup>

      <FormGroup v-if="!user.parentUserId">
        <FormHeading>{{ t('admin.users.addSubAccount') }}</FormHeading>
        <AdminSubAccountDialog
          :parent-user-id="user.id"
          :parent-name="user.name"
          @save="createSubAccount"
        >
          <BasePrimaryButton>
            {{ t('admin.users.addSubAccount') }}
          </BasePrimaryButton>
        </AdminSubAccountDialog>
      </FormGroup>

      <FormGroup>
        <FormHeading>{{ t('admin.users.acl') }}</FormHeading>
        <div class="space-y-2">
          <div
            v-for="router in acls.routers"
            :key="router.id"
            class="flex items-center gap-4"
          >
            <span class="w-32 text-sm">{{ router.name }}</span>
            <BaseSelect
              v-model="aclMap[router.id]"
              :options="[
                { label: t('admin.users.noAccess'), value: '' },
                { label: t('admin.users.read'), value: 'read' },
                { label: t('admin.users.write'), value: 'write' },
                { label: t('admin.users.admin'), value: 'admin' },
              ]"
            />
          </div>
        </div>
      </FormGroup>

      <FormGroup>
        <FormHeading>{{ t('form.actions') }}</FormHeading>
        <FormPrimaryActionField type="submit" :label="t('form.save')" />
        <FormSecondaryActionField :label="t('form.revert')" @click="revert" />
        <FormSecondaryActionField
          :label="t('admin.users.delete')"
          class="text-red-600"
          @click="deleteUser"
        />
      </FormGroup>
    </FormElement>
  </main>
</template>

<script setup lang="ts">
import { roles } from '#shared/utils/permissions';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const { data: user, refresh: refreshUser } = await useFetch(
  `/api/admin/users/${id}`,
  { method: 'get' }
);
const { data: acls, refresh: refreshAcl } = await useFetch(
  `/api/admin/users/${id}/acl`,
  { method: 'get' }
);

const form = ref({
  role: String(user.value?.role ?? roles.ADMIN),
  enabled: user.value?.enabled ?? true,
  email: user.value?.email ?? '',
  password: '',
});

const aclMap = ref<Record<number, string>>({});

watch(
  () => acls.value,
  (val) => {
    if (!val) return;
    const map: Record<number, string> = {};
    for (const r of val.routers) {
      const acl = val.acls.find((a: any) => a.routerId === r.id);
      map[r.id] = acl ? acl.permission : '';
    }
    aclMap.value = map;
  },
  { immediate: true }
);

const roleOptions = computed(() => [
  { label: 'Superadmin', value: String(roles.SUPERADMIN) },
  { label: 'Admin', value: String(roles.ADMIN) },
  { label: 'Operator', value: String(roles.OPERATOR) },
  { label: 'Viewer', value: String(roles.VIEWER) },
  { label: 'Client', value: String(roles.CLIENT) },
]);

async function submit() {
  const body: any = {};
  if (Number(form.value.role) !== user.value?.role) body.role = Number(form.value.role);
  if (form.value.enabled !== user.value?.enabled) body.enabled = form.value.enabled;
  if (form.value.email !== (user.value?.email ?? '')) body.email = form.value.email || null;
  if (form.value.password) body.password = form.value.password;

  if (Object.keys(body).length > 0) {
    await $fetch(`/api/admin/users/${id}`, { method: 'patch', body });
  }

  const aclRows = Object.entries(aclMap.value)
    .filter(([, perm]) => perm)
    .map(([routerId, permission]) => ({
      routerId: Number(routerId),
      permission: permission as 'read' | 'write' | 'admin',
    }));

  await $fetch(`/api/admin/users/${id}/acl`, {
    method: 'put',
    body: aclRows,
  });

  await refreshUser();
  await refreshAcl();
}

async function revert() {
  await refreshUser();
  await refreshAcl();
  if (user.value) {
    form.value = {
      role: String(user.value.role),
      enabled: user.value.enabled,
      email: user.value.email ?? '',
      password: '',
    };
  }
}

async function deleteUser() {
  if (!confirm(t('admin.users.deleteConfirm'))) return;
  await $fetch(`/api/admin/users/${id}`, { method: 'delete' });
  router.push('/admin/users');
}

async function createSubAccount(data: { name: string; email?: string }) {
  try {
    await $fetch(`/api/admin/users/${id}/sub-accounts`, {
      method: 'POST',
      body: data,
    });
    await refreshUser();
  } catch (error) {
    console.error('Failed to create sub-account:', error);
  }
}
</script>
