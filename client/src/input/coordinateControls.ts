import { validateNumericPropertyInput, type PropertyControlMetadata } from './propertyControls';

/** Shared signed coordinate metadata for World Builder property rows and text entry. */
export function coordinateMetadata(tooltip: string): PropertyControlMetadata {
  return {
    valueType: 'number',
    tooltip,
    range: { min: -1_000_000, max: 1_000_000, step: 1, anchor: 0 },
  };
}

/** Require a complete integer so an empty field never becomes coordinate zero. */
export function parseCoordinate(label: string, raw: string) {
  if (!/^[+-]?\d+$/.test(raw.trim())) return { ok: false as const, message: `${label} must be an integer.` };
  return validateNumericPropertyInput(label, raw.trim(), coordinateMetadata(''), true);
}
