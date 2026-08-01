import { WfaRejectionReason, WfaRequestReason } from '../models/index.js';
import { getOperationalSettingsStrict } from '../utils/settings.js';

const CATALOG_MODELS = Object.freeze({
  request: WfaRequestReason,
  rejection: WfaRejectionReason
});

const CATALOG_NOT_FOUND_CODES = Object.freeze({
  request: 'WFA_REQUEST_REASON_NOT_FOUND',
  rejection: 'REJECTION_REASON_NOT_FOUND'
});

const createWfaError = ({ status = 400, code, message, field = null }) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = field ? [{ field, code }] : [];
  return error;
};

const createValidationError = (message, field) =>
  createWfaError({ code: 'E_VALIDATION', message, field });

const getCatalogModel = (catalog) => {
  const model = CATALOG_MODELS[catalog];

  if (!model) {
    throw createWfaError({
      status: 409,
      code: 'WFA_REASON_CATALOG_CONFLICT',
      message: 'Katalog alasan WFA tidak valid.'
    });
  }

  return model;
};

const normalizeOptionalText = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const assertReasonId = (reasonId, { code, field, message }) => {
  if (!Number.isInteger(Number(reasonId)) || Number(reasonId) < 1) {
    throw createWfaError({ code, message, field });
  }
};

const normalizeCreatePayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createValidationError('Body katalog alasan harus berupa object.', null);
  }

  const allowedFields = ['label', 'is_active', 'is_other', 'sort_order'];
  const unknownField = Object.keys(payload).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw createValidationError(`Field ${unknownField} tidak didukung.`, unknownField);
  }

  const label = normalizeOptionalText(payload.label);
  if (!label || label.length > 120) {
    throw createValidationError('Label alasan wajib diisi dan maksimal 120 karakter.', 'label');
  }

  const sortOrder = payload.sort_order ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw createValidationError('sort_order harus bilangan bulat non-negatif.', 'sort_order');
  }

  if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') {
    throw createValidationError('is_active harus boolean.', 'is_active');
  }

  if (payload.is_other !== undefined && typeof payload.is_other !== 'boolean') {
    throw createValidationError('is_other harus boolean.', 'is_other');
  }

  return {
    label,
    is_active: payload.is_active ?? true,
    is_other: payload.is_other ?? false,
    sort_order: sortOrder
  };
};

const normalizeUpdatePayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createValidationError('Body katalog alasan harus berupa object.', null);
  }

  if (Object.hasOwn(payload, 'is_other')) {
    throw createWfaError({
      status: 409,
      code: 'WFA_REASON_CATALOG_CONFLICT',
      message: 'Tipe Other tidak dapat diubah setelah alasan dibuat.',
      field: 'is_other'
    });
  }

  const allowedFields = ['label', 'is_active', 'sort_order'];
  const providedFields = Object.keys(payload);
  const unknownField = providedFields.find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw createValidationError(`Field ${unknownField} tidak didukung.`, unknownField);
  }
  if (providedFields.length === 0) {
    throw createValidationError('Minimal satu field perubahan wajib diisi.', null);
  }

  const normalized = {};
  if (Object.hasOwn(payload, 'label')) {
    const label = normalizeOptionalText(payload.label);
    if (!label || label.length > 120) {
      throw createValidationError('Label alasan wajib diisi dan maksimal 120 karakter.', 'label');
    }
    normalized.label = label;
  }
  if (Object.hasOwn(payload, 'is_active')) {
    if (typeof payload.is_active !== 'boolean') {
      throw createValidationError('is_active harus boolean.', 'is_active');
    }
    normalized.is_active = payload.is_active;
  }
  if (Object.hasOwn(payload, 'sort_order')) {
    if (!Number.isInteger(payload.sort_order) || payload.sort_order < 0) {
      throw createValidationError('sort_order harus bilangan bulat non-negatif.', 'sort_order');
    }
    normalized.sort_order = payload.sort_order;
  }

  return normalized;
};

export const readWfaRequestConfig = async (transaction = null) => {
  let settings;

  try {
    settings = await getOperationalSettingsStrict(transaction);
  } catch (_error) {
    throw createWfaError({
      status: 500,
      code: 'WFA_CONFIG_UNAVAILABLE',
      message: 'Konfigurasi WFA belum tersedia.'
    });
  }

  const reasons = await WfaRequestReason.findAll({
    where: { is_active: true },
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC']
    ],
    transaction
  });

  return {
    radiusMeters: settings.wfaRequestRadiusM,
    reasons: reasons.map((reason) => ({
      id: reason.id,
      label: reason.label,
      isOther: Boolean(reason.is_other),
      sortOrder: reason.sort_order
    }))
  };
};

