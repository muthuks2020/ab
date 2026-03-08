require('dotenv').config();

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
      pool: { min: 2, max: 10 },
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

// ★ KEY FIX: db is a function (lazy) — NOT called at require time
// This ensures dotenv has loaded before the first DB call
function db(table) {
  return getKnex()(table);
}

module.exports = { getKnex, db, testConnection, destroy };
