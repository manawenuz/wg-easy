import { getEngine } from '../engines/registry';
import { quotaService } from '../services/quotaService';

export async function runUsagePoller() {
  const engine = getEngine('wireguard');
  const iface = await Database.interfaces.get();
  const samples = await engine.sampleUsage(iface);
  const clients = await Database.clients.getAll();

  for (const sample of samples) {
    const client = clients.find((c) => c.publicKey === sample.publicKey);
    if (!client) continue;

    const lastSample = await quotaService.getLastUsageSample(client.id);

    let rxDelta = Number(sample.rxBytes);
    let txDelta = Number(sample.txBytes);

    if (lastSample) {
      const lastRx = lastSample.rxBytes;
      const lastTx = lastSample.txBytes;

      rxDelta = Number(sample.rxBytes) - lastRx;
      txDelta = Number(sample.txBytes) - lastTx;

      // Counter reset detection
      if (rxDelta < 0) rxDelta = Number(sample.rxBytes);
      if (txDelta < 0) txDelta = Number(sample.txBytes);
    }

    if (rxDelta > 0 || txDelta > 0) {
      await quotaService.insertUsageSample(
        client.id,
        Number(sample.rxBytes),
        Number(sample.txBytes)
      );

      const quota = await quotaService.getQuota(client.id);
      if (quota) {
        await quotaService.addUsage(client.id, rxDelta, txDelta);
      }
    }
  }
}
