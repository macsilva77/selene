import axios from 'axios';
import { tokenStore } from '@selene/providers';
import { clearSession } from './session';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

export const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  withCredentials: true, // envia cookies HttpOnly automaticamente (refresh + access)
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let redirecting = false;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (
      axios.isAxiosError(err) &&
      err.response?.status === 401 &&
      globalThis.window !== undefined &&
      !redirecting
    ) {
      redirecting = true;
      clearSession();
      globalThis.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
