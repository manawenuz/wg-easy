import { getEngine } from '../../engines/registry';

export default defineMetricsHandler('json', async () => {
  return getMetricsJSON();
});

async function getMetricsJSON() {
  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);
  const dbClients = await Database.clients.getAllPublic();
  const usage = await engine.sampleUsage(iface);

  const clients = dbClients.map((client) => {
    const sample = usage.find((s) => s.publicKey === client.publicKey);
    return {
      ...client,
      latestHandshakeAt: sample?.lastHandshakeAt ?? null,
      endpoint: sample?.endpoint ?? null,
      transferRx: sample ? Number(sample.rxBytes) : null,
      transferTx: sample ? Number(sample.txBytes) : null,
    };
  });

  let wireguardPeerCount = 0;
  let wireguardEnabledPeersCount = 0;
  let wireguardConnectedPeersCount = 0;
  for (const client of clients) {
    wireguardPeerCount++;
    if (client.enabled === true) {
      wireguardEnabledPeersCount++;
    }
    if (isPeerConnected(client)) {
      wireguardConnectedPeersCount++;
    }
  }
  return {
    wireguard_configured_peers: wireguardPeerCount,
    wireguard_enabled_peers: wireguardEnabledPeersCount,
    wireguard_connected_peers: wireguardConnectedPeersCount,
    clients: clients.map((client) => ({
      name: client.name,
      enabled: client.enabled,
      ipv4Address: client.ipv4Address,
      ipv6Address: client.ipv6Address,
      publicKey: client.publicKey,
      endpoint: client.endpoint,
      latestHandshakeAt: client.latestHandshakeAt,
      transferRx: client.transferRx,
      transferTx: client.transferTx,
    })),
  };
}
