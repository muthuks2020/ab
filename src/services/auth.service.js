/**
 * auth.service.js — Authentication Service
 * @version 2.0.0 - Migrated to aop schema (v5)
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const authConfig = require('../config/auth');

const AuthService = {

  async login(username, password, deviceInfo = null, ipAddress = null) {
    const user = await db('ts_auth_users')
      .where({ username, is_active: true })
      .first();

    if (!user) {
      throw Object.assign(new Error('Invalid username or password.'), { status: 401 });
    }

    if (user.auth_provider === 'azure_ad') {
      throw Object.assign(new Error('This account requires Azure SSO login.'), { status: 401 });
    }

    if (!user.password_hash) {
      throw Object.assign(new Error('Password not set. Contact admin.'), { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw Object.assign(new Error('Invalid username or password.'), { status: 401 });
    }

    const jti = uuidv4();
    const accessToken = jwt.sign(
      {
        userId: user.id,
        employeeCode: user.employee_code,
        role: user.role,
        jti,
      },
      authConfig.jwt.secret,
      { expiresIn: authConfig.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, jti, type: 'refresh' },
      authConfig.jwt.refreshSecret,
      { expiresIn: authConfig.jwt.refreshExpiresIn }
    );

    const refreshHash = await bcrypt.hash(refreshToken, 6);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db('ts_user_sessions').insert({
      user_id: user.id,
      token_jti: jti,
      refresh_token: refreshHash,
      device_info: deviceInfo,
      ip_address: ipAddress,
      expires_at: expiresAt,
    });

    await db('ts_auth_users').where({ id: user.id }).update({ last_login_at: new Date() });

    return {
      user: {
        id: user.id,
        employeeCode: user.employee_code,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        zoneCode: user.zone_code,
        zoneName: user.zone_name,
        areaCode: user.area_code,
        areaName: user.area_name,
        territoryCode: user.territory_code,
        territoryName: user.territory_name,
        reportsTo: user.reports_to,
        isVacant: user.is_vacant || false,
      },
      accessToken,
      refreshToken,
    };
  },

  async logout(jti) {
    await db('ts_user_sessions')
      .where({ token_jti: jti })
      .update({ revoked_at: new Date() });
  },

  async refresh(refreshToken) {
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, authConfig.jwt.refreshSecret);
    } catch (err) {
      throw Object.assign(new Error('Invalid or expired refresh token.'), { status: 401 });
    }

    const session = await db('ts_user_sessions')
      .where({ token_jti: decoded.jti })
      .whereNull('revoked_at')
      .where('expires_at', '>', new Date())
      .first();

    if (!session) {
      throw Object.assign(new Error('Session not found or expired.'), { status: 401 });
    }

    const isMatch = await bcrypt.compare(refreshToken, session.refresh_token);
    if (!isMatch) {
      await db('ts_user_sessions').where({ id: session.id }).update({ revoked_at: new Date() });
      throw Object.assign(new Error('Refresh token mismatch. Session revoked.'), { status: 401 });
    }

    const user = await db('ts_auth_users').where({ id: decoded.userId, is_active: true }).first();
    if (!user) {
      throw Object.assign(new Error('User not found.'), { status: 401 });
    }

    await db('ts_user_sessions').where({ id: session.id }).update({ revoked_at: new Date() });

    const newJti = uuidv4();
    const newAccessToken = jwt.sign(
      { userId: user.id, employeeCode: user.employee_code, role: user.role, jti: newJti },
      authConfig.jwt.secret,
      { expiresIn: authConfig.jwt.expiresIn }
    );
    const newRefreshToken = jwt.sign(
      { userId: user.id, jti: newJti, type: 'refresh' },
      authConfig.jwt.refreshSecret,
      { expiresIn: authConfig.jwt.refreshExpiresIn }
    );

    const refreshHash = await bcrypt.hash(newRefreshToken, 6);
    await db('ts_user_sessions').insert({
      user_id: user.id,
      token_jti: newJti,
      refresh_token: refreshHash,
      device_info: session.device_info,
      ip_address: session.ip_address,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  async getProfile(userId) {
    const user = await db('ts_auth_users').where({ id: userId, is_active: true }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });

    let managerName = null;
    if (user.reports_to) {
      const mgr = await db('ts_auth_users').where({ employee_code: user.reports_to }).first();
      managerName = mgr?.full_name || null;
    }

    return {
      id: user.id,
      employeeCode: user.employee_code,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      designation: user.designation,
      zoneCode: user.zone_code,
      zoneName: user.zone_name,
      areaCode: user.area_code,
      areaName: user.area_name,
      territoryCode: user.territory_code,
      territoryName: user.territory_name,
      reportsTo: user.reports_to,
      managerName,
      isVacant: user.is_vacant || false,
    };
  },
};

module.exports = AuthService;
