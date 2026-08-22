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

  function buildModelsMock({
    findAndCountAllResult = { count: 0, rows: [] },
    findAllResult = [],
    bookingRecord = null
  } = {}) {
    return {
      Booking: {
        findAndCountAll: jest.fn().mockResolvedValue(findAndCountAllResult),
        findAll: jest.fn().mockResolvedValue(findAllResult),
        findByPk: jest.fn().mockResolvedValue(bookingRecord)
      },
      Location: {
        destroy: jest.fn()
      },
      BookingStatus: {},
      User: {},
      Photo: {},
      Position: {},
      Role: {},
      WfaRequestReason: {},
      WfaRejectionReason: {}
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

    jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
      readWfaRequestConfig: jest.fn(),
      resolveActiveWfaRequestReason: jest.fn(),
      resolveActiveWfaRejectionReason: jest.fn()
    }));

    jest.unstable_mockModule('../src/services/wfaEligibility.service.js', () => ({
      assertWfaEligibility: jest.fn()
    }));

    jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
      scoreBookingLocation: jest.fn()
    }));
  }

  async function importBookingController(models, sequelizeMock = buildSequelizeMock()) {
    mockControllerDependencies({ models, sequelizeMock });
    return import('../src/controllers/booking.controller.js');
  }


  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });



  it('returns user-scoped all-status summary independent from active history status filter', async () => {
    const sequelizeMock = buildSequelizeMock();
    const models = buildModelsMock({
      findAllResult: [
        { status: 1, count: '5' },
        { status: 2, count: '1' },
        { status: 3, count: '2' }
      ],
      findAndCountAllResult: {
        count: 2,
        rows: [
          {
            booking_id: 90,
            status: 3,
            user: {
              id_users: 42,
              full_name: 'Booking User',
              role: { role_name: 'User' },
              email: 'booking@example.com',
              nip_nim: 'EMP-42',
              position: { position_name: 'Engineer' }
            },
            schedule_date: '2026-05-15',
            booking_status: { name_status: 'pending' },
            location: {
              location_id: 9,
              latitude: '-0.8917',
              longitude: '119.8707',
              radius: '100',
              description: 'Remote Hub'
            },
            notes: 'Needs review',
            suitability_score: '82.4',
            suitability_label: 'Recommended',
            created_at: new Date('2026-05-01T08:00:00.000Z'),
            processed_at: null,
            approved_by: null
          }
        ]
      }
    });

    mockControllerDependencies({ models, sequelizeMock });

    const { getBookingHistory } = await import('../src/controllers/booking.controller.js');

    const req = {
      user: { id: 42 },
      query: { status: 'pending', page: '1', limit: '10' }
    };
    const res = buildRes();
    const next = jest.fn();

    await getBookingHistory(req, res, next);

    expect(models.Booking.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 42,
          status: { [Op.in]: [1, 2, 3] }
        }),
        group: ['status'],
        raw: true
      })
    );
    expect(models.Booking.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 42, status: 3 },
        limit: 10,
        offset: 0,
        distinct: true
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          summary: {
            total: 8,
            pending: 2,
            approved: 5,
            rejected: 1
          },
          bookings: [
            expect.objectContaining({
              booking_id: 90,
              status: 'pending',
              status_key: 'pending',
              status_label: 'Pending'
            })
          ],
          pagination: expect.objectContaining({
            total_items: 2
          }),
          filters: expect.objectContaining({
            status: 'pending'
          })
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('treats status=all as no status filter for booking history list', async () => {
    const sequelizeMock = buildSequelizeMock();
    const models = buildModelsMock({
      findAllResult: [{ status: 3, count: '2' }],
      findAndCountAllResult: { count: 2, rows: [] }
    });

    mockControllerDependencies({ models, sequelizeMock });

    const { getBookingHistory } = await import('../src/controllers/booking.controller.js');

    const res = buildRes();
    const next = jest.fn();

    await getBookingHistory(
      {
        user: { id: 42 },
        query: { status: 'all', page: '1', limit: '10' }
      },
      res,
      next
    );

    expect(models.Booking.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 42 }
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filters: expect.objectContaining({ status: 'all' })
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid booking history status filters before querying bookings', async () => {
    const models = buildModelsMock();
    const { getBookingHistory } = await importBookingController(models);
    const res = buildRes();
    const next = jest.fn();

    await getBookingHistory({ user: { id: 42 }, query: { status: 'archived' } }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Status filter tidak valid')
      })
    );
    expect(models.Booking.findAll).not.toHaveBeenCalled();
    expect(models.Booking.findAndCountAll).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
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
