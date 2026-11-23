import { describe, expect, it, vi } from 'vitest';
import { ambianceRegionSchema, incomingMessageSchema, namedRegionSchema } from './protocol';
import { createInitialState } from '../state/gameState';
import { createOnMessageHandler } from './messageHandlers';

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

  it('removes landing support before cancelling travel and applies the server relocation', async () => {
    const state = createInitialState();
    state.player.id = 'self';
    state.player.x = -5;
    state.player.y = -4;
    state.player.z = -40;
    state.platforms.set('island', { id: 'island', name: 'Island', startX: -10, startY: -9, endX: -1, endY: -2, z: -40 });
    const handlePlatformRemoved = vi.fn(() => expect(state.platforms.has('island')).toBe(false));
    const provided = { state, handlePlatformRemoved, peerManager: { setListenerFloor: vi.fn() } };
    const deps = new Proxy(provided, {
      get: (target, property, receiver) => Reflect.has(target, property) ? Reflect.get(target, property, receiver) : vi.fn(),
    }) as unknown as Parameters<typeof createOnMessageHandler>[0];
    const handler = createOnMessageHandler(deps);
    await handler(incomingMessageSchema.parse({ type: 'platform_remove', platformId: 'island' }));
    expect(handlePlatformRemoved).toHaveBeenCalledOnce();
    expect(state.player.x).toBe(-5);
    await handler(incomingMessageSchema.parse({
      type: 'update_position', id: 'self', x: 0, y: 0, z: 0, facingDeg: 0, acousticZoneId: 'floor:0',
    }));
    expect(state.player).toMatchObject({ x: 0, y: 0, z: 0, acousticZoneId: 'floor:0' });
  });
});
