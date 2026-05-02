import type { InterfaceType } from '#db/repositories/interface/types';
import type { ClientType } from '#db/repositories/client/types';

export type EngineType = 'wireguard' | 'amneziawg' | 'boringtun' | 'mikrotik';

export type Client = Omit<ClientType, 'createdAt' | 'updatedAt'> & {
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type Hooks = {
  preUp: string;
  postUp: string;
  preDown: string;
  postDown: string;
};

export interface EngineCapabilities {
  obfuscation: 'none' | 'amneziawg-params' | 'wg-obfuscator-sidecar';
  speedLimit: 'none' | 'engine-native' | 'control-plane-fallback';
  multiPeerSync: boolean;
  livePeerStats: boolean;
}

export interface UsageSample {
  publicKey: string;
  rxBytes: bigint;
  txBytes: bigint;
  lastHandshakeAt: Date | null;
  endpoint?: string | null;
}

export interface Health {
  ok: boolean;
  details?: string;
}

export interface VpnEngine {
  readonly id: EngineType;
  readonly capabilities: EngineCapabilities;

  healthCheck(iface: InterfaceType): Promise<Health>;

  bringUp(iface: InterfaceType): Promise<void>;
  bringDown(iface: InterfaceType): Promise<void>;

  syncInterface(iface: InterfaceType, peers: Client[]): Promise<void>;

  createPeer(iface: InterfaceType, peer: Client): Promise<void>;
  updatePeer(iface: InterfaceType, peer: Client): Promise<void>;
  removePeer(iface: InterfaceType, peerPublicKey: string): Promise<void>;
  enablePeer(iface: InterfaceType, peerPublicKey: string): Promise<void>;
  disablePeer(iface: InterfaceType, peerPublicKey: string): Promise<void>;

  sampleUsage(iface: InterfaceType): Promise<UsageSample[]>;

  applySpeedLimit(
    iface: InterfaceType,
    peerPublicKey: string,
    upKbps: number,
    downKbps: number
  ): Promise<void>;
  clearSpeedLimit(iface: InterfaceType, peerPublicKey: string): Promise<void>;
}
