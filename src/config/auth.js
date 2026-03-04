/**
 * auth.js — Authentication Configuration
 * 
 * @version 2.0.0 - Dual-auth support (local + SSO)
 * @author Appasamy Associates - Target Setting PWA
 */

const authConfig = {

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  mode: process.env.AUTH_MODE || 'local',

  azureAd: {
    enabled: (process.env.AUTH_MODE || 'local') !== 'local',
    tenantId: process.env.AZURE_AD_TENANT_ID || '',
    clientId: process.env.AZURE_AD_CLIENT_ID || '',
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
    redirectUri: process.env.AZURE_AD_REDIRECT_URI || '',
    identityMetadata: process.env.AZURE_AD_TENANT_ID
      ? `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0/.well-known/openid-configuration`
      : '',

    groupRoleMap: {
      'SG-PWA-SalesRep': 'sales_rep',
      'SG-PWA-TBM': 'tbm',
      'SG-PWA-ABM': 'abm',
      'SG-PWA-ZBM': 'zbm',
      'SG-PWA-SalesHead': 'sales_head',
      'SG-PWA-Admin': 'admin',
    },
  },
};

module.exports = authConfig;
