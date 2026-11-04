/**
 * Creates a confirmed Supabase Auth user for testing (admin API, service role).
 *
 *   pnpm --filter backend auth:create-user demo@example.com demo12345
 *
 * Signing up from the login page works too (local Supabase auto-confirms emails).
 */
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password) {
  console.error('Usage: auth:create-user <email> <password>');
  process.exit(1);
}
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/backend/.env first.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
console.log(`Created ${data.user.email} (${data.user.id}). Sign in at http://localhost:3000`);
