import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';

import {
  User,
  Photo,
  Role,
  Program,
  Position,
  Division,
  AttendanceCategory,
  Location,
  sequelize
} from '../models/index.js';
import logger from '../utils/logger.js';
import { buildUserProfilePhotoKey, uploadBufferToSpaces } from '../config/spaces.js';

const deleteLegacyCloudinaryPhoto = async (publicId) => {
  try {
    const { default: cloudinary } = await import('../config/cloudinary.js');
    await cloudinary.uploader.destroy(publicId);
    logger.info(`Old photo deleted from Cloudinary: ${publicId}`);
    return true;
  } catch (deleteError) {
    logger.warn(`Failed to delete old photo from Cloudinary ${publicId}: ${deleteError.message}`);
    return false;
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.update({ full_name: name, email });

    res.json({
      message: 'Profile updated',
      user: { id: user.id_users, full_name: user.full_name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getAllUsers = async (req, res, next) => {
  try {
    // Get query parameters for search and sorting
    const search = req.query.search;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'DESC';

    // Build where clause for filtering
    let whereClause = {
      deleted_at: null
    };

    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { full_name: { [Op.like]: `%${search}%` } },
        { nip_nim: { [Op.like]: `%${search}%` } }
      ];
    }

    // Query users with all required associations
    const users = await User.findAll({
      where: whereClause,
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
          attributes: ['division_name'],
          required: false
        },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at'],
          required: false
        },
        {
          model: Location,
          as: 'wfh_location',
          where: { id_attendance_categories: 2 },
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ],
          required: true
        }
      ],
      order: [[sortBy, sortOrder.toUpperCase()]]
    });

    // Transform data to match the response structure from /auth/me endpoint
    const transformedUsers = users.map((user) => ({
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
      location: user.wfh_location
        ? {
            location_id: user.wfh_location.location_id,
            latitude: parseFloat(user.wfh_location.latitude),
            longitude: parseFloat(user.wfh_location.longitude),
            radius: parseFloat(user.wfh_location.radius),
            description: user.wfh_location.description,
            category_name: user.wfh_location.attendance_category
              ? user.wfh_location.attendance_category.category_name
              : 'Work From Home'
          }
        : null
    }));

    logger.info(`Users fetched successfully, returned ${transformedUsers.length} users`);

    res.json({
      success: true,
      data: transformedUsers,
      message: 'Users fetched successfully'
    });
  } catch (error) {
    logger.error(`Error fetching users: ${error.message}`, { stack: error.stack });
    next(error);
  }
};

// POST /users/:id/photo - Admin Upload Foto Wajah User
export const uploadUserPhoto = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Check if file uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File foto wajah harus diupload'
      });
    }

    // Get old photo data for deletion
    let oldPublicId = null;
    let oldPhotoDeleted = false;

    if (user.id_photos) {
      const oldPhoto = await Photo.findByPk(user.id_photos);
      if (oldPhoto && oldPhoto.public_id) {
        oldPublicId = oldPhoto.public_id;
      }
    }

    const storageKey = buildUserProfilePhotoKey(id, req.file.originalname);
    const uploadResult = await uploadBufferToSpaces({
      key: storageKey,
      buffer: req.file.buffer,
      contentType: req.file.mimetype
    });

    // Create or update photo record
    let photo = await Photo.findOne({ where: { user_id: id } });

    if (photo) {
      // Update existing photo
      await photo.update({
        photo_url: uploadResult.url,
        storage_provider: 'spaces',
        storage_key: uploadResult.key,
        public_id: null,
        photo_updated_at: new Date()
      });
    } else {
      // Create new photo record
      photo = await Photo.create({
        user_id: id,
        photo_url: uploadResult.url,
        storage_provider: 'spaces',
        storage_key: uploadResult.key,
        public_id: null,
        photo_updated_at: new Date()
      });

      // Update user to reference this photo
      await user.update({
        id_photos: photo.id_photos
      });
    }

    if (oldPublicId) {
      oldPhotoDeleted = await deleteLegacyCloudinaryPhoto(oldPublicId);
    }

    logger.info(`Photo uploaded for user ${id}: ${uploadResult.url}`);

    res.json({
      success: true,
      message: 'Foto berhasil diperbarui',
      data: {
        user_id: parseInt(id, 10),
        photo_id: photo.id_photos,
        photo: uploadResult.url,
        photo_updated_at: photo.photo_updated_at,
        old_photo_deleted: oldPhotoDeleted
      }
    });
  } catch (error) {
    logger.error(`Error uploading user photo: ${error.message}`, { stack: error.stack });
    next(error);
  }
};

