<template>
  <main>
    <FormElement>
      <FormGroup>
        <FormHeading>{{ t('admin.bootstrap.title') }}</FormHeading>
        <FormInfoField
          id="routerName"
          :label="t('general.name')"
          :data="routerData?.name ?? ''"
        />
      </FormGroup>
    </FormElement>

    <div class="mt-6">
      <RoutersBootstrapWizard v-if="routerData" :router="routerData" />
    </div>
  </main>
</template>

<script setup lang="ts">
const { t } = useI18n();
const route = useRoute();
const id = Number(route.params.id);

interface RouterItem {
  id: number;
  name: string;
  host: string | null;
  port: number | null;
  engineType: string;
  transport: string;
  enabled: boolean;
}

const { data: routerList } = await useFetch<RouterItem[]>(`/api/admin/router`, {
  method: 'get',
});

const routerData = computed(() => {
  if (!routerList.value) return null;
  return routerList.value.find((r) => r.id === id) ?? null;
});
</script>
