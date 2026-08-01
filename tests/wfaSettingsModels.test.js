import * as models from '../src/models/index.js';

describe('WFA policy persistence models', () => {
  it('exports both reason catalogs and keeps the legacy booking rejection field', () => {
    expect(models).toHaveProperty('WfaRequestReason');
    expect(models).toHaveProperty('WfaRejectionReason');
    expect(models.Booking.rawAttributes).toHaveProperty('request_reason_id');
    expect(models.Booking.rawAttributes).toHaveProperty('request_other_reason');
    expect(models.Booking.rawAttributes).toHaveProperty('rejection_reason_id');
    expect(models.Booking.rawAttributes).toHaveProperty('rejection_note');
    expect(models.Booking.rawAttributes).toHaveProperty('radius_snapshot');
    expect(models.Booking.rawAttributes).toHaveProperty('rejection_reason');
  });

  it('registers stable booking association aliases for both catalogs', () => {
    expect(models.Booking.associations).toHaveProperty('request_reason');
    expect(models.Booking.associations).toHaveProperty('rejection_reason_detail');
  });
});
