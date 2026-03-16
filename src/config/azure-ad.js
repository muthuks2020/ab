'use strict';

const TENANT_ID = process.env.AZURE_TENANT_ID || '';
const CLIENT_ID = process.env.AZURE_CLIENT_ID || '';

module.exports = {

  SSO_ENABLED: process.env.AZURE_SSO_ENABLED === 'true',
  enabled:     process.env.AZURE_SSO_ENABLED === 'true',

  credentials: {
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
  },

  JWKS_URI: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
  AUDIENCE: CLIENT_ID,
  ISSUER:   `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,

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

  GROUP_ROLE_MAP: {
    'SG-PWA-SalesRep':  'sales_rep',
    'SG-PWA-TBM':       'tbm',
    'SG-PWA-ABM':       'abm',
    'SG-PWA-ZBM':       'zbm',
    'SG-PWA-SalesHead': 'sales_head',
    'SG-PWA-Admin':     'admin',
  },
};
