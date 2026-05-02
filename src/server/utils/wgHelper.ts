// ! Auto Imports are not supported in this file

import { exec } from './cmd';
import { configgen } from '../engines/wireguard/configgen';

// needed to support cli
const wgExecutable =
  typeof WG_ENV !== 'undefined' ? WG_ENV.WG_EXECUTABLE : 'dev';

export const wg = {
  generateServerPeer: configgen.generateServerPeer,
  generateServerInterface: configgen.generateServerInterface,
  generateClientConfig: configgen.generateClientConfig,
  cleanClientFilename: configgen.cleanClientFilename,

  generatePrivateKey: () => {
    return exec(`${wgExecutable} genkey`);
  },

  getPublicKey: (privateKey: string) => {
    return exec(`echo ${privateKey} | ${wgExecutable} pubkey`, {
      log: `echo ***hidden*** | ${wgExecutable} pubkey`,
    });
  },

  generatePreSharedKey: () => {
    return exec(`${wgExecutable} genpsk`);
  },
};
