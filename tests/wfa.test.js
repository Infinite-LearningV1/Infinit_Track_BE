import { jest } from '@jest/globals';
import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

describe('WFA Recommendation FAHP Logic', () => {
  beforeAll(() => {
    process.env.FAHP_METHOD = 'extent';
    process.env.AHP_CR_THRESHOLD = '0.10';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const basePlace = {
    properties: { name: 'Dummy', categories: [], distance: 1000, amenity_score: 50 },
    geometry: { type: 'Point', coordinates: [106.8, -6.2] },
    userLocation: { lat: -6.2, lon: 106.8 }
  };

  it('memberi label "Sangat Rendah" untuk lokasi tidak cocok dan jauh', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Remote Park', categories: ['park'], distance: 3000, amenity_score: 10 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Sangat Rendah');
  });

  it('memberi label "Rendah" untuk lokasi kurang cocok', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Small Mall', categories: ['mall'], distance: 2500, amenity_score: 30 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Rendah');
  });

  it('memberi label "Sedang" untuk lokasi rata-rata', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Restaurant',
        categories: ['restaurant'],
        distance: 1500,
        amenity_score: 50
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Sedang');
  });

  it('memberi label "Tinggi" untuk lokasi baik', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Hotel Meeting', categories: ['hotel'], distance: 800, amenity_score: 70 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Tinggi');
  });

  it('memberi label "Sangat Tinggi" untuk cafe dekat dengan fasilitas bagus', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Coffee Lab', categories: ['cafe'], distance: 200, amenity_score: 90 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Sangat Tinggi');
  });
});
