import { setBaseUrl } from '@workspace/api-client-react';

/**
 * Configures the generated API client to call the deployed API service.
 *
 * Reads `VITE_API_URL` (a build-time env var, e.g.
 * `https://train-tracker-api.onrender.com`). When unset the client keeps
 * same-origin relative `/api/*` calls, which is what local/Replit previews use.
 */
export function configureApiClient(): void {
  const apiUrl = import.meta.env.VITE_API_URL;
  setBaseUrl(
    typeof apiUrl === 'string' && apiUrl.trim() !== '' ? apiUrl : null,
  );
}
