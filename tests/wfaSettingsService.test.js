import { jest } from '@jest/globals';

const mockGetOperationalSettingsStrict = jest.fn();
const mockRequestFindAll = jest.fn();
const mockRequestFindByPk = jest.fn();
const mockRequestFindOne = jest.fn();
const mockRequestCreate = jest.fn();
const mockRejectionFindAll = jest.fn();
const mockRejectionFindByPk = jest.fn();
const mockRejectionFindOne = jest.fn();
const mockRejectionCreate = jest.fn();

jest.unstable_mockModule('../src/utils/settings.js', () => ({
  getOperationalSettingsStrict: mockGetOperationalSettingsStrict
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  WfaRequestReason: {
    findAll: mockRequestFindAll,
    findByPk: mockRequestFindByPk,
    findOne: mockRequestFindOne,
    create: mockRequestCreate
  },
  WfaRejectionReason: {
    findAll: mockRejectionFindAll,
    findByPk: mockRejectionFindByPk,
    findOne: mockRejectionFindOne,
    create: mockRejectionCreate
  }
}));

const {
  readWfaRequestConfig,
  resolveActiveWfaRequestReason,
  resolveActiveWfaRejectionReason,
  listWfaReasons,
  createWfaReason,
  updateWfaReason
} = await import('../src/services/wfaSettings.service.js');

