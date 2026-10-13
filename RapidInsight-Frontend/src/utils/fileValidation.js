import { buildTableNameFromFileName } from './identifierNaming.js';

const ALLOWED_EXTENSIONS = ['.json', '.yaml', '.yml', '.csv'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function validateSchemaFile(file) {
  if (!file) {
    return { valid: false, message: 'No file selected.' };
  }

  const fileName = file.name.toLowerCase();
  const isAllowedExtension = ALLOWED_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension)
  );

  if (!isAllowedExtension) {
    return { valid: false, message: 'Only JSON, YAML, YML, and CSV files are allowed.' };
  }

  if (file.size <= 0) {
    return { valid: false, message: 'File is empty.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, message: 'File size should be less than 5MB.' };
  }

  const tableName = buildTableNameFromFileName(file.name);

  if (!tableName) {
    return { valid: false, message: 'File name cannot be converted into a valid table name.' };
  }

  return {
    valid: true,
    message: 'Valid file.',
    tableName
  };
}

