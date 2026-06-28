import { jest } from '@jest/globals';

const mockBuildFuzzyAhpDashboardRecapPayload = jest.fn();
const mockLoggerError = jest.fn();

jest.unstable_mockModule('../src/services/fuzzyAhpAnalysis.service.js', () => ({
  buildDisciplineAnalysis: jest.fn(),
  buildDisciplineFahpPayload: jest.fn(),
  buildFuzzyAhpDashboardRecapPayload: mockBuildFuzzyAhpDashboardRecapPayload,
  buildSmartAcAnalysis: jest.fn(),
  buildSmartAcFahpPayload: jest.fn(),
  buildWfaAnalysis: jest.fn(),
  buildWfaFahpPayload: jest.fn(),
  formatWibDateTime: jest.fn(),
  getAnalysisWindow: jest.fn()
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    error: mockLoggerError
  }
}));

const { getFuzzyAhpAnalysis, getFuzzyAhpDashboardRecap } = await import('../src/controllers/analysis.controller.js');

describe('analysis fuzzy ahp controller validation', () => {
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
    mockBuildFuzzyAhpDashboardRecapPayload.mockResolvedValueOnce({
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
    });

    const req = { query: { type: 'discipline' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await getFuzzyAhpDashboardRecap(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildFuzzyAhpDashboardRecapPayload).toHaveBeenCalledWith({ type: 'discipline' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
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
      },
      message: 'Fuzzy AHP dashboard recap retrieved successfully'
    });
  });

  it('keeps additive display fields present for empty dashboard recap payloads', async () => {
    mockBuildFuzzyAhpDashboardRecapPayload.mockResolvedValueOnce({
      type: 'wfa',
      type_label: 'WFA',
      generated_at: '2026-06-26T00:00:00+07:00',
      timezone: 'Asia/Jakarta',
      requested_window: { period: 'monthly' },
      executed_window: {
        start_at: '2026-06-01T00:00:00+07:00',
        end_at: '2026-06-26T00:00:00+07:00'
      },
      status: 'empty',
      needs_data: true,
      consistency: {
        CR: 0.21,
        threshold: 0.1,
        is_consistent: false,
        summary_label: 'Konsistensi perlu ditinjau'
      },
      criteria_weights: [
        {
          key: 'location_type',
          label: 'location_type',
          display_label: 'Tipe Lokasi',
          value: 0.5
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
    });

    const req = { query: { type: 'wfa' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await getFuzzyAhpDashboardRecap(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          type: 'wfa',
          type_label: 'WFA',
          status: 'empty',
          needs_data: true,
          consistency: expect.objectContaining({
            summary_label: 'Konsistensi perlu ditinjau'
          }),
          criteria_weights: [
            expect.objectContaining({
              key: 'location_type',
              display_label: 'Tipe Lokasi'
            })
          ]
        })
      })
    );
  });
});
