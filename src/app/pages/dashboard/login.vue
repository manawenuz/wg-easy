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

      <div class="flex border-b border-gray-200 dark:border-neutral-600">
        <button
          class="flex-1 pb-2 text-sm font-medium transition"
          :class="{
            'border-b-2 border-red-800 text-red-800 dark:border-red-400 dark:text-red-400':
              activeTab === 'qr',
            'text-gray-500 dark:text-neutral-400': activeTab !== 'qr',
          }"
          @click="activeTab = 'qr'"
        >
          {{ $t('dashboard.scanQr') }}
        </button>
        <button
          class="flex-1 pb-2 text-sm font-medium transition"
          :class="{
            'border-b-2 border-red-800 text-red-800 dark:border-red-400 dark:text-red-400':
              activeTab === 'paste',
            'text-gray-500 dark:text-neutral-400': activeTab !== 'paste',
          }"
          @click="activeTab = 'paste'"
        >
          {{ $t('dashboard.pasteConfig') }}
        </button>
      </div>

      <DashboardQrLogin
        v-if="activeTab === 'qr'"
        @scan="handleLogin"
      />
      <DashboardPasteConfigLogin
        v-else
        @submit="handleLogin"
      />

      <div v-if="authenticating" class="text-center">
        <IconsLoading class="mx-auto w-5 animate-spin" />
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import nacl from 'tweetnacl';

const { t } = useI18n();

const activeTab = ref<'qr' | 'paste'>('qr');
const authenticating = ref(false);

function decodeBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function handleLogin(privateKey: string) {
  if (authenticating.value) return;
  authenticating.value = true;

  try {
    const privateKeyBytes = decodeBase64(privateKey);
    const publicKeyBytes = nacl.scalarMult.base(privateKeyBytes);
    const publicKeyBase64 = encodeBase64(publicKeyBytes);

    const challengeRes = await $fetch('/api/dashboard/login/challenge', {
      method: 'POST',
      body: { publicKey: publicKeyBase64 },
    });

    const nonceBytes = decodeBase64(challengeRes.nonce);
    const serverPublicKeyBytes = decodeBase64(challengeRes.serverPublicKey);
    const sharedSecret = nacl.scalarMult(
      privateKeyBytes,
      serverPublicKeyBytes
    );

    const message = new Uint8Array(nonceBytes.length + sharedSecret.length);
    message.set(nonceBytes);
    message.set(sharedSecret, nonceBytes.length);
    const signature = nacl.hash(message);

    await $fetch('/api/dashboard/login/verify', {
      method: 'POST',
      body: {
        challengeId: challengeRes.challengeId,
        signature: encodeBase64(signature),
      },
    });

    await navigateTo('/dashboard');
  } catch (e) {
    const fetchError = e as { data?: { message?: string } };
    const toast = useToast();
    toast.showToast({
      type: 'error',
      message: fetchError.data?.message || t('toast.unknown'),
    });
  } finally {
    authenticating.value = false;
  }
}

useHead({
  title: t('dashboard.loginTitle'),
});

definePageMeta({
  layout: false,
});
</script>
