import { LocalShellTransport } from '../transports/local-shell';
import type { EngineType, VpnEngine } from './types';
import { MikrotikEngine } from './mikrotik';
import { WireguardEngine } from './wireguard';

const engines = new Map<EngineType, VpnEngine>();

engines.set(
  'wireguard',
  new WireguardEngine(
    new LocalShellTransport(),
    typeof WG_ENV !== 'undefined' ? WG_ENV.WG_EXECUTABLE : 'wg'
  )
);

engines.set('mikrotik', new MikrotikEngine());

export function getEngine(type: EngineType): VpnEngine {
  const engine = engines.get(type);
  if (!engine) {
    throw new Error(`Engine '${type}' is not registered`);
  }
  return engine;
}
