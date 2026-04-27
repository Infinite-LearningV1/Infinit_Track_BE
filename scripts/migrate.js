#!/usr/bin/env node

/**
 * Safe Database Migration Script
 *
 * This script runs Sequelize migrations in a safe, idempotent manner.
 * It will:
 * - Check database connection before running
 * - Run only pending migrations
 * - Exit with proper error codes
 * - Log migration status
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import sequelize from '../src/config/database.js';
import logger from '../src/utils/logger.js';
import { reconcileMigrationMeta } from './migrationMetaCompatibility.js';

const execAsync = promisify(exec);

async function runMigrations() {
  const startTime = Date.now();

  try {
    logger.info('Starting database migration process...');

    // Step 1: Test database connection
    logger.info('Testing database connection...');
    await sequelize.authenticate();
    logger.info('✓ Database connection successful');

    // Step 2: Reconcile legacy migration filenames before status/migrate checks
    logger.info('Reconciling legacy migration metadata...');
    const reconciliationOps = await reconcileMigrationMeta(sequelize);
    logger.info('Migration metadata reconciliation operations:', reconciliationOps);

    // Step 3: Check migration status
    logger.info('Checking migration status...');
    try {
      const { stdout: statusOutput } = await execAsync(
        'npx sequelize-cli db:migrate:status --migrations-path src/models/migrations',
        { env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' } }
      );
      logger.info('Migration status:', statusOutput);
    } catch (error) {
      logger.warn('Could not check migration status (this is OK for first run)');
    }

    // Step 4: Run migrations
    logger.info('Running pending migrations...');
    const { stdout, stderr } = await execAsync(
      'npx sequelize-cli db:migrate --migrations-path src/models/migrations',
      { env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' } }
    );

    if (stdout) logger.info('Migration output:', stdout);
    if (stderr) logger.warn('Migration warnings:', stderr);

    const duration = Date.now() - startTime;
    logger.info(`✓ Migrations completed successfully in ${duration}ms`);

    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`✗ Migration failed after ${duration}ms:`, {
      message: error.message,
      stack: error.stack,
      stdout: error.stdout,
      stderr: error.stderr
    });

    // Exit with error code to stop deployment
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection during migration:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception during migration:', error);
  process.exit(1);
});

// Run migrations
runMigrations();
