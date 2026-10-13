import { apiRequest } from './apiClient.js';

export function generatePreview({ schemaDefinition }) {
  return apiRequest('/datagen/preview', {
    method: 'POST',
    body: JSON.stringify({ schemaDefinition })
  });
}

export function generateData({ schemaDefinition, rowCount }) {
  return apiRequest('/datagen/generate', {
    method: 'POST',
    body: JSON.stringify({
      schemaDefinition,
      rowCount
    })
  });
}
