const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const isSafeUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

export const assertSafeUrl = (
  value,
  errorMessage = 'URL tidak valid atau protokol tidak diizinkan'
) => {
  if (!isSafeUrl(value)) {
    throw new Error(errorMessage);
  }

  return true;
};
