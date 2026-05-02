<template>
  <div class="flex flex-col gap-3">
    <BaseTextArea
      v-model="configText"
      :placeholder="$t('dashboard.pasteConfigPlaceholder')"
      rows="8"
    />
    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
    <button
      class="rounded py-2 text-sm text-white shadow transition"
      :class="{
        'cursor-pointer bg-red-800 hover:bg-red-700 dark:bg-red-800 dark:hover:bg-red-700':
          configText.trim(),
        'cursor-not-allowed bg-gray-200 dark:bg-neutral-800':
          !configText.trim(),
      }"
      @click="submit"
    >
      {{ $t('dashboard.signIn') }}
    </button>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ submit: [privateKey: string] }>();

const configText = ref('');
const error = ref('');

function extractPrivateKey(text: string): string | null {
  const match = text.match(/^PrivateKey\s*=\s*([A-Za-z0-9+/=]+)$/m);
  return match?.[1] ?? null;
}

function submit() {
  error.value = '';
  if (!configText.value.trim()) return;

  const privateKey = extractPrivateKey(configText.value);
  if (!privateKey) {
    error.value = 'Could not find PrivateKey in config.';
    return;
  }

  emit('submit', privateKey);
}
</script>
