import type { z } from 'zod';
import type { configSchema } from './config.js';

/** Validated environment configuration of the backend (see apps/backend/.env.example). */
export type Config = z.infer<typeof configSchema>;
