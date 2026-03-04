/**
 * Seed Script
 * Generates real bcrypt hashes for the demo password and updates seed users.
 * Run: node seeds/run-seeds.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, testConnection } = require('../src/config/database');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

async function runSeeds() {
  console.log('🌱 Starting seed process...');
  await testConnection();

  // Generate bcrypt hash
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  console.log(`   Password: "${DEMO_PASSWORD}" → hash generated`);

  // Update all users that have the placeholder hash
  const result = await db('auth_users')
    .where('password_hash', 'LIKE', '$2b$10$YourBcryptHashHere%')
    .update({ password_hash: hash });

  console.log(`   Updated ${result} user(s) with real bcrypt hash.`);

  // If no users were updated (maybe already correct), check total count
  const count = await db('auth_users').count('* as total').first();
  console.log(`   Total users in DB: ${count.total}`);

  // Verify login works
  const testUser = await db('auth_users').where('username', 'sr_vasanth').first();
  if (testUser) {
    const isMatch = await bcrypt.compare(DEMO_PASSWORD, testUser.password_hash);
    console.log(`   Login test (sr_vasanth + ${DEMO_PASSWORD}): ${isMatch ? '✅ PASS' : '❌ FAIL'}`);
  }

  console.log('🌱 Seed complete.\n');
  process.exit(0);
}

runSeeds().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
