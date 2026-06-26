import { jest } from '@jest/globals';

const mockBuildDisciplineAnalysis = jest.fn();
const mockBuildDisciplineFahpPayload = jest.fn();
const mockBuildFuzzyAhpDashboardRecapPayload = jest.fn();
const mockBuildSmartAcAnalysis = jest.fn();
const mockBuildSmartAcFahpPayload = jest.fn();
const mockBuildWfaAnalysis = jest.fn();
const mockBuildWfaFahpPayload = jest.fn();
const mockFormatWibDateTime = jest.fn();
const mockGetAnalysisWindow = jest.fn();
const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/services/fuzzyAhpAnalysis.service.js', () => ({
  buildDisciplineAnalysis: mockBuildDisciplineAnalysis,
  buildDisciplineFahpPayload: mockBuildDisciplineFahpPayload,
  buildFuzzyAhpDashboardRecapPayload: mockBuildFuzzyAhpDashboardRecapPayload,
  buildSmartAcAnalysis: mockBuildSmartAcAnalysis,
  buildSmartAcFahpPayload: mockBuildSmartAcFahpPayload,
  buildWfaAnalysis: mockBuildWfaAnalysis,
  buildWfaFahpPayload: mockBuildWfaFahpPayload,
  formatWibDateTime: mockFormatWibDateTime,
  getAnalysisWindow: mockGetAnalysisWindow
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

describe('analysis fuzzy ahp controller validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('delegates dashboard recap to the recap payload builder and returns success envelope', async () => {
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
      generated_at: '2026-06-26T00:00:00+07:00',
      timezone: 'Asia/Jakarta',
      requested_window: { period: 'monthly' },
      executed_window: {
        start_at: '2026-06-01T00:00:00+07:00',
        end_at: '2026-06-26T00:00:00+07:00'
      },
      status: 'ready',
      needs_data: false,
      consistency: { CR: 0.01, threshold: 0.1, is_consistent: true },
      criteria_weights: [{ key: 'attendance', label: 'attendance', value: 0.4 }],
      ranking_preview: { top_n: 5, items: [] },
      distribution: { 'Sangat Tinggi': 0, Tinggi: 0, Sedang: 0, Rendah: 0, 'Sangat Rendah': 0 }
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

  it('logs and forwards dashboard recap builder errors', async () => {
    const req = {
      query: { type: 'wfa' },
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
