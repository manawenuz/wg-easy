import { eq, sql } from 'drizzle-orm';
import { TOTP } from 'otpauth';
import { user } from './schema';
import type { UserType } from './types';
import type { DBType } from '#db/sqlite';
import type { Role } from '#shared/utils/permissions';
import { roles } from '#shared/utils/permissions';

type LoginResult =
  | {
      success: true;
      user: UserType;
    }
  | {
      success: false;
      error:
        | 'INCORRECT_CREDENTIALS'
        | 'TOTP_REQUIRED'
        | 'USER_DISABLED'
        | 'INVALID_TOTP_CODE'
        | 'UNEXPECTED_ERROR';
    };

function createPreparedStatement(db: DBType) {
  return {
    findAll: db.query.user.findMany().prepare(),
    findById: db.query.user
      .findFirst({ where: eq(user.id, sql.placeholder('id')) })
      .prepare(),
    findByUsername: db.query.user
      .findFirst({
        where: eq(user.username, sql.placeholder('username')),
      })
      .prepare(),
    update: db
      .update(user)
      .set({
        name: sql.placeholder('name') as never as string,
        email: sql.placeholder('email') as never as string,
      })
      .where(eq(user.id, sql.placeholder('id')))
      .prepare(),
    updateKey: db
      .update(user)
      .set({
        totpKey: sql.placeholder('key') as never as string,
        totpVerified: false,
      })
      .where(eq(user.id, sql.placeholder('id')))
      .prepare(),
  };
}

export class UserService {
  #db: DBType;
  #statements: ReturnType<typeof createPreparedStatement>;

  constructor(db: DBType) {
    this.#db = db;
    this.#statements = createPreparedStatement(db);
  }

  async getAll() {
    return this.#statements.findAll.execute();
  }

  async get(id: ID) {
    return this.#statements.findById.execute({ id });
  }

  async getByUsername(username: string) {
    return this.#statements.findByUsername.execute({ username });
  }

