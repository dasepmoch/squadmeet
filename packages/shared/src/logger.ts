export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  child(scope: string): Logger;
}

export interface LogRecord {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

export type LogSink = (record: LogRecord) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Builds a scoped logger on top of any sink (console, file, test collector). */
export function createLogger(sink: LogSink, scope = 'app', minLevel: LogLevel = 'info'): Logger {
  const emit = (level: LogLevel, message: string, data?: unknown): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    sink(data === undefined ? { level, scope, message } : { level, scope, message, data });
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (childScope) => createLogger(sink, `${scope}:${childScope}`, minLevel),
  };
}

/** Collects records in memory. Useful for tests and the debug overlay. */
export function createMemorySink(capacity = 200): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    sink: (record) => {
      records.push(record);
      if (records.length > capacity) records.shift();
    },
  };
}

/** Normalizes unknown thrown values into a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch (jsonErr: unknown) {
    return `Unserializable error (${String(jsonErr)})`;
  }
}
