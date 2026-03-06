/**
 * database.js — PostgreSQL / Knex Configuration
 * 
 * Provides a singleton Knex instance configured for the aop schema.
 * All services import { db } or getKnex() to run queries.
 * 
 * @version 2.0.0 — Migrated to unified aop schema (v5)
 * @author Appasamy Associates - Target Setting PWA
 */

const knex = require('knex');

let knexInstance = null;

function getKnex() {
  if (!knexInstance) {
    knexInstance = knex({
      client: 'pg',
      connection: {
        host     : process.env.DB_HOST     || 'report-db.ct0cwymqiinz.ap-south-1.rds.amazonaws.com',
        port     : parseInt(process.env.DB_PORT || '5432', 10),
        database : process.env.DB_NAME     || 'appasamy_rpt',
        user     : process.env.DB_USER     || 'aop_user',
        password : process.env.DB_PASSWORD || 'aop_access',
        ssl      : { rejectUnauthorized: false },
      },
      searchPath: [process.env.DB_SCHEMA || 'aop'],
      pool: {
        min: 2,
        max: 10,
      },
    });
  }
  return knexInstance;
}

async function testConnection() {
  try {
    const k = getKnex();
    await k.raw('SELECT 1');
    console.log('[DB] PostgreSQL connection successful');
    return true;
  } catch (error) {
    console.error('[DB] PostgreSQL connection failed:', error.message);
    return false;
  }
}

async function destroy() {
  if (knexInstance) {
    await knexInstance.destroy();
    knexInstance = null;
  }
}

module.exports = {
  getKnex,
  db: getKnex(),
  testConnection,
  destroy,
};
