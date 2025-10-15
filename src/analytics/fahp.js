export function mulTFN([l1, m1, u1], [l2, m2, u2]) {
  return [l1 * l2, m1 * m2, u1 * u2];
}

export function powTFN([l, m, u], p) {
  return [l ** p, m ** p, u ** p];
}

export function invTFN([l, m, u]) {
  return [1 / u, 1 / m, 1 / l];
}

export function centroidTFN([l, m, u]) {
  return (l + 4 * m + u) / 6;
}

export function defuzzifyMatrixTFN(matrixTFN) {
  return matrixTFN.map((row) => row.map((tfn) => centroidTFN(tfn)));
}

/**
 * Compute FGM (Fuzzy Geometric Mean) weights from TFN pairwise comparison matrix
 * @param {Array<Array<[number, number, number]>>} matrixTFN - NxN matrix of TFN triplets
 * @returns {Array<number>} - Normalized crisp weights (sum=1)
 */
export function fgmWeightsTFN(matrixTFN) {
  const n = matrixTFN.length;
  if (n === 0) return [];

  // Compute geometric mean for each row (as TFN)
  const gmTFN = [];
  for (let i = 0; i < n; i++) {
    let productTFN = [1, 1, 1];
    for (let j = 0; j < n; j++) {
      productTFN = mulTFN(productTFN, matrixTFN[i][j]);
    }
    // Take nth root
    gmTFN.push(powTFN(productTFN, 1 / n));
  }

  // Defuzzify each GM to crisp value
  const gmCrisp = gmTFN.map(centroidTFN);

  // Normalize to sum=1
  const total = gmCrisp.reduce((a, b) => a + b, 0) || 1;
  return gmCrisp.map((v) => v / total);
}

// Compute CR using eigenvalue approximation without external libs
export function computeCR(matrix) {
  const n = matrix.length;
  if (n === 0) return { CI: 0, CR: 0, lambdaMax: 0 };

  // power iteration for principal eigenvector
  let w = Array.from({ length: n }, () => 1 / n);
  const maxIter = 100;
  for (let iter = 0; iter < maxIter; iter++) {
    const Aw = Array.from({ length: n }, (_, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += matrix[i][j] * w[j];
      return s;
    });
    const sumAw = Aw.reduce((a, b) => a + b, 0) || 1;
    w = Aw.map((v) => v / sumAw);
  }
  // lambda_i = (Aw)_i / w_i
  const AwFinal = Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) s += matrix[i][j] * w[j];
    return s;
  });
  const lambdas = AwFinal.map((v, i) => v / (w[i] || 1e-12));
  const lambdaMax = lambdas.reduce((a, b) => a + b, 0) / n;
  const CI = (lambdaMax - n) / (n - 1 || 1);

  // Saaty RI values for n=1..15
  const RI_TABLE = {
    1: 0.0,
    2: 0.0,
    3: 0.58,
    4: 0.9,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49
  };
  const RI = RI_TABLE[n] ?? 1.49;
  const CR = RI === 0 ? 0 : CI / RI;
  return { CI, CR, lambdaMax };
}
