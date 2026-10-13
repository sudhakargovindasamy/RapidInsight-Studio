import { apiRequest, saveSession } from './apiClient.js';

export async function signupUser(payload) {
  return apiRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function loginUser(payload) {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (response.session) {
    saveSession(response.session);
  }

  return response;
}

export async function getMe() {
  return apiRequest('/me');
}