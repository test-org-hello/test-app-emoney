import cors from 'cors';

/** CORS for the web app; `origins` is a comma-separated list (CORS_ORIGIN). */
export const corsMiddleware = (origins: string) => cors({ origin: origins.split(',').map((s) => s.trim()) });
