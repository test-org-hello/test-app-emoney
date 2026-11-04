import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { logger as log } from './lib/logger.js';

const config = loadConfig();
const { app, reconciler } = buildContainer(config, log);

const server = app.listen(config.PORT, () => {
  log.info(
    { port: config.PORT, circle: config.CIRCLE_BASE_URL, blockchain: config.CIRCLE_BLOCKCHAIN },
    'backend listening',
  );
});
reconciler.start(config.RECONCILE_INTERVAL_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    reconciler.stop();
    server.close(() => process.exit(0));
  });
}
