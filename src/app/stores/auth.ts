import type { H3Event } from 'h3';
import type { SharedPublicUser } from '~~/shared/utils/permissions';
import type { Principal } from '~~/server/utils/principal';

export const useAuthStore = defineStore('Auth', () => {
  // userData.role is the EFFECTIVE role returned by /api/session, which already
  // demotes dashboard user sessions to CLIENT regardless of the underlying
  // user row's role. Never trust the raw user.role for UI gating.
  const userData = useState<SharedPublicUser | null>('user-data', () => null);
  const principal = useState<Principal | null>('principal', () => null);

  async function getSession(event?: H3Event) {
    const fetch = event?.$fetch || $fetch;
    try {
      const data = await fetch('/api/session', {
        method: 'get',
      });
      return data as SharedPublicUser;
    } catch {
      return null;
    }
  }

  async function update() {
    const data = await getSession();
    userData.value = data;
  }

  return { userData, principal, update, getSession };
});
