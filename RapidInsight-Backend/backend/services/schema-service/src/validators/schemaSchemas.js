const { z } = require('zod');

const projectIdSchema = z
  .string({
    required_error: 'Project ID is required.'
  })
  .trim()
  .uuid('Project ID must be a valid UUID.');

const schemaIdSchema = z
  .string({
    required_error: 'Schema ID is required.'
  })
  .trim()
  .uuid('Schema ID must be a valid UUID.');

/*
 * Validates POST /schema/upload body.
 *
 * The existing API accepts either:
 * - project_id
 * - projectId
 */
const uploadSchemaBodySchema = z
  .object({
    project_id: projectIdSchema.optional(),
    projectId: projectIdSchema.optional(),
    /*
     * 'faker' is the historical value for "generate mock data" and is what the
     * frontend still sends. 'synthetic' is accepted ahead of the rename planned
     * in docs/sdv-migration-plan.md, so the backend and frontend can switch over
     * independently instead of needing a synchronised deploy.
     */
    data_source: z.enum(['faker', 'synthetic', 'uploaded']).optional()
  })
  .passthrough()
  .refine(
    (body) => body.project_id || body.projectId,
    {
      message: 'project_id or projectId is required.',
      path: ['project_id']
    }
  );

/*
 * Listing schemas allows project ID to be optional.
 */
const listSchemasQuerySchema = z
  .object({
    project_id: projectIdSchema.optional(),
    projectId: projectIdSchema.optional()
  })
  .passthrough();

/*
 * Validates routes such as:
 * GET /schema/:schemaId
 * DELETE /schema/:schemaId
 */
const schemaIdParamsSchema = z.object({
  schemaId: schemaIdSchema
});

module.exports = {
  uploadSchemaBodySchema,
  listSchemasQuerySchema,
  schemaIdParamsSchema
};