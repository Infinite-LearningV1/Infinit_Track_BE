import { jest } from '@jest/globals';
import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';
import logger from '../src/utils/logger.js';

describe('WFA Recommendation FAHP Logic', () => {
  beforeAll(() => {
    process.env.FAHP_METHOD = 'extent';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const basePlace = {
    properties: { name: 'Dummy', categories: [], distance: 1000, amenity_score: 50 },
    geometry: { type: 'Point', coordinates: [106.8, -6.2] },
    userLocation: { lat: -6.2, lon: 106.8 }
  };

  it('memberi label "Cukup" untuk lokasi tidak cocok dan jauh', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Remote Park', categories: ['park'], distance: 3000, amenity_score: 10 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Cukup');
  });

  it('memberi label "Baik" untuk lokasi kurang cocok', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Small Mall', categories: ['mall'], distance: 2500, amenity_score: 30 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Baik');
  });

  it('memberi label "Baik" untuk lokasi rata-rata', async () => {
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
    expect(result.label).toBe('Baik');
  });

  it('memberi label "Baik" untuk lokasi baik', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Hotel Meeting', categories: ['hotel'], distance: 800, amenity_score: 70 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Baik');
  });

  it('memberi penalti eksplisit untuk lokasi low-suitability seperti warehouse', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Warehouse Yard',
        categories: ['industrial.warehouse'],
        distance: 1000,
        amenity_score: 50
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.breakdown.location_score).toBe(10);
  });

  it('tetap memberi penalti low-suitability meski kategori juga mengandung park', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Industrial Park Yard',
        categories: ['industrial.park'],
        distance: 1000,
        amenity_score: 50
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.breakdown.location_score).toBe(10);
  });

  it('memprioritaskan penalti low-suitability meski kategori juga mengandung cafe', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Factory Cafe Annex',
        categories: ['cafe', 'industrial.factory'],
        distance: 1000,
        amenity_score: 50
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.breakdown.location_score).toBe(10);
  });

  it('tidak menghukum venue yang hanya kebetulan mengandung substring yard pada nama', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Courtyard Coffee',
        categories: ['cafe'],
        distance: 200,
        amenity_score: 90
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.breakdown.location_score).toBe(100);
  });

  it('tidak menghukum kategori yang hanya kebetulan mengandung substring yard', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Vineyard Cafe',
        categories: ['tourism.vineyard', 'cafe'],
        distance: 200,
        amenity_score: 90
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.breakdown.location_score).toBe(100);
  });

  it('fail-closed ke skor terendah ketika payload tempat malformed', async () => {
    const result = await fuzzyEngine.calculateWfaScore(null);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika distance bukan angka', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Broken Distance Cafe',
        categories: ['cafe'],
        distance: 'nearby',
        amenity_score: 90
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika distance string kosong', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Blank Distance Cafe',
        categories: ['cafe'],
        distance: '   ',
        amenity_score: 90
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika amenity_score bukan angka', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Unknown Amenity Cafe',
        categories: ['cafe'],
        distance: 200,
        amenity_score: 'unknown'
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika amenity_score string kosong', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Blank Amenity Cafe',
        categories: ['cafe'],
        distance: 200,
        amenity_score: ' '
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika distance bertipe boolean', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Boolean Distance Cafe',
        categories: ['cafe'],
        distance: false,
        amenity_score: 90
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('fail-closed ketika amenity_score bertipe boolean', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Boolean Amenity Cafe',
        categories: ['cafe'],
        distance: 200,
        amenity_score: false
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Rendah');
    expect(result.breakdown).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('memberi label "Sangat Baik" untuk cafe dekat dengan fasilitas bagus', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Coffee Lab', categories: ['cafe'], distance: 200, amenity_score: 90 }
    };
    const result = await fuzzyEngine.calculateWfaScore(place);
    expect(result.label).toBe('Sangat Baik');
  });
});
