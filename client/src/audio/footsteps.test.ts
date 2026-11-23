import { afterEach, expect, it, vi } from 'vitest';
import { footstepSample } from './footsteps';

const sets = [
  { id: 'default', title: 'Default', urls: ['/sounds/steps/default/step-1.ogg'] },
  { id: 'bridge', title: 'Bridge', urls: ['/sounds/steps/bridge/step-1.ogg', '/sounds/steps/bridge/step-2.ogg'] },
];

afterEach(() => vi.restoreAllMocks());

it('can play each sample listed for the platform', () => {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
  expect(footstepSample(sets, 'bridge')).toBe(sets[1].urls[0]);
  expect(footstepSample(sets, 'bridge')).toBe(sets[1].urls[1]);
});

it('uses default footsteps for an older platform or missing sound folder', () => {
  expect(footstepSample(sets)).toBe(sets[0].urls[0]);
  expect(footstepSample(sets, 'retired')).toBe(sets[0].urls[0]);
  expect(footstepSample([])).toBe(sets[0].urls[0]);
});
