import {
  readOperationalSettings,
  updateOperationalSettings
} from '../services/operationalSettings.service.js';

export const getOperationalSettings = async (_req, res, next) => {
  try {
    const settings = await readOperationalSettings();
    return res.status(200).json(settings);
  } catch (error) {
    return next(error);
  }
};

export const patchOperationalSettings = async (req, res, next) => {
  try {
    const settings = await updateOperationalSettings(req.body);
    return res.status(200).json(settings);
  } catch (error) {
    return next(error);
  }
};
