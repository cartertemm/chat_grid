import { describe, expect, it } from 'vitest';
import { getNearestItemPosition, isItemOnFloor, itemOccupiesPosition, type WorldItem } from './gameState';

const widget = { x: -5, y: 2, z: 0, endX: 4, endY: 8, endZ: 40, params: {}, occupiedOffsets: [{ x: 0, y: 0 }] } as WorldItem;

describe('compact item bounds', () => {
  it('includes opposite corners and upper landings without allocating a volume', () => {
    expect(itemOccupiesPosition(widget, 4, 8, 40)).toBe(true);
    expect(itemOccupiesPosition(widget, 4, 9, 40)).toBe(false);
    expect(isItemOnFloor(widget, 41)).toBe(false);
    expect(getNearestItemPosition(widget, 100, 5)).toEqual({ x: 4, y: 5 });
    expect(getNearestItemPosition(widget, -3, 5)).toEqual({ x: -3, y: 5 });
  });

  it('preserves point and fixed catalog footprint behavior', () => {
    const point = { ...widget, endX: undefined, endY: undefined, endZ: undefined };
    expect(itemOccupiesPosition(point, -5, 2, 0)).toBe(true);
    expect(itemOccupiesPosition(point, -4, 2, 0)).toBe(false);
    expect(itemOccupiesPosition({ ...point, occupiedOffsets: [{ x: 1, y: 0 }] }, -4, 2, 0)).toBe(true);
  });
});
