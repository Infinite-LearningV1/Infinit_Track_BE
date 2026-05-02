/**
 * JAKARTA TIMEZONE UTILITIES - Fixed Implementation V4
 * ALWAYS record in WIB (UTC+7) regardless of server location
 * System will force all timestamps to WIB for consistency
 */

/**
 * Get current time in WIB (UTC+7) - FORCE WIB regardless of server location
 * @returns {Date} Current WIB time
 */
export const getJakartaTime = () => {
  const now = new Date();
  // Get WIB time string using proper timezone
  const wibString = now.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Parse the WIB string back to Date (this will be in local timezone but has WIB values)
  const [datePart, timePart] = wibString.split(', ');
  const [day, month, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');

  return new Date(year, month - 1, day, hour, minute, second);
};

/**
 * Get current time for database storage
 * Returns a UTC time that when formatted with +7 hours will show WIB time
 */
export const getCurrentTimeForDB = () => {
  // FIXED: Simply get current UTC time and let formatting handle WIB conversion
  // Database stores UTC, formatUTCToJakartaTime handles the WIB conversion
  return new Date();
};

/**
 * Convert any date to Jakarta timezone
 * @param {Date} date - Date to convert
 * @returns {Date} Date converted to Jakarta timezone
 */
export const toJakartaTime = (date) => {
  if (!date) return null;
  const inputDate = new Date(date);
  const jakartaOffset = 7 * 60 * 60 * 1000; // 7 hours in milliseconds
  return new Date(inputDate.getTime() + jakartaOffset);
};

/**
 * Format datetime to WIB time in HH:MM format
 * For data from Sequelize with timezone +07:00 setting (already in WIB)
 * @param {Date|string} dateTime - Date object from Sequelize (already in WIB timezone)
 * @returns {string} Formatted time as "HH:MM" in WIB timezone
 */
export const formatUTCToJakartaTime = (dateTime) => {
  if (!dateTime) {
    return '00:00';
  }

  const date = new Date(dateTime);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return '00:00';
  }

  // Since Sequelize timezone is +07:00, the date object is already in WIB
  // Just format the hours and minutes directly
  const hours = date.getHours();
  const minutes = date.getMinutes();

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/**
 * Get Jakarta time formatted as YYYY-MM-DD
 * @returns {string} Today's date in Jakarta timezone
 */
export const getJakartaDateString = () => {
  const jakartaTime = getJakartaTime();
  const year = jakartaTime.getFullYear();
  const month = String(jakartaTime.getMonth() + 1).padStart(2, '0');
  const day = String(jakartaTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 * @param {number} lat1 - First latitude
 * @param {number} lon1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lon2 - Second longitude
 * @returns {number} Distance in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6371000; // Mean Earth radius in meters

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);

  const a =
    sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
};

/**
 * Check if user is within allowed radius of a location
 * @param {number} userLat - User's latitude
 * @param {number} userLon - User's longitude
 * @param {number} locationLat - Location's latitude
 * @param {number} locationLon - Location's longitude
 * @param {number} radius - Allowed radius in meters
 * @returns {boolean} True if within radius
 */
export const isWithinRadius = (userLat, userLon, locationLat, locationLon, radius) => {
  const distance = calculateDistance(userLat, userLon, locationLat, locationLon);
  return distance <= radius;
};
