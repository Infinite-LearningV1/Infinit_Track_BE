// Models index file - Sequelize models entry point
import sequelize from '../config/database.js';

import User from './user.model.js';
import Attendance from './attendance.model.js';
import WfaRequest from './wfaRequest.model.js';
import Program from './program.model.js';
import Role from './role.model.js';
import Position from './position.model.js';
import Division from './division.model.js';
import Photo from './photo.model.js';
import AttendanceCategory from './attendanceCategory.model.js';
import AttendanceStatus from './attendanceStatus.model.js';
import AttendanceSessionState from './attendanceSessionState.model.js';
import Location from './location.js';
import Settings from './settings.model.js';
import Booking from './booking.model.js';
import BookingStatus from './bookingStatus.model.js';
import LocationEvent from './locationEvent.model.js';
import AuthSession from './authSession.model.js';
import WfaRequestReason from './wfaRequestReason.model.js';
import WfaRejectionReason from './wfaRejectionReason.model.js';

// Jalankan relasi SETELAH define semua model
User.belongsTo(Role, { foreignKey: 'id_roles', as: 'role' });
User.belongsTo(Program, { foreignKey: 'id_programs', as: 'program' });
User.belongsTo(Position, { foreignKey: 'id_position', as: 'position' });
User.belongsTo(Division, { foreignKey: 'id_divisions', as: 'division' });
User.belongsTo(Photo, { foreignKey: 'id_photos', as: 'photo_file' });

// Role relations
Role.hasMany(User, { foreignKey: 'id_roles', as: 'users' });

// Program relations
Program.hasMany(User, { foreignKey: 'id_programs', as: 'users' });
Program.hasMany(Position, { foreignKey: 'id_programs', as: 'positions' });

// Position relations
Position.belongsTo(Program, { foreignKey: 'id_programs', as: 'program' });
Position.hasMany(User, { foreignKey: 'id_position', as: 'users' });

// Division relations
Division.hasMany(User, { foreignKey: 'id_divisions', as: 'users' });

// Photo relations
Photo.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// AuthSession relations
User.hasMany(AuthSession, {
  foreignKey: 'user_id',
  sourceKey: 'id_users',
  as: 'auth_sessions'
});
AuthSession.belongsTo(User, {
  foreignKey: 'user_id',
  targetKey: 'id_users',
  as: 'user'
});

// Attendance relations
Attendance.belongsTo(User, {
  foreignKey: 'user_id',
  targetKey: 'id_users',
  as: 'user'
});
Attendance.belongsTo(Location, {
  foreignKey: 'location_id',
  as: 'location'
});
Attendance.belongsTo(AttendanceCategory, {
  foreignKey: 'category_id',
  targetKey: 'id_attendance_categories',
  as: 'attendance_category'
});
Attendance.belongsTo(AttendanceStatus, {
  foreignKey: 'status_id',
  targetKey: 'id_attendance_status',
  as: 'status'
});
Attendance.belongsTo(Booking, {
  foreignKey: 'booking_id',
  as: 'booking'
});

// Location relations with User and AttendanceCategory
User.hasOne(Location, {
  foreignKey: 'user_id',
  as: 'wfh_location',
  scope: { id_attendance_categories: 2 }
});
Location.belongsTo(User, {
  foreignKey: 'user_id',
  targetKey: 'id_users',
  as: 'user'
});
Location.belongsTo(AttendanceCategory, {
  foreignKey: 'id_attendance_categories',
  as: 'attendance_category'
});

// Booking relations
Booking.belongsTo(User, {
  foreignKey: 'user_id',
  targetKey: 'id_users',
  as: 'user'
});
Booking.belongsTo(User, {
  foreignKey: 'approved_by',
  targetKey: 'id_users',
  as: 'processor'
});
Booking.belongsTo(Location, {
  foreignKey: 'location_id',
  as: 'location'
});
Booking.belongsTo(BookingStatus, {
  foreignKey: 'status',
  as: 'booking_status'
});
Booking.hasMany(Attendance, {
  foreignKey: 'booking_id',
  as: 'attendances'
});
Booking.belongsTo(WfaRequestReason, {
  foreignKey: 'request_reason_id',
  as: 'request_reason'
});
Booking.belongsTo(WfaRejectionReason, {
  foreignKey: 'rejection_reason_id',
  as: 'rejection_reason_detail'
});
WfaRequestReason.hasMany(Booking, {
  foreignKey: 'request_reason_id',
  as: 'bookings'
});
WfaRejectionReason.hasMany(Booking, {
  foreignKey: 'rejection_reason_id',
  as: 'bookings'
});

// BookingStatus relations
BookingStatus.hasMany(Booking, {
  foreignKey: 'status',
  as: 'bookings'
});

export {
  sequelize,
  User,
  Attendance,
  WfaRequest,
  Program,
  Role,
  Position,
  Division,
  Photo,
  AttendanceCategory,
  AttendanceStatus,
  AttendanceSessionState,
  Location,
  Settings,
  Booking,
  BookingStatus,
  LocationEvent,
  AuthSession,
  WfaRequestReason,
  WfaRejectionReason
};
