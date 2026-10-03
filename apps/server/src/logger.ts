import { createLogger, type Logger, type LogLevel } from '@huddle/shared';

/** JSON-lines logger for the server (stdout for info/debug, stderr for warn/error). */
export function createServerLogger(level: LogLevel): Logger {
  return createLogger(
    (r) => {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        level: r.level,
        scope: r.scope,
        msg: r.message,
        ...(r.data === undefined ? {} : { data: r.data }),
      });
      if (r.level === 'warn' || r.level === 'error') process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    },
    'server',
    level,
  );
}