// PATCH /users/:id - Update User
export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      full_name,
      password,
      phone,
      nip_nim,
      id_roles,
      id_programs,
      id_position,
      id_divisions,
      id_photos,
      latitude,
      longitude,
      radius,
      description
    } = req.body;

    // Find the user by ID
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if nip_nim is being changed and if it's already taken by another user
    if (nip_nim && nip_nim !== user.nip_nim) {
      const existingUser = await User.findOne({
        where: {
          nip_nim: nip_nim,
          id_users: { [Op.ne]: id }, // Exclude current user
          deleted_at: null
        }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'E_VALIDATION_NIP_EXISTS: NIP/NIM already exists'
        });
      }
    }

    // Prepare update data (exclude email as it should not be changed)
    const updateData = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (nip_nim !== undefined) updateData.nip_nim = nip_nim;
    if (id_roles !== undefined) updateData.id_roles = id_roles;
    if (id_programs !== undefined) updateData.id_programs = id_programs;
    if (id_position !== undefined) updateData.id_position = id_position;
    if (id_divisions !== undefined) updateData.id_divisions = id_divisions;
    if (id_photos !== undefined) updateData.id_photos = id_photos; // Hash password if provided
    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update user data
    await user.update(updateData);

    // Handle WFH location update if location data is provided
    if (
      latitude !== undefined ||
      longitude !== undefined ||
      radius !== undefined ||
      description !== undefined
    ) {
      const locationData = {};
      if (latitude !== undefined) locationData.latitude = latitude;
      if (longitude !== undefined) locationData.longitude = longitude;
      if (radius !== undefined) locationData.radius = radius;
      if (description !== undefined) locationData.description = description;

      // Find or create WFH location record
      const [location, created] = await Location.findOrCreate({
        where: {
          user_id: id,
          id_attendance_categories: 2 // WFH category
        },
        defaults: {
          user_id: id,
          id_attendance_categories: 2,
          ...locationData
        }
      });

      // If location already exists, update it
      if (!created) {
        await location.update(locationData);
      }
    }

    // Fetch updated user with all relations for response
    const updatedUser = await User.findByPk(id, {
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
          attributes: ['division_name'],
          required: false
        },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at'],
          required: false
        },
        {
          model: Location,
          as: 'wfh_location',
          where: { id_attendance_categories: 2 },
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ],
          required: false
        }
      ]
    });

    // Transform response data to match /auth/login and /auth/me structure
    const responseData = {
      id: updatedUser.id_users,
      full_name: updatedUser.full_name,
      email: updatedUser.email,
      role_name: updatedUser.role ? updatedUser.role.role_name : null,
      position_name: updatedUser.position ? updatedUser.position.position_name : null,
      program_name: updatedUser.program ? updatedUser.program.program_name : null,
      division_name: updatedUser.division ? updatedUser.division.division_name : null,
      nip_nim: updatedUser.nip_nim,
      phone: updatedUser.phone,
      photo: updatedUser.photo_file ? updatedUser.photo_file.photo_url : null,
      photo_updated_at: updatedUser.photo_file ? updatedUser.photo_file.photo_updated_at : null,
      location: updatedUser.wfh_location
        ? {
            location_id: updatedUser.wfh_location.location_id,
            latitude: parseFloat(updatedUser.wfh_location.latitude),
            longitude: parseFloat(updatedUser.wfh_location.longitude),
            radius: parseFloat(updatedUser.wfh_location.radius),
            description: updatedUser.wfh_location.description,
            category_name: updatedUser.wfh_location.attendance_category
              ? updatedUser.wfh_location.attendance_category.category_name
              : 'Work From Home'
          }
        : null
    };

    logger.info(`User ${id} updated successfully by user ${req.user.id}`);

    res.json({
      success: true,
      data: responseData,
      message: 'User updated successfully'
    });
  } catch (error) {
    logger.error(`Error updating user ${req.params.id}: ${error.message}`, { stack: error.stack });
    next(error);
  }
};

// DELETE /users/:id - Soft Delete User
export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find the user by ID
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is already soft deleted
    if (user.deleted_at) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Perform soft delete
    await user.destroy();

    logger.info(`User ${id} soft deleted successfully by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'User soft deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting user ${req.params.id}: ${error.message}`, { stack: error.stack });
    next(error);
  }
};

