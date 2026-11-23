import type { FootstepSet } from '../state/platformGeometry';

/** Select a sample from the landing surface, falling back to the default set. */
export function footstepSample(sets: readonly FootstepSet[], selected = 'default'): string {
  const samples = sets.find((set) => set.id === selected && set.urls.length)?.urls
    ?? sets.find((set) => set.id === 'default')?.urls;
  if (!samples?.length) return '/sounds/steps/default/step-1.ogg';
  return samples[Math.floor(Math.random() * samples.length)];
}
