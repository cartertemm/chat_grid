import { describe, expect, it } from 'vitest';
import { containingRegions } from './regions';
import type { NamedRegion } from './gameState';

const studio: NamedRegion = { id: 'studio', name: 'Studio', floorZ: 0, startX: 0, startY: 0, endX: 5, endY: 5 };
const closet: NamedRegion = { ...studio, id: 'closet', name: 'Closet', endX: 1, endY: 1 };

describe('named places at the current tile', () => {
  it('includes boundaries, overlaps and nested regions, ordered by inclusive area', () => {
    const overlap = { ...studio, id: 'overlap', name: 'Hall', startX: 1, endX: 2, endY: 3 };
    expect(containingRegions([studio, overlap, closet], { x: 1, y: 1, z: 0 }).map((region) => region.name))
      .toEqual(['Closet', 'Hall', 'Studio']);
    expect(containingRegions([studio, closet], { x: 2, y: 1, z: 0 })).toEqual([studio]);
    expect(containingRegions([studio], { x: 5, y: 5, z: 0 })).toEqual([studio]);
  });

  it('uses a stable tie break and excludes other floors and outside tiles', () => {
    const other = { ...closet, id: 'other', name: 'Booth' };
    expect(containingRegions([closet, other, { ...studio, floorZ: 40 }], { x: 0, y: 0, z: 0 }))
      .toEqual([other, closet]);
    expect(containingRegions([studio], { x: 6, y: 0, z: 0 })).toEqual([]);
  });
});
