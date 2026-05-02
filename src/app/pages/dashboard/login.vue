<template>
  <main>
    <UiBanner />
    <div
      class="mx-auto mt-10 flex w-80 flex-col gap-5 overflow-hidden rounded-md bg-white p-5 text-gray-700 shadow dark:bg-neutral-700 dark:text-neutral-200"
    >
      <div class="text-center">
        <h1 class="text-lg font-semibold">{{ $t('dashboard.loginTitle') }}</h1>
        <p class="mt-2 text-sm text-gray-500 dark:text-neutral-400">
          {{ $t('dashboard.loginDesc') }}
        </p>
      </div>

      <BaseTextArea
        v-model="publicKey"
        :placeholder="$t('dashboard.publicKeyPlaceholder')"
        rows="3"
      />

      <button
        class="rounded py-2 text-sm text-white shadow transition"
        :class="{
          'cursor-pointer bg-red-800 hover:bg-red-700 dark:bg-red-800 dark:hover:bg-red-700':
            publicKey.trim(),
          'cursor-not-allowed bg-gray-200 dark:bg-neutral-800':
            !publicKey.trim(),
        }"
        @click="submit"
      >
        <IconsLoading v-if="authenticating" class="mx-auto w-5 animate-spin" />
        <span v-else>{{ $t('dashboard.signIn') }}</span>
      </button>
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();

const authenticating = ref(false);
const publicKey = ref('');

const _submit = useSubmit(
  '/api/user-session',
  {
    method: 'post',
  },
  {
    revert: async (success) => {
      authenticating.value = false;
      if (success) {
        await navigateTo('/dashboard');
      } else {
        publicKey.value = '';
      }
    },
    noSuccessToast: true,
  }
);

function submit() {
  if (!publicKey.value.trim() || authenticating.value) return;

  authenticating.value = true;
  return _submit({ publicKey: publicKey.value.trim() });
}

useHead({
  title: t('dashboard.loginTitle'),
});

definePageMeta({
  layout: false,
});
</script>
