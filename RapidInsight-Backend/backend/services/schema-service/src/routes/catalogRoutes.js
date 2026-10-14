const express = require('express');
const validateRequest = require('../middlewares/validateRequest');
const uploadIngestionFile = require('../middlewares/uploadIngestionFile');

const {
  listSourcesQuerySchema,
  listAssetsQuerySchema,
  listColumnsQuerySchema,
  profileStatBodySchema,
  listHistoryQuerySchema
} = require('../validators/catalogSchemas');

const {
  getSources,
  getAssets,
  getColumns,
  profileStat,
  getProfilingHistory,
  getProfilingHistoryItemHandler,
  registerAsset,
  ingestFileHandler,
  ingestMockHandler,
  ingestDatabaseHandler
} = require('../controllers/catalogController');

const router = express.Router();

router.get('/sources', validateRequest(listSourcesQuerySchema, 'query'), getSources);
router.get('/assets', validateRequest(listAssetsQuerySchema, 'query'), getAssets);
router.get('/columns', validateRequest(listColumnsQuerySchema, 'query'), getColumns);
router.post('/profile-stat', validateRequest(profileStatBodySchema, 'body'), profileStat);
router.get('/profiling-history', validateRequest(listHistoryQuerySchema, 'query'), getProfilingHistory);
router.get('/profiling-history/:resultId', getProfilingHistoryItemHandler);
router.post('/register-asset', registerAsset);

router.post('/assets/:assetId/ingest-file', uploadIngestionFile.single('file'), ingestFileHandler);
router.post('/assets/:assetId/ingest-mock', ingestMockHandler);
router.post('/assets/:assetId/ingest-database', ingestDatabaseHandler);

module.exports = router;
