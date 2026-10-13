import { apiRequest } from './apiClient.js';

export async function getTablesByProject(projectId) {
  return apiRequest(`/tables?project_id=${encodeURIComponent(projectId)}`);
}

export async function getGeneratedTableBySchema(schemaId) {
  return apiRequest(`/tables/schemas/${schemaId}/generated-table`);
}

export async function buildTable(schemaId) {
  return apiRequest(`/tables/schemas/${schemaId}/build-table`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function generateAndInsertData(schemaId, rowCount = 100) {
  return apiRequest(`/tables/schemas/${schemaId}/generate-and-insert`, {
    method: 'POST',
    body: JSON.stringify({ rowCount })
  });
}

export async function populateGeneratedTable(generatedTableId, rowCount = 100) {
  return apiRequest(`/tables/generated/${generatedTableId}/populate`, {
    method: 'POST',
    body: JSON.stringify({ rowCount })
  });
}

export async function getTableRows(generatedTableId, page = 1, pageSize = 50) {
  return apiRequest(
    `/tables/generated/${generatedTableId}/rows?page=${page}&pageSize=${pageSize}`
  );
}

export async function generateProjectTables(projectId, rowCount = 100, customKpis = []) {
  return apiRequest(`/tables/projects/${encodeURIComponent(projectId)}/generate-tables`, {
    method: 'POST',
    body: JSON.stringify({ rowCount, custom_kpis: customKpis })
  });
}

export async function retryProjectDataInsert(projectId, rowCount = 100) {
  return apiRequest(`/tables/projects/${encodeURIComponent(projectId)}/retry-data-insert`, {
    method: 'POST',
    body: JSON.stringify({ rowCount })
  });
}

export async function getProjectDataModel(projectId) {
  return apiRequest(`/tables/projects/${encodeURIComponent(projectId)}/data-model`);
}
