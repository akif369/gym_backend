import * as dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalEnvNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number, got: ${raw}`);
  return parsed;
}

function optionalEnvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Environment variable ${key} must be true or false, got: ${raw}`);
}

function evolutionGoConfig() {
  const enabled = optionalEnvBoolean('EVOLUTION_GO_ENABLED', false);
  const baseUrl = optionalEnv('EVOLUTION_GO_URL', '').trim().replace(/\/+$/, '');
  const instanceToken = optionalEnv('EVOLUTION_GO_INSTANCE_TOKEN', '').trim();
  const defaultCountryCode = optionalEnv('EVOLUTION_GO_DEFAULT_COUNTRY_CODE', '91').trim();
  const timeoutMs = optionalEnvNumber('EVOLUTION_GO_TIMEOUT_MS', 10_000);

  if (!/^\d{1,3}$/.test(defaultCountryCode)) {
    throw new Error('EVOLUTION_GO_DEFAULT_COUNTRY_CODE must contain 1 to 3 digits');
  }
  if (timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new Error('EVOLUTION_GO_TIMEOUT_MS must be between 1000 and 60000');
  }
  if (enabled) {
    if (!baseUrl) throw new Error('EVOLUTION_GO_URL is required when EVOLUTION_GO_ENABLED=true');
    if (!instanceToken) throw new Error('EVOLUTION_GO_INSTANCE_TOKEN is required when EVOLUTION_GO_ENABLED=true');

    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('EVOLUTION_GO_URL must be a valid absolute HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('EVOLUTION_GO_URL must use http or https');
    }
    if (/\/send\/text$/i.test(url.pathname)) {
      throw new Error('EVOLUTION_GO_URL must be the Evolution Go base URL; /send/text is added by the backend');
    }
  }

  return { enabled, baseUrl, instanceToken, defaultCountryCode, timeoutMs };
}

export const config = {
  // ── Server ──────────────────────────────────────────────────
  nodeEnv: optionalEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalEnvNumber('PORT', 3001),
  host: optionalEnv('HOST', '0.0.0.0'),
  appName: optionalEnv('APP_NAME', 'GymFlow'),
  apiPrefix: optionalEnv('API_PREFIX', '/api/v1'),
  publicApiUrl: optionalEnv('PUBLIC_API_URL', `http://localhost:${optionalEnvNumber('PORT', 3001)}`).replace(/\/$/, ''),
publicWebUrl: optionalEnv(
  'PUBLIC_WEB_URL',
  (optionalEnv('CORS_ORIGIN', 'http://localhost:3000').split(',')[0] ?? 'http://localhost:3000').trim()
).replace(/\/$/, ''),

  // ── Database ─────────────────────────────────────────────────
  databaseUrl: requireEnv('DATABASE_URL'),

  // ── JWT ──────────────────────────────────────────────────────
  jwt: {
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    accessExpiresIn: optionalEnv('JWT_ACCESS_EXPIRES_IN', '1d'),    // 1 day — long-lived for usability
    refreshExpiresIn: optionalEnv('JWT_REFRESH_EXPIRES_IN', '365d'), // 1 year — sliding expiry
    refreshExpiresInMs: 365 * 24 * 60 * 60 * 1000, // 365 days in ms
  },



  // ── CORS ─────────────────────────────────────────────────────
  corsOrigins: optionalEnv('CORS_ORIGIN', 'http://localhost:3000').split(',').map(s => s.trim()),

  // ── Rate Limiting ────────────────────────────────────────────
  rateLimitMax: optionalEnvNumber('RATE_LIMIT_MAX', 100),
  authRateLimitMax: optionalEnvNumber('AUTH_RATE_LIMIT_MAX', 10),

  // ── File Uploads ─────────────────────────────────────────────
  uploadDir: optionalEnv('UPLOAD_DIR', './uploads'),
  maxFileSizeMb: optionalEnvNumber('MAX_FILE_SIZE_MB', 5),

  // ── Security ─────────────────────────────────────────────────
  passwordResetTokenExpiresMinutes: optionalEnvNumber('PASSWORD_RESET_TOKEN_EXPIRES_MINUTES', 60),
  maxFailedLoginAttempts: optionalEnvNumber('MAX_FAILED_LOGIN_ATTEMPTS', 5),
  accountLockoutDurationMinutes: optionalEnvNumber('ACCOUNT_LOCKOUT_DURATION_MINUTES', 30),

  // ── Logging ──────────────────────────────────────────────────
  logLevel: optionalEnv('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  // ── S3 / Storage ─────────────────────────────────────────────
  s3: {
    endpoint: optionalEnv('S3_ENDPOINT', 'http://localhost:3900'),
    region: optionalEnv('S3_REGION', 'garage'),
    accessKeyId: optionalEnv('S3_ACCESS_KEY', 'garage_key'),
    secretAccessKey: optionalEnv('S3_SECRET_KEY', 'garage_secret'),
    bucketName: optionalEnv('S3_BUCKET_NAME', 'gymatrix-image'),
  },

  evolutionGo: evolutionGoConfig(),
  membershipExpirySweepIntervalMs: optionalEnvNumber('MEMBERSHIP_EXPIRY_SWEEP_INTERVAL_MS', 60 * 60 * 1000),
  attendanceAutoCheckoutSweepIntervalMs: optionalEnvNumber('ATTENDANCE_AUTO_CHECKOUT_SWEEP_INTERVAL_MS', 60 * 1000),

  // ── Derived ──────────────────────────────────────────────────
  isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
  isDevelopment: optionalEnv('NODE_ENV', 'development') === 'development',
  isTest: optionalEnv('NODE_ENV', 'development') === 'test',
} as const;

export type Config = typeof config;
