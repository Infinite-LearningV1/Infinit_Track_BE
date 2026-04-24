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
  AttendanceCategory
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
    const isMobile =
      userAgent.includes('Mobile') || req.headers.authorization?.startsWith('Bearer '); // Find user by email (case insensitive)
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
    // Debug logging untuk troubleshooting role issues
    console.log('🔍 Login Debug Info:');
    console.log('- User ID:', user.id_users);
    console.log('- User Email:', user.email);
    console.log('- User id_roles:', user.id_roles);
    console.log('- User Role Object:', user.role);
    console.log('- Role Name:', user.role?.role_name);
    console.log('- Full User Object (roles):', JSON.stringify(user.role, null, 2));

    // Check if user has role assigned
    if (!user.id_roles) {
      console.log('❌ User has no role assigned (id_roles is null)');
    } else if (!user.role) {
      console.log('❌ Role relationship not loaded or role does not exist');
      console.log('- Looking for role with ID:', user.id_roles);
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

    // Check if existing token needs refresh (sliding window)
    let token;
    let shouldRefresh = false;

    if (req.cookies?.token) {
      try {
        const decoded = jwt.verify(req.cookies.token, config.jwt.secret);
        const timeToExpiry = decoded.exp - Math.floor(Date.now() / 1000);

        // If less than 1 hour remaining, refresh token
        if (timeToExpiry < 3600) {
          shouldRefresh = true;
        } else {
          token = req.cookies.token;
        }
      } catch (error) {
        shouldRefresh = true;
      }
    } else {
      shouldRefresh = true;
    }
    const responseData = {
      id: user.id_users,
      full_name: user.full_name,
      email: user.email,
      role_name: user.role?.role_name || null,
      position_name: user.position?.position_name || null,
      program_name: user.program?.program_name || null,
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
    if (shouldRefresh || !token) {
      // Ensure we have the role_name for the token
      let roleName = user.role?.role_name;

      // If role_name is still not available, try to fetch it directly
      if (!roleName && user.id_roles) {
        try {
          const roleData = await Role.findByPk(user.id_roles);
          roleName = roleData?.role_name;
          console.log('🔧 Fetched role name directly:', roleName);
        } catch (roleError) {
          console.error('Error fetching role:', roleError.message);
        }
      }

      const payload = {
        id: user.id_users,
        email: user.email,
        full_name: user.full_name,
        role_name: roleName || null,
        photo: user.photo_file ? user.photo_file.photo_url : null
      };

      console.log('🔍 Creating JWT token with payload:', payload);

      token = jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.ttl
      });

      // Set cookie for web clients
      if (!isMobile) {
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: config.jwt.ttl * 1000
        });
      }

      logger.info(`Login successful for user: ${email}`);
    } // Always add token to response (for both mobile and web clients)
    responseData.token = token;

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

export const logout = (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout successful' });
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

    // Commit transaksi
    await transaction.commit(); // Generate JWT token for the new user
    const payload = {
      id: user.id_users,
      email: user.email,
      full_name: user.full_name,
      role_name: userWithRole.role?.role_name || null,
      photo: uploadResult.url
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.ttl
    });

    // Set token in cookies
    res.cookie('token', token, { httpOnly: true }); // Response sukses dengan data user dan lokasi
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: userWithRole.id_users,
          full_name: userWithRole.full_name,
          email: userWithRole.email,
          role_name: userWithRole.role?.role_name || null,
          token: token
        },
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
