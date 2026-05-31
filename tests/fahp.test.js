import { computeCR, defuzzifyMatrixTFN } from '../src/analytics/fahp.js';
import { extentWeightsTFN } from '../src/analytics/fahp.extent.js';
import { TFN, WFA_PAIRWISE_TFN, DISC_PAIRWISE_TFN, SMART_AC_PAIRWISE_TFN } from '../src/analytics/config.fahp.js';
import { labelEqualInterval } from '../src/analytics/labeling.js';

test("Chang's extent produces normalized weights for a custom TFN matrix", () => {
  const matrix = [
    [TFN.EQUAL, TFN.MODERATE, TFN.STRONG],
    [[1 / 4, 1 / 3, 1 / 2], TFN.EQUAL, TFN.MODERATE],
    [[1 / 7, 1 / 5, 1 / 3], [1 / 4, 1 / 3, 1 / 2], TFN.EQUAL]
  ];
  const weights = extentWeightsTFN(matrix);
  const sum = weights.reduce((a, b) => a + b, 0);

  expect(weights).toHaveLength(3);
  expect(weights.every((value) => value >= 0)).toBe(true);
  expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
});

test("Chang's extent is the official normalized weighting path for WFA, discipline, and Smart AC", () => {
  const weightSets = [
    extentWeightsTFN(WFA_PAIRWISE_TFN),
    extentWeightsTFN(DISC_PAIRWISE_TFN),
    extentWeightsTFN(SMART_AC_PAIRWISE_TFN)
  ];

  for (const weights of weightSets) {
    expect(weights.every((value) => value >= 0)).toBe(true);
    expect(Math.abs(weights.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-6);
  }
});

test('CR is small for near-consistent crisp matrix', () => {
  const M = [
    [1, 3, 5],
    [1 / 3, 1, 3],
    [1 / 5, 1 / 3, 1]
  ];
  const { CR } = computeCR(M);
  expect(CR).toBeLessThan(0.1);
});

test('CR from defuzzified TFN matrices is reasonable', () => {
  const wfaCrisp = defuzzifyMatrixTFN(WFA_PAIRWISE_TFN);
  const discCrisp = defuzzifyMatrixTFN(DISC_PAIRWISE_TFN);
  const smartAcCrisp = defuzzifyMatrixTFN(SMART_AC_PAIRWISE_TFN);
  const { CR: crWfa } = computeCR(wfaCrisp);
  const { CR: crDisc } = computeCR(discCrisp);
  const { CR: crSmartAc } = computeCR(smartAcCrisp);
  expect(crWfa).toBeLessThan(0.2);
  expect(crDisc).toBeLessThan(0.2);
  expect(crSmartAc).toBeLessThan(0.2);
});

test('Labeling equal interval uses the 4-bucket threshold 0-25-50-75', () => {
  expect(labelEqualInterval(0.24)).toBe('Rendah');
  expect(labelEqualInterval(0.25)).toBe('Cukup');
  expect(labelEqualInterval(0.49)).toBe('Cukup');
  expect(labelEqualInterval(0.5)).toBe('Baik');
  expect(labelEqualInterval(0.74)).toBe('Baik');
  expect(labelEqualInterval(0.75)).toBe('Sangat Baik');
});
