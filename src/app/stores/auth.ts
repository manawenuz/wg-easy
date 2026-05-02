import type { H3Event } from 'h3';
import type { SharedPublicUser } from '~~/shared/utils/permissions';
import type { Principal } from '~~/server/utils/principal';

export const useAuthStore = defineStore('Auth', () => {
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
