<template>
  <div class="flex flex-col gap-3">
    <div class="relative aspect-square w-full overflow-hidden rounded bg-black">
      <video
        ref="videoRef"
        class="h-full w-full object-cover"
        autoplay
        playsinline
        muted
      />
      <div
        v-if="!hasCamera"
        class="absolute inset-0 flex items-center justify-center bg-neutral-800 text-center text-sm text-neutral-300"
      >
        {{ $t('dashboard.cameraUnavailable') }}
      </div>
    </div>
    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import QrScanner from 'qr-scanner';

const emit = defineEmits<{ scan: [privateKey: string] }>();

const videoRef = ref<HTMLVideoElement | null>(null);
const hasCamera = ref(true);
const error = ref('');
let scanner: QrScanner | null = null;

function extractPrivateKey(text: string): string | null {
  const match = text.match(/^PrivateKey\s*=\s*([A-Za-z0-9+/=]+)$/m);
  return match?.[1] ?? null;
}

onMounted(async () => {
  if (!videoRef.value) return;

  try {
    scanner = new QrScanner(
      videoRef.value,
      (result) => {
        const privateKey = extractPrivateKey(result.data);
        if (privateKey) {
          scanner?.stop();
          emit('scan', privateKey);
        }
      },
      { returnDetailedScanResult: true }
    );

    await scanner.start();
  } catch {
    hasCamera.value = false;
    error.value = 'Camera access denied. Please use the paste-config option.';
  }
});

onBeforeUnmount(() => {
  scanner?.destroy();
});
</script>
