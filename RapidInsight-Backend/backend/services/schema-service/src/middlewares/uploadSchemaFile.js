const multer = require('multer');
const path = require('path');

const env = require('../config/env');

const maxFileSizeBytes =
  env.MAX_SCHEMA_FILE_SIZE_MB * 1024 * 1024;

const allowedExtensions = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.csv'
]);

function fileFilter(req, file, callback) {
  const extension = path
    .extname(file.originalname || '')
    .toLowerCase();

  if (!allowedExtensions.has(extension)) {
    const error = new Error(
      'Only JSON, YAML, YML, and CSV files are allowed.'
    );

    error.statusCode = 400;
    error.code = 'INVALID_FILE_TYPE';
    error.isOperational = true;

    return callback(error);
  }

  return callback(null, true);
}

const uploadSchemaFile = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 1,
    fileSize: maxFileSizeBytes
  },

  fileFilter
});

module.exports = uploadSchemaFile;