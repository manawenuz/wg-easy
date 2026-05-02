<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      badgeClass,
    ]"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { roles } from '#shared/utils/permissions';

const props = defineProps<{
  role: number;
}>();

const config: Record<
  number,
  { label: string; class: string }
> = {
  [roles.SUPERADMIN]: {
    label: 'Superadmin',
    class: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  },
  [roles.ADMIN]: {
    label: 'Admin',
    class: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  [roles.OPERATOR]: {
    label: 'Operator',
    class: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  [roles.VIEWER]: {
    label: 'Viewer',
    class: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  [roles.CLIENT]: {
    label: 'Client',
    class: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  },
};

const label = computed(() => config[props.role]?.label ?? 'Unknown');
const badgeClass = computed(() => config[props.role]?.class ?? '');
</script>