export const resolveActiveWfaRequestReason = async ({
  reasonId,
  otherReasonText = null,
  transaction = null
}) => {
  assertReasonId(reasonId, {
    code: 'WFA_REQUEST_REASON_REQUIRED',
    field: 'request_reason_id',
    message: 'Alasan pengajuan WFA wajib dipilih.'
  });

  const reason = await WfaRequestReason.findByPk(Number(reasonId), { transaction });
  if (!reason) {
    throw createWfaError({
      code: 'WFA_REQUEST_REASON_NOT_FOUND',
      message: 'Alasan pengajuan WFA tidak ditemukan.',
      field: 'request_reason_id'
    });
  }
  if (!reason.is_active) {
    throw createWfaError({
      code: 'WFA_REQUEST_REASON_NOT_ACTIVE',
      message: 'Alasan WFA tidak lagi tersedia.',
      field: 'request_reason_id'
    });
  }

  const trimmedOtherReason = normalizeOptionalText(otherReasonText);
  if (reason.is_other && !trimmedOtherReason) {
    throw createWfaError({
      code: 'WFA_OTHER_REASON_REQUIRED',
      message: 'Keterangan alasan lainnya wajib diisi.',
      field: 'request_other_reason'
    });
  }

  return {
    reason,
    normalizedOtherReason: reason.is_other ? trimmedOtherReason : null
  };
};

export const resolveActiveWfaRejectionReason = async ({
  reasonId,
  note = null,
  transaction = null
}) => {
  assertReasonId(reasonId, {
    code: 'REJECTION_REASON_REQUIRED',
    field: 'rejection_reason_id',
    message: 'Alasan penolakan wajib dipilih.'
  });

  const reason = await WfaRejectionReason.findByPk(Number(reasonId), { transaction });
  if (!reason) {
    throw createWfaError({
      code: 'REJECTION_REASON_NOT_FOUND',
      message: 'Alasan penolakan tidak ditemukan.',
      field: 'rejection_reason_id'
    });
  }
  if (!reason.is_active) {
    throw createWfaError({
      code: 'REJECTION_REASON_NOT_ACTIVE',
      message: 'Alasan penolakan tidak lagi tersedia.',
      field: 'rejection_reason_id'
    });
  }

  const normalizedNote = normalizeOptionalText(note);
  if (reason.is_other && !normalizedNote) {
    throw createWfaError({
      code: 'REJECTION_NOTE_REQUIRED',
      message: 'Catatan wajib diisi untuk alasan penolakan Lainnya.',
      field: 'rejection_note'
    });
  }

  return { reason, normalizedNote };
};

export const listWfaReasons = async ({
  catalog,
  includeInactive = false,
  transaction = null
}) => {
  const model = getCatalogModel(catalog);
  return model.findAll({
    where: includeInactive ? {} : { is_active: true },
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC']
    ],
    transaction
  });
};

export const createWfaReason = async ({ catalog, payload, transaction = null }) => {
  const model = getCatalogModel(catalog);
  const normalized = normalizeCreatePayload(payload);

  if (normalized.is_other) {
    const existingOther = await model.findOne({ where: { is_other: true }, transaction });
    if (existingOther) {
      throw createWfaError({
        status: 409,
        code: 'WFA_REASON_CATALOG_CONFLICT',
        message: 'Katalog ini sudah memiliki alasan Lainnya.',
        field: 'is_other'
      });
    }
  }

  const now = new Date();
  return model.create(
    {
      ...normalized,
      created_at: now,
      updated_at: now
    },
    { transaction }
  );
};

export const updateWfaReason = async ({ catalog, id, payload, transaction = null }) => {
  const model = getCatalogModel(catalog);
  const normalized = normalizeUpdatePayload(payload);
  const reason = await model.findByPk(Number(id), { transaction });

  if (!reason) {
    throw createWfaError({
      code: CATALOG_NOT_FOUND_CODES[catalog],
      message: 'Alasan WFA tidak ditemukan.',
      field: 'id'
    });
  }

  await reason.update({ ...normalized, updated_at: new Date() }, { transaction });
  return reason;
};
