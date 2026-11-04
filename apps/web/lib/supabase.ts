import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local');
}

/** Browser Supabase client, used only for Auth. Data goes through the backend API. */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
