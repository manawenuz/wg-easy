import { getEngine } from '../engines/registry';

export async function setSpeedLimit(
  clientId: ID,
  upKbps: number,
  downKbps: number
) {
  const client = await Database.clients.get(clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  const iface = await Database.interfaces.get();
  const engine = getEngine('wireguard');

  if (engine.capabilities.speedLimit === 'none') {
    throw new Error('Speed limits are not supported by this engine');
  }

  // Treat all-zero as clear
  if (upKbps === 0 && downKbps === 0) {
    await clearSpeedLimit(clientId);
    return null;
  }

  await Database.speedLimits.upsert({ clientId, upKbps, downKbps });
  await engine.applySpeedLimit(iface, client.publicKey, upKbps, downKbps);

  return Database.speedLimits.getByClientId(clientId);
}

export async function clearSpeedLimit(clientId: ID) {
  const client = await Database.clients.get(clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  const iface = await Database.interfaces.get();
  const engine = getEngine('wireguard');

  await engine.clearSpeedLimit(iface, client.publicKey);
  await Database.speedLimits.delete(clientId);
}
