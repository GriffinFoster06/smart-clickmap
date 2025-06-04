import { getClusterRadius, clusterClicks } from '../backend/clusterUtils.js';

describe('getClusterRadius', () => {
  test('returns default for no clicks', () => {
    expect(getClusterRadius([])).toBeCloseTo(0.05);
  });

  test('returns tight radius for close clicks', () => {
    const clicks = [
      { x: 0.01, y: 0.01 },
      { x: 0.02, y: 0.02 }
    ];
    expect(getClusterRadius(clicks)).toBeCloseTo(0.01);
  });

  test('returns mid radius for moderately spaced clicks', () => {
    const clicks = [
      { x: 0, y: 0 },
      { x: 0.05, y: 0 }
    ];
    expect(getClusterRadius(clicks)).toBeCloseTo(0.02);
  });
});

describe('clusterClicks', () => {
  test('clusters points within radius', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.02, y: 0.02 },
      { x: 0.5, y: 0.5 }
    ];
    const result = clusterClicks(points, 0.05);
    expect(result.length).toBe(2);
    const first = result.find(b => b.count === 2);
    expect(first).toBeDefined();
    expect(first.x).toBeCloseTo(0.01, 2);
    expect(first.y).toBeCloseTo(0.01, 2);
  });

  test('handles empty input', () => {
    expect(clusterClicks([], 0.05)).toEqual([]);
  });
});
