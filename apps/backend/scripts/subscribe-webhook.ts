/**
 * Registers the backend webhook endpoint in Circle.
 *
 *   pnpm --filter @circle-wallet/backend circle:subscribe-webhook https://<public-host>/webhooks/circle
 *
 * The URL must be publicly reachable over HTTPS (e.g. a cloudflared/ngrok
 * tunnel to localhost:4000). Circle sends a HEAD request to validate it.
 * The same can be done in the console: Wallets -> Webhooks -> Add subscription.
 */
import { CircleClient } from '../src/circle/client.js';

const endpoint = process.argv[2];
const baseUrl = process.env.CIRCLE_BASE_URL;
const apiKey = process.env.CIRCLE_API_KEY;

if (!endpoint?.startsWith('https://')) {
  console.error('Usage: circle:subscribe-webhook https://<public-host>/webhooks/circle');
  process.exit(1);
}
if (!baseUrl || !apiKey) {
  console.error('Set CIRCLE_BASE_URL and CIRCLE_API_KEY in apps/backend/.env first.');
  process.exit(1);
}

const circle = new CircleClient({ baseUrl, apiKey, entitySecret: '' });
const sub = await circle.request<{ id: string; endpoint: string; enabled: boolean }>(
  'POST',
  '/v2/notifications/subscriptions',
  { body: { endpoint, notificationTypes: ['transactions.inbound', 'transactions.outbound'] } },
);
console.log('Subscription created:', sub);
