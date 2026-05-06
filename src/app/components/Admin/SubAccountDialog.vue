<template>
  <BaseDialog>
    <template #trigger><slot /></template>
    <template #title>
      {{ $t('admin.users.addSubAccount') }}
    </template>
    <template #description>
      <div class="flex flex-col gap-3">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ $t('admin.users.subAccountDescription') }}
          <span class="font-medium text-gray-800 dark:text-gray-200">{{ parentName }}</span>
        </p>
        <FormTextField
          id="clientName"
          v-model="clientName"
          :label="$t('client.name')"
        />
      </div>
    </template>
    <template #actions>
      <DialogClose as-child>
        <BaseSecondaryButton>{{ $t('dialog.cancel') }}</BaseSecondaryButton>
      </DialogClose>
      <DialogClose as-child>
        <BasePrimaryButton @click="handleSave">
          {{ $t('dialog.create') }}
        </BasePrimaryButton>
      </DialogClose>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
const props = defineProps<{
  parentUserId: number;
  parentName: string;
}>();

const emit = defineEmits<{
  save: [data: { name: string; userId: number }];
}>();

const clientName = ref('');

function handleSave() {
  emit('save', {
    name: clientName.value,
    userId: props.parentUserId,
  });
  clientName.value = '';
}
</script>