  async create(username: string, password: string) {
    const hash = await hashPassword(password);

    return this.#db.transaction(async (tx) => {
      const oldUser = await tx.query.user
        .findFirst({
          where: eq(user.username, username),
        })
        .execute();

      if (oldUser) {
        throw new Error('User already exists');
      }

      const userCount = await tx.$count(user);

      await tx.insert(user).values({
        password: hash,
        username,
        email: null,
        name: 'Administrator',
        role: userCount === 0 ? roles.ADMIN : roles.CLIENT,
        totpVerified: false,
        enabled: true,
      });
    });
  }

  async update(id: ID, name: string, email: string | null) {
    return this.#statements.update.execute({ id, name, email });
  }

  async updatePassword(id: ID, currentPassword: string, newPassword: string) {
    const hash = await hashPassword(newPassword);

    return this.#db.transaction(async (tx) => {
      // get user again to avoid password changing while request
      const txUser = await tx.query.user
        .findFirst({ where: eq(user.id, id) })
        .execute();

      if (!txUser) {
        throw new Error('User not found');
      }

      const passwordValid = await isPasswordValid(
        currentPassword,
        txUser.password
      );

      if (!passwordValid) {
        throw new Error('Invalid password');
      }

      await tx
        .update(user)
        .set({ password: hash })
        .where(eq(user.id, id))
        .execute();
    });
  }

  updateTotpKey(id: ID, key: string | null) {
    return this.#statements.updateKey.execute({ id, key });
  }

  login(username: string, password: string, code: string | undefined) {
    return this.#db.transaction(async (tx): Promise<LoginResult> => {
      const txUser = await tx.query.user
        .findFirst({ where: eq(user.username, username) })
        .execute();

      if (!txUser) {
        return { success: false, error: 'INCORRECT_CREDENTIALS' };
      }

      const passwordValid = await isPasswordValid(password, txUser.password);

      if (!passwordValid) {
        return { success: false, error: 'INCORRECT_CREDENTIALS' };
      }

      if (txUser.totpVerified) {
        if (!code) {
          return { success: false, error: 'TOTP_REQUIRED' };
        } else {
          if (!txUser.totpKey) {
            return { success: false, error: 'UNEXPECTED_ERROR' };
          }

          const totp = new TOTP({
            issuer: 'wg-easy',
            label: txUser.username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: txUser.totpKey,
          });

          const valid = totp.validate({ token: code, window: 1 });

          if (valid === null) {
            return { success: false, error: 'INVALID_TOTP_CODE' };
          }
        }
      }

      if (!txUser.enabled) {
        return { success: false, error: 'USER_DISABLED' };
      }

      return { success: true, user: txUser };
    });
  }

  verifyTotp(id: ID, code: string) {
    return this.#db.transaction(async (tx) => {
      const txUser = await tx.query.user
        .findFirst({ where: eq(user.id, id) })
        .execute();

      if (!txUser) {
        throw new Error('User not found');
      }

      if (!txUser.totpKey) {
        throw new Error('TOTP key is not set');
      }

      const totp = new TOTP({
        issuer: 'wg-easy',
        label: txUser.username,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: txUser.totpKey,
      });

      const valid = totp.validate({ token: code, window: 1 });

      if (valid === null) {
        throw new Error('Invalid TOTP code');
      }

      await tx
        .update(user)
        .set({ totpVerified: true })
        .where(eq(user.id, id))
        .execute();
    });
  }

  deleteTotpKey(id: ID, currentPassword: string) {
    return this.#db.transaction(async (tx) => {
      const txUser = await tx.query.user
        .findFirst({ where: eq(user.id, id) })
        .execute();

      if (!txUser) {
        throw new Error('User not found');
      }

      const passwordValid = await isPasswordValid(
        currentPassword,
        txUser.password
      );

      if (!passwordValid) {
        throw new Error('Invalid password');
      }

      await tx
        .update(user)
        .set({ totpKey: null, totpVerified: false })
        .where(eq(user.id, id))
        .execute();
    });
  }

  async delete(id: ID) {
    return this.#db.delete(user).where(eq(user.id, id)).execute();
  }

  async updateRole(id: ID, role: Role) {
    return this.#db
      .update(user)
      .set({ role })
      .where(eq(user.id, id))
      .execute();
  }

  async updateEnabled(id: ID, enabled: boolean) {
    return this.#db
      .update(user)
      .set({ enabled })
      .where(eq(user.id, id))
      .execute();
  }

  async updateEmail(id: ID, email: string | null) {
    return this.#db
      .update(user)
      .set({ email })
      .where(eq(user.id, id))
      .execute();
  }

  async updatePasswordDirect(id: ID, newPassword: string) {
    const hash = await hashPassword(newPassword);
    return this.#db
      .update(user)
      .set({ password: hash })
      .where(eq(user.id, id))
      .execute();
  }

  async createEndUser(name: string, email?: string | null) {
    return this.#db.transaction(async (tx) => {
      // Generate a unique username from the name
      const base = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'user';
      const existing = await tx.query.user.findMany().execute();
      const taken = new Set(existing.map((u) => u.username));
      let username = base;
      let i = 1;
      while (taken.has(username)) {
        username = `${base}-${i++}`;
      }

      const result = await tx.insert(user).values({
        username,
        password: '', // no password — key-only auth
        email: email ?? null,
        name,
        role: roles.CLIENT,
        totpVerified: false,
        enabled: true,
      }).returning({ id: user.id });

      return result[0]!;
    });
  }

  async createAdmin(
    username: string,
    password: string,
    role: Role,
    email?: string | null
  ) {
    const hash = await hashPassword(password);

    return this.#db.transaction(async (tx) => {
      const oldUser = await tx.query.user
        .findFirst({
          where: eq(user.username, username),
        })
        .execute();

      if (oldUser) {
        throw new Error('User already exists');
      }

      const result = await tx.insert(user).values({
        password: hash,
        username,
        email: email ?? null,
        name: username,
        role,
        totpVerified: false,
        enabled: true,
      }).returning({ id: user.id });

      return result[0];
    });
  }
}
