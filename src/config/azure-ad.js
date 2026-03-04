'use strict';
/**
 * azure-ad.js — Azure AD / SSO configuration
 * @version 3.0.0 — Added JWKS_URI, AUDIENCE, ISSUER, SSO_ENABLED exports
 *
 * No client secret needed:
 *   - Frontend uses MSAL.js PKCE (no secret for SPA)
 *   - Backend validates ID token via JWKS public keys
 */

const TENANT_ID = process.env.AZURE_TENANT_ID || '';
const CLIENT_ID = process.env.AZURE_CLIENT_ID || '';

module.exports = {
  // ─── Feature flag ─────────────────────────────────────────────────
  // auth.controller.js checks azureConfig.SSO_ENABLED
  SSO_ENABLED: process.env.AZURE_SSO_ENABLED === 'true',
  enabled:     process.env.AZURE_SSO_ENABLED === 'true',

  // ─── Credentials (no client secret) ───────────────────────────────
  credentials: {
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
  },

  // ─── Token validation (used by sso.service.js) ────────────────────
  JWKS_URI: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
  AUDIENCE: CLIENT_ID,
  ISSUER:   `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,

  // ─── Metadata ─────────────────────────────────────────────────────
  metadata: {
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    discovery: '.well-known/openid-configuration',
    version:   'v2.0',
  },

  settings: {
    validateIssuer:    true,
    passReqToCallback: true,
    loggingLevel:      'warn',
    loggingNoPII:      true,
  },

  redirectUrl: process.env.AZURE_REDIRECT_URI
    || 'http://localhost:3000/api/v1/auth/sso-callback',

  scopes: ['openid', 'profile', 'email', 'User.Read'],

  // ─── Azure AD Group → App Role mapping ────────────────────────────
  GROUP_ROLE_MAP: {
    'SG-PWA-SalesRep':  'sales_rep',
    'SG-PWA-TBM':       'tbm',
    'SG-PWA-ABM':       'abm',
    'SG-PWA-ZBM':       'zbm',
    'SG-PWA-SalesHead': 'sales_head',
    'SG-PWA-Admin':     'admin',
  },
};
