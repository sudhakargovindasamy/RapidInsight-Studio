import { apiRequest } from './apiClient.js';

export async function getProjects() {
  return apiRequest('/projects');
}

export async function createProject(payload) {
  return apiRequest('/projects', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getProjectDashboard(projectId) {
  return apiRequest(`/projects/${projectId}/dashboard`);
}

export async function getProjectById(projectId) {
  return apiRequest(`/projects/${projectId}`);
}

export async function deleteProject(projectId) {
  return apiRequest(`/projects/${projectId}`, { method: 'DELETE' });
}