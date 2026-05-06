import { getEngine } from '../engines/registry';

export async function getEffectiveSpeedLimit(clientId: ID) {
  const client = await Database.clients.get(clientId);
  if (!client) {
    return null;
  }

  // Check if client has a traffic group
  if (client.trafficGroupId) {
    const group = await Database.trafficGroups.get(client.trafficGroupId);
    if (group && group.upKbps !== null && group.downKbps !== null) {
      return {
        upKbps: group.upKbps,
        downKbps: group.downKbps,
        source: 'group' as const,
      };
    }
  }

  // Fall back to per-client speed limit
  const perClientLimit = await Database.speedLimits.getByClientId(clientId);
  if (perClientLimit) {
    return {
      upKbps: perClientLimit.upKbps,
      downKbps: perClientLimit.downKbps,
      source: 'client' as const,
    };
  }

  return null;
}

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
  const engine = getEngine(iface.engineType);

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
  const engine = getEngine(iface.engineType);

  await engine.clearSpeedLimit(iface, client.publicKey);
  await Database.speedLimits.delete(clientId);
}

export async function applySpeedLimitForClient(clientId: ID) {
  const effectiveLimit = await getEffectiveSpeedLimit(clientId);
  if (!effectiveLimit) {
    return;
  }

  const client = await Database.clients.get(clientId);
  if (!client) {
    return;
  }

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);

  if (engine.capabilities.speedLimit === 'none') {
    return;
  }

  await engine.applySpeedLimit(
    iface,
    client.publicKey,
    effectiveLimit.upKbps,
    effectiveLimit.downKbps
  );
}
