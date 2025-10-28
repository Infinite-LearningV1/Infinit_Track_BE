import { body, validationResult } from 'express-validator';
import multer from 'multer';

import User from '../models/user.model.js';
import { assertSafeUrl } from '../utils/url.js';

// Remove the file system setup as we're switching to Cloudinary
// const uploadsDir = 'uploads/face/';
// if (!fs.existsSync(uploadsDir)) {
//   fs.mkdirSync(uploadsDir, { recursive: true });
// }

// Use memory storage instead of disk storage for Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, JPG and PNG files are allowed'), false);
  }
};

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  },
  fileFilter: fileFilter
});

const passwordBlacklist = ['password', 'password123', '12345678', 'qwerty123', 'abcdefg1'];

export const safeUrlField = (field, { required = false, message } = {}) => {
  const errorMessage = message || `${field} harus berupa URL http/https yang valid`;
  const chain = required
    ? body(field).notEmpty().withMessage(`${field} wajib diisi`)
    : body(field).optional({ checkFalsy: true, nullable: true });

  return chain.custom((value) => assertSafeUrl(value, errorMessage));
};

// User registration validation rules
export const registerValidation = [
  // Email validation
  body('email')
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Format email tidak valid')
    .custom(async (value) => {
      const existingUser = await User.findOne({ where: { email: value } });
      if (existingUser) {
        throw new Error('Email sudah digunakan');
      }
      return true;
    }),

  body('password')
    .trim()
    .isLength({ min: 8 })
    .withMessage('Password minimal 8 karakter')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/)
    .withMessage('Password wajib kombinasi angka dan huruf')
    .custom((value) => {
      if (passwordBlacklist.includes(value.toLowerCase())) {
        throw new Error('Password terlalu mudah ditebak');
      }
      if (/\s/.test(value)) {
        throw new Error('Password tidak boleh mengandung spasi');
      }
      return true;
    }),

  body('id_divisions').optional().isInt().withMessage('Division harus berupa angka'),

  // Phone number validation
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone Number wajib diisi')
    .matches(/^\d+$/)
    .withMessage('Phone Number hanya boleh berisi angka'),

  // NIP/NIM validation
  body('nipNim')
    .notEmpty()
    .withMessage('NIP/NIM wajib diisi')
    .matches(/^[A-Za-z0-9]+$/)
    .withMessage('NIP/NIM hanya kombinasi huruf dan angka')
    .custom(async (value) => {
      const existingUser = await User.findOne({ where: { nip_nim: value } });
      if (existingUser) {
        throw new Error('NIP/NIM sudah digunakan');
      }
      return true;
    }),

  // Latitude validation
  body('latitude')
    .notEmpty()
    .withMessage('Latitude wajib diisi')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Latitude tidak boleh 0'),

  // Longitude validation
  body('longitude')
    .notEmpty()
    .withMessage('Longitude wajib diisi')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Longitude tidak boleh 0'),

  // Radius validation (optional, defaults to 100)
  body('radius')
    .optional()
    .default(100)
    .isFloat({ gt: 0 })
    .withMessage('Radius harus lebih besar dari 0'),

  // Description validation (optional)
  body('description').optional().isString().withMessage('Description harus berupa teks')
];

// Login validation rules
export const loginValidation = [
  // Email validation
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Email wajib diisi')
    .isEmail()
    .withMessage('Format email tidak valid'),

  // Password validation
  body('password')
    .notEmpty()
    .withMessage('Password wajib diisi')
    .isLength({ min: 8 })
    .withMessage('Password minimal 8 karakter')
    .matches(/^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9]+$/)
    .withMessage('Password harus kombinasi huruf dan angka tanpa spasi')
];

// Simple login validation for auth controller
export const validateLogin = [
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Email wajib diisi')
    .isEmail()
    .withMessage('Format email tidak valid'),
  body('password')
    .notEmpty()
    .withMessage('Password wajib diisi')
    .isLength({ min: 6 })
    .withMessage('Password minimal 6 karakter')
];

// Validation middleware
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'E_VALIDATION',
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

// File validation middleware
export const validateFaceImage = (req, res, next) => {
  if (
    req.file &&
    req.file.mimetype &&
    !['image/jpeg', 'image/jpg', 'image/png'].includes(req.file.mimetype)
  ) {
    return res.status(400).json({
      success: false,
      code: 'E_VALIDATION',
      message: 'File harus berupa gambar (JPEG, JPG, PNG)'
    });
  }

  if (!req.body.radius) {
    req.body.radius = 100;
  }

  next();
};

