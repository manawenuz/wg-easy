import { rcompare, valid } from 'semver';

type GithubTag = {
  name: string;
  commit: {
    sha: string;
  };
};

type GithubBranch = {
  commit: {
    sha: string;
  };
};

type UpdateCandidate = {
  version: string;
  changelog: string;
  url: string;
  revision?: string;
};

const updateRepo = process.env.WG_UPDATE_REPO || 'manawenuz/wg-easy';
const updateBranch = process.env.WG_UPDATE_BRANCH || 'master';

function githubUrl(path: string) {
  return `https://api.github.com/repos/${updateRepo}/${path}`;
}

async function fetchLatestTaggedRelease(): Promise<UpdateCandidate> {
  try {
    const tags = await $fetch<GithubTag[]>(githubUrl('tags?per_page=100'), {
      method: 'get',
      timeout: 5000,
    });

    const latest = tags
      .filter((tag) => valid(tag.name))
      .sort((a, b) => rcompare(a.name, b.name))[0];

    if (!latest) {
      throw new Error('Empty Response');
    }

    return {
      version: latest.name,
      changelog: `Latest ${updateRepo} tag: ${latest.name}`,
      url: `https://github.com/${updateRepo}/tree/${latest.name}`,
      revision: latest.commit.sha,
    };
  } catch (e) {
    SERVER_DEBUG('Failed to fetch latest release tag: ', e);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch latest release tag',
    });
  }
}

async function fetchLatestEdgeCandidate(): Promise<UpdateCandidate> {
  try {
    const branch = await $fetch<GithubBranch>(
      githubUrl(`branches/${updateBranch}`),
      { method: 'get', timeout: 5000 }
    );

    if (!branch?.commit?.sha) {
      throw new Error('Empty Response');
    }

    const shortSha = branch.commit.sha.slice(0, 12);
    return {
      version: `edge-${shortSha}`,
      changelog: `Latest ${updateRepo}:${updateBranch} candidate: ${shortSha}`,
      url: `https://github.com/${updateRepo}/commit/${branch.commit.sha}`,
      revision: branch.commit.sha,
    };
  } catch (e) {
    SERVER_DEBUG('Failed to fetch latest edge candidate: ', e);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch latest edge candidate',
    });
  }
}

/**
 * Fetch latest release tag from the fork repository.
 * @cache Response is cached for 1 hour
 */
export const cachedFetchLatestRelease = cacheFunction(
  fetchLatestTaggedRelease,
  {
    expiry: 60 * 60 * 1000,
  }
);

/**
 * Fetch latest edge candidate from the fork repository.
 * @cache Response is cached for 5 minutes
 */
export const cachedFetchLatestEdgeCandidate = cacheFunction(
  fetchLatestEdgeCandidate,
  {
    expiry: 5 * 60 * 1000,
  }
);
