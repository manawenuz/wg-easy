<template>
  <BaseDialog trigger-class="inline-block">
    <template #trigger>
      <FormSecondaryActionField
        :label="t('admin.obfuscation.title')"
        class="text-sm"
      />
    </template>

    <template #title>{{ t('admin.obfuscation.title') }}</template>
    <template #description>
      {{ t('admin.obfuscation.description', { iface: interfaceName }) }}
    </template>

    <FormElement @submit.prevent="submit">
      <FormGroup>
        <FormSwitchField
          id="enabled"
          v-model="form.enabled"
          :label="t('admin.obfuscation.enabled')"
        />
      </FormGroup>

      <FormGroup v-if="form.enabled">
        <FormHeading>{{ t('admin.obfuscation.advanced') }}</FormHeading>
        <FormNumberField
          id="listenPort"
          v-model="form.listenPort"
          :label="t('admin.obfuscation.listenPort')"
          :description="t('admin.obfuscation.listenPortDesc')"
        />
        <FormNumberField
          id="wgTargetPort"
          v-model="form.wgTargetPort"
          :label="t('admin.obfuscation.wgTargetPort')"
          :description="t('admin.obfuscation.wgTargetPortDesc')"
        />
        <FormTextField
          id="key"
          v-model="form.key"
          :label="t('admin.obfuscation.key')"
          :description="t('admin.obfuscation.keyDesc')"
        />
        <FormNumberField
          id="dummyPaddingMin"
          v-model="form.dummyPaddingMin"
          :label="t('admin.obfuscation.dummyPaddingMin')"
        />
        <FormNumberField
          id="dummyPaddingMax"
          v-model="form.dummyPaddingMax"
          :label="t('admin.obfuscation.dummyPaddingMax')"
        />
      </FormGroup>

      <div class="mt-4 flex justify-end gap-2">
        <BaseSecondaryButton type="button" @click="closeDialog">
          {{ t('form.cancel') }}
        </BaseSecondaryButton>
        <BasePrimaryButton type="submit">
          {{ t('form.save') }}
        </BasePrimaryButton>
      </div>
    </FormElement>
  </BaseDialog>
</template>

<script setup lang="ts">
interface ObfuscationData {
  enabled: boolean;
  listenPort: number | null;
  wgTargetPort: number | null;
  key: string | null;
  dummyPaddingMin: number | null;
  dummyPaddingMax: number | null;
}

const props = defineProps<{
  interfaceName: string;
  routerId: number;
  initialData?: ObfuscationData | null;
}>();

const { t } = useI18n();

const form = ref({
  enabled: props.initialData?.enabled ?? false,
  listenPort: props.initialData?.listenPort ?? 51830,
  wgTargetPort: props.initialData?.wgTargetPort ?? 51820,
  key: props.initialData?.key ?? '',
  dummyPaddingMin: props.initialData?.dummyPaddingMin ?? 8,
  dummyPaddingMax: props.initialData?.dummyPaddingMax ?? 64,
});

const dialogOpen = ref(false);

function closeDialog() {
  dialogOpen.value = false;
}

async function submit() {
  const body = {
    enabled: form.value.enabled,
    listenPort: form.value.enabled ? form.value.listenPort : null,
    wgTargetPort: form.value.enabled ? form.value.wgTargetPort : null,
    key: form.value.enabled ? (form.value.key || null) : null,
    dummyPaddingMin: form.value.enabled ? form.value.dummyPaddingMin : null,
    dummyPaddingMax: form.value.enabled ? form.value.dummyPaddingMax : null,
  };

  await $fetch(`/api/admin/interface/${props.interfaceName}/obfuscation`, {
    method: 'put',
    body,
  });

  closeDialog();
  emit('saved');
}

const emit = defineEmits<{
  saved: [];
}>();
</script>
