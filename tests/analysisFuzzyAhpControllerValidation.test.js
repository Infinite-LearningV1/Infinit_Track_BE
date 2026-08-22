import { jest } from '@jest/globals';

const mockBuildDisciplineAnalysis = jest.fn();
const mockBuildDisciplineFahpPayload = jest.fn();
const mockBuildFuzzyAhpDashboardRecapPayload = jest.fn();
const mockBuildSmartAcAnalysis = jest.fn();
const mockBuildSmartAcFahpPayload = jest.fn();
const mockFormatWibDateTime = jest.fn();
const mockGetAnalysisWindow = jest.fn();
const mockAnalyze = jest.fn();
const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/services/fuzzyAhpAnalysis.service.js', () => ({
  buildDisciplineAnalysis: mockBuildDisciplineAnalysis,
  buildDisciplineFahpPayload: mockBuildDisciplineFahpPayload,
  buildFuzzyAhpDashboardRecapPayload: mockBuildFuzzyAhpDashboardRecapPayload,
  buildSmartAcAnalysis: mockBuildSmartAcAnalysis,
  buildSmartAcFahpPayload: mockBuildSmartAcFahpPayload,
  formatWibDateTime: mockFormatWibDateTime,
  getAnalysisWindow: mockGetAnalysisWindow
}));
jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
  analyze: mockAnalyze
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    error: mockLoggerError
  }
}));

const {
  getFuzzyAhpAnalysis,
  getFuzzyAhpDashboardRecap
} = await import('../src/controllers/analysis.controller.js');
const {
  fuzzyAhpDashboardRecapValidation,
  validate
} = await import('../src/middlewares/validator.js');

