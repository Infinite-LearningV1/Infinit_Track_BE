import {
  createWfaReason,
  listWfaReasons,
  readWfaRequestConfig,
  updateWfaReason
} from '../services/wfaSettings.service.js';

const projectReason = (reason) => ({
  id: reason.id,
  label: reason.label,
  is_active: Boolean(reason.is_active),
  is_other: Boolean(reason.is_other),
  sort_order: reason.sort_order,
  created_at: reason.created_at,
  updated_at: reason.updated_at
});

export const getWfaRequestConfig = async (_req, res, next) => {
  try {
    const config = await readWfaRequestConfig();
    return res.status(200).json({
      success: true,
      data: {
        radius_meters: config.radiusMeters,
        reasons: config.reasons.map((reason) => ({
          id: reason.id,
          label: reason.label,
          is_other: reason.isOther,
          sort_order: reason.sortOrder
        }))
      }
    });
  } catch (error) {
    return next(error);
  }
};

const createListController = (catalog) => async (_req, res, next) => {
  try {
    const reasons = await listWfaReasons({ catalog, includeInactive: true });
    return res.status(200).json({
      success: true,
      data: { reasons: reasons.map(projectReason) }
    });
  } catch (error) {
    return next(error);
  }
};

const createCreateController = (catalog) => async (req, res, next) => {
  try {
    const reason = await createWfaReason({ catalog, payload: req.body });
    return res.status(201).json({
      success: true,
      data: { reason: projectReason(reason) }
    });
  } catch (error) {
    return next(error);
  }
};

const createUpdateController = (catalog) => async (req, res, next) => {
  try {
    const reason = await updateWfaReason({
      catalog,
      id: req.params.id,
      payload: req.body
    });
    return res.status(200).json({
      success: true,
      data: { reason: projectReason(reason) }
    });
  } catch (error) {
    return next(error);
  }
};

export const listWfaRequestReasons = createListController('request');
export const createWfaRequestReason = createCreateController('request');
export const updateWfaRequestReason = createUpdateController('request');
export const listWfaRejectionReasons = createListController('rejection');
export const createWfaRejectionReason = createCreateController('rejection');
export const updateWfaRejectionReason = createUpdateController('rejection');
