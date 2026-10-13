const { z } = require('zod');

const uuidSchema = z.string().trim().uuid();

const listSourcesQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  project_id: uuidSchema.optional()
}).refine(data => data.projectId || data.project_id, {
  message: 'projectId or project_id is required.',
  path: ['projectId']
});

const listAssetsQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
  source_id: uuidSchema.optional()
}).refine(data => data.projectId || data.project_id, {
  message: 'projectId or project_id is required.',
  path: ['projectId']
});

const listColumnsQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  assetId: uuidSchema.optional(),
  asset_id: uuidSchema.optional()
}).refine(data => data.projectId || data.project_id, {
  message: 'projectId or project_id is required.',
  path: ['projectId']
}).refine(data => data.assetId || data.asset_id, {
  message: 'assetId or asset_id is required.',
  path: ['assetId']
});

const profileStatBodySchema = z.object({
  projectId: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  columnId: uuidSchema.optional(),
  column_id: uuidSchema.optional(),
  statistic: z.enum(['NULL_COUNT', 'COUNT', 'DISTINCT_COUNT', 'MIN', 'MAX', 'AVG'], {
    errorMap: () => ({ message: 'statistic must be one of: NULL_COUNT, COUNT, DISTINCT_COUNT, MIN, MAX, AVG.' })
  })
}).refine(data => data.projectId || data.project_id, {
  message: 'projectId or project_id is required.',
  path: ['projectId']
}).refine(data => data.columnId || data.column_id, {
  message: 'columnId or column_id is required.',
  path: ['columnId']
});

const listHistoryQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  project_id: uuidSchema.optional()
}).refine(data => data.projectId || data.project_id, {
  message: 'projectId or project_id is required.',
  path: ['projectId']
});

module.exports = {
  listSourcesQuerySchema,
  listAssetsQuerySchema,
  listColumnsQuerySchema,
  profileStatBodySchema,
  listHistoryQuerySchema
};

