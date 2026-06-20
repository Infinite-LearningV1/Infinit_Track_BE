import { Op } from 'sequelize';

import { Attendance, AttendanceCategory, Location, Photo, User } from '../models/index.js';
import { getJakartaDateString } from './geofence.js';
import { formatTimeOnly } from './workHourFormatter.js';

const DEFAULT_HERO_MAP_MAX_USERS = 500;

const HERO_MAP_STATUS_BY_CATEGORY = {
  WFO: 'WFO',
  WFH: 'WFH',
  WFA: 'WFA',
  'Work From Office': 'WFO',
  'Work From Home': 'WFH',
  'Work From Anywhere': 'WFA'
};

const createBadRequest = (message) => {
  const error = new Error(message);
  error.status = 400;

  return error;
};

const parsePositiveInteger = (value) => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
};

const parseLimit = (limit) => {
  if (limit == null) {
    return null;
  }

  if (typeof limit !== 'string' || !/^[1-9]\d*$/.test(limit)) {
    throw createBadRequest('limit must be a positive integer');
  }

  return Number.parseInt(limit, 10);
};

const resolveMaxUsers = (limit) => {
  const envMaxUsers = parsePositiveInteger(process.env.HERO_MAP_MAX_USERS) ?? DEFAULT_HERO_MAP_MAX_USERS;
  const requestedLimit = parseLimit(limit);

  return requestedLimit == null ? envMaxUsers : Math.min(requestedLimit, envMaxUsers);
};

const buildAttendanceWhere = (date) => ({
  attendance_date: date,
  time_in: {
    [Op.not]: null
  }
});

const buildLocationInclude = () => ({
  model: Location,
  as: 'location',
  attributes: ['latitude', 'longitude'],
  required: true,
  where: {
    latitude: { [Op.not]: null },
    longitude: { [Op.not]: null }
  }
});

const buildCategoryInclude = () => ({
  model: AttendanceCategory,
  as: 'attendance_category',
  attributes: ['category_name'],
  required: true,
  where: {
    category_name: { [Op.in]: Object.keys(HERO_MAP_STATUS_BY_CATEGORY) }
  }
});

const buildMappableIncludes = () => [buildLocationInclude(), buildCategoryInclude()];

export const buildTodayLocationsSnapshot = async ({ date = getJakartaDateString(), limit } = {}) => {
  const maxUsers = resolveMaxUsers(limit);
  const where = buildAttendanceWhere(date);
  const mappableIncludes = buildMappableIncludes();
  const totalUsers = await Attendance.count({
    where,
    include: mappableIncludes,
    distinct: true,
    col: 'id_attendance'
  });
  const rows = await Attendance.findAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id_users', 'full_name'],
        include: [
          {
            model: Photo,
            as: 'photo_file',
            attributes: ['photo_url'],
            required: false
          }
        ]
      },
      ...mappableIncludes
    ],
    order: [['time_in', 'ASC']],
    limit: maxUsers
  });

  const locations = rows
    .map((attendance) => {
      const latitude =
        attendance.location?.latitude != null ? parseFloat(attendance.location.latitude) : null;
      const longitude =
        attendance.location?.longitude != null ? parseFloat(attendance.location.longitude) : null;
      const categoryName = attendance.attendance_category?.category_name;
      const status = categoryName ? HERO_MAP_STATUS_BY_CATEGORY[categoryName] ?? null : null;

      if (
        latitude == null ||
        longitude == null ||
        Number.isNaN(latitude) ||
        Number.isNaN(longitude) ||
        !status
      ) {
        return null;
      }

      return {
        user_id: attendance.user?.id_users,
        full_name: attendance.user?.full_name || 'Unknown User',
        photo: attendance.user?.photo_file?.photo_url || null,
        status,
        check_in_time: formatTimeOnly(attendance.time_in),
        latitude,
        longitude
      };
    })
    .filter(Boolean);

  const truncated = totalUsers > maxUsers;

  return {
    date,
    timezone: 'Asia/Jakarta',
    snapshot_type: 'attendance_checkin_snapshot',
    is_live_tracking: false,
    authority: 'context_only',
    final_attendance_authority: 'attendance_records',
    total_users: totalUsers,
    truncated,
    truncated_at: truncated ? maxUsers : null,
    locations
  };
};

export default {
  buildTodayLocationsSnapshot
};
