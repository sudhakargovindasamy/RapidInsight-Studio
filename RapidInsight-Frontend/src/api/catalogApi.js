import { apiRequest } from './apiClient.js';

/**
 * Fetch catalog data sources for an authorized project
 */
export async function getCatalogSources(projectId, { loadedOnly = true } = {}) {
  const query = loadedOnly
    ? `/schema/catalog/sources?projectId=${encodeURIComponent(projectId)}&loadedOnly=true`
    : `/schema/catalog/sources?projectId=${encodeURIComponent(projectId)}`;
  return apiRequest(query);
}

/**
 * Fetch catalog assets for a given source within a project
 */
export async function getCatalogAssets(projectId, sourceId) {
  const url = sourceId
    ? `/schema/catalog/assets?projectId=${encodeURIComponent(projectId)}&sourceId=${encodeURIComponent(sourceId)}`
    : `/schema/catalog/assets?projectId=${encodeURIComponent(projectId)}`;
  return apiRequest(url);
}

/**
 * Fetch catalog columns for a given asset within a project
 */
export async function getCatalogColumns(projectId, assetId) {
  return apiRequest(
    `/schema/catalog/columns?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(assetId)}`
  );
}

/**
 * Run a profile statistic query against the physical table of a verified catalog column
 */
export async function runProfileStat({ projectId, assetId, columnId, statistic }) {
  return apiRequest('/schema/catalog/profile-stat', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      assetId,
      columnId,
      statistic
    })
  });
}

/**
 * Fetch persistent profiling history for an authorized project
 */
export async function getProfilingHistory(projectId) {
  return apiRequest(`/schema/catalog/profiling-history?projectId=${encodeURIComponent(projectId)}`);
}

/**
 * Fetch a single historical profiling run with complete insights, visualizations, and column profiles
 */
export async function getProfilingHistoryItem(projectId, resultId) {
  return apiRequest(
    `/schema/catalog/profiling-history/${encodeURIComponent(resultId)}?projectId=${encodeURIComponent(projectId)}`
  );
}

/**
 * Method A: Ingests an uploaded data file (CSV, XLSX, XLS, JSON, YAML) into the asset's physical table.
 */
export async function ingestFileIntoAsset({ projectId, assetId, file }) {
  const formData = new FormData();
  formData.append('projectId', projectId);
  formData.append('file', file);
  return apiRequest(`/schema/catalog/assets/${encodeURIComponent(assetId)}/ingest-file`, {
    method: 'POST',
    body: formData
  });
}

/**
 * Method B: Generates synthetic mock records matching asset column specs and loads into destination table.
 */
export async function ingestMockDataIntoAsset({ projectId, assetId, rowCount = 100 }) {
  return apiRequest(`/schema/catalog/assets/${encodeURIComponent(assetId)}/ingest-mock`, {
    method: 'POST',
    body: JSON.stringify({ projectId, rowCount })
  });
}

/**
 * Method C: Imports rows from an external connected database table into the asset's destination table with column mapping.
 */
export async function ingestDatabaseIntoAsset({
  projectId,
  assetId,
  connectionConfig,
  sourceSchema = 'public',
  sourceTable,
  columnMapping = {},
  limit = 500
}) {
  return apiRequest(`/schema/catalog/assets/${encodeURIComponent(assetId)}/ingest-database`, {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      connectionConfig,
      sourceSchema,
      sourceTable,
      columnMapping,
      limit
    })
  });
}

