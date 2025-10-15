import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

describe('Smart Auto Checkout FAHP Logic', () => {
  const targetDate = '2025-09-20';
  const timeIn = new Date('2025-09-20T09:00:00+07:00');
  const fallbackEndStr = '18:00:00';
  const weights = [0.4, 0.2, 0.2, 0.2]; // [HIST, CHECKIN, CONTEXT, TRANSITION]

  it('menggabungkan semua kandidat saat tersedia', () => {
    const candidates = {
      HIST: new Date('2025-09-20T17:00:00+07:00'),
      CHECKIN: new Date('2025-09-20T17:00:00+07:00'),
      CONTEXT: new Date('2025-09-20T16:30:00+07:00'),
      TRANSITION: new Date('2025-09-20T16:45:00+07:00')
    };
    const predicted = fuzzyEngine.weightedPrediction(
      candidates,
      weights,
      targetDate,
      timeIn,
      fallbackEndStr
    );
    expect(predicted).toBeInstanceOf(Date);
  });

  it('menghasilkan null jika tidak ada kandidat cukup (akan dipakai fallback oleh pemanggil)', () => {
    const candidates = { HIST: null, CHECKIN: null, CONTEXT: null, TRANSITION: null };
    const predicted = fuzzyEngine.weightedPrediction(
      candidates,
      weights,
      targetDate,
      timeIn,
      fallbackEndStr
    );
    expect(predicted).toBeNull();
  });

  it('tetap logis saat beberapa kandidat null', () => {
    const candidates = {
      HIST: new Date('2025-09-20T16:00:00+07:00'),
      CHECKIN: null,
      CONTEXT: null,
      TRANSITION: new Date('2025-09-20T17:30:00+07:00')
    };
    const predicted = fuzzyEngine.weightedPrediction(
      candidates,
      weights,
      targetDate,
      timeIn,
      fallbackEndStr
    );
    expect(predicted).toBeInstanceOf(Date);
  });
});
