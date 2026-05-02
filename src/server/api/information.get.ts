import { gt } from 'semver';
import { exec } from '../utils/cmd';

async function isAwgAvailable(): Promise<boolean> {
  try {
    await exec('which awg', { log: false });
    return true;
  } catch {
    return false;
  }
}

export default defineEventHandler(async () => {
  const latestRelease = await cachedFetchLatestRelease();
  const updateAvailable = gt(latestRelease.version, RELEASE);
  const insecure = WG_ENV.INSECURE;
  const awgAvailable = await isAwgAvailable();
  const wgInterface = await Database.interfaces.get();

  return {
    currentRelease: RELEASE,
    latestRelease: latestRelease,
    updateAvailable,
    insecure,
    isAwg: awgAvailable, // backwards compat
    awgAvailable,
    firewallEnabled: wgInterface.firewallEnabled,
  };
});
