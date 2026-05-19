import type { Client, VpnEngine } from '../engines/types';
import type { InterfaceType } from '#db/repositories/interface/types';

/**
 * Attempts syncInterface inline. On failure, enqueues a pending mutation
 * and returns { queued: true } instead of throwing.
 */
export async function syncOrEnqueue(
  engine: VpnEngine,
  iface: InterfaceType,
  clients: Client[],
  clientId?: number
): Promise<{ queued: boolean }> {
  try {
    await engine.syncInterface(iface, clients);
    return { queued: false };
  } catch {
    await Database.pendingMutations.enqueue(
      iface.name,
      'syncInterface',
      {},
      clientId
    );
    return { queued: true };
  }
}
