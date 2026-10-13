export function apiUrl(path: string): string {
  const apiBaseUrl = new URL('api/', document.baseURI);
  return new URL(path.replace(/^\/+/, ''), apiBaseUrl).pathname;
}