export const userRegistrationValidation = [
  upload.single('face_photo'),
  validateFaceImage,
  ...registerValidation,
  validate
];

// Validation for updating user
export const validateUpdateUser = [
  body('full_name')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Full name must be a non-empty string'),
  body('password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('phone').optional().isNumeric().withMessage('Phone must be numeric'),
  body('nip_nim')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('NIP/NIM must be a non-empty string'),
  body('id_roles').optional().isInt({ gt: 0 }).withMessage('Role ID must be a positive integer'),
  body('id_programs')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Program ID must be a positive integer'),
  body('id_position')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Position ID must be a positive integer'),
  body('id_divisions')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Division ID must be a positive integer'),
  body('id_photos').optional().isInt({ gt: 0 }).withMessage('Photo ID must be a positive integer'),
  body('latitude').optional().isDecimal().withMessage('Latitude must be a decimal number'),
  body('longitude').optional().isDecimal().withMessage('Longitude must be a decimal number'),
  body('radius').optional().isDecimal().withMessage('Radius must be a decimal number'),
  body('description').optional().isString().trim().withMessage('Description must be a string')
];

// Validation for creating new user by admin/management
export const validateCreateUser = [
  body('full_name')
    .trim()
    .notEmpty()
    .withMessage('Nama lengkap wajib diisi')
    .isLength({ min: 2 })
    .withMessage('Nama lengkap minimal 2 karakter'),

  body('email')
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Format email tidak valid')
    .normalizeEmail(),

  body('password')
    .trim()
    .isLength({ min: 8 })
    .withMessage('Password minimal 8 karakter')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/)
    .withMessage('Password wajib kombinasi angka dan huruf')
    .custom((value) => {
      if (passwordBlacklist.includes(value.toLowerCase())) {
        throw new Error('Password terlalu mudah ditebak');
      }
      if (/\s/.test(value)) {
        throw new Error('Password tidak boleh mengandung spasi');
      }
      return true;
    }),

  body('phone')
    .notEmpty()
    .withMessage('Nomor telepon wajib diisi')
    .matches(/^\d+$/)
    .withMessage('Nomor telepon hanya boleh berisi angka'),

  body('nip_nim')
    .notEmpty()
    .withMessage('NIP/NIM wajib diisi')
    .matches(/^[A-Za-z0-9]+$/)
    .withMessage('NIP/NIM hanya kombinasi huruf dan angka'),

  body('id_roles')
    .notEmpty()
    .withMessage('Role wajib dipilih')
    .isInt({ gt: 0 })
    .withMessage('Role ID harus berupa angka positif'),

  body('id_programs')
    .notEmpty()
    .withMessage('Program wajib dipilih')
    .isInt({ gt: 0 })
    .withMessage('Program ID harus berupa angka positif'),

  body('id_position')
    .notEmpty()
    .withMessage('Posisi wajib dipilih')
    .isInt({ gt: 0 })
    .withMessage('Position ID harus berupa angka positif'),

  body('id_divisions')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Division ID harus berupa angka positif'),

  body('latitude')
    .notEmpty()
    .withMessage('Latitude wajib diisi')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Latitude tidak boleh 0'),

  body('longitude')
    .notEmpty()
    .withMessage('Longitude wajib diisi')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Longitude tidak boleh 0'),

  body('radius')
    .optional()
    .default(100)
    .isFloat({ gt: 0 })
    .withMessage('Radius harus lebih besar dari 0'),

  body('description').optional().isString().trim().withMessage('Deskripsi harus berupa teks')
];

// Check-in validation rules
export const checkInValidation = [
  body('category_id')
    .notEmpty()
    .withMessage('Category ID wajib diisi')
    .isInt({ min: 1, max: 3 })
    .withMessage('Category ID harus 1 (WFO), 2 (WFH), atau 3 (WFA)'),

  body('latitude')
    .notEmpty()
    .withMessage('Latitude wajib diisi')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Latitude tidak boleh 0'),

  body('longitude')
    .notEmpty()
    .withMessage('Longitude wajib diisi')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Longitude tidak boleh 0'),

  body('notes')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Catatan maksimal 500 karakter'),

  body('booking_id')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Booking ID harus berupa angka positif')
    .custom((value, { req }) => {
      // Jika category_id adalah 3 (WFA), booking_id wajib ada
      if (req.body.category_id == 3 && !value) {
        throw new Error('Booking ID wajib diisi untuk WFA');
      }
      return true;
    })
];

