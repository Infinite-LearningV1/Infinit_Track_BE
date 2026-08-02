import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const mockBookingFindOne = jest.fn();

jest.unstable_mockModule('../src/models/booking.model.js', () => ({
  default: { findOne: mockBookingFindOne }
}));

const {
  assertFutureWibScheduleDate,
  assertWfaEligibility,
  findActiveDuplicateBooking
} = await import('../src/services/wfaEligibility.service.js');

describe('assertFutureWibScheduleDate', () => {
  test.each(['', '2026/08/10', '2026-02-30', '2026-8-10', null])(
    'rejects invalid date %p',
    (value) => {
      expect(() => assertFutureWibScheduleDate(value, { today: '2026-08-02' })).toThrow(
        expect.objectContaining({ code: 'INVALID_SCHEDULE_DATE', status: 400 })
      );
    }
  );

  test.each([
    ['2026-08-01', 'PAST_DATE_NOT_ALLOWED'],
    ['2026-08-02', 'SAME_DAY_NOT_ALLOWED']
  ])('rejects %s with %s', (value, code) => {
    expect(() => assertFutureWibScheduleDate(value, { today: '2026-08-02' })).toThrow(
      expect.objectContaining({ code })
    );
  });

  test('returns a future date unchanged', () => {
    expect(assertFutureWibScheduleDate('2026-08-03', { today: '2026-08-02' })).toBe('2026-08-03');
  });
});

describe('WFA duplicate booking eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds pending or approved duplicates for the authenticated user and schedule date', async () => {
    const transaction = { id: 'transaction-1' };
    const duplicate = { booking_id: 17 };
    mockBookingFindOne.mockResolvedValue(duplicate);

    await expect(
      findActiveDuplicateBooking({
        userId: 41,
        scheduleDate: '2026-08-03',
        transaction
      })
    ).resolves.toBe(duplicate);

    expect(mockBookingFindOne).toHaveBeenCalledTimes(1);
    const [{ where, transaction: receivedTransaction }] = mockBookingFindOne.mock.calls[0];
    expect(where.user_id).toBe(41);
    expect(where.schedule_date).toBe('2026-08-03');
    expect(where.status).toEqual({ [Op.in]: [1, 3] });
    expect(receivedTransaction).toBe(transaction);
  });

  test('skips the duplicate query when analysis eligibility disables duplicate checks', async () => {
    await expect(
      assertWfaEligibility({
        userId: 41,
        scheduleDate: '2099-08-03',
        checkDuplicate: false
      })
    ).resolves.toBe('2099-08-03');

    expect(mockBookingFindOne).not.toHaveBeenCalled();
  });
});
