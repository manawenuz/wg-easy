<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white',
      colorMode === 'dark' ? colorDark : colorLight,
    ]"
  >
    {{ name }}
  </span>
</template>

<script setup lang="ts">
const colorMode = useColorMode();

defineProps<{
  name: string;
  colorLight: string;
  colorDark: string;
}>();
</script>
