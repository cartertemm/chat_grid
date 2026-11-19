import type { NamedRegion } from './gameState';

/** Return every inclusive region at a tile, ordered from smallest to largest. */
export function containingRegions(regions: Iterable<NamedRegion>, position: { x: number; y: number; z: number }): NamedRegion[] {
  const area = (region: NamedRegion) => (region.endX - region.startX + 1) * (region.endY - region.startY + 1);
  return [...regions].filter((region) => region.floorZ === position.z
    && position.x >= region.startX && position.x <= region.endX
    && position.y >= region.startY && position.y <= region.endY)
    .sort((left, right) => area(left) - area(right) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
