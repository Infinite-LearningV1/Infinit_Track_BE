import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const User = { modelName: 'User' };
const Position = { modelName: 'Position' };
const Role = { modelName: 'Role' };
const Location = { modelName: 'Location' };
const BookingStatus = { modelName: 'BookingStatus' };
const WfaRequestReason = { modelName: 'WfaRequestReason' };
const WfaRejectionReason = { modelName: 'WfaRejectionReason' };
const sequelizeMock = {
  fn: jest.fn((...args) => ({ fn: args })),
  col: jest.fn((value) => ({ col: value }))
};

jest.unstable_mockModule('../src/config/database.js', () => ({ default: sequelizeMock }));
jest.unstable_mockModule('../src/models/index.js', () => ({
  User,
  Position,
  Role,
  Location,
  BookingStatus,
  WfaRequestReason,
  WfaRejectionReason
}));

const { buildBookingManagementListQuery, escapeBookingSearchLike } = await import(
  '../src/modules/booking/bookingManagement.query.js'
);
test('escapes SQL LIKE wildcard characters in applicant search terms', () => {
  expect(escapeBookingSearchLike('A%_\\')).toBe('A\\%\\_\\\\');
});

test('builds combined applicant search, booking filters, and pagination in one query graph', () => {
  const query = buildBookingManagementListQuery({
    page: 2,
    limit: 5,
    status: 'pending',
    user_id: 42,
    date_from: '2026-08-10',
    date_to: '2026-08-31',
    search: '  A%_\\  ',
    sortBy: 'location',
    sortOrder: 'ASC'
  });

  expect(query.where).toEqual({
    status: 3,
    user_id: 42,
    schedule_date: { [Op.between]: ['2026-08-10', '2026-08-31'] }
  });
  expect(query.limit).toBe(5);
  expect(query.offset).toBe(5);
  expect(query.distinct).toBe(true);
  const applicant = query.include.find((item) => item.as === 'user');
  expect(applicant).toMatchObject({
    model: User,
    as: 'user',
    required: true,
    attributes: ['id_users', 'full_name', 'email', 'nip_nim']
  });
  expect(applicant.where).toEqual({
    [Op.or]: [
      { full_name: { [Op.like]: '%A\\%\\_\\\\%' } },
      { nip_nim: { [Op.like]: '%A\\%\\_\\\\%' } }
    ]
  });
  expect(applicant.include).toEqual(expect.arrayContaining([
    expect.objectContaining({ model: Position, as: 'position' }),
    expect.objectContaining({ model: Role, as: 'role' })
  ]));
});

test('keeps applicant optional without search and includes an optional processor identity', () => {
  const query = buildBookingManagementListQuery({ page: 1, limit: 10 });
  const applicant = query.include.find((item) => item.as === 'user');
  const processor = query.include.find((item) => item.as === 'processor');

  expect(applicant.required).toBe(false);
  expect(applicant).not.toHaveProperty('where');
  expect(processor).toMatchObject({
    model: User,
    as: 'processor',
    required: false,
    attributes: ['id_users', 'full_name']
  });
  expect(processor.include).toEqual([
    expect.objectContaining({ model: Role, as: 'role', required: false })
  ]);
  expect(query.include).toEqual(expect.arrayContaining([
    expect.objectContaining({ model: Location, as: 'location' }),
    expect.objectContaining({ model: BookingStatus, as: 'booking_status' }),
    expect.objectContaining({ model: WfaRequestReason, as: 'request_reason' }),
    expect.objectContaining({ model: WfaRejectionReason, as: 'rejection_reason_detail' })
  ]));
});

test('preserves approval-first ordering with newest and booking id tie-breakers', () => {
  const query = buildBookingManagementListQuery({ page: 1, limit: 10 });

  expect(query.order).toEqual([
    [{ fn: ['FIELD', { col: 'status' }, 3, 1, 2] }, 'ASC'],
    ['created_at', 'DESC'],
    ['booking_id', 'DESC']
  ]);
});
