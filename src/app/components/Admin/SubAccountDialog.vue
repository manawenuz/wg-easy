<template>
  <BaseDialog>
    <template #trigger><slot /></template>
    <template #title>
      {{ $t('admin.users.addSubAccount') }}
    </template>
    <template #description>
      <div class="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {{ $t('admin.users.subAccountDescription') }}
      </div>
      <FormGroup>
        <FormTextField
          id="name"
          v-model="formData.name"
          :label="$t('admin.users.name')"
        />
        <FormTextField
          id="email"
          v-model="formData.email"
          type="email"
          :label="$t('admin.users.email')"
        />
      </FormGroup>
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
  save: [data: { name: string; email?: string }];
}>();

const formData = reactive({
  name: '',
  email: '',
});

function handleSave() {
  emit('save', {
    name: formData.name,
    email: formData.email || undefined,
  });
}
</script>
