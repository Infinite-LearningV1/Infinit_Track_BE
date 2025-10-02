import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

describe('Discipline Index FAHP Logic', () => {
  beforeAll(() => {
    // Ensure deterministic method and threshold for tests
    process.env.FAHP_METHOD = 'extent';
    process.env.AHP_CR_THRESHOLD = '0.10';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('menghasilkan label "Sangat Rendah" untuk profil disiplin sangat buruk', async () => {
    const input = {
      alpha_rate: 90,
      avg_lateness_minutes: 55,
      lateness_frequency: 90,
      work_hour_consistency: 5
    };
    const result = await fuzzyEngine.calculateDisciplineIndex(input);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('label');
    expect(result.label).toBe('Sangat Rendah');
  });

  it('menghasilkan label "Rendah" untuk profil disiplin rendah', async () => {
    const input = {
      alpha_rate: 60,
      avg_lateness_minutes: 40,
      lateness_frequency: 60,
      work_hour_consistency: 20
    };
    const result = await fuzzyEngine.calculateDisciplineIndex(input);
    expect(result.label).toBe('Rendah');
  });

  it('menghasilkan label "Sedang" untuk profil disiplin sedang', async () => {
    const input = {
      alpha_rate: 30,
      avg_lateness_minutes: 25,
      lateness_frequency: 35,
      work_hour_consistency: 50
    };
    const result = await fuzzyEngine.calculateDisciplineIndex(input);
    expect(result.label).toBe('Sedang');
  });

  it('menghasilkan label "Tinggi" untuk profil disiplin baik', async () => {
    const input = {
      alpha_rate: 15,
      avg_lateness_minutes: 10,
      lateness_frequency: 20,
      work_hour_consistency: 75
    };
    const result = await fuzzyEngine.calculateDisciplineIndex(input);
    expect(result.label).toBe('Tinggi');
  });

  it('menghasilkan label "Sangat Tinggi" untuk profil disiplin sangat baik', async () => {
    const input = {
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 100
    };
    const result = await fuzzyEngine.calculateDisciplineIndex(input);
    expect(result.label).toBe('Sangat Tinggi');
  });
});
