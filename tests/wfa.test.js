import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

describe('WFA Recommendation FAHP Logic', () => {
  beforeAll(() => {
    process.env.FAHP_METHOD = 'extent';
  });

  const basePlace = {
    properties: { name: 'Dummy', categories: [], distance: 1000 },
    geometry: { type: 'Point', coordinates: [106.8, -6.2] },
    userLocation: { lat: -6.2, lon: 106.8 }
  };
  const componentsFor = (place, facilityScore) => ({
    locationTypeScore: fuzzyEngine.getLocationTypeScore(place),
    distanceScore: fuzzyEngine.getDistanceFactorScore(place.properties.distance),
    facilityScore
  });

  it('memberi label "Cukup" untuk lokasi tidak cocok dan jauh', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Remote Park', categories: ['park'], distance: 3000 }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 10));
    expect(result.label).toBe('Cukup');
  });

  it('memberi label "Cukup" untuk lokasi kurang cocok dengan fasilitas terbatas', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Small Mall', categories: ['mall'], distance: 2500 }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 30));
    expect(result.label).toBe('Cukup');
  });

  it('memberi label "Baik" untuk lokasi rata-rata', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Restaurant',
        categories: ['restaurant'],
        distance: 1500,
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 50));
    expect(result.label).toBe('Baik');
  });

  it('memberi label "Baik" untuk lokasi baik', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Hotel Meeting', categories: ['hotel'], distance: 800 }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 70));
    expect(result.label).toBe('Baik');
  });

  it('memberi penalti eksplisit untuk lokasi low-suitability seperti warehouse', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Warehouse Yard',
        categories: ['industrial.warehouse'],
        distance: 1000
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 50));
    expect(result.breakdown.location_type).toBe(10);
  });

  it('tetap memberi penalti low-suitability meski kategori juga mengandung park', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Industrial Park Yard',
        categories: ['industrial.park'],
        distance: 1000
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 50));
    expect(result.breakdown.location_type).toBe(10);
  });

  it('memprioritaskan penalti low-suitability meski kategori juga mengandung cafe', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Factory Cafe Annex',
        categories: ['cafe', 'industrial.factory'],
        distance: 1000
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 50));
    expect(result.breakdown.location_type).toBe(10);
  });

  it('tidak menghukum venue yang hanya kebetulan mengandung substring yard pada nama', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Courtyard Coffee',
        categories: ['cafe'],
        distance: 200
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 90));
    expect(result.breakdown.location_type).toBe(100);
  });

  it('tidak menghukum kategori yang hanya kebetulan mengandung substring yard', async () => {
    const place = {
      ...basePlace,
      properties: {
        name: 'Vineyard Cafe',
        categories: ['tourism.vineyard', 'cafe'],
        distance: 200
      }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 90));
    expect(result.breakdown.location_type).toBe(100);
  });

  it('menolak input lokasi yang bukan angka', async () => {
    await expect(
      fuzzyEngine.calculateWfaScore({ locationTypeScore: 'cafe', distanceScore: 80, facilityScore: 90 })
    ).rejects.toThrow('location_type must be numeric');
  });

  it('menolak input jarak di luar rentang', async () => {
    await expect(
      fuzzyEngine.calculateWfaScore({ locationTypeScore: 100, distanceScore: 101, facilityScore: 90 })
    ).rejects.toThrow('distance_factor must be between 0 and 100');
  });

  it('menolak input fasilitas di luar rentang', async () => {
    await expect(
      fuzzyEngine.calculateWfaScore({ locationTypeScore: 100, distanceScore: 80, facilityScore: -1 })
    ).rejects.toThrow('facility_score must be between 0 and 100');
  });

  it('memberi label "Sangat Baik" untuk cafe dekat dengan fasilitas bagus', async () => {
    const place = {
      ...basePlace,
      properties: { name: 'Coffee Lab', categories: ['cafe'], distance: 200 }
    };
    const result = await fuzzyEngine.calculateWfaScore(componentsFor(place, 90));
    expect(result.label).toBe('Sangat Baik');
  });
});
