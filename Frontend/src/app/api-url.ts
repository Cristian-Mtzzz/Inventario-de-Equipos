import { isDevMode } from '@angular/core';

const API_BASE_PATH = isDevMode() ? 'api/' : '/ApiInventariosTic/api/';

export function apiUrl(path: string): string {
  const apiBaseUrl = new URL(API_BASE_PATH, document.baseURI);
  return new URL(path.replace(/^\/+/, ''), apiBaseUrl).pathname;
}
