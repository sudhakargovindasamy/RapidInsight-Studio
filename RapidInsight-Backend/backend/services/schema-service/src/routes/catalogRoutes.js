const express = require('express');
const validateRequest = require('../middlewares/validateRequest');

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
  registerAsset
} = require('../controllers/catalogController');

const router = express.Router();

router.get('/sources', validateRequest(listSourcesQuerySchema, 'query'), getSources);
router.get('/assets', validateRequest(listAssetsQuerySchema, 'query'), getAssets);
router.get('/columns', validateRequest(listColumnsQuerySchema, 'query'), getColumns);
router.post('/profile-stat', validateRequest(profileStatBodySchema, 'body'), profileStat);
router.get('/profiling-history', validateRequest(listHistoryQuerySchema, 'query'), getProfilingHistory);
router.post('/register-asset', registerAsset);

module.exports = router;
