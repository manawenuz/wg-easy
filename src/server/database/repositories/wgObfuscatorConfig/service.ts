import { eq } from 'drizzle-orm';
import { wgObfuscatorConfig } from './schema';
import type { DBType } from '#db/sqlite';

export class WgObfuscatorConfigService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async get(interfaceId: string) {
    return this.#db.query.wgObfuscatorConfig.findFirst({
      where: eq(wgObfuscatorConfig.interfaceId, interfaceId),
    });
  }

  async create(data: {
    interfaceId: string;
    listenPort: number;
    wgTargetPort: number;
    key: string;
    dummyPaddingMin?: number;
    dummyPaddingMax?: number;
    deployEnabled?: boolean;
    deploymentMode?: 'router' | 'host';
    hostEndpoint?: string | null;
  }) {
    const result = await this.#db
      .insert(wgObfuscatorConfig)
      .values({
        interfaceId: data.interfaceId,
        listenPort: data.listenPort,
        wgTargetPort: data.wgTargetPort,
        key: data.key,
        dummyPaddingMin: data.dummyPaddingMin ?? 8,
        dummyPaddingMax: data.dummyPaddingMax ?? 64,
        deployEnabled: data.deployEnabled ?? false,
        deploymentMode: data.deploymentMode ?? 'router',
        hostEndpoint: data.hostEndpoint ?? null,
      })
      .returning();
    return result[0]!;
  }

  async update(
    interfaceId: string,
    data: Partial<{
      listenPort: number;
      wgTargetPort: number;
      key: string;
      dummyPaddingMin: number;
      dummyPaddingMax: number;
      deployEnabled: boolean;
      deploymentMode: 'router' | 'host';
      hostEndpoint: string | null;
    }>
  ) {
    const result = await this.#db
      .update(wgObfuscatorConfig)
      .set(data)
      .where(eq(wgObfuscatorConfig.interfaceId, interfaceId))
      .returning();
    return result[0];
  }

  async delete(interfaceId: string) {
    await this.#db
      .delete(wgObfuscatorConfig)
      .where(eq(wgObfuscatorConfig.interfaceId, interfaceId));
  }
}
