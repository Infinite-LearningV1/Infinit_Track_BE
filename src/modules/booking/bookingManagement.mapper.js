import { mapUserPhotoProjection } from '../../utils/userPhotoProjection.js';

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapRequestReason = (row) => row.request_reason
  ? {
      id: row.request_reason.id,
      label: row.request_reason.label,
      is_other: Boolean(row.request_reason.is_other),
      other_text: row.request_other_reason || null
    }
  : null;

const mapRejectionReason = (row) => row.rejection_reason_detail
  ? {
      id: row.rejection_reason_detail.id,
      label: row.rejection_reason_detail.label,
      is_other: Boolean(row.rejection_reason_detail.is_other),
      note: row.rejection_note || null
    }
  : null;

const mapProcessor = (row) => row.processor
  ? {
      id: row.processor.id_users,
      full_name: row.processor.full_name ?? null,
      role: row.processor.role?.role_name ?? null
    }
  : null;
const mapLocation = (row) => row.location
  ? {
      location_id: row.location.location_id,
      latitude: numberOrNull(row.location.latitude),
      longitude: numberOrNull(row.location.longitude),
      radius: numberOrNull(row.location.radius),
      description: row.location.description ?? null
    }
  : null;

export const mapBookingManagementRow = (row) => {
  const location = mapLocation(row);
  const { photo, photo_updated_at: photoUpdatedAt } = mapUserPhotoProjection(row.user);
  const radiusSnapshot = row.radius_snapshot != null
    ? numberOrNull(row.radius_snapshot)
    : location?.radius ?? null;

  return {
    booking_id: row.booking_id,
    user_id: row.user?.id_users ?? row.user_id ?? null,
    user_full_name: row.user?.full_name ?? null,
    user_role_name: row.user?.role?.role_name ?? null,
    user_email: row.user?.email ?? null,
    user_nip_nim: row.user?.nip_nim ?? null,
    user_photo: photo,
    user_photo_updated_at: photoUpdatedAt,
    user_position_name: row.user?.position?.position_name ?? null,
    schedule_date: row.schedule_date,
    status: row.booking_status?.name_status ?? null,
    location,
    notes: row.notes ?? '',
    suitability_score: numberOrNull(row.suitability_score),
    suitability_label: row.suitability_label ?? null,
    created_at: row.created_at,
    processed_at: row.processed_at ?? null,
    approved_by: row.approved_by ?? null,
    processed_by: mapProcessor(row),
    request_reason: mapRequestReason(row),
    rejection_reason: mapRejectionReason(row),
    radius_snapshot: radiusSnapshot
  };
};
