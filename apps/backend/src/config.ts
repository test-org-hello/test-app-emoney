import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  CIRCLE_BASE_URL: z.url(),
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be a 32-byte hex string'),
  CIRCLE_BLOCKCHAIN: z.string().default('BASE-SEPOLIA'),
  CIRCLE_ACCOUNT_TYPE: z.enum(['SCA', 'EOA']).default('SCA'),
  CIRCLE_WALLET_SET_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  CIRCLE_WEBHOOK_VERIFY_SIGNATURE: bool.default(true),

  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee apps/backend/.env.example`);
  }
  return parsed.data;
}
