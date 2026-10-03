import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const envSchema = z.object({
  /** 0 picks a free port (tests). */
  HUDDLE_PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  HUDDLE_HOST: z.string().default('0.0.0.0'),
  /** Directory with the built web client (apps/web/dist). Empty disables static hosting. */
  HUDDLE_STATIC_DIR: z.string().default(''),
  /** Allowed browser origins for WebSocket/API access. Empty = same-origin only. */
  HUDDLE_ALLOWED_ORIGINS: csv.default([]),
  HUDDLE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Secret used to sign room tokens and resume tokens. Generated per boot when unset. */
  HUDDLE_TOKEN_SECRET: z.string().min(16).optional(),
  HUDDLE_TRUST_PROXY: bool.default(false),
  /** Comma-separated STUN/TURN URLs, e.g. `stun:stun.example.com:3478,turn:turn.example.com:3478`. */
  HUDDLE_ICE_URLS: csv.default([]),
  /** coturn `static-auth-secret` for minting short-lived TURN credentials. */
  HUDDLE_TURN_SECRET: z.string().optional(),
  HUDDLE_TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  HUDDLE_MEDIA_TRANSPORT: z.enum(['mesh', 'livekit']).default('mesh'),
  HUDDLE_LIVEKIT_URL: z.string().optional(),
  HUDDLE_LIVEKIT_API_KEY: z.string().optional(),
  HUDDLE_LIVEKIT_API_SECRET: z.string().optional(),
  HUDDLE_MESH_CAP: z.coerce.number().int().min(2).max(16).default(8),
  HUDDLE_ROOM_CAPACITY: z.coerce.number().int().min(2).max(50).default(24),
  /** Concurrent WebSockets per client IP (offices behind one NAT need headroom). */
  HUDDLE_MAX_CONN_PER_IP: z.coerce.number().int().min(1).max(10_000).default(64),
  /** Rooms alive at once; new rooms are refused beyond this. */
  HUDDLE_MAX_ROOMS: z.coerce.number().int().min(1).max(100_000).default(500),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  return parsed.data;
}

/** Runtime config served to clients at `/config.json` (never contains secrets). */
export interface ClientRuntimeConfig {
  protocolVersion: number;
  mediaTransport: 'mesh' | 'livekit';
  meshCap: number;
  roomCapacity: number;
  features: Record<string, boolean>;
}
