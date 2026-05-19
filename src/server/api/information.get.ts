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
  const isEdgeBuild = WG_BUILD.CHANNEL === 'edge';
  const latestRelease = isEdgeBuild
    ? await cachedFetchLatestEdgeCandidate()
    : await cachedFetchLatestRelease();
  const updateAvailable = isEdgeBuild
    ? !!WG_BUILD.REVISION && latestRelease.revision !== WG_BUILD.REVISION
    : gt(latestRelease.version, RELEASE);
  const insecure = WG_ENV.INSECURE;
  const awgAvailable = await isAwgAvailable();
  const wgInterface = await Database.interfaces.get();

  return {
    currentRelease: RELEASE,
    currentBuild: {
      channel: WG_BUILD.CHANNEL,
      revision: WG_BUILD.REVISION,
      imageRepository: WG_BUILD.IMAGE_REPOSITORY,
      updateRepo: WG_BUILD.UPDATE_REPO,
      updateBranch: WG_BUILD.UPDATE_BRANCH,
    },
    latestRelease: latestRelease,
    updateAvailable,
    insecure,
    isAwg: awgAvailable, // backwards compat
    awgAvailable,
    firewallEnabled: wgInterface.firewallEnabled,
  };
});