// POST /users - Create New User (Admin and Management only)
export const createUser = async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      full_name,
      email,
      password,
      phone,
      nip_nim,
      id_roles,
      id_programs,
      id_position,
      id_divisions,
      latitude,
      longitude,
      radius,
      description
    } = req.body; // Check if file uploaded
    if (!req.file || !req.file.buffer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_UPLOAD',
        message:
          'Upload gambar wajah gagal atau tidak ditemukan. Pastikan field name adalah "face_photo"'
      });
    }

    // Check email uniqueness
    const existingEmail = await User.findOne({
      where: { email, deleted_at: null },
      transaction
    });
    if (existingEmail) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION_EMAIL_EXISTS',
        message: 'Email sudah digunakan'
      });
    }

    // Check NIP/NIM uniqueness
    const existingNip = await User.findOne({
      where: { nip_nim, deleted_at: null },
      transaction
    });
    if (existingNip) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION_NIP_EXISTS',
        message: 'NIP/NIM sudah digunakan'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user first, then write photo to Spaces with final user id key
    const newUser = await User.create(
      {
        full_name,
        email,
        password: hashedPassword,
        phone,
        nip_nim,
        id_roles,
        id_programs,
        id_position,
        id_divisions: id_divisions || null,
        id_photos: null,
        created_by: req.user.id,
        created_at: new Date(),
        updated_at: new Date()
      },
      { transaction }
    );

    const storageKey = buildUserProfilePhotoKey(newUser.id_users, req.file.originalname);
    const uploadResult = await uploadBufferToSpaces({
      key: storageKey,
      buffer: req.file.buffer,
      contentType: req.file.mimetype
    });

    const photo = await Photo.create(
      {
        photo_url: uploadResult.url,
        storage_provider: 'spaces',
        storage_key: uploadResult.key,
        public_id: null,
        user_id: newUser.id_users,
        photo_updated_at: new Date()
      },
      { transaction }
    );

    await newUser.update(
      {
        id_photos: photo.id_photos
      },
      { transaction }
    );

    // Create WFH location
    await Location.create(
      {
        user_id: newUser.id_users,
        id_attendance_categories: 2, // WFH category
        latitude,
        longitude,
        radius: radius || 100,
        description: description || 'Default WFH Location'
      },
      { transaction }
    );

    // Commit transaction
    await transaction.commit();

    // Fetch complete user data for response
    const createdUser = await User.findByPk(newUser.id_users, {
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
          attributes: ['division_name'],
          required: false
        },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at'],
          required: false
        },
        {
          model: Location,
          as: 'wfh_location',
          where: { id_attendance_categories: 2 },
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ],
          required: false
        }
      ]
    });

    // Transform response data to match /auth/login and /auth/me structure
    const responseData = {
      id: createdUser.id_users,
      full_name: createdUser.full_name,
      email: createdUser.email,
      role_name: createdUser.role ? createdUser.role.role_name : null,
      position_name: createdUser.position ? createdUser.position.position_name : null,
      program_name: createdUser.program ? createdUser.program.program_name : null,
      division_name: createdUser.division ? createdUser.division.division_name : null,
      nip_nim: createdUser.nip_nim,
      phone: createdUser.phone,
      photo: createdUser.photo_file ? createdUser.photo_file.photo_url : null,
      photo_updated_at: createdUser.photo_file ? createdUser.photo_file.photo_updated_at : null,
      location: createdUser.wfh_location
        ? {
            location_id: createdUser.wfh_location.location_id,
            latitude: parseFloat(createdUser.wfh_location.latitude),
            longitude: parseFloat(createdUser.wfh_location.longitude),
            radius: parseFloat(createdUser.wfh_location.radius),
            description: createdUser.wfh_location.description,
            category_name: createdUser.wfh_location.attendance_category
              ? createdUser.wfh_location.attendance_category.category_name
              : 'Work From Home'
          }
        : null
    };

    logger.info(`User created successfully with ID ${newUser.id_users} by user ${req.user.id}`);

    res.status(201).json({
      success: true,
      data: responseData,
      message: 'User created successfully'
    });
  } catch (error) {
    await transaction.rollback();
    logger.error(`Error creating user: ${error.message}`, { stack: error.stack });
    next(error);
  }
};

// GET /users/:id - Get User by ID (Admin and Management only)
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find user by ID with all required associations
    const user = await User.findOne({
      where: {
        id_users: id,
        deleted_at: null
      },
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
          attributes: ['division_name'],
          required: false
        },
        {
          model: Photo,
          as: 'photo_file',
          attributes: ['photo_url', 'photo_updated_at'],
          required: false
        },
        {
          model: Location,
          as: 'wfh_location',
          where: { id_attendance_categories: 2 },
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ],
          required: true
        }
      ]
    });

    // Check if user exists
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'E_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Transform data to match the response structure from /auth/me endpoint
    const transformedUser = {
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
      location: user.wfh_location
        ? {
            location_id: user.wfh_location.location_id,
            latitude: parseFloat(user.wfh_location.latitude),
            longitude: parseFloat(user.wfh_location.longitude),
            radius: parseFloat(user.wfh_location.radius),
            description: user.wfh_location.description,
            category_name: user.wfh_location.attendance_category
              ? user.wfh_location.attendance_category.category_name
              : 'Work From Home'
          }
        : null
    };

    logger.info(`User ${id} details fetched successfully by user ${req.user.id}`);

    res.json({
      success: true,
      data: transformedUser,
      message: 'User details fetched successfully'
    });
  } catch (error) {
    logger.error(`Error fetching user ${req.params.id}: ${error.message}`, { stack: error.stack });
    next(error);
  }
};
