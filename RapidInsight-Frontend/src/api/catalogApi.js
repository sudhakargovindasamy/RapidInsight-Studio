import { apiRequest } from './apiClient.js';

/**
 * Fetch catalog data sources for an authorized project
 */
export async function getCatalogSources(projectId) {
  return apiRequest(`/schema/catalog/sources?projectId=${encodeURIComponent(projectId)}`);
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
export async function runProfileStat({ projectId, columnId, statistic }) {
  return apiRequest('/schema/catalog/profile-stat', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
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

