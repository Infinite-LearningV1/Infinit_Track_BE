export function labelEqualInterval(score01) {
  const s = Math.max(0, Math.min(1, score01));
  if (s < 0.2) return 'Sangat Rendah';
  if (s < 0.4) return 'Rendah';
  if (s < 0.6) return 'Sedang';
  if (s < 0.8) return 'Tinggi';
  return 'Sangat Tinggi';
}
