import { apiRequest } from './apiClient.js';

export async function uploadSchema({ projectId, file, dataSource }) {
  const formData = new FormData();
  formData.append('project_id', projectId);
  formData.append('file', file);
  if (dataSource) {
    formData.append('data_source', dataSource);
  }

  return apiRequest('/schema/upload', {
    method: 'POST',
    body: formData
  });
}

export async function getSchemasByProject(projectId) {
  return apiRequest(`/schema/my?project_id=${encodeURIComponent(projectId)}`);
}

export async function getProjectSeedStatus(projectId) {
  return apiRequest(
    `/schema/seed-status?project_id=${encodeURIComponent(projectId)}`
  );
}

export async function retrySeedRows(schemaId) {
  return apiRequest(
    `/schema/${encodeURIComponent(schemaId)}/seed-rows/retry`,
    { method: 'POST' }
  );
}

export async function getSchemaById(schemaId) {
  return apiRequest(`/schema/${encodeURIComponent(schemaId)}`);
}

export async function deleteSchema(schemaId) {
  return apiRequest(`/schema/${encodeURIComponent(schemaId)}`, {
    method: 'DELETE'
  });
}

export async function testDatabaseConnection(connectionConfig) {
  return apiRequest('/schema/connect-db/test', {
    method: 'POST',
    body: JSON.stringify(connectionConfig)
  });
}

export async function importTablesFromDatabase(payload) {
  return apiRequest('/schema/connect-db/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function registerAssetMetadata(payload) {
  return apiRequest('/schema/register-asset', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getDatabaseTableColumns(payload) {
  return apiRequest('/schema/connect-db/table-columns', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
