'use strict';

/**
 * Lightweight migration runner for the migrations shipped in this repository.
 * It records successfully applied filenames in schema_migrations and skips them
 * on later deploys. Existing migrations are written to be safe on an already
 * partially-migrated production database.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sequelize = require('./database');

const migrationsDir = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function isApplied(filename) {
  const [rows] = await sequelize.query(
    'SELECT filename FROM schema_migrations WHERE filename = :filename LIMIT 1',
    { replacements: { filename } }
  );
  return rows.length > 0;
}

async function markApplied(filename) {
  await sequelize.query(
    `INSERT INTO schema_migrations (filename) VALUES (:filename)
     ON CONFLICT (filename) DO NOTHING`,
    { replacements: { filename } }
  );
}

async function runMigration(filename) {
  const fullPath = path.join(migrationsDir, filename);
  const ext = path.extname(filename).toLowerCase();

  console.log(`→ ${filename}`);

  if (ext === '.sql') {
    const sql = fs.readFileSync(fullPath, 'utf8');
    await sequelize.query(sql);
    return;
  }

  if (ext === '.js') {
    const migration = require(fullPath);
    if (!migration || typeof migration.up !== 'function') {
      throw new Error(`${filename} does not export an up() migration function`);
    }
    await migration.up(sequelize.getQueryInterface(), require('sequelize'));
    return;
  }

  throw new Error(`Unsupported migration type: ${filename}`);
}

async function main() {
  try {
    await sequelize.authenticate();
    await ensureMigrationsTable();

    const files = fs.readdirSync(migrationsDir)
      .filter(name => name.endsWith('.sql') || name.endsWith('.js'))
      .sort();

    for (const filename of files) {
      if (await isApplied(filename)) {
        console.log(`✓ ${filename} already applied`);
        continue;
      }

      await runMigration(filename);
      await markApplied(filename);
      console.log(`✓ ${filename} applied`);
    }

    console.log('All repository migrations are up to date.');
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    if (process.env.NODE_ENV !== 'production') console.error(error.stack);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  }
}

main();
