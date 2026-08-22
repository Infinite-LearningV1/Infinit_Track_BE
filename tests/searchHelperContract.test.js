import { Op } from 'sequelize';

import { applySearch, applyMultipleSearch } from '../src/utils/searchHelper.js';

/**
 * Characterization coverage for the shared search primitive
 * (INF-252, Phase 2 groundwork).
 *
 * `applySearch` builds the search predicate for both admin lists --
 * getAllAttendances and, indirectly, anything else that adopts it. Eleven test
 * files mock this module. **None test it.** It is the least-covered piece of
 * shared code in the repository, and Phase 2 replaces it with an allowlisted
 * query object.
 *
 * Two recorded findings are pinned here as executable evidence rather than
 * prose: it mutates its argument (F2), and it does not escape LIKE wildcards
 * (F3).
 */

/** Reads the Op.or / Op.and arrays that are stored under symbol keys. */
const symbolValue = (obj, sym) => obj?.[sym];

describe('applySearch guard clauses', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a non-string', 42]
  ])('returns the options untouched for %s', (_name, term) => {
    const options = { where: { deleted_at: null } };

    const result = applySearch(options, term, ['full_name']);

    expect(result).toBe(options);
    expect(result.where).toEqual({ deleted_at: null });
  });

  it.each([
    ['undefined fields', undefined],
    ['an empty array', []],
    ['a non-array', 'full_name']
  ])('returns the options untouched for %s', (_name, fields) => {
    const options = { where: { deleted_at: null } };

    const result = applySearch(options, 'nadia', fields);

    expect(result.where).toEqual({ deleted_at: null });
  });
});

describe('applySearch predicate construction', () => {
  it('builds an OR of LIKE clauses across every field', () => {
    const options = {};

    applySearch(options, 'nadia', ['full_name', 'nip_nim']);

    const or = symbolValue(options.where, Op.or);
    expect(or).toHaveLength(2);
    expect(symbolValue(or[0].full_name, Op.like)).toBe('%nadia%');
    expect(symbolValue(or[1].nip_nim, Op.like)).toBe('%nadia%');
  });

  it('trims the term before wrapping it', () => {
    const options = {};

    applySearch(options, '  nadia  ', ['full_name']);

    const or = symbolValue(options.where, Op.or);
    expect(symbolValue(or[0].full_name, Op.like)).toBe('%nadia%');
  });

  it('creates the where clause when none exists', () => {
    const options = {};

    applySearch(options, 'nadia', ['full_name']);

    expect(options.where).toBeDefined();
  });

  it('wraps pre-existing conditions in an AND alongside the search', () => {
    const options = { where: { deleted_at: null } };

    applySearch(options, 'nadia', ['full_name']);

    const and = symbolValue(options.where, Op.and);
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ deleted_at: null });
    expect(symbolValue(and[1], Op.or)).toHaveLength(1);
  });

  it('appends to an existing AND rather than nesting a second one', () => {
    const options = { where: { [Op.and]: [{ user_id: 7 }] } };

    applySearch(options, 'nadia', ['full_name']);

    const and = symbolValue(options.where, Op.and);
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ user_id: 7 });
  });

  it('supports the $association.field$ syntax the attendance list relies on', () => {
    const options = {};

    applySearch(options, 'nadia', ['$user.full_name$', '$user.nip_nim$']);

    const or = symbolValue(options.where, Op.or);
    expect(Object.keys(or[0])[0]).toBe('$user.full_name$');
  });
});

describe('applySearch known defects', () => {
  /**
   * F2. The function returns the same object it was given and edits it in
   * place. A caller cannot build a query, branch, and discard one path --
   * every call permanently changes the options it was handed. Phase 2's query
   * object should return a new value instead.
   */
  it('mutates the caller options in place instead of returning a new object', () => {
    const options = { where: { deleted_at: null }, limit: 10 };
    const before = options.where;

    const result = applySearch(options, 'nadia', ['full_name']);

    expect(result).toBe(options);
    expect(options.where).not.toBe(before);
    expect(options.where).not.toEqual({ deleted_at: null });
  });

  /**
   * F3. The term is interpolated straight into `%...%` with no escaping of
   * the LIKE metacharacters. This is not SQL injection -- Sequelize still
   * binds the value -- but the search behaves in ways a user cannot predict.
   */
  it.each([
    ['percent', '100%', '%100%%'],
    ['underscore', 'a_b', '%a_b%'],
    ['both', '50%_off', '%50%_off%']
  ])('does not escape the LIKE wildcard in a %s search', (_name, term, expected) => {
    const options = {};

    applySearch(options, term, ['full_name']);

    const or = symbolValue(options.where, Op.or);
    expect(symbolValue(or[0].full_name, Op.like)).toBe(expected);
  });

  it('turns a lone percent sign into a match-everything query', () => {
    const options = {};

    applySearch(options, '%', ['full_name']);

    const or = symbolValue(options.where, Op.or);
    // '%%%' matches every row rather than rows containing a percent sign.
    expect(symbolValue(or[0].full_name, Op.like)).toBe('%%%');
  });
});

describe('applyMultipleSearch', () => {
  it('returns the options untouched when either argument is not an object', () => {
    const options = { where: {} };

    expect(applyMultipleSearch(options, null, {})).toBe(options);
    expect(applyMultipleSearch(options, {}, null)).toBe(options);
  });

  it('applies a single mapped parameter', () => {
    const options = {};

    applyMultipleSearch(options, { name: 'nadia' }, { name: ['full_name'] });

    const or = symbolValue(options.where, Op.or);
    expect(or).toHaveLength(1);
    expect(symbolValue(or[0].full_name, Op.like)).toBe('%nadia%');
  });

  /**
   * F37, characterized not fixed.
   *
   * applySearch decides whether to preserve existing conditions with
   * `Object.keys(queryOptions.where).length > 0`. Its own predicate is stored
   * under the SYMBOL key Op.or, and Object.keys does not enumerate symbols.
   *
   * So on the second call the branch concludes the where clause is empty and
   * REPLACES it. Searching two fields through applyMultipleSearch silently
   * keeps only the last one.
   */
  it('silently discards all but the last search term', () => {
    const options = {};

    applyMultipleSearch(
      options,
      { name: 'nadia', code: 'A123' },
      { name: ['full_name'], code: ['nip_nim'] }
    );

    // No AND was built, and the first predicate is gone.
    expect(symbolValue(options.where, Op.and)).toBeUndefined();

    const or = symbolValue(options.where, Op.or);
    expect(or).toHaveLength(1);
    expect(Object.keys(or[0])[0]).toBe('nip_nim');
    expect(symbolValue(or[0].nip_nim, Op.like)).toBe('%A123%');
  });

  it('loses the first term even when applySearch is called directly twice', () => {
    const options = {};

    applySearch(options, 'nadia', ['full_name']);
    applySearch(options, 'A123', ['nip_nim']);

    const or = symbolValue(options.where, Op.or);
    expect(or).toHaveLength(1);
    expect(Object.keys(or[0])[0]).toBe('nip_nim');
  });

  it('skips a parameter with no matching field mapping', () => {
    const options = {};

    applyMultipleSearch(options, { unmapped: 'nadia' }, { name: ['full_name'] });

    expect(options.where).toBeUndefined();
  });
});
