const express = require('express');

const uploadSchemaFile = require('../middlewares/uploadSchemaFile');
const validateRequest = require('../middlewares/validateRequest');

const {
  uploadSchemaBodySchema,
  listSchemasQuerySchema,
  schemaIdParamsSchema
} = require('../validators/schemaSchemas');

const {
  uploadSchema,
  listSchemas,
  getSchemaById,
  deleteSchema,
  retrySeedRows,
  getProjectSeedStatus,
  testDatabaseConnection,
  importDatabaseTables
} = require('../controllers/schemaController');

const router = express.Router();

router.post('/connect-db/test', testDatabaseConnection);
router.post('/connect-db/import', importDatabaseTables);

/*
 * Multer must run first because it reads the multipart/form-data
 * body and creates req.body and req.file.
 */
router.post(
  '/upload',
  uploadSchemaFile.single('file'),
  validateRequest(uploadSchemaBodySchema, 'body'),
  uploadSchema
);

router.get(
  '/my',
  validateRequest(listSchemasQuerySchema, 'query'),
  listSchemas
);

router.get(
  '/list',
  validateRequest(listSchemasQuerySchema, 'query'),
  listSchemas
);

/*
 * Must stay above /:schemaId. Express matches in declaration order, so a literal
 * path declared after a parameterised one is never reached - "seed-status" would
 * be read as a schema id.
 */
router.get(
  '/seed-status',
  validateRequest(listSchemasQuerySchema, 'query'),
  getProjectSeedStatus
);

router.get(
  '/:schemaId',
  validateRequest(schemaIdParamsSchema, 'params'),
  getSchemaById
);

router.post(
  '/:schemaId/seed-rows/retry',
  validateRequest(schemaIdParamsSchema, 'params'),
  retrySeedRows
);

router.delete(
  '/:schemaId',
  validateRequest(schemaIdParamsSchema, 'params'),
  deleteSchema
);

module.exports = router;