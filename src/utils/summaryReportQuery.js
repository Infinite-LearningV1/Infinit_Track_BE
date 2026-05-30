export const SUMMARY_REPORT_SEARCH_FIELDS = [
  '$user.full_name$',
  '$user.nip_nim$',
  '$user.email$',
  '$user.role.role_name$',
  '$status.attendance_status_name$',
  '$attendance_category.category_name$'
];

const SUMMARY_SEARCH_PARAM_PRECEDENCE = ['q', 'search', 'query', 'keyword'];

const firstStringValue = (value) => {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim()) ?? null;
  }

  return typeof value === 'string' ? value : null;
};

export const resolveSummarySearchTerm = (query = {}) => {
  for (const key of SUMMARY_SEARCH_PARAM_PRECEDENCE) {
    const value = firstStringValue(query[key]);
    const trimmed = value?.trim();

    if (trimmed) {
      return { term: trimmed, source: key };
    }
  }

  return { term: null, source: null };
};

export default {
  SUMMARY_REPORT_SEARCH_FIELDS,
  resolveSummarySearchTerm
};
