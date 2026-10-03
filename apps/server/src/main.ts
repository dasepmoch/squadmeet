import { createHuddleServer } from './app.ts';
import { loadConfig } from './config.ts';
import { createServerLogger } from './logger.ts';

const config = loadConfig();
const log = createServerLogger(config.HUDDLE_LOG_LEVEL);
const server = await createHuddleServer(config, log);
const port = await server.listen();
log.info('listening', { host: config.HUDDLE_HOST, port });

function shutdown(signal: string): void {
  log.info('shutting down', { signal });
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