// Booking validation rules
export const createBookingValidation = [
  body('schedule_date').notEmpty().withMessage('Tanggal jadwal wajib diisi'),

  body('latitude')
    .notEmpty()
    .withMessage('Latitude wajib diisi')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Latitude tidak boleh 0'),

  body('longitude')
    .notEmpty()
    .withMessage('Longitude wajib diisi')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude tidak valid')
    .custom((value) => parseFloat(value) !== 0)
    .withMessage('Longitude tidak boleh 0'),

  body('radius')
    .optional()
    .default(100)
    .isFloat({ gt: 0 })
    .withMessage('Radius harus lebih besar dari 0'),

  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Deskripsi maksimal 255 karakter'),

  body('notes')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Catatan maksimal 500 karakter')
];

export const updateStatusValidation = [
  body('status')
    .notEmpty()
    .withMessage('Status wajib diisi')
    .isIn(['approved', 'rejected'])
    .withMessage('Status harus "approved" atau "rejected"')
];

// Check-out validation rules
export const checkOutValidation = [
  body('latitude')
    .exists()
    .withMessage('Latitude wajib diisi')
    .notEmpty()
    .withMessage('Latitude tidak boleh kosong')
    .isNumeric()
    .withMessage('Latitude harus berupa angka')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude harus antara -90 dan 90')
    .custom((value) => {
      const numValue = parseFloat(value);
      if (numValue === 0) {
        throw new Error('Latitude tidak boleh 0');
      }
      return true;
    }),
  body('longitude')
    .exists()
    .withMessage('Longitude wajib diisi')
    .notEmpty()
    .withMessage('Longitude tidak boleh kosong')
    .isNumeric()
    .withMessage('Longitude harus berupa angka')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude harus antara -180 dan 180')
    .custom((value) => {
      const numValue = parseFloat(value);
      if (numValue === 0) {
        throw new Error('Longitude tidak boleh 0');
      }
      return true;
    })
];

// Location event validation rules
export const locationEventValidation = [
  // Event type validation
  body('event_type')
    .exists()
    .withMessage('Event type wajib diisi')
    .notEmpty()
    .withMessage('Event type tidak boleh kosong')
    .isIn(['ENTER', 'EXIT'])
    .withMessage('Event type harus berupa ENTER atau EXIT'),

  // Location ID validation
  body('location_id')
    .exists()
    .withMessage('Location ID wajib diisi')
    .notEmpty()
    .withMessage('Location ID tidak boleh kosong')
    .isInt({ min: 1 })
    .withMessage('Location ID harus berupa integer positif'),
  // Event timestamp validation
  body('event_timestamp')
    .exists()
    .withMessage('Event timestamp wajib diisi')
    .notEmpty()
    .withMessage('Event timestamp tidak boleh kosong')
    .isISO8601()
    .withMessage('Event timestamp harus dalam format ISO 8601 yang valid')
    .custom((value) => {
      const eventTime = new Date(value);
      const now = new Date();

      // Convert to Jakarta time for comparison (UTC+7)
      const jakartaOffset = 7 * 60 * 60 * 1000; // UTC+7 in milliseconds
      const jakartaNow = new Date(now.getTime() + jakartaOffset);

      // Use Jakarta time for validation
      const eventTimeJakarta = new Date(eventTime.getTime() + jakartaOffset);

      // Check if event is more than 24 hours in the future
      const twentyFourHoursFromNow = new Date(jakartaNow.getTime() + 24 * 60 * 60 * 1000);

      if (eventTimeJakarta > twentyFourHoursFromNow) {
        throw new Error('Event timestamp tidak boleh lebih dari 24 jam ke depan');
      }

      // Check if event is more than 24 hours in the past
      const twentyFourHoursAgo = new Date(jakartaNow.getTime() - 24 * 60 * 60 * 1000);

      if (eventTimeJakarta < twentyFourHoursAgo) {
        throw new Error('Event timestamp tidak boleh lebih dari 24 jam yang lalu');
      }

      return true;
    })
];
