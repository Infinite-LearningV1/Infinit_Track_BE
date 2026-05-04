import { jest } from '@jest/globals';
import { Op } from 'sequelize';

describe('booking controller readiness regressions', () => {
  function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  function buildTransaction() {
    return {
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue()
    };
  }

  function buildSequelizeMock(transaction = buildTransaction()) {
    return {
      transaction: jest.fn().mockResolvedValue(transaction),
      fn: jest.fn((...args) => ({ args })),
      col: jest.fn((value) => value)
    };
  }

  function buildModelsMock({ findAndCountAllResult = { count: 0, rows: [] }, bookingRecord = null } = {}) {
    return {
      Booking: {
        findAndCountAll: jest.fn().mockResolvedValue(findAndCountAllResult),
        findByPk: jest.fn().mockResolvedValue(bookingRecord)
      },
      Location: {
        destroy: jest.fn()
      },
      BookingStatus: {},
      User: {},
      Position: {},
      Role: {}
    };
  }

  function mockControllerDependencies({ models, sequelizeMock }) {
    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: sequelizeMock
    }));

    jest.unstable_mockModule('../src/models/index.js', () => models);

    jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
      default: {}
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      }
    }));
  }

  async function importBookingController(models, sequelizeMock = buildSequelizeMock()) {
    mockControllerDependencies({ models, sequelizeMock });
    return import('../src/controllers/booking.controller.js');
  }

  async function expectListValidationError(query, expectedMessageFragment) {
    const models = buildModelsMock();
    const { getAllBookings } = await importBookingController(models);
    const res = buildRes();
    const next = jest.fn();

    await getAllBookings({ query }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(expectedMessageFragment)
      })
    );
    expect(models.Booking.findAndCountAll).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('applies documented bookings filters and pagination for admin listing', async () => {
    const sequelizeMock = buildSequelizeMock();
    const models = buildModelsMock({
      findAndCountAllResult: {
        count: 7,
        rows: [
          {
            booking_id: 88,
            user: {
              id_users: 42,
              full_name: 'Booking User',
              role: { role_name: 'User' },
              email: 'booking@example.com',
              nip_nim: 'EMP-42',
              position: { position_name: 'Engineer' }
            },
            schedule_date: '2026-05-15',
            booking_status: { name_status: 'approved' },
            location: {
              location_id: 9,
              latitude: '-0.8917',
              longitude: '119.8707',
              radius: '100',
              description: 'Remote Hub'
            },
            notes: 'Needs review',
            suitability_score: '80',
            suitability_label: 'Tinggi',
            created_at: new Date('2026-05-01T08:00:00.000Z'),
            processed_at: null,
            approved_by: null
          }
        ]
      }
    });

    mockControllerDependencies({ models, sequelizeMock });

    const { getAllBookings } = await import('../src/controllers/booking.controller.js');

    const req = {
      query: {
        status: 'approved',
        user_id: '42',
        date_from: '2026-05-01',
        date_to: '2026-05-31',
        page: '2',
        limit: '5'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getAllBookings(req, res, next);

    expect(models.Booking.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 1,
          user_id: 42,
          schedule_date: {
            [Op.gte]: '2026-05-01',
            [Op.lte]: '2026-05-31'
          }
        },
        limit: 5,
        offset: 5,
        distinct: true
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          pagination: expect.objectContaining({
            current_page: 2,
            total_pages: 2,
            total_items: 7,
            items_per_page: 5
          }),
          bookings: expect.arrayContaining([
            expect.objectContaining({
              booking_id: 88,
              user_id: 42,
              status: 'approved'
            })
          ])
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid status filters before querying bookings', async () => {
    await expectListValidationError({ status: 'archived' }, 'Status filter tidak valid');
  });

  it('rejects invalid pagination values before querying bookings', async () => {
    await expectListValidationError(
      {
        page: '0',
        limit: '-2'
      },
      'Parameter pagination tidak valid'
    );
  });

  it('rejects pagination limits above the admin safety cap', async () => {
    await expectListValidationError({ limit: '101' }, 'Limit maksimum adalah 100');
  });

  it('rejects invalid user_id filters before querying bookings', async () => {
    await expectListValidationError({ user_id: '0' }, 'Parameter user_id tidak valid');
  });

  it('rejects datetime date filters that do not match the published date format', async () => {
    await expectListValidationError(
      {
        date_from: '2026-05-01T12:00:00Z'
      },
      'Gunakan format YYYY-MM-DD'
    );
  });

  it('rejects date ranges where date_from is later than date_to', async () => {
    await expectListValidationError(
      {
        date_from: '2026-05-31',
        date_to: '2026-05-01'
      },
      'date_from tidak boleh lebih lambat dari date_to'
    );
  });

  it('deletes only the booking record without deleting the shared location', async () => {
    const transaction = buildTransaction();
    const sequelizeMock = buildSequelizeMock(transaction);
    const bookingRecord = {
      destroy: jest.fn().mockResolvedValue()
    };
    const models = buildModelsMock({ bookingRecord });

    mockControllerDependencies({ models, sequelizeMock });

    const { deleteBooking } = await import('../src/controllers/booking.controller.js');

    const req = {
      params: { id: '55' }
    };
    const res = buildRes();
    const next = jest.fn();

    await deleteBooking(req, res, next);

    expect(models.Booking.findByPk).toHaveBeenCalledWith('55', { transaction });
    expect(bookingRecord.destroy).toHaveBeenCalledWith({ transaction });
    expect(models.Location.destroy).not.toHaveBeenCalled();
    expect(transaction.commit).toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Data booking berhasil dihapus.'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
