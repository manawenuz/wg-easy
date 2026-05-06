import { eq, sql, count } from 'drizzle-orm';
import { trafficGroup } from './schema';
import { client } from '../../schema';
import type { DBType } from '#db/sqlite';
import type { TrafficGroupCreateType, TrafficGroupUpdateType, TrafficGroupType } from './types';
import { getNextColor } from '../../../utils/colorGenerator';

export class TrafficGroupService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    // Get all groups with client counts
    const groups = await this.#db.query.trafficGroup.findMany();

    const groupsWithCounts = await Promise.all(
      groups.map(async (group) => {
        const clientCount = await this.#db
          .select({ count: count() })
          .from(client)
          .where(eq(client.trafficGroupId, group.id))
          .then((result) => result[0]?.count ?? 0);

        return {
          ...group,
          clientCount,
        };
      })
    );

    return groupsWithCounts;
  }

  async get(id: ID) {
    return this.#db.query.trafficGroup.findFirst({
      where: eq(trafficGroup.id, id),
    });
  }

  async create(data: TrafficGroupCreateType) {
    // Validate: if quota is set, period must be set
    if (data.quotaLimitBytes !== undefined && data.quotaLimitBytes !== null) {
      if (!data.quotaPeriod) {
        throw new Error('Quota period is required when quota limit is set');
      }
    }

    // Validate: if speed is set, both up and down must be set
    if (
      (data.upKbps !== undefined && data.downKbps === undefined) ||
      (data.upKbps === undefined && data.downKbps !== undefined)
    ) {
      throw new Error('Both upload and download speeds must be set together');
    }

    // Get existing groups to generate next color
    const existingGroups = await this.#db.query.trafficGroup.findMany();
    const colors = getNextColor(existingGroups);

    const result = await this.#db.insert(trafficGroup).values({
      name: data.name,
      colorLight: colors.light,
      colorDark: colors.dark,
      upKbps: data.upKbps,
      downKbps: data.downKbps,
      quotaLimitBytes: data.quotaLimitBytes,
      quotaPeriod: data.quotaPeriod,
      quotaAutoDisable: data.quotaAutoDisable ?? true,
      isDefault: false,
    }).returning();

    return result[0];
  }

  async update(id: ID, data: TrafficGroupUpdateType) {
    // Validate: if quota is set, period must be set
    if (data.quotaLimitBytes !== undefined && data.quotaLimitBytes !== null) {
      if (data.quotaPeriod === undefined || data.quotaPeriod === null) {
        throw new Error('Quota period is required when quota limit is set');
      }
    }

    // Validate: if speed is set, both up and down must be set
    if (
      (data.upKbps !== undefined && data.upKbps !== null && (data.downKbps === undefined || data.downKbps === null)) ||
      (data.downKbps !== undefined && data.downKbps !== null && (data.upKbps === undefined || data.upKbps === null))
    ) {
      throw new Error('Both upload and download speeds must be set together');
    }

    await this.#db
      .update(trafficGroup)
      .set(data)
      .where(eq(trafficGroup.id, id))
      .execute();
  }

  async delete(id: ID) {
    // Check if this is the default group
    const group = await this.get(id);
    if (!group) {
      throw new Error('Traffic group not found');
    }
    if (group.isDefault) {
      throw new Error('Cannot delete the default traffic group');
    }

    // Get the default group
    const defaultGroup = await this.getDefault();
    if (!defaultGroup) {
      throw new Error('No default traffic group found');
    }

    // Reassign all clients to the default group
    await this.#db
      .update(client)
      .set({ trafficGroupId: defaultGroup.id })
      .where(eq(client.trafficGroupId, id))
      .execute();

    // Delete the group
    await this.#db.delete(trafficGroup).where(eq(trafficGroup.id, id)).execute();
  }

  async setDefault(id: ID) {
    // Use transaction to ensure atomicity
    await this.#db.transaction(async (tx) => {
      // Unset all defaults
      await tx
        .update(trafficGroup)
        .set({ isDefault: false })
        .execute();

      // Set this one as default
      await tx
        .update(trafficGroup)
        .set({ isDefault: true })
        .where(eq(trafficGroup.id, id))
        .execute();
    });
  }

  async getDefault() {
    return this.#db.query.trafficGroup.findFirst({
      where: eq(trafficGroup.isDefault, true),
    });
  }
}
