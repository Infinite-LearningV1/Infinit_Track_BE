export function labelEqualInterval(score01) {
  const s = Math.max(0, Math.min(1, score01));
  if (s < 0.25) return 'Rendah';
  if (s < 0.5) return 'Cukup';
  if (s < 0.75) return 'Baik';
  return 'Sangat Baik';
}
