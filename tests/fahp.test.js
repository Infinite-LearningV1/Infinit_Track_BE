import { fgmWeightsTFN, computeCR, defuzzifyMatrixTFN } from '../src/analytics/fahp.js';
import { TFN, WFA_PAIRWISE_TFN, DISC_PAIRWISE_TFN } from '../src/analytics/config.fahp.js';
import { labelEqualInterval } from '../src/analytics/labeling.js';

test('FGM produces normalized weights (sum=1) - custom matrix', () => {
  const M = [
    [TFN.EQUAL, TFN.MODERATE, TFN.STRONG],
    [[1 / 4, 1 / 3, 1 / 2], TFN.EQUAL, TFN.MODERATE],
    [[1 / 7, 1 / 5, 1 / 3], [1 / 4, 1 / 3, 1 / 2], TFN.EQUAL]
  ];
  const w = fgmWeightsTFN(M);
  const sum = w.reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
});

test('FGM normalized weights for WFA and DISC profiles', () => {
  const wfaW = fgmWeightsTFN(WFA_PAIRWISE_TFN);
  const discW = fgmWeightsTFN(DISC_PAIRWISE_TFN);
  expect(Math.abs(wfaW.reduce((a,b)=>a+b,0) - 1)).toBeLessThan(1e-6);
  expect(Math.abs(discW.reduce((a,b)=>a+b,0) - 1)).toBeLessThan(1e-6);
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
  const { CR: crWfa } = computeCR(wfaCrisp);
  const { CR: crDisc } = computeCR(discCrisp);
  expect(crWfa).toBeLessThan(0.2);
  expect(crDisc).toBeLessThan(0.2);
});

test('Labeling equal interval works as expected', () => {
  expect(labelEqualInterval(0.19)).toBe('Sangat Rendah');
  expect(labelEqualInterval(0.21)).toBe('Rendah');
  expect(labelEqualInterval(0.59)).toBe('Sedang');
  expect(labelEqualInterval(0.61)).toBe('Tinggi');
  expect(labelEqualInterval(0.81)).toBe('Sangat Tinggi');
});