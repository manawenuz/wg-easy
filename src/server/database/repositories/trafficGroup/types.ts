import { z } from 'zod';
import type { trafficGroup } from './schema';

export type TrafficGroupType = typeof trafficGroup.$inferSelect;
export type TrafficGroupInsertType = typeof trafficGroup.$inferInsert;

export const TrafficGroupCreateSchema = z.object({
  name: z.string().min(1).max(100),
  upKbps: z.number().int().min(0).optional(),
  downKbps: z.number().int().min(0).optional(),
  quotaLimitBytes: z.number().int().min(0).optional(),
  quotaPeriod: z.enum(['daily', 'weekly', 'monthly']).optional(),
  quotaAutoDisable: z.boolean().optional().default(true),
});

export type TrafficGroupCreateType = z.infer<typeof TrafficGroupCreateSchema>;

export const TrafficGroupUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  upKbps: z.number().int().min(0).optional().nullable(),
  downKbps: z.number().int().min(0).optional().nullable(),
  quotaLimitBytes: z.number().int().min(0).optional().nullable(),
  quotaPeriod: z.enum(['daily', 'weekly', 'monthly']).optional().nullable(),
  quotaAutoDisable: z.boolean().optional(),
});

export type TrafficGroupUpdateType = z.infer<typeof TrafficGroupUpdateSchema>;
