<template>
  <div>
    <header
      class="mx-auto my-4 flex max-w-3xl flex-col justify-center max-md:px-3"
    >
      <div class="mb-5 flex w-full items-center justify-between">
        <NuxtLink
          to="/dashboard"
          class="text-xl font-bold text-gray-700 dark:text-neutral-200"
        >
          {{ $t('pages.dashboard') }}
        </NuxtLink>
        <div class="flex flex-row items-center gap-3">
          <span
            v-if="authStore.userData"
            class="text-sm text-gray-500 dark:text-neutral-400"
          >
            {{ authStore.userData.name }}
          </span>
          <button
            class="rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-red-800 hover:text-white dark:bg-neutral-600 dark:text-neutral-200 dark:hover:bg-red-800 dark:hover:text-white"
            @click="logout"
          >
            {{ $t('general.logout') }}
          </button>
        </div>
      </div>
    </header>
    <slot />
  </div>
</template>

<script setup lang="ts">
const authStore = useAuthStore();
const toast = useToast();
const route = useRoute();

onMounted(() => {
  if (route.query.toast === 'no-permission') {
    toast.showToast({
      type: 'error',
      message: 'Not allowed to access Admin Panel',
    });
    // Remove query param without navigation
    const newQuery = { ...route.query };
    delete newQuery.toast;
    window.history.replaceState({}, '', route.path);
  }
});

const _logout = useSubmit(
  '/api/session',
  {
    method: 'delete',
  },
  {
    revert: async () => {},
    noSuccessToast: true,
  }
);

async function logout() {
  authStore.userData = null;
  authStore.principal = null;
  await _logout(undefined);
  await navigateTo('/dashboard/login', { replace: true });
}
</script>
