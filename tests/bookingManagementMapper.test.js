import { mapBookingManagementRow } from '../src/modules/booking/bookingManagement.mapper.js';

const baseRow = {
  booking_id: 42,
  user: {
    id_users: 7,
    full_name: 'Andi Saputra',
    nip_nim: 'EMP-007',
    email: 'andi@example.com',
    position: { position_name: 'Backend Engineer' },
    role: { role_name: 'Employee' }
  },
  schedule_date: '2026-08-12',
  booking_status: { name_status: 'approved' },
  location: {
    location_id: 13,
    latitude: '-0.8917',
    longitude: '119.8707',
    radius: '100',
    description: 'Coworking Space Palu'
  },
  notes: 'Meeting onsite',
  created_at: new Date('2026-08-09T05:00:00.000Z'),
  processed_at: new Date('2026-08-09T06:00:00.000Z'),
  approved_by: 12,
  suitability_score: '82.45',
  suitability_label: 'Baik'
};
test('projects a manual processor identity and canonical nested WFA reason data', () => {
  const result = mapBookingManagementRow({
    ...baseRow,
    processor: {
      id_users: 12,
      full_name: 'Eko Prasetyo',
      role: { role_name: 'Admin' }
    },
    request_reason: { id: 3, label: 'Pertemuan dengan klien', is_other: false },
    request_other_reason: null,
    rejection_reason_detail: null,
    rejection_note: null,
    radius_snapshot: 150
  });

  expect(result).toMatchObject({
    booking_id: 42,
    user_id: 7,
    user_full_name: 'Andi Saputra',
    user_nip_nim: 'EMP-007',
    user_position_name: 'Backend Engineer',
    status: 'approved',
    radius_snapshot: 150,
    suitability_score: 82.45,
    suitability_label: 'Baik'
  });
  expect(result.processed_by).toEqual({
    id: 12,
    full_name: 'Eko Prasetyo',
    role: 'Admin'
  });
  expect(result.request_reason).toEqual({
    id: 3,
    label: 'Pertemuan dengan klien',
    is_other: false,
    other_text: null
  });
  expect(result.rejection_reason).toBeNull();
  expect(result.location).toEqual({
    location_id: 13,
    latitude: -0.8917,
    longitude: 119.8707,
    radius: 100,
    description: 'Coworking Space Palu'
  });
});

test('keeps automated processed rows truthful when there is no human processor', () => {
  const result = mapBookingManagementRow({
    ...baseRow,
    booking_status: { name_status: 'rejected' },
    approved_by: null,
    processor: null,
    request_reason: null,
    rejection_reason_detail: { id: 4, label: 'Lokasi tidak sesuai', is_other: false },
    rejection_note: 'Pilih lokasi lain',
    radius_snapshot: null
  });

  expect(result.processed_at).toEqual(baseRow.processed_at);
  expect(result.processed_by).toBeNull();
  expect(result.approved_by).toBeNull();
  expect(result.rejection_reason).toEqual({
    id: 4,
    label: 'Lokasi tidak sesuai',
    is_other: false,
    note: 'Pilih lokasi lain'
  });
  expect(result.radius_snapshot).toBe(100);
});

test('preserves nullable scoring without fabricating fallback quality', () => {
  const result = mapBookingManagementRow({
    ...baseRow,
    suitability_score: null,
    suitability_label: null,
    processor: null,
    request_reason: null,
    rejection_reason_detail: null,
    radius_snapshot: 100
  });
  expect(result.suitability_score).toBeNull();
  expect(result.suitability_label).toBeNull();
  expect(result.processed_by).toBeNull();
});

test('preserves numeric zero as a real suitability score', () => {
  const result = mapBookingManagementRow({
    ...baseRow,
    suitability_score: '0.00',
    suitability_label: 'Tidak Direkomendasikan',
    processor: null,
    request_reason: null,
    rejection_reason_detail: null,
    radius_snapshot: 100
  });

  expect(result.suitability_score).toBe(0);
  expect(result.suitability_label).toBe('Tidak Direkomendasikan');
});
