/**
 * sso.service.js — Azure AD SSO Backend Service
 *
 * 4-step lookup: azure_oid → employee_code → email → auto-provision
 * Token validation uses JWKS public keys (no client secret needed).
 * Employee code comes from Azure AD phone_number claim (domain convention).
 *
 * ★ SAFE REQUIRE: If jwks-rsa is not installed, the server still starts.
 *   validateAzureToken will throw a clear error at runtime instead of
 *   crashing the entire backend at startup.
 *
 * @version 3.1.0
 */

const jwt = require('jsonwebtoken');
const azureConfig = require('../config/azure-ad');
const db = require('../config/database');

// ★ Safe require — don't crash the server if jwks-rsa isn't installed
let jwksClient;
try {
  jwksClient = require('jwks-rsa');
} catch (err) {
  console.warn('[SSO] jwks-rsa package not installed. SSO token validation will not work.');
  console.warn('[SSO] Run: npm install jwks-rsa');
  jwksClient = null;
}

let jwksClientInstance = null;

function getJwksClient() {
  if (!jwksClient) {
    throw new Error(
      'jwks-rsa package is not installed. Run: npm install jwks-rsa'
    );
  }
  if (!jwksClientInstance) {
    jwksClientInstance = jwksClient({
      jwksUri: azureConfig.JWKS_URI,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
    });
  }
  return jwksClientInstance;
}

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Validate Azure AD ID token using JWKS public keys.
 * @param {string} idToken — Raw JWT from MSAL popup
 * @returns {object} Decoded claims
 */
async function validateAzureToken(idToken) {
  if (!idToken) throw new Error('No token provided');

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header) throw new Error('Invalid token format');

  const publicKey = await getSigningKey(decoded.header);

  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: azureConfig.AUDIENCE,
    issuer: azureConfig.ISSUER,
  });

  return claims;
}

/**
 * 4-step user lookup/create:
 *   Step 1: azure_oid → returning SSO user
 *   Step 2: employee_code (from phone_number claim) → link existing user
 *   Step 3: email → link existing user
 *   Step 4: auto-provision new user
 */
async function findOrCreateSsoUser({ azure_oid, email, name, employee_code, groups }) {
  const knex = db.getKnex();

  // ── Step 1: Look up by azure_oid (returning user) ──────────────────
  let user = await knex('ts_auth_users').where('azure_oid', azure_oid).first();

  if (user) {
    console.log(`[SSO] Found user by azure_oid: ${azure_oid}`);
    await knex('ts_auth_users').where('id', user.id).update({
      azure_upn: email,
      last_login_at: new Date(),
    });
    return await knex('ts_auth_users').where('id', user.id).first();
  }

  // ── Step 2: Look up by employee_code (Azure AD phone_number) ───────
  if (employee_code && employee_code.trim()) {
    user = await knex('ts_auth_users')
      .where('employee_code', employee_code.trim())
      .first();

    if (user) {
      console.log(`[SSO] Linked user by employee_code: ${employee_code}`);
      await knex('ts_auth_users').where('id', user.id).update({
        azure_oid,
        azure_upn: email,
        email: email || user.email,
        auth_provider: 'both',
        last_login_at: new Date(),
      });

      try {
        await knex('ts_audit_log').insert({
          actor_code: user.employee_code,
          actor_role: user.role,
          action: 'sso_account_linked_by_empcode',
          entity_type: 'auth_users',
          entity_id: user.id,
          detail: JSON.stringify({ azure_oid, email, employee_code }),
        });
      } catch (auditErr) {
        console.warn('[SSO] Audit log insert failed:', auditErr.message);
      }

      return await knex('ts_auth_users').where('id', user.id).first();
    }
  }

  // ── Step 3: Look up by email — link azure_oid ──────────────────────
  if (email) {
    user = await knex('ts_auth_users').where('email', email).first();

    if (user) {
      console.log(`[SSO] Linked user by email: ${email}`);
      await knex('ts_auth_users').where('id', user.id).update({
        azure_oid,
        azure_upn: email,
        auth_provider: 'both',
        last_login_at: new Date(),
      });

      try {
        await knex('ts_audit_log').insert({
          actor_code: user.employee_code,
          actor_role: user.role,
          action: 'sso_account_linked',
          entity_type: 'auth_users',
          entity_id: user.id,
          detail: JSON.stringify({ azure_oid, email }),
        });
      } catch (auditErr) {
        console.warn('[SSO] Audit log insert failed:', auditErr.message);
      }

      return await knex('ts_auth_users').where('id', user.id).first();
    }
  }

  // ── Step 4: Auto-provision new user ────────────────────────────────
  console.log(`[SSO] Auto-provisioning new user: ${email}`);
  const role = determineRole(groups, email);

  // Use employee_code from Azure AD if available, otherwise generate one
  const finalEmployeeCode = (employee_code && employee_code.trim())
    ? employee_code.trim()
    : await generateEmployeeCode(knex, role);

  const [newUser] = await knex('ts_auth_users').insert({
    employee_code: finalEmployeeCode,
    username: email.split('@')[0],
    full_name: name,
    email,
    role,
    auth_provider: 'azure_ad',
    azure_oid,
    azure_upn: email,
    is_active: true,
    last_login_at: new Date(),
  }).returning('*');

  try {
    await knex('ts_audit_log').insert({
      actor_code: finalEmployeeCode,
      actor_role: role,
      action: 'sso_user_provisioned',
      entity_type: 'auth_users',
      entity_id: newUser.id,
      detail: JSON.stringify({ azure_oid, email, employee_code, groups }),
    });
  } catch (auditErr) {
    console.warn('[SSO] Audit log insert failed:', auditErr.message);
  }

  return newUser;
}

/**
 * Determine role from Azure AD groups or admin email list.
 */
function determineRole(groups, email) {
  const adminEmails = (process.env.DEFAULT_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase());

  if (adminEmails.includes(email.toLowerCase())) return 'admin';

  if (groups && groups.length > 0 && azureConfig.GROUP_ROLE_MAP) {
    for (const [groupName, role] of Object.entries(azureConfig.GROUP_ROLE_MAP)) {
      if (groups.includes(groupName)) return role;
    }
  }

  return process.env.DEFAULT_SSO_ROLE || 'sales_rep';
}

/**
 * Generate a unique employee code based on role prefix.
 */
async function generateEmployeeCode(knex, role) {
  const prefixMap = {
    sales_rep: 'SR', tbm: 'TBM', abm: 'ABM', zbm: 'ZBM',
    sales_head: 'SH', admin: 'ADM',
    at_iol_specialist: 'ATIOL', eq_spec_diagnostic: 'EQSD',
    eq_spec_surgical: 'EQSS', at_iol_manager: 'ATIOLM',
    eq_mgr_diagnostic: 'EQMD', eq_mgr_surgical: 'EQMS',
  };

  const prefix = prefixMap[role] || 'EMP';
  const lastUser = await knex('ts_auth_users')
    .where('employee_code', 'like', `${prefix}-%`)
    .orderBy('employee_code', 'desc')
    .first();

  let nextNum = 1;
  if (lastUser) {
    const parts = lastUser.employee_code.split('-');
    nextNum = parseInt(parts[parts.length - 1] || 0) + 1;
  }

  return `${prefix}-${String(nextNum).padStart(4, '0')}`;
}

module.exports = {
  validateAzureToken,
  findOrCreateSsoUser,
  determineRole,
  generateEmployeeCode,
};
