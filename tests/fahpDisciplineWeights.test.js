import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

const sumDisciplineWeights = (weights) =>
  weights.alpha_rate + weights.lateness_severity + weights.lateness_frequency + weights.work_focus;

describe('FAHP Discipline weights', () => {
  it('keeps alpha dominant while preserving non-zero lateness and work-focus criteria', () => {
    const weights = fuzzyEngine.getDisciplineAhpWeights();

    expect(weights.alpha_rate).toBeGreaterThanOrEqual(0.5);
    expect(weights.alpha_rate).toBeLessThanOrEqual(0.7);
    expect(weights.lateness_severity).toBeGreaterThan(0);
    expect(weights.lateness_frequency).toBeGreaterThan(0);
    expect(weights.work_focus).toBeGreaterThan(0);
    expect(weights.alpha_rate).toBeGreaterThan(weights.lateness_severity);
    expect(weights.alpha_rate).toBeGreaterThan(weights.lateness_frequency);
    expect(weights.alpha_rate).toBeGreaterThan(weights.work_focus);
    expect(weights.consistency_ratio).toBeLessThan(0.1);
    expect(sumDisciplineWeights(weights)).toBeCloseTo(1, 5);
  });

  it('allows lateness metrics to affect discipline score when alpha is equal', async () => {
    const clean = await fuzzyEngine.calculateDisciplineIndex({
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 100
    });
    const late = await fuzzyEngine.calculateDisciplineIndex({
      alpha_rate: 0,
      avg_lateness_minutes: 30,
      lateness_frequency: 50,
      work_hour_consistency: 100
    });

    expect(late.score).not.toBe(clean.score);
  });

  it('allows work-hour consistency to affect discipline score when absence and lateness are equal', async () => {
    const consistent = await fuzzyEngine.calculateDisciplineIndex({
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 100
    });
    const inconsistent = await fuzzyEngine.calculateDisciplineIndex({
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 50
    });

    expect(inconsistent.score).not.toBe(consistent.score);
  });
});
