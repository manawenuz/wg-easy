import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './service';

describe('UserService', () => {
  let service: UserService;

  function createMockDb(overrides: Record<string, unknown> = {}) {
    const prepare = vi.fn(() => ({ execute: vi.fn(async () => []) }));
    const chainUpdate = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          prepare: vi.fn(() => ({ execute: vi.fn() })),
        })),
      })),
    }));
    const chainDelete = vi.fn(() => ({
      where: vi.fn(() => ({ execute: vi.fn() })),
    }));
    const chainInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => ({
          execute: vi.fn(async () => []),
        })),
      })),
    }));

    const base = {
      query: {
        user: {
          findMany: vi.fn((args?: any) => {
            if (args === undefined) return { prepare };
            return [];
          }),
          findFirst: vi.fn(() => ({ prepare })),
        },
        client: {
          findMany: vi.fn((args?: any) => {
            if (args === undefined) return { prepare };
            return [];
          }),
        },
      },
      update: chainUpdate,
      delete: chainDelete,
      insert: chainInsert,
      transaction: vi.fn(async (fn: any) =>
        fn({
          update: chainUpdate,
          delete: chainDelete,
          insert: chainInsert,
          query: {
            user: {
              findMany: vi.fn(async () => []),
              findFirst: vi.fn(async () => undefined),
            },
            client: { findMany: vi.fn(async () => []) },
          },
        })
      ),
    };

    // Deep merge overrides for query methods
    if (overrides.query) {
      Object.assign(base.query, overrides.query);
    }
    Object.assign(base, overrides);
    return base as never;
  }

  describe('getRootUserId', () => {
    it('returns its own id for root user', async () => {
      const db = createMockDb();
      service = new UserService(db);
      vi.spyOn(service, 'get').mockResolvedValue({
        id: 1,
        parentUserId: null,
      } as never);

      const result = await service.getRootUserId(1);
      expect(result).toBe(1);
    });

    it('returns parent id for 1-level sub-account', async () => {
      const db = createMockDb();
      service = new UserService(db);
      vi.spyOn(service, 'get')
        .mockResolvedValueOnce({ id: 2, parentUserId: 1 } as never)
        .mockResolvedValueOnce({ id: 1, parentUserId: null } as never);

      const result = await service.getRootUserId(2);
      expect(result).toBe(1);
    });

    it('returns root id for 3-level chain', async () => {
      const db = createMockDb();
      service = new UserService(db);
      vi.spyOn(service, 'get')
        .mockResolvedValueOnce({ id: 4, parentUserId: 3 } as never)
        .mockResolvedValueOnce({ id: 3, parentUserId: 2 } as never)
        .mockResolvedValueOnce({ id: 2, parentUserId: 1 } as never)
        .mockResolvedValueOnce({ id: 1, parentUserId: null } as never);

      const result = await service.getRootUserId(4);
      expect(result).toBe(1);
    });

    it('throws CYCLE_DETECTED when depth exceeds 10', async () => {
      const db = createMockDb();
      service = new UserService(db);
      let callCount = 0;
      vi.spyOn(service, 'get').mockImplementation(async () => {
        callCount++;
        return { id: callCount, parentUserId: callCount + 1 } as never;
      });

      await expect(service.getRootUserId(1)).rejects.toThrow('CYCLE_DETECTED');
    });
  });

  describe('getFamilyMemberIds', () => {
    it('returns root only when no descendants', async () => {
      const db = createMockDb();
      service = new UserService(db);

      const result = await service.getFamilyMemberIds(1);
      expect(result).toEqual([1]);
    });

    it('returns root + all descendants', async () => {
      const db = createMockDb({
        query: {
          user: {
            findMany: vi.fn((args?: any) => {
              if (args === undefined) return { prepare: vi.fn(() => ({ execute: vi.fn(async () => []) })) };
              const callCount = (service as any)._findManyCallCount = ((service as any)._findManyCallCount ?? 0) + 1;
              if (callCount === 1) return [{ id: 2 }, { id: 3 }];
              if (callCount === 2) return [{ id: 4 }];
              return [];
            }),
            findFirst: vi.fn(() => ({ prepare: vi.fn(() => ({ execute: vi.fn(async () => undefined) })) })),
          },
          client: {
            findMany: vi.fn((args?: any) => {
              if (args === undefined) return { prepare: vi.fn(() => ({ execute: vi.fn(async () => []) })) };
              return [];
            }),
          },
        },
      });
      service = new UserService(db);

      const result = await service.getFamilyMemberIds(1);
      expect(result).toContain(1);
      expect(result).toContain(2);
      expect(result).toContain(3);
      expect(result).toContain(4);
    });
  });

  describe('getFamilyClientIds', () => {
    it('returns client ids for all family members', async () => {
      const db = createMockDb({
        query: {
          user: {
            findMany: vi.fn(() => ({ prepare: vi.fn(() => ({ execute: vi.fn(async () => []) })) })),
            findFirst: vi.fn(() => ({ prepare: vi.fn(() => ({ execute: vi.fn(async () => undefined) })) })),
          },
          client: {
            findMany: vi.fn((args?: any) => {
              if (args === undefined) return { prepare: vi.fn(() => ({ execute: vi.fn(async () => []) })) };
              return [{ id: 10 }, { id: 11 }];
            }),
          },
        },
      });
      service = new UserService(db);
      vi.spyOn(service, 'getFamilyMemberIds').mockResolvedValue([1, 2]);

      const result = await service.getFamilyClientIds(1);
      expect(result).toEqual([10, 11]);
    });
  });

  describe('updateParentUserId', () => {
    it('deletes quota row when attaching as sub-account', async () => {
      const txMock = {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ execute: vi.fn() })) })) })),
        delete: vi.fn(() => ({ where: vi.fn(() => ({ execute: vi.fn() })) })),
      };
      const db = createMockDb({
        transaction: vi.fn(async (fn: any) => fn(txMock)),
      });
      service = new UserService(db);

      await service.updateParentUserId(2, 1);

      expect(txMock.update).toHaveBeenCalled();
      expect(txMock.delete).toHaveBeenCalled();
    });

    it('does not delete quota row when promoting to root', async () => {
      const txMock = {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ execute: vi.fn() })) })) })),
        delete: vi.fn(() => ({ where: vi.fn(() => ({ execute: vi.fn() })) })),
      };
      const db = createMockDb({
        transaction: vi.fn(async (fn: any) => fn(txMock)),
      });
      service = new UserService(db);

      await service.updateParentUserId(2, null);

      expect(txMock.update).toHaveBeenCalled();
      expect(txMock.delete).not.toHaveBeenCalled();
    });
  });
});
