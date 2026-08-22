import { body, param } from 'express-validator';

const mutableReasonFields = ['label', 'is_active', 'sort_order'];

export const createWfaReasonValidation = [
  body('label')
    .exists({ values: 'falsy' })
    .withMessage('label wajib diisi')
    .bail()
    .isString()
    .withMessage('label harus berupa string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('label wajib diisi dan maksimal 120 karakter'),
  body('is_active').optional().isBoolean().withMessage('is_active harus boolean'),
  body('is_other').optional().isBoolean().withMessage('is_other harus boolean'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sort_order harus bilangan bulat non-negatif')
    .toInt()
];

export const updateWfaReasonValidation = [
  body().custom((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Body harus berupa object');
    }
    if (Object.hasOwn(value, 'is_other')) {
      throw new Error('is_other tidak dapat diubah setelah alasan dibuat');
    }

    const unknownField = Object.keys(value).find((field) => !mutableReasonFields.includes(field));
    if (unknownField) {
      throw new Error(`Field ${unknownField} tidak didukung`);
    }
    if (!mutableReasonFields.some((field) => Object.hasOwn(value, field))) {
      throw new Error('Minimal satu field perubahan wajib diisi');
    }
    return true;
  }),
  body('label')
    .optional()
    .isString()
    .withMessage('label harus berupa string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('label wajib diisi dan maksimal 120 karakter'),
  body('is_active').optional().isBoolean().withMessage('is_active harus boolean'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sort_order harus bilangan bulat non-negatif')
    .toInt()
];

export const wfaReasonIdValidation = [
  param('id').isInt({ min: 1 }).withMessage('id alasan tidak valid').toInt()
];
