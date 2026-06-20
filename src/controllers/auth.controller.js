import { randomUUID } from 'crypto';

import { validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import config from '../config/index.js';
import { buildUserProfilePhotoKey, uploadBufferToSpaces, deleteSpacesObject } from '../config/spaces.js';
import {
  User,
  Photo,
  Role,
  Program,
  Position,
  Division,
  AttendanceCategory,
  AuthSession
} from '../models/index.js';
import sequelize from '../config/database.js';
import Location from '../models/location.js';
import logger from '../utils/logger.js';

export const login = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Login failed - Validation errors: ${JSON.stringify(errors.array())}`);
      return res.status(400).json({
        success: false,
        code: 'E_LOGIN',
        message: errors.array()[0].msg
      });
    }

    const { email, password } = req.body;
    const userAgent = req.get('User-Agent') || '';
    const clientType = resolveClientType(req);
    const user = await User.findOne({
      where: { email: email.toLowerCase() },
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id_roles', 'role_name']
        },
        {
          model: Program,
          as: 'program',
          attributes: ['program_name']
        },
        {
          model: Position,
          as: 'position',
          attributes: ['position_name']
        },
        { model: Division, as: 'division', attributes: ['division_name'] },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at']
        }
      ]
    });
    if (!user) {
      logger.warn(`Login failed - Email not found: ${email}`);
      return res.status(400).json({
        success: false,
        code: 'E_LOGIN',
        message: 'Email tidak terdaftar'
      });
    }
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn(`Login failed - Wrong password for: ${email}`);
      return res.status(400).json({
        success: false,
        code: 'E_LOGIN',
        message: 'Password salah'
      });
    }

    // Get user's WFH default location
    let wfhLocation = null;
    try {
      wfhLocation = await Location.findOne({
        where: {
          user_id: user.id_users,
          id_attendance_categories: 2 // WFH category
        },
        include: [
          {
            model: AttendanceCategory,
            as: 'category',
            attributes: ['category_name']
          }
        ]
      });
    } catch (locationError) {
      logger.warn(
        `Could not fetch WFH location for user ${user.id_users}: ${locationError.message}`
      );
    }

    const roleName = await resolveRoleName(user);
    const photoUrl = user.photo_file ? user.photo_file.photo_url : null;
    const tokenUserState = {
      id: user.id_users,
      email: user.email,
      full_name: user.full_name,
      role_name: roleName,
      photo: photoUrl
    };
    const responseData = {
      id: user.id_users,
      full_name: user.full_name,
      email: user.email,
      role_name: roleName,
      position_name: user.position?.position_name || null,
      program_name: user.program?.program_name || null,
      division_name: user.division ? user.division.division_name : null,
      nip_nim: user.nip_nim,
      phone: user.phone,
      photo: photoUrl,
      photo_updated_at: user.photo_file ? user.photo_file.photo_updated_at : null,
      location: wfhLocation
        ? {
            latitude: parseFloat(wfhLocation.latitude),
            longitude: parseFloat(wfhLocation.longitude),
            radius: parseFloat(wfhLocation.radius),
            description: wfhLocation.description,
            category_name: wfhLocation.category?.category_name || null
          }
        : null
    };

    const transaction = await sequelize.transaction();
    let accessToken;
    let refreshToken;

    try {
      await lockUserForSessionReplacement(user.id_users, transaction);
      await revokeActiveSessionsForClient(user.id_users, clientType, { transaction });

      const { refreshJti, session } = await createAuthSession(
        user.id_users,
        clientType,
        userAgent,
        { transaction }
      );
      ({ accessToken, refreshToken } = buildSessionTokens(
        tokenUserState,
        session.session_id,
        refreshJti
      ));

      await transaction.commit();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error(`Login session replacement rollback failed: ${rollbackError.message}`, {
          stack: rollbackError.stack,
          original_error: error.message,
          user_id: user.id_users,
          client_type: clientType
        });
      }

      throw error;
    }

    if (clientType === 'web') {
      setSessionCookies(res, accessToken, refreshToken);
    }

    responseData.token = accessToken;
    responseData.auth = buildAuthResponse(accessToken, refreshToken, clientType);
    if (clientType !== 'web') {
      responseData.refresh_token = refreshToken;
    }

    logger.info(`Login successful for user: ${email}`);

    res.json({
      success: true,
      data: responseData,
      message: 'Login berhasil'
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      code: 'E_LOGIN',
      message: 'Terjadi kesalahan pada server'
    });
  }
};

function resolveRefreshToken(req) {
  return req.cookies?.refresh_token || req.body?.refresh_token || null;
}

function resolveAccessToken(req) {
  const authHeader = req.headers?.authorization;

  if (authHeader) {
    const [scheme, value, extra] = authHeader.trim().split(/\s+/);

    if (scheme?.toLowerCase() === 'bearer' && value && !extra) {
      return value;
    }
  }

  return req.cookies?.token || null;
}

function resolveClientType(req) {
  const explicitClientType = req.headers?.['x-client-type']?.toString().trim().toLowerCase();
  const userAgent = req.get('User-Agent') || '';
  const authHeader = req.headers?.authorization || '';
  const browserUserAgentPattern = /(Mozilla\/|AppleWebKit\/|Chrome\/|Safari\/|Firefox\/|Edg\/)/i;
  const nativeUserAgentPattern = /(okhttp|dalvik|cfnetwork)/i;

  if (explicitClientType === 'web') {
    return 'web';
  }

  if (explicitClientType === 'mobile') {
    return 'mobile';
  }

  if (explicitClientType === 'android') {
    return 'android';
  }

  if (browserUserAgentPattern.test(userAgent)) {
    return 'web';
  }

  if (nativeUserAgentPattern.test(userAgent)) {
    return 'android';
  }

  if (authHeader.trim().toLowerCase().startsWith('bearer ')) {
    return 'android';
  }

  return 'android';
}

function buildAccessTokenPayload({ session_id, id, email, full_name, role_name, photo }) {
  return {
    session_id,
    id,
    email,
    full_name,
    role_name: role_name || null,
    photo: photo || null
  };
}

function buildRefreshTokenPayload({ session_id, id, email, full_name, role_name, photo, jti }) {
  return {
    session_id,
    jti,
    id,
    email,
    full_name,
    role_name: role_name || null,
    photo: photo || null
  };
}

function buildSessionTokens(userState, sessionId, refreshJti) {
  const accessPayload = buildAccessTokenPayload({
    ...userState,
    session_id: sessionId
  });
  const refreshPayload = buildRefreshTokenPayload({
    ...accessPayload,
    jti: refreshJti
  });

  return {
    accessToken: jwt.sign(accessPayload, config.jwt.secret, {
      expiresIn: config.jwt.accessTtl
    }),
    refreshToken: jwt.sign(refreshPayload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshTtl
    })
  };
}

function buildRefreshExpiryDate(currentTime) {
  return new Date(currentTime.getTime() + config.jwt.refreshTtl * 1000);
}

function buildAuthResponse(accessToken, refreshToken, clientType) {
  const auth = {
    access_token: accessToken
  };

  if (clientType !== 'web') {
    auth.refresh_token = refreshToken;
  }

  return auth;
}

async function lockUserForSessionReplacement(userId, transaction) {
  return User.findByPk(userId, {
    lock: transaction.LOCK.UPDATE,
    transaction
  });
}

async function revokeActiveSessionsForClient(userId, clientType, options = {}) {
  return AuthSession.update(
    {
      revoked_at: new Date(),
      revocation_reason: 'replaced_by_new_login'
    },
    {
      where: {
        user_id: userId,
        client_type: clientType,
        revoked_at: null
      },
      ...(options.transaction ? { transaction: options.transaction } : {})
    }
  );
}

async function createAuthSession(userId, clientType, userAgent, options = {}) {
  const currentTime = options.currentTime || new Date();
  const payload = {
    user_id: userId,
    refresh_jti: options.refreshJti || randomUUID(),
    client_type: clientType,
    user_agent: userAgent || null,
    last_activity_at: currentTime,
    expires_at: buildRefreshExpiryDate(currentTime)
  };

  const session = options.transaction
    ? await AuthSession.create(payload, { transaction: options.transaction })
    : await AuthSession.create(payload);

  return {
    refreshJti: session.refresh_jti,
    session
  };
}

async function resolveRoleName(user) {
  if (user.role?.role_name) {
    return user.role.role_name;
  }

  if (!user.id_roles) {
    throw new Error(`Role claim missing for user ${user.id_users}`);
  }

  const role = await Role.findByPk(user.id_roles);

  if (!role) {
    throw new Error(`Role ${user.id_roles} not found for user ${user.id_users}`);
  }

  return role.role_name;
}

async function loadSessionTokenUserState(userId) {
  const user = await User.findByPk(userId, {
    include: [
      {
        model: Role,
        as: 'role',
        attributes: ['id_roles', 'role_name']
      },
      {
        model: Photo,
        as: 'photo_file',
        attributes: ['photo_url']
      }
    ]
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id_users,
    email: user.email,
    full_name: user.full_name,
    role_name: await resolveRoleName(user),
    photo: user.photo_file?.photo_url || null
  };
}

function setSessionCookies(res, accessToken, refreshToken) {
  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.jwt.accessTtl * 1000
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.jwt.refreshTtl * 1000
  });
}

function clearSessionCookies(res) {
  res.clearCookie('token');
  res.clearCookie('refresh_token');
}

function verifyOptionalToken(token, secret) {
  if (!token) {
    return { payload: null, error: null };
  }

  try {
    return { payload: jwt.verify(token, secret), error: null };
  } catch (error) {
    if (!isJwtVerificationError(error)) {
      throw error;
    }

    return { payload: null, error };
  }
}

function isJwtExpiredError(error) {
  return error?.name === 'TokenExpiredError';
}

function isJwtVerificationError(error) {
  return (
    error?.name === 'TokenExpiredError' ||
    error?.name === 'JsonWebTokenError' ||
    error?.name === 'NotBeforeError'
  );
}

function isSessionInactive(lastActivityAt, inactivityWindowSeconds) {
  if (!lastActivityAt) {
    return true;
  }

  return Date.now() - new Date(lastActivityAt).getTime() > inactivityWindowSeconds * 1000;
}

function sendInvalidRefreshResponse(res) {
  return res.status(401).json({
    success: false,
    code: 'AUTH_REFRESH_TOKEN_INVALID',
    message: 'Refresh token invalid'
  });
}

function sendInactiveSessionResponse(res) {
  return res.status(401).json({
    success: false,
    code: 'AUTH_SESSION_INACTIVE',
    message: 'Refresh session expired'
  });
}

function sendInternalServerErrorResponse(res) {
  return res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
}

export const refresh = async (req, res) => {
  let decoded = null;
  let sessionUserId = null;

  try {
    const refreshToken = resolveRefreshToken(req);

    if (!refreshToken) {
      return sendInvalidRefreshResponse(res);
    }

    decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const session = await AuthSession.findByPk(decoded.session_id);
    sessionUserId = session?.user_id || decoded.id || null;

    if (!session || session.user_id !== decoded.id || session.refresh_jti !== decoded.jti) {
      return sendInvalidRefreshResponse(res);
    }

    if (session.revoked_at) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REFRESH_TOKEN_REVOKED',
        message: 'Refresh session revoked'
      });
    }

    if (
      isSessionInactive(session.last_activity_at, config.jwt.refreshInactivityWindowSeconds) ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      await session.update({
        revoked_at: new Date(),
        revocation_reason: 'expired'
      });

      return sendInactiveSessionResponse(res);
    }

    const tokenUserState = await loadSessionTokenUserState(session.user_id);

    if (!tokenUserState) {
      await session.update({
        revoked_at: new Date(),
        revocation_reason: 'user_not_found'
      });

      return sendInvalidRefreshResponse(res);
    }

    const nextRefreshJti = randomUUID();
    const { accessToken, refreshToken: nextRefreshToken } = buildSessionTokens(
      tokenUserState,
      session.session_id,
      nextRefreshJti
    );
    const currentTime = new Date();

    const [rotatedSessionCount] = await AuthSession.update(
      {
        refresh_jti: nextRefreshJti,
        last_activity_at: currentTime,
        expires_at: new Date(currentTime.getTime() + config.jwt.refreshTtl * 1000)
      },
      {
        where: {
          session_id: session.session_id,
          refresh_jti: decoded.jti,
          revoked_at: null
        }
      }
    );

    if (rotatedSessionCount !== 1) {
      logger.warn('Refresh rejected after CAS rotation miss', {
        session_id: session.session_id,
        user_id: session.user_id,
        refresh_jti: decoded.jti
      });
      return sendInvalidRefreshResponse(res);
    }

    if (session.client_type === 'web' || req.cookies?.refresh_token) {
      setSessionCookies(res, accessToken, nextRefreshToken);

      return res.json({
        success: true,
        data: {
          access_token: accessToken,
          auth: buildAuthResponse(accessToken, nextRefreshToken, 'web')
        },
        message: 'Refresh successful'
      });
    }

    return res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: nextRefreshToken,
        auth: buildAuthResponse(accessToken, nextRefreshToken, session.client_type)
      },
      message: 'Refresh successful'
    });
  } catch (error) {
    if (isJwtExpiredError(error)) {
      logger.warn(`Refresh expired: ${error.message}`);
      return sendInactiveSessionResponse(res);
    }

    if (isJwtVerificationError(error)) {
      logger.warn(`Refresh rejected: ${error.message}`);
      return sendInvalidRefreshResponse(res);
    }

    logger.error(`Refresh failed: ${error.message}`, {
      stack: error.stack,
      session_id: decoded?.session_id || null,
      user_id: sessionUserId || decoded?.id || null
    });
    return sendInternalServerErrorResponse(res);
  }
};

export const logout = async (req, res, next) => {
  let sessionId = null;

  try {
    sessionId = req.user?.session_id || null;

    const accessTokenResult = verifyOptionalToken(resolveAccessToken(req), config.jwt.secret);

    if (!sessionId) {
      sessionId = accessTokenResult.payload?.session_id || null;
    }

    const refreshTokenResult = !sessionId
      ? verifyOptionalToken(resolveRefreshToken(req), config.jwt.refreshSecret)
      : { payload: null, error: null };

    if (!sessionId) {
      sessionId = refreshTokenResult.payload?.session_id || null;
    }

    if (!sessionId) {
      if (accessTokenResult.error) {
        logger.warn(`Logout access token could not identify session: ${accessTokenResult.error.message}`);
      }

      if (refreshTokenResult.error) {
        logger.warn(
          `Logout refresh token could not identify session: ${refreshTokenResult.error.message}`
        );
      }
    }

    if (sessionId) {
      try {
        const session = await AuthSession.findByPk(sessionId);

        if (session && !session.revoked_at) {
          await session.update({
            revoked_at: new Date(),
            revocation_reason: 'logout'
          });
        }
      } catch (error) {
        logger.error(`Logout failed after session identification: ${error.message}`, {
          stack: error.stack,
          session_id: sessionId,
          user_id: req.user?.id || accessTokenResult.payload?.id || refreshTokenResult.payload?.id || null
        });
        clearSessionCookies(res);
        return sendInternalServerErrorResponse(res);
      }
    }

    clearSessionCookies(res);
    return res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    return next(error);
  }
};

export const register = async (req, res) => {
  const transaction = await sequelize.transaction();
  let uploadResult;

  try {
    const {
      email,
      password,
      id_roles,
      id_position,
      full_name,
      nipNim,
      phoneNumber,
      id_divisions,
      id_programs,
      latitude,
      longitude,
      radius,
      description
    } = req.body;
    const userAgent = req.get('User-Agent') || '';
    const clientType = resolveClientType(req);

    // Validate required fields
    if (!id_roles) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Role harus diisi'
      });
    }

    if (!id_position) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Position harus diisi'
      });
    }

    if (!id_programs) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Program harus diisi'
      });
    }

    // Cek unik email
    const emailExists = await User.findOne({ where: { email } });
    if (emailExists) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, code: 'E_VALIDATION', message: 'Email sudah ada' });
    }

    // Cek unik nip_nim
    const nipExists = await User.findOne({ where: { nip_nim: nipNim } });
    if (nipExists) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, code: 'E_VALIDATION', message: 'NIP/NIM sudah ada' });
    } // Cek file upload
    if (!req.file || !req.file.buffer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_UPLOAD',
        message:
          'Upload gambar wajah gagal atau tidak ditemukan. Pastikan field name adalah "face_photo"'
      });
    } // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user first, then upload photo to Spaces with final user id key
    const user = await User.create(
      {
        email,
        password: password_hash,
        full_name,
        nip_nim: nipNim,
        phone: phoneNumber,
        id_roles: id_roles,
        id_position: id_position,
        id_divisions: id_divisions,
        id_programs: id_programs,
        id_photos: null
      },
      { transaction }
    );

    try {
      const storageKey = buildUserProfilePhotoKey(user.id_users, req.file.originalname);
      uploadResult = await uploadBufferToSpaces({
        key: storageKey,
        buffer: req.file.buffer,
        contentType: req.file.mimetype
      });
    } catch (uploadError) {
      await transaction.rollback();
      logger.error(`Spaces upload error: ${uploadError.message}`);
      return res.status(500).json({
        success: false,
        code: 'E_UPLOAD',
        message: 'Gagal mengupload foto ke cloud storage'
      });
    }

    const photo = await Photo.create(
      {
        photo_url: uploadResult.url,
        storage_provider: 'spaces',
        storage_key: uploadResult.key,
        public_id: null,
        user_id: user.id_users,
        photo_updated_at: new Date()
      },
      { transaction }
    );

    await user.update(
      {
        id_photos: photo.id_photos
      },
      { transaction }
    );

    // Fetch user with role data for response
    const userWithRole = await User.findByPk(user.id_users, {
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id_roles', 'role_name']
        }
      ],
      transaction
    });

    // Buat lokasi default WFH
    const location = await Location.create(
      {
        user_id: user.id_users,
        id_attendance_categories: 2, // hardcode untuk WFH category
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: radius || 100,
        description: description || 'Default WFH Location'
      },
      { transaction }
    );

    const roleName = userWithRole.role?.role_name || null;
    const tokenUserState = {
      id: user.id_users,
      email: user.email,
      full_name: user.full_name,
      role_name: roleName,
      photo: uploadResult.url
    };
    const { refreshJti, session } = await createAuthSession(user.id_users, clientType, userAgent, {
      transaction
    });
    const { accessToken, refreshToken } = buildSessionTokens(
      tokenUserState,
      session.session_id,
      refreshJti
    );

    // Commit transaksi
    await transaction.commit();

    if (clientType === 'web') {
      setSessionCookies(res, accessToken, refreshToken);
    }

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: userWithRole.id_users,
          full_name: userWithRole.full_name,
          email: userWithRole.email,
          role_name: roleName,
          token: accessToken
        },
        ...(clientType !== 'web' ? { refresh_token: refreshToken } : {}),
        location: {
          location_id: location.location_id,
          latitude: location.latitude,
          longitude: location.longitude,
          radius: location.radius,
          description: location.description
        }
      },
      message: 'Registrasi berhasil'
    });
  } catch (err) {
    if (uploadResult?.key) {
      try {
        await deleteSpacesObject(uploadResult.key);
      } catch (cleanupError) {
        logger.warn(`Failed to clean up Spaces object ${uploadResult.key}: ${cleanupError.message}`);
      }
    }

    // Rollback transaksi jika ada error
    await transaction.rollback();

    // Handle multer errors specifically
    if (err.code === 'UNEXPECTED_FIELD' || err.name === 'MulterError') {
      return res.status(400).json({
        success: false,
        code: 'E_UPLOAD',
        message: 'Field name untuk upload foto harus "face_photo"'
      });
    }

    logger.error(`Registration error: ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      success: false,
      code: 'E_DB',
      message: err.message || 'Terjadi kesalahan pada server'
    });
  }
};

