import { executeResearchAttendanceTrigger } from '../services/researchAttendanceTrigger.service.js';

export const triggerResearchAttendanceDaily = async (req, res, next) => {
  try {
    const result = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: req.body,
      user: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const triggerResearchAttendanceFullDay = async (req, res, next) => {
  try {
    const result = await executeResearchAttendanceTrigger({
      endpointType: 'full-day',
      body: req.body,
      user: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
