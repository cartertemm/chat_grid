import { describe, expect, it } from 'vitest';
import { ambianceRegionSchema, incomingMessageSchema, namedRegionSchema } from './protocol';

describe('signed platform world coordinates', () => {
  it('accepts a platform at negative coordinates and its action result', () => {
    const platform = { id: 'island', name: 'Island', startX: -10, startY: -9, endX: -1, endY: -2, z: -40 };
    expect(incomingMessageSchema.parse({ type: 'platform_upsert', platform })).toEqual({ type: 'platform_upsert', platform });
    expect(incomingMessageSchema.parse({ type: 'platform_remove', platformId: 'island' })).toEqual({ type: 'platform_remove', platformId: 'island' });
    expect(incomingMessageSchema.parse({ type: 'platform_action_result', ok: false, message: 'Platform overlaps Island.' })).toMatchObject({ ok: false });
  });

  it('accepts named and sounding regions on negative-coordinate platforms', () => {
    const region = { id: 'region', name: 'Studio', floorZ: -40, startX: -10, startY: -9, endX: -1, endY: -2 };
    expect(namedRegionSchema.parse(region)).toEqual(region);
    const ambiance = { ...region, soundId: 'rain', volume: 50, fadeDistance: 5 };
    expect(ambianceRegionSchema.parse(ambiance)).toEqual(ambiance);
  });
});