export const getCurrentUser = async (req, res, next) => {
  try {
    // Get user data using req.user.id from verifyToken middleware
    const user = await User.findOne({
      where: { id_users: req.user.id },
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['role_name']
        },
        {
          model: Program,
          as: 'program',
          attributes: ['program_name']
        },
        {
          model: Position,
          as: 'position',
          attributes: ['position_name']
        },
        {
          model: Division,
          as: 'division',
          attributes: ['division_name']
        },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at']
        }
      ]
    });

    if (!user) {
      logger.warn(`User not found for id: ${req.user.id}`);
      return res.status(404).json({
        success: false,
        code: 'E_USER_NOT_FOUND',
        message: 'User tidak ditemukan'
      });
    }

    // Get user's WFH default location
    let wfhLocation = null;
    try {
      wfhLocation = await Location.findOne({
        where: {
          user_id: user.id_users,
          id_attendance_categories: 2 // WFH category
        },
        include: [
          {
            model: AttendanceCategory,
            as: 'category',
            attributes: ['category_name']
          }
        ]
      });
    } catch (locationError) {
      logger.warn(
        `Could not fetch WFH location for user ${user.id_users}: ${locationError.message}`
      );
    }

    // Construct response data with same structure as login endpoint
    const responseData = {
      id: user.id_users,
      full_name: user.full_name,
      email: user.email,
      role_name: user.role ? user.role.role_name : null,
      position_name: user.position ? user.position.position_name : null,
      program_name: user.program ? user.program.program_name : null,
      division_name: user.division ? user.division.division_name : null,
      nip_nim: user.nip_nim,
      phone: user.phone,
      photo: user.photo_file ? user.photo_file.photo_url : null,
      photo_updated_at: user.photo_file ? user.photo_file.photo_updated_at : null,
      location: wfhLocation
        ? {
            latitude: parseFloat(wfhLocation.latitude),
            longitude: parseFloat(wfhLocation.longitude),
            radius: parseFloat(wfhLocation.radius),
            description: wfhLocation.description,
            category_name: wfhLocation.category?.category_name || null
          }
        : null
    };

    logger.info(`User profile fetched successfully for user: ${user.email}`);

    res.status(200).json({
      success: true,
      data: responseData,
      message: 'User profile fetched successfully'
    });
  } catch (error) {
    logger.error(`Get current user error: ${error.message}`, { stack: error.stack });
    next(error);
  }
};