describe('WFA settings service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads strict radius and projects only active request reasons in stable order', async () => {
    const transaction = { id: 'tx' };
    mockGetOperationalSettingsStrict.mockResolvedValue({ wfaRequestRadiusM: 100 });
    mockRequestFindAll.mockResolvedValue([
      { id: 1, label: 'Pertemuan dengan klien', is_other: false, sort_order: 10 }
    ]);

    await expect(readWfaRequestConfig(transaction)).resolves.toEqual({
      radiusMeters: 100,
      reasons: [
        { id: 1, label: 'Pertemuan dengan klien', isOther: false, sortOrder: 10 }
      ]
    });
    expect(mockRequestFindAll).toHaveBeenCalledWith({
      where: { is_active: true },
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC']
      ],
      transaction
    });
  });

  it('maps strict operational setting failures to a stable WFA configuration error', async () => {
    mockGetOperationalSettingsStrict.mockRejectedValue(
      Object.assign(new Error('raw settings details'), { code: 'E_OPERATIONAL_SETTINGS_INVALID' })
    );
    mockRequestFindAll.mockResolvedValue([]);

    await expect(readWfaRequestConfig()).rejects.toMatchObject({
      status: 500,
      code: 'WFA_CONFIG_UNAVAILABLE',
      details: []
    });
  });

  it.each([
    [null, 'WFA_REQUEST_REASON_REQUIRED'],
    [undefined, 'WFA_REQUEST_REASON_REQUIRED']
  ])('requires a request reason id (%p)', async (reasonId, code) => {
    await expect(resolveActiveWfaRequestReason({ reasonId })).rejects.toMatchObject({
      status: 400,
      code
    });
  });

  it('rejects a request reason that does not exist', async () => {
    mockRequestFindByPk.mockResolvedValue(null);

    await expect(
      resolveActiveWfaRequestReason({ reasonId: 99, otherReasonText: null })
    ).rejects.toMatchObject({
      status: 400,
      code: 'WFA_REQUEST_REASON_NOT_FOUND'
    });
  });

  it('rejects an inactive request reason', async () => {
    mockRequestFindByPk.mockResolvedValue({ id: 3, is_active: false, is_other: false });

    await expect(resolveActiveWfaRequestReason({ reasonId: 3 })).rejects.toMatchObject({
      status: 400,
      code: 'WFA_REQUEST_REASON_NOT_ACTIVE'
    });
  });

  it('requires trimmed text for an Other request reason', async () => {
    mockRequestFindByPk.mockResolvedValue({ id: 4, is_active: true, is_other: true });

    await expect(
      resolveActiveWfaRequestReason({ reasonId: 4, otherReasonText: '   ' })
    ).rejects.toMatchObject({
      status: 400,
      code: 'WFA_OTHER_REASON_REQUIRED'
    });
  });

  it('normalizes request Other text only when the selected reason is Other', async () => {
    const reason = { id: 4, is_active: true, is_other: true };
    mockRequestFindByPk.mockResolvedValueOnce(reason).mockResolvedValueOnce({
      id: 1,
      is_active: true,
      is_other: false
    });

    await expect(
      resolveActiveWfaRequestReason({ reasonId: 4, otherReasonText: '  Keperluan khusus  ' })
    ).resolves.toEqual({ reason, normalizedOtherReason: 'Keperluan khusus' });
    await expect(
      resolveActiveWfaRequestReason({ reasonId: 1, otherReasonText: 'ignored' })
    ).resolves.toMatchObject({ normalizedOtherReason: null });
  });

  it('requires an active rejection reason and a note for Other', async () => {
    mockRejectionFindByPk
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3, is_active: false, is_other: false })
      .mockResolvedValueOnce({ id: 5, is_active: true, is_other: true });

    await expect(resolveActiveWfaRejectionReason({ reasonId: null })).rejects.toMatchObject({
      code: 'REJECTION_REASON_REQUIRED'
    });
    await expect(resolveActiveWfaRejectionReason({ reasonId: 99 })).rejects.toMatchObject({
      code: 'REJECTION_REASON_NOT_FOUND'
    });
    await expect(resolveActiveWfaRejectionReason({ reasonId: 3 })).rejects.toMatchObject({
      code: 'REJECTION_REASON_NOT_ACTIVE'
    });
    await expect(
      resolveActiveWfaRejectionReason({ reasonId: 5, note: '' })
    ).rejects.toMatchObject({ code: 'REJECTION_NOTE_REQUIRED' });
  });

  it('normalizes optional rejection notes', async () => {
    const reason = { id: 2, is_active: true, is_other: false };
    mockRejectionFindByPk.mockResolvedValue(reason);

    await expect(
      resolveActiveWfaRejectionReason({ reasonId: 2, note: '  Konteks tambahan  ' })
    ).resolves.toEqual({ reason, normalizedNote: 'Konteks tambahan' });
  });

  it('lists the selected catalog with optional inactive rows', async () => {
    mockRequestFindAll.mockResolvedValue([{ id: 1 }]);

    await expect(
      listWfaReasons({ catalog: 'request', includeInactive: true })
    ).resolves.toEqual([{ id: 1 }]);
    expect(mockRequestFindAll).toHaveBeenCalledWith({
      where: {},
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC']
      ],
      transaction: null
    });
  });

  it('rejects a second Other row in the same catalog', async () => {
    mockRequestFindOne.mockResolvedValue({ id: 4, is_other: true });

    await expect(
      createWfaReason({
        catalog: 'request',
        payload: { label: 'Lain lagi', is_other: true, sort_order: 1000 }
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'WFA_REASON_CATALOG_CONFLICT'
    });
    expect(mockRequestCreate).not.toHaveBeenCalled();
  });

  it('creates a normalized catalog row', async () => {
    const created = { id: 10 };
    mockRejectionCreate.mockResolvedValue(created);

    await expect(
      createWfaReason({
        catalog: 'rejection',
        payload: { label: '  Kebijakan lain  ', is_other: false, sort_order: 25 }
      })
    ).resolves.toBe(created);
    expect(mockRejectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Kebijakan lain',
        is_active: true,
        is_other: false,
        sort_order: 25,
        created_at: expect.any(Date),
        updated_at: expect.any(Date)
      }),
      { transaction: null }
    );
  });

  it('updates only mutable catalog fields and preserves fixed is_other semantics', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const reason = { id: 7, is_other: true, update };
    mockRequestFindByPk.mockResolvedValue(reason);

    await expect(
      updateWfaReason({
        catalog: 'request',
        id: 7,
        payload: { label: '  Lainnya terbaru ', is_active: false, sort_order: 900 }
      })
    ).resolves.toBe(reason);
    expect(update).toHaveBeenCalledWith(
      {
        label: 'Lainnya terbaru',
        is_active: false,
        sort_order: 900,
        updated_at: expect.any(Date)
      },
      { transaction: null }
    );

    await expect(
      updateWfaReason({ catalog: 'request', id: 7, payload: { is_other: false } })
    ).rejects.toMatchObject({ code: 'WFA_REASON_CATALOG_CONFLICT' });
  });

  it.each([
    [{ label: '   ' }, 'label'],
    [{ label: 'x'.repeat(121) }, 'label'],
    [{ label: 'Valid', sort_order: -1 }, 'sort_order'],
    [{ label: 'Valid', is_active: 'yes' }, 'is_active']
  ])('rejects invalid catalog payload %p', async (payload, field) => {
    await expect(
      createWfaReason({ catalog: 'request', payload })
    ).rejects.toMatchObject({ status: 400, code: 'E_VALIDATION', details: [{ field, code: 'E_VALIDATION' }] });
  });
});