const createDashboardValidatorHarness = async (query) => {
  const req = { query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  const next = jest.fn();

  for (const middleware of [...fuzzyAhpDashboardRecapValidation, validate]) {
    await new Promise((resolve) => {
      middleware(req, res, () => {
        next();
        resolve();
      });

      if (res.status.mock.calls.length > 0) {
        resolve();
      }
    });

    if (res.status.mock.calls.length > 0) break;
  }

  return { req, res, next };
};

describe('analysis fuzzy ahp controller validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAnalysisWindow.mockReturnValue({
      startAt: new Date('2026-08-01T00:00:00.000Z'),
      endAt: new Date('2026-08-15T00:00:00.000Z')
    });
  });

  it('returns 400 for invalid type values', async () => {
    const req = {
      query: { type: 'invalid', period: 'monthly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'type must be one of: wfa, discipline, smart_ac'
    });
  });

  it('returns 400 for invalid period values', async () => {
    const req = {
      query: { type: 'discipline', period: 'yearly' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'period must be one of: weekly, monthly'
    });
  });

  it('delegates dashboard recap payload and returns additive display fields in the success envelope', async () => {
    const req = {
      query: { type: 'discipline' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    const payload = {
      type: 'discipline',
      type_label: 'Discipline',
      generated_at: '2026-06-26T00:00:00+07:00',
      timezone: 'Asia/Jakarta',
      requested_window: { period: 'monthly' },
      executed_window: {
        start_at: '2026-06-01T00:00:00+07:00',
        end_at: '2026-06-26T00:00:00+07:00'
      },
      status: 'ready',
      needs_data: false,
      consistency: {
        CR: 0.01,
        threshold: 0.1,
        is_consistent: true,
        summary_label: 'Konsistensi dapat diterima'
      },
      criteria_weights: [
        {
          key: 'alpha_rate',
          label: 'alpha_rate',
          display_label: 'Disiplin Kehadiran',
          value: 0.317
        }
      ],
      ranking_preview: { top_n: 5, items: [] },
      distribution: {
        'Sangat Tinggi': 0,
        Tinggi: 0,
        Sedang: 0,
        Rendah: 0,
        'Sangat Rendah': 0
      }
    };

    mockBuildFuzzyAhpDashboardRecapPayload.mockResolvedValue(payload);

    await getFuzzyAhpDashboardRecap(req, res, next);

    expect(mockBuildFuzzyAhpDashboardRecapPayload).toHaveBeenCalledWith({ type: 'discipline' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: payload,
      message: 'Fuzzy AHP dashboard recap retrieved successfully'
    });
  });

  it('delegates WFA dashboard recap with explicit from/to and preserves the success envelope', async () => {
    const req = {
      query: { type: 'wfa', from: '2026-08-01', to: '2026-08-15' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    const payload = {
      type: 'wfa',
      type_label: 'WFA',
      status: 'ready',
      timezone: 'Asia/Jakarta',
      requested_window: { from: '2026-08-01', to: '2026-08-15' },
      criteria_weights: [
        { key: 'location_type', display_label: 'Tipe Lokasi', value: 0.6335 }
      ],
      consistency: {
        CR: 0.0576,
        threshold: 0.1,
        is_consistent: true,
        summary_label: 'Konsistensi dapat diterima'
      },
      methodology: { version: 'wfa_fahp_v1', weighting_method: 'row_geometric_mean_fallback' },
      ranking_preview: { top_n: 5, items: [] },
      evidence: {
        approved_booking_count: 1,
        analyzable_booking_count: 1,
        excluded_missing_snapshot_count: 0,
        excluded_incompatible_snapshot_count: 0,
        unique_location_count: 1,
        ranked_location_count: 1
      }
    };

    mockBuildFuzzyAhpDashboardRecapPayload.mockResolvedValue(payload);

    await getFuzzyAhpDashboardRecap(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildFuzzyAhpDashboardRecapPayload).toHaveBeenCalledWith({
      type: 'wfa',
      from: '2026-08-01',
      to: '2026-08-15'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: payload,
      message: 'Fuzzy AHP dashboard recap retrieved successfully'
    });
  });

  it('keeps the generic fuzzy-ahp type=wfa route retired with the exact move contract', async () => {
    const req = { query: { type: 'wfa', period: 'monthly' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await getFuzzyAhpAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildFuzzyAhpDashboardRecapPayload).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'WFA_ANALYSIS_MOVED',
      message: 'Use /api/analysis/fuzzy-ahp/wfa with lat, lon, and schedule_date.'
    });
  });

  it.each([
    [{ type: 'wfa', to: '2026-08-15' }, 'Parameter from dan to wajib diisi saat period=range atau custom'],
    [{ type: 'wfa', from: '2026-08-01' }, 'Parameter from dan to wajib diisi saat period=range atau custom'],
    [{ type: 'wfa', from: '2026-02-30', to: '2026-08-15' }, 'Parameter from harus menggunakan format YYYY-MM-DD'],
    [{ type: 'wfa', from: '2026-08-15', to: '2026-08-01' }, 'Parameter from tidak boleh lebih besar dari to'],
    [{ type: 'wfa', from: '2026-08-01', to: '2026-09-01' }, 'Rentang tanggal custom maksimal 31 hari'],
    [{ type: 'wfa', period: 'monthly', from: '2026-08-01', to: '2026-08-15' }, 'only type, from, and to query parameters are allowed for wfa dashboard'],
    [{ type: 'wfa', lat: '-0.9', from: '2026-08-01', to: '2026-08-15' }, 'only type, from, and to query parameters are allowed for wfa dashboard'],
    [{ type: 'wfa', lon: '119.8', from: '2026-08-01', to: '2026-08-15' }, 'only type, from, and to query parameters are allowed for wfa dashboard'],
    [{ type: 'wfa', schedule_date: '2026-08-15', from: '2026-08-01', to: '2026-08-15' }, 'only type, from, and to query parameters are allowed for wfa dashboard'],
    [{ type: 'wfa', radius_meters: '5000', from: '2026-08-01', to: '2026-08-15' }, 'only type, from, and to query parameters are allowed for wfa dashboard']
  ])('rejects invalid WFA dashboard query %#', async (query, expectedMessage) => {
    const { res } = await createDashboardValidatorHarness(query);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'E_VALIDATION',
        message: expectedMessage
      })
    );
  });

  it('accepts only type/from/to for a valid WFA dashboard query', async () => {
    const { res, next } = await createDashboardValidatorHarness({
      type: 'wfa',
      from: '2026-08-01',
      to: '2026-08-15'
    });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('logs and forwards dashboard recap builder errors', async () => {
    const req = {
      query: { type: 'discipline' },
      user: { id: 12, role_name: 'Admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    const error = new Error('boom');

    mockBuildFuzzyAhpDashboardRecapPayload.mockRejectedValue(error);

    await getFuzzyAhpDashboardRecap(req, res, next);

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to build FAHP dashboard recap', {
      error: 'boom',
      query: req.query
    });
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
