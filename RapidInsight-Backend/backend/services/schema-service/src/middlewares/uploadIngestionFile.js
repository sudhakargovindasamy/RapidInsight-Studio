const multer = require('multer');
const path = require('path');
const env = require('../config/env');

const maxFileSizeBytes = (env.MAX_SCHEMA_FILE_SIZE_MB || 50) * 1024 * 1024;

const allowedExtensions = new Set([
  '.csv',
  '.xlsx',
  '.xls',
  '.json',
  '.yaml',
  '.yml'
]);

function fileFilter(req, file, callback) {
  const extension = path
    .extname(file.originalname || '')
    .toLowerCase();

  if (!allowedExtensions.has(extension)) {
    const error = new Error(
      'Only CSV, Excel (.xlsx, .xls), JSON, and YAML files are supported for ingestion.'
    );
    error.statusCode = 400;
    error.code = 'INVALID_FILE_TYPE';
    error.isOperational = true;

    return callback(error);
  }

  return callback(null, true);
}

const uploadIngestionFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxFileSizeBytes
  },
  fileFilter
});

module.exports = uploadIngestionFile;

