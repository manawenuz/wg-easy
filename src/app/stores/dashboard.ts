export type DashboardClient = {
  id: number;
  name: string;
  enabled: boolean;
  ipv4: string;
  lastHandshakeAt: string | null;
  rxBytes: number | null;
  txBytes: number | null;
  expiresAt: string | null;
  quota?: {
    limitBytes: number;
    usedBytes: number;
    period: string;
    periodEnd: Date;
  };
  speedLimit?: {
    upKbps: number;
    downKbps: number;
  };
};

export type UsageBucket = {
  ts: number;
  rxBytes: number;
  txBytes: number;
};

export const useDashboardStore = defineStore('Dashboard', () => {
  const me = ref<{
    user: { id: number; name: string; email: string | null };
    clientsCount: number;
  } | null>(null);

  const clients = ref<DashboardClient[] | null>(null);

  const usageCache = ref<
    Record<number, { range: string; buckets: UsageBucket[] }>
  >({});

  async function refreshMe() {
    const data = await $fetch('/api/dashboard/me');
    me.value = data as typeof me.value;
  }

  async function refreshClients() {
    const data = await $fetch('/api/dashboard/clients');
    clients.value = data as unknown as DashboardClient[];
  }

  async function getUsage(clientId: number, range: '24h' | '7d' | '30d') {
    const cached = usageCache.value[clientId];
    if (cached && cached.range === range) {
      return cached.buckets;
    }

    const data = await $fetch(`/api/dashboard/clients/${clientId}/usage`, {
      params: { range },
    });

    const buckets = (data as { buckets: UsageBucket[] }).buckets;
    usageCache.value[clientId] = { range, buckets };
    return buckets;
  }

  return {
    me,
    clients,
    usageCache,
    refreshMe,
    refreshClients,
    getUsage,
  };
});
