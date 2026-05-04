import { Op } from 'sequelize';

import { Attendance, AttendanceCategory, Location, Photo, User } from '../models/index.js';
import { getJakartaDateString } from './geofence.js';
import { formatTimeOnly } from './workHourFormatter.js';

const HERO_MAP_STATUS_BY_CATEGORY = {
  WFO: 'WFO',
  WFH: 'WFH',
  WFA: 'WFA',
  'Work From Office': 'WFO',
  'Work From Home': 'WFH',
  'Work From Anywhere': 'WFA'
};

export const buildTodayLocationsSnapshot = async ({ date = getJakartaDateString() } = {}) => {
  const rows = await Attendance.findAll({
    where: {
      attendance_date: date,
      time_in: {
        [Op.not]: null
      }
    },
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
      {
        model: Location,
        as: 'location',
        attributes: ['latitude', 'longitude'],
        required: false
      },
      {
        model: AttendanceCategory,
        as: 'attendance_category',
        attributes: ['category_name']
      }
    ],
    order: [['time_in', 'ASC']]
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

  return {
    date,
    timezone: 'Asia/Jakarta',
    total_users: locations.length,
    locations
  };
};

export default {
  buildTodayLocationsSnapshot
};
