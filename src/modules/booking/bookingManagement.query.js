import { Op } from 'sequelize';

import sequelize from '../../config/database.js';
import {
  BookingStatus,
  Location,
  Position,
  Role,
  User,
  WfaRejectionReason,
  WfaRequestReason
} from '../../models/index.js';

const STATUS_IDS = Object.freeze({
  approved: 1,
  rejected: 2,
  pending: 3
});

export const escapeBookingSearchLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const buildApplicantInclude = (search) => {
  const term = typeof search === 'string' ? search.trim() : '';
  const like = term ? `%${escapeBookingSearchLike(term)}%` : null;
  const include = {
    model: User,
    as: 'user',
    attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
    required: Boolean(like),
    include: [
      {
        model: Position,
        as: 'position',
        attributes: ['position_name'],
        required: false
      },
      {
        model: Role,
        as: 'role',
        attributes: ['id_roles', 'role_name'],
        required: false
      }
    ]
  };

  if (like) {
    include.where = {
      [Op.or]: [
        { full_name: { [Op.like]: like } },
        { nip_nim: { [Op.like]: like } }
      ]
    };
  }

  return include;
};
const buildProcessorInclude = () => ({
  model: User,
  as: 'processor',
  attributes: ['id_users', 'full_name'],
  required: false,
  include: [
    {
      model: Role,
      as: 'role',
      attributes: ['role_name'],
      required: false
    }
  ]
});

const buildScheduleDateWhere = ({ date_from, date_to }) => {
  if (date_from && date_to) return { [Op.between]: [date_from, date_to] };
  if (date_from) return { [Op.gte]: date_from };
  if (date_to) return { [Op.lte]: date_to };
  return null;
};

export const buildBookingManagementListQuery = (query = {}) => {
  const { page = 1, limit = 10, status, user_id, date_from, date_to, search } = query;
  const where = {};

  if (status) where.status = STATUS_IDS[status];
  if (user_id) where.user_id = user_id;
  const scheduleDateWhere = buildScheduleDateWhere({ date_from, date_to });
  if (scheduleDateWhere) where.schedule_date = scheduleDateWhere;

  return {
    attributes: [
      'booking_id',
      'user_id',
      'schedule_date',
      'location_id',
      'status',
      'notes',
      'created_at',
      'approved_by',
      'processed_at',
      'suitability_score',
      'suitability_label',
      'request_reason_id',
      'request_other_reason',
      'rejection_reason_id',
      'rejection_note',
      'radius_snapshot'
    ],
    where,
    include: [
      buildApplicantInclude(search),
      buildProcessorInclude(),
      {
        model: Location,
        as: 'location',
        attributes: ['location_id', 'latitude', 'longitude', 'radius', 'description'],
        required: false
      },
      {
        model: BookingStatus,
        as: 'booking_status',
        attributes: ['name_status'],
        required: false
      },
      {
        model: WfaRequestReason,
        as: 'request_reason',
        attributes: ['id', 'label', 'is_other'],
        required: false
      },
      {
        model: WfaRejectionReason,
        as: 'rejection_reason_detail',
        attributes: ['id', 'label', 'is_other'],
        required: false
      }
    ],
    order: [
      [sequelize.fn('FIELD', sequelize.col('status'), 3, 1, 2), 'ASC'],
      ['created_at', 'DESC'],
      ['booking_id', 'DESC']
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true
  };
};
