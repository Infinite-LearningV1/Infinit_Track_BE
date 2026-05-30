const {
  SUMMARY_REPORT_SEARCH_FIELDS,
  resolveSummarySearchTerm
} = await import('../src/utils/summaryReportQuery.js');

describe('summary report search query helpers', () => {
  test('defines searchable fields for summary report rows', () => {
    expect(SUMMARY_REPORT_SEARCH_FIELDS).toEqual([
      '$user.full_name$',
      '$user.nip_nim$',
      '$user.email$',
      '$user.role.role_name$',
      '$status.attendance_status_name$',
      '$attendance_category.category_name$'
    ]);
  });

  test('uses q as canonical search parameter', () => {
    expect(resolveSummarySearchTerm({ q: '  Nico  ' })).toEqual({
      term: 'Nico',
      source: 'q'
    });
  });

  test('falls back through deprecated aliases', () => {
    expect(resolveSummarySearchTerm({ search: 'Rina' })).toEqual({
      term: 'Rina',
      source: 'search'
    });
    expect(resolveSummarySearchTerm({ query: 'late' })).toEqual({
      term: 'late',
      source: 'query'
    });
    expect(resolveSummarySearchTerm({ keyword: 'wfo' })).toEqual({
      term: 'wfo',
      source: 'keyword'
    });
  });

  test('uses q over all deprecated aliases', () => {
    expect(
      resolveSummarySearchTerm({
        q: 'Canonical',
        search: 'SearchAlias',
        query: 'QueryAlias',
        keyword: 'KeywordAlias'
      })
    ).toEqual({
      term: 'Canonical',
      source: 'q'
    });
  });

  test('skips blank values and keeps precedence for next non-blank alias', () => {
    expect(resolveSummarySearchTerm({ q: '   ', search: 'SearchAlias' })).toEqual({
      term: 'SearchAlias',
      source: 'search'
    });
  });

  test('returns null term when no search value is provided', () => {
    expect(resolveSummarySearchTerm({})).toEqual({ term: null, source: null });
    expect(resolveSummarySearchTerm({ q: '   ' })).toEqual({ term: null, source: null });
  });

  test('uses the first non-blank string value from array query params', () => {
    expect(resolveSummarySearchTerm({ q: ['FirstValue', 'SecondValue'] })).toEqual({
      term: 'FirstValue',
      source: 'q'
    });

    expect(resolveSummarySearchTerm({ q: ['  ', 'ArrayValue'] })).toEqual({
      term: 'ArrayValue',
      source: 'q'
    });
  });
});
