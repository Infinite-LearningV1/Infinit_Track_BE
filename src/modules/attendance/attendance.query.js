import { Op } from 'sequelize';
import {
  AttendanceCategory, AttendanceStatus, Location, Photo, Role, User
} from '../../models/index.js';
import { buildUserPhotoInclude } from '../../utils/userPhotoProjection.js';

const MODE_IDS = { wfo: 1, wfh: 2, wfa: 3 };
const STATUS_IDS = { ontime: 1, late: 2, alpha: 3, early: 4 };
const DIRECT_SORTS = new Set(['attendance_date', 'time_in', 'time_out', 'created_at']);

export const escapeAttendanceLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const buildOrder = ({ sortBy, sortOrder = 'DESC' }) => {
  if (!sortBy) {
    return [['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']];
  }

  const direction = sortOrder === 'ASC' ? 'ASC' : 'DESC';
  if (DIRECT_SORTS.has(sortBy)) return [[sortBy, direction], ['id_attendance', 'DESC']];
  if (sortBy === 'full_name') {
    return [[{ model: User, as: 'user' }, 'full_name', direction], ['id_attendance', 'DESC']];
  }
  if (sortBy === 'status') {
    return [[
      { model: AttendanceStatus, as: 'status' }, 'attendance_status_name', direction
    ], ['id_attendance', 'DESC']];
  }

  return [['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']];
};

export const buildAttendanceListQuery = (query = {}) => {
  const { page = 1, limit = 10, search, from, to, mode, status, checkout_state } = query;
  const where = {};

  if (from && to) where.attendance_date = { [Op.between]: [from, to] };
  else if (from) where.attendance_date = { [Op.gte]: from };
  else if (to) where.attendance_date = { [Op.lte]: to };
  if (mode) where.category_id = MODE_IDS[mode];
  if (status) where.status_id = STATUS_IDS[status];
  if (checkout_state === 'completed') where.time_out = { [Op.not]: null };
  if (checkout_state === 'open') where.time_out = { [Op.is]: null };

  const term = typeof search === 'string' ? search.trim() : '';
  const like = term ? `%${escapeAttendanceLike(term)}%` : null;
  const userInclude = {
    model: User,
    as: 'user',
    attributes: ['id_users', 'full_name', 'nip_nim'],
    required: Boolean(like),
    include: [
      { model: Role, as: 'role', attributes: ['role_name'], required: false },
      buildUserPhotoInclude(Photo)
    ]
  };

  if (like) {
    userInclude.where = {
      [Op.or]: [
        { full_name: { [Op.like]: like } },
        { nip_nim: { [Op.like]: like } },
        { email: { [Op.like]: like } }
      ]
    };
  }

  return {
    attributes: [
      'id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'category_id',
      'status_id', 'location_id'
    ],
    where,
    include: [
      userInclude,
      {
        model: Location,
        as: 'location',
        attributes: ['location_id', 'description'],
        required: false
      },
      {
        model: AttendanceStatus,
        as: 'status',
        attributes: ['attendance_status_name'],
        required: false
      },
      {
        model: AttendanceCategory,
        as: 'attendance_category',
        attributes: ['category_name'],
        required: false
      }
    ],
    order: buildOrder(query),
    limit,
    offset: (page - 1) * limit,
    distinct: true
  };
};

export const buildAttendanceDetailQuery = () => ({
  attributes: [
    'id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'category_id',
    'status_id', 'notes', 'booking_id', 'location_id'
  ],
  include: [
    {
      model: User,
      as: 'user',
      attributes: ['id_users', 'full_name', 'nip_nim', 'email'],
      required: false,
      include: [
        { model: Role, as: 'role', attributes: ['role_name'], required: false },
        buildUserPhotoInclude(Photo)
      ]
    },
    {
      model: Location,
      as: 'location',
      attributes: ['location_id', 'description', 'latitude', 'longitude', 'radius'],
      required: false
    },
    {
      model: AttendanceStatus,
      as: 'status',
      attributes: ['attendance_status_name'],
      required: false
    },
    {
      model: AttendanceCategory,
      as: 'attendance_category',
      attributes: ['category_name'],
      required: false
    }
  ]
});
