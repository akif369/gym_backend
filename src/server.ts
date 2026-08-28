import { buildApp } from './app';
import { config } from './config/env';
import { logger } from './common/logger/index';
import { checkDatabaseConnection, closeDatabaseConnection } from './db/index';
import * as fs from 'fs';
import * as path from 'path';
import { startMembershipExpiryScheduler } from './modules/memberships/memberships.scheduler';
import { startAttendanceAutoCheckoutScheduler } from './modules/attendance/attendance.scheduler';

// ── Ensure upload directory exists ────────────────────────────────────────────
const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info({ uploadDir }, 'Upload directory created');
}

// ── Start Server ──────────────────────────────────────────────────────────────

async function start() {
  let fastify: Awaited<ReturnType<typeof buildApp>> | undefined;
  let stopMembershipExpiryScheduler: (() => void) | undefined;
  let stopAttendanceAutoCheckoutScheduler: (() => void) | undefined;

  try {
    fastify = await buildApp();

    const isDatabaseConnected = await checkDatabaseConnection();
    if (isDatabaseConnected) {
      logger.info('Database connection verified');
    } else {
      logger.warn('Database connection check failed');
    }

    // Ensure S3 bucket exists
    const { ensureBucketExists } = await import('./common/storage/s3');
    await ensureBucketExists();

    await fastify.listen({
      port: config.port,
      host: config.host,
    });
    stopMembershipExpiryScheduler = startMembershipExpiryScheduler();
    stopAttendanceAutoCheckoutScheduler = startAttendanceAutoCheckoutScheduler();

    logger.info(
      {
        port: config.port,
        host: config.host,
        env: config.nodeEnv,
        apiPrefix: config.apiPrefix,
        docsUrl: `http://localhost:${config.port}/docs`,
      },
      '🚀 GYMatrix API server started',
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, closing server gracefully...');
    try {
      stopMembershipExpiryScheduler?.();
      stopAttendanceAutoCheckoutScheduler?.();
      if (fastify) await fastify.close();
      await closeDatabaseConnection();
      logger.info('Server shut down cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ── Unhandled Rejection / Exception Guard ──────────────────────────────────
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled Promise Rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught Exception — server will exit');
    process.exit(1);
  });
}

void start();
