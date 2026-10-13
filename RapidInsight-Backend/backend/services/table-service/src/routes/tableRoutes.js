const express = require('express');

const {
  listTables,
  buildTable,
  generateAndInsertData,
  getGeneratedTableBySchema,
  populateGeneratedTable,
  getRows,
  generateTablesForProjectHandler,
  retryDataInsertHandler,
  getProjectDataModelHandler
} = require('../controllers/tableController');

const router = express.Router();

router.get('/', listTables);

router.post('/projects/:projectId/generate-tables', generateTablesForProjectHandler);
router.post('/projects/:projectId/retry-data-insert', retryDataInsertHandler);
router.get('/projects/:projectId/data-model', getProjectDataModelHandler);

router.post('/schemas/:schemaId/build-table', buildTable);
router.post('/schemas/:schemaId/generate-and-insert', generateAndInsertData);
router.get('/schemas/:schemaId/generated-table', getGeneratedTableBySchema);

router.post('/generated/:generatedTableId/populate', populateGeneratedTable);
router.get('/generated/:generatedTableId/rows', getRows);

module.exports = router;