import { LocalShellTransport } from '../transports/local-shell';
import type { EngineType, VpnEngine } from './types';
import { MikrotikEngine } from './mikrotik';
import { WireguardEngine } from './wireguard';
import { AmneziaWgEngine } from './amneziawg';
import { BoringtunEngine } from './boringtun';
import type { InterfaceType } from '#db/repositories/interface/types';

const engines = new Map<EngineType, VpnEngine>();

engines.set('wireguard', new WireguardEngine(new LocalShellTransport()));
engines.set('amneziawg', new AmneziaWgEngine(new LocalShellTransport()));
engines.set('boringtun', new BoringtunEngine(new LocalShellTransport()));
engines.set('mikrotik', new MikrotikEngine());

export function getEngine(type: EngineType): VpnEngine {
  const engine = engines.get(type);
  if (!engine) {
    throw new Error(`Engine '${type}' is not registered`);
  }
  return engine;
}

export function getEngineForInterface(iface: InterfaceType): VpnEngine {
  return getEngine(iface.engineType);
}
