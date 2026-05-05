<template>
  <BaseDialog :trigger-class="triggerClass">
    <template #trigger>
      <slot />
    </template>
    <template #title>
      {{ $t('client.new') }}
    </template>
    <template #description>
      <div class="flex flex-col gap-3">
        <FormTextField id="name" v-model="name" :label="$t('client.name')" />
        <FormDateField
          id="expiresAt"
          v-model="expiresAt"
          :label="$t('client.expireDate')"
        />
      </div>
    </template>
    <template #actions>
      <DialogClose as-child>
        <BaseSecondaryButton>{{ $t('dialog.cancel') }}</BaseSecondaryButton>
      </DialogClose>
      <DialogClose as-child>
        <BasePrimaryButton @click="createClient">
          {{ $t('client.create') }}
        </BasePrimaryButton>
      </DialogClose>
    </template>
  </BaseDialog>
</template>

<script lang="ts" setup>
// Owner picker (existing/new end-user) is deferred — see PRD-60-05 follow-up.
// The server auto-creates an end-user named after the client when no owner
// is supplied, so a name-only form is enough to get a working peer.

const name = ref<string>('');
const expiresAt = ref<string | null>(null);
const clientsStore = useClientsStore();
const { t } = useI18n();

defineProps<{ triggerClass?: string }>();

function createClient() {
  return _createClient({ name: name.value, expiresAt: expiresAt.value });
}

const _createClient = useSubmit(
  '/api/client',
  { method: 'post' },
  {
    revert: () => clientsStore.refresh(),
    successMsg: t('client.created'),
  }
);
</script>
