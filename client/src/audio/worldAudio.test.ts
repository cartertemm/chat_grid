import { describe, expect, it, vi } from 'vitest';
import { type AudioEngine } from './audioEngine';
import { WorldAudioRouter } from './worldAudio';
import type { WallStructure } from '../state/gameState';
import { wallAcousticMixBetween } from '../state/structureGeometry';
import { worldSoundSchema } from '../network/protocol';

function createAudioMock() {
  return {
    setSpatialTransmissionResolver: vi.fn(),
    playSpatialSample: vi.fn(async () => undefined),
    playSpatialSampleAndWait: vi.fn(async () => undefined),
  } as unknown as AudioEngine;
}

const listener = { x: 1, y: 2, z: 0, acousticZoneId: 'elevator:car-1' };
const source = { x: 3, y: 4, z: 0, acousticZoneId: 'floor:0' };

describe('WorldAudioRouter', () => {
  it.each(['horizontal', 'vertical'] as const)('plays a %s door sound equally on both sides of an opaque wall', (orientation) => {
    const wall: WallStructure = {
      id: 'wall', floorZ: 0, startX: 4, startY: 5, orientation, length: 1,
      title: 'Wall', movementBlocked: true, soundTransmission: 0, occlusionLowpassHz: 800,
      height: 40, preset: 'brick', contactSound: '/sounds/wall.ogg',
      doors: [{
        id: 'door', offset: 0, title: 'Door', isOpen: false, isLocked: false,
        hasPin: false, unlockMode: 'none', keypadSides: 'both', pinRequiredFor: 'unlock',
        unlockTimeoutSeconds: 0, revision: 0,
      }],
    };
    const event = worldSoundSchema.parse({
      type: 'world_sound', sound: '/sounds/door_close.ogg', x: 4, y: 5, z: 0,
      acousticZoneId: 'floor:0', doorOrientation: orientation,
    });
    const positive = { x: 4, y: 5, z: 0, acousticZoneId: 'floor:0' };
    const negative = { ...positive, ...(orientation === 'horizontal' ? { y: 4 } : { x: 3 }) };
    for (const player of [negative, positive]) {
      const audio = createAudioMock();
      const router = new WorldAudioRouter(
        audio, () => player, () => true,
        (emitter, listener) => wallAcousticMixBetween([wall], listener, emitter),
        (emitter, listener) => emitter.acousticZoneId === listener.acousticZoneId,
      );
      router.playSample(event.sound, event);
      const [, emitter] = vi.mocked(audio.playSpatialSample).mock.calls[0];
      expect({ x: emitter.x, y: emitter.y }).toEqual({ x: player.x, y: player.y });
      expect(wallAcousticMixBetween([wall], player, emitter)).toEqual({ gain: 1, lowpassHz: 20_000 });
    }

    const divider = {
      ...wall, id: 'divider', doors: [], soundTransmission: 0.25, occlusionLowpassHz: 1800,
      ...(orientation === 'horizontal' ? { startY: 3 } : { startX: 2 }),
    };
    const farPlayer = { ...negative, ...(orientation === 'horizontal' ? { y: 1 } : { x: 0 }) };
    const audio = createAudioMock();
    const router = new WorldAudioRouter(
      audio, () => farPlayer, () => true,
      (emitter, listener) => wallAcousticMixBetween([wall, divider], listener, emitter),
      () => true,
    );
    router.playSample(event.sound, event);
    const [, emitter] = vi.mocked(audio.playSpatialSample).mock.calls[0];
    expect(wallAcousticMixBetween([wall, divider], farPlayer, emitter)).toEqual({ gain: 0.25, lowpassHz: 1800 });
  });
  it('suppresses every world one-shot when its source zone is isolated', () => {
    const audio = createAudioMock();
    const router = new WorldAudioRouter(
      audio,
      () => listener,
      () => true,
      () => ({ gain: 0, lowpassHz: 800 }),
      () => false,
    );

    router.playSample('/sounds/step-1.ogg', source);

    expect(audio.playSpatialSample).not.toHaveBeenCalled();
  });

  it('passes audible sources through the shared positional engine', () => {
    const audio = createAudioMock();
    const router = new WorldAudioRouter(
      audio,
      () => listener,
      () => true,
      () => ({ gain: 0.4, lowpassHz: 800 }),
      () => true,
    );

    router.playSample('/sounds/step-1.ogg', { ...source, gain: 0.7, range: 12 });

    expect(audio.playSpatialSample).toHaveBeenCalledWith(
      '/sounds/step-1.ogg',
      { ...source, gain: 0.7, range: 12 },
      listener,
      0.7,
      12,
    );
  });

  it('starts a landing sample at zero rider transmission so an opening door can reveal it', () => {
    const audio = createAudioMock();
    const router = new WorldAudioRouter(
      audio,
      () => listener,
      () => true,
      () => ({ gain: 0, lowpassHz: 800 }),
      () => true,
    );

    router.playSample('/sounds/elevator_open.ogg', source);

    expect(audio.playSpatialSample).toHaveBeenCalled();
  });

  it('suppresses every world one-shot when the world layer is disabled', () => {
    const audio = createAudioMock();
    const router = new WorldAudioRouter(
      audio,
      () => listener,
      () => false,
      () => ({ gain: 1, lowpassHz: 20_000 }),
      () => true,
    );

    router.playSample('/sounds/step-1.ogg', source);

    expect(audio.playSpatialSample).not.toHaveBeenCalled();
  });
});
