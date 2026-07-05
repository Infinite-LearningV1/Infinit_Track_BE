import { jest } from '@jest/globals';

const mockCollectDatabaseSnapshot = jest.fn();
const mockApplyResearchAttendancePlan = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockBookingFindAll = jest.fn();
const mockLocationEventFindAll = jest.fn();
const mockUserFindAll = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockTransaction = jest.fn(async () => ({
  commit: mockCommit,
  rollback: mockRollback
}));

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    researchAttendanceTriggerEnabled: true
  }
}));

jest.unstable_mockModule('../scripts/research/generate-attendance-dataset.js', () => ({
  collectDatabaseSnapshot: mockCollectDatabaseSnapshot,
  applyResearchAttendancePlan: mockApplyResearchAttendancePlan
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: {
    findAll: mockAttendanceFindAll
  },
  Booking: {
    findAll: mockBookingFindAll
  },
  LocationEvent: {
    findAll: mockLocationEventFindAll
  },
  User: {
    findAll: mockUserFindAll
  },
  Role: {},
  sequelize: {
    transaction: mockTransaction,
    Sequelize: {
      Op: {
        gte: Symbol.for('gte'),
        lt: Symbol.for('lt')
      }
    }
  }
}));

const {
  collectTriggerSnapshotForDate,
  applyResearchAttendancePlanInTransaction
} = await import('../src/services/researchAttendanceTrigger.service.js');

describe('research attendance trigger infrastructure helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindAll.mockResolvedValue([
      {
        id_users: 10,
        full_name: 'User 10',
        role: { role_name: 'Internship' }
      }
    ]);
  });

  it('merges target-date attendance snapshot rows beyond the historical generator window', async () => {
    mockCollectDatabaseSnapshot.mockResolvedValue({
      dbIdentity: { host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' },
      baselineUsers: [{ userId: 10, role_name: 'Internship' }],
      existingAttendanceRows: [],
      existingBookingRows: [],
      existingLocationEvents: [],
      expectedLocationsByUser: { 10: { wfoLocationId: 101 } }
    });
    mockAttendanceFindAll.mockResolvedValue([
      { user_id: 10, attendance_date: '2026-07-01', status_id: 1, category_id: 1 }
    ]);
    mockBookingFindAll.mockResolvedValue([
      { booking_id: 33, user_id: 10, schedule_date: '2026-07-01', status: 1, location_id: 101 }
    ]);
    mockLocationEventFindAll.mockResolvedValue([
      { id: 7, user_id: 10, location_id: 101, event_type: 'ENTER', event_timestamp: '2026-07-01 08:00:00' }
    ]);

    const snapshot = await collectTriggerSnapshotForDate('2026-07-01');

    expect(snapshot.existingAttendanceRows).toEqual([
      expect.objectContaining({ user_id: 10, attendance_date: '2026-07-01' })
    ]);
    expect(snapshot.existingBookingRows).toEqual([
      expect.objectContaining({ booking_id: 33, schedule_date: '2026-07-01' })
    ]);
    expect(snapshot.existingLocationEvents).toEqual([
      expect.objectContaining({ id: 7, user_id: 10 })
    ]);
  });

  it('wraps apply writes in a transaction and commits on success', async () => {
    mockApplyResearchAttendancePlan.mockResolvedValue({
      attendance: 2,
      bookings: 1,
      locationEvents: 4
    });

    const result = await applyResearchAttendancePlanInTransaction({
      plannedAttendanceRows: [{ id_attendance: 1 }],
      plannedBookingRows: [{ booking_id: 1 }],
      plannedLocationEventRows: [{ id: 1 }]
    });

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockApplyResearchAttendancePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ commit: mockCommit, rollback: mockRollback })
      })
    );
    expect(mockCommit).toHaveBeenCalled();
    expect(mockRollback).not.toHaveBeenCalled();
    expect(result).toEqual({
      applied_writes: {
        attendance: 2,
        bookings: 1,
        location_events: 4
      },
      replaced: {
        attendance: 0,
        location_events: 0
      }
    });
  });

  it('rolls back transaction when apply write fails', async () => {
    mockApplyResearchAttendancePlan.mockRejectedValue(new Error('attendance insert failed'));

    await expect(
      applyResearchAttendancePlanInTransaction({
        plannedAttendanceRows: [{ id_attendance: 1 }],
        plannedBookingRows: [{ booking_id: 1 }],
        plannedLocationEventRows: [{ id: 1 }]
      })
    ).rejects.toThrow('attendance insert failed');

    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalled();
  });
});
