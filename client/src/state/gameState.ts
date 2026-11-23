import { type Platform } from './platformGeometry';

export const GRID_SIZE = 41;
export const HEARING_RADIUS = 20;
export const MOVE_COOLDOWN_MS = 200;

export type ItemType = string;

export type WorldItem = {
  id: string;
  type: ItemType;
  title: string;
  x: number;
  y: number;
  z: number;
  endX?: number;
  endY?: number;
  endZ?: number;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  capabilities: string[];
  useSound?: string;
  emitSound?: string;
  params: Record<string, unknown>;
  carrierId?: string | null;
  display?: Record<string, string>;
  occupiedOffsets: Array<{ x: number; y: number }>;
};

/** Server-owned inclusive rectangle carrying a looping world sound. */
export type AmbianceRegion = {
  id: string;
  name: string;
  soundId: string;
  floorZ: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  volume: number;
  fadeDistance: number;
};

export type NamedRegion = {
  id: string;
  name: string;
  floorZ: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type AmbianceType = { id: string; title: string; url: string };

export type WallDoor = import('zod').infer<typeof import('../network/protocol').doorSchema>;

export type WallStructure = {
  doors?: WallDoor[];
  id: string;
  floorZ: number;
  startX: number;
  startY: number;
  orientation: 'horizontal' | 'vertical';
  length: number;
  title: string;
  movementBlocked: boolean;
  soundTransmission: number;
  occlusionLowpassHz: number;
  height: number;
  preset: string;
  contactSound: string;
};

export type StructurePreset = Omit<WallStructure, 'id' | 'floorZ' | 'startX' | 'startY' | 'orientation' | 'length' | 'preset' | 'doors'> & {
  id: string;
};

export type SelectionContext = 'pickupDrop' | 'delete' | 'edit' | 'use' | 'secondaryUse' | 'inspect' | 'manage' | null;

export type GameMode =
  | 'normal'
  | 'commandPalette'
  | 'helpView'
  | 'nickname'
  | 'chat'
  | 'micGainEdit'
  | 'effectSelect'
  | 'listUsers'
  | 'listItems'
  | 'addItem'
  | 'selectItem'
  | 'itemProperties'
  | 'itemPropertyEdit'
  | 'optionSelect'
  | 'itemManageOptions'
  | 'itemManageTransferUser'
  | 'confirmYesNo'
  | 'adminMenu'
  | 'adminRoleList'
  | 'adminRolePermissionList'
  | 'adminRoleDeleteReplacement'
  | 'adminUserList'
  | 'adminUserRoleSelect'
  | 'adminUserDeleteConfirm'
  | 'adminRoleNameEdit'
  | 'worldBuilder'
  | 'checkpointMenu'
  | 'checkpointLabel'
  | 'checkpointList'
  | 'checkpointPreview'
  | 'worldBuilderPreset'
  | 'worldBuilderDirection'
  | 'worldBuilderWallList'
  | 'worldBuilderWallActions'
  | 'worldBuilderPropertyList'
  | 'worldBuilderPropertyEdit'
  | 'doorSettings'
  | 'doorSettingsEdit'
  | 'doorKeypad'
  | 'worldBuilderRegionList'
  | 'worldBuilderRegionActions'
  | 'worldBuilderRegionEdit'
  | 'worldBuilderPlatformList'
  | 'worldBuilderPlatformActions'
  | 'worldBuilderPlatformEdit'
  | 'worldBuilderAmbianceList'
  | 'worldBuilderAmbianceActions'
  | 'worldBuilderAmbianceEdit'
  | 'pianoUse';

export type Player = {
  id: string | null;
  nickname: string;
  x: number;
  y: number;
  z: number;
  facingDeg: number;
  acousticZoneId: string;
  lastMoveTime: number;
};

export type PeerState = {
  id: string;
  userId?: string | null;
  nickname: string;
  x: number;
  y: number;
  z: number;
  facingDeg: number;
  acousticZoneId: string;
};

export type GameState = {
  running: boolean;
  mode: GameMode;
  keysPressed: Record<string, boolean>;
  nicknameInput: string;
  cursorPos: number;
  cursorVisible: boolean;
  sortedPeerIds: string[];
  listIndex: number;
  sortedItemIds: string[];
  itemListIndex: number;
  selectedItemIds: string[];
  selectionContext: SelectionContext;
  selectedItemIndex: number;
  selectedItemId: string | null;
  itemPropertyKeys: string[];
  itemPropertyIndex: number;
  editingPropertyKey: string | null;
  effectSelectIndex: number;
  addItemTypeIndex: number;
  isMuted: boolean;
  player: Player;
  peers: Map<string, PeerState>;
  items: Map<string, WorldItem>;
  structures: Map<string, WallStructure>;
  platforms: Map<string, Platform>;
  ambiances: Map<string, AmbianceRegion>;
  regions: Map<string, NamedRegion>;
  elevatorItemId: string | null;
};

export function createInitialState(): GameState {
  return {
    running: false,
    mode: 'normal',
    keysPressed: {},
    nicknameInput: '',
    cursorPos: 0,
    cursorVisible: true,
    sortedPeerIds: [],
    listIndex: 0,
    sortedItemIds: [],
    itemListIndex: 0,
    selectedItemIds: [],
    selectionContext: null,
    selectedItemIndex: 0,
    selectedItemId: null,
    itemPropertyKeys: [],
    itemPropertyIndex: 0,
    editingPropertyKey: null,
    effectSelectIndex: 0,
    addItemTypeIndex: 0,
    isMuted: false,
    player: {
      id: null,
      nickname: 'anon',
      x: 20,
      y: 20,
      z: 0,
      facingDeg: 0,
      acousticZoneId: 'floor:0',
      lastMoveTime: 0,
    },
    peers: new Map(),
    items: new Map(),
    structures: new Map(),
    platforms: new Map(),
    ambiances: new Map(),
    regions: new Map(),
    elevatorItemId: null,
  };
}

export function getNearestPeer(state: GameState): { peerId: string | null; distance: number } {
  let nearest: string | null = null;
  let minDist = Infinity;
  for (const [id, peer] of state.peers.entries()) {
    if (peer.z !== state.player.z) continue;
    const dist = Math.hypot(peer.x - state.player.x, peer.y - state.player.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = id;
    }
  }
  return { peerId: nearest, distance: minDist };
}

/** Names a server-owned compass heading for spoken orientation. */
export function getFacingDirection(facingDeg: number): string {
  const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return directions[facingDeg / 45] ?? 'unknown';
}

export function getDirection(px: number, py: number, tx: number, ty: number): string {
  const dx = tx - px;
  const dy = ty - py;
  if (dx === 0 && dy === 0) return 'here';
  if (dx === 0) return dy > 0 ? 'directly north' : 'directly south';
  if (dy === 0) return dx > 0 ? 'directly east' : 'directly west';

  const octants = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'] as const;
  const step = Math.PI / 4;
  const rawIndex = Math.round(Math.atan2(dy, dx) / step);
  const index = ((rawIndex % octants.length) + octants.length) % octants.length;
  return octants[index];
}

export function getNearestItem(state: GameState): { itemId: string | null; distance: number } {
  let nearest: string | null = null;
  let minDist = Infinity;
  for (const [id, item] of state.items.entries()) {
    if (item.carrierId) continue;
    if (!isItemOnFloor(item, state.player.z)) continue;
    const nearestPosition = getNearestItemPosition(item, state.player.x, state.player.y);
    const dist = Math.hypot(nearestPosition.x - state.player.x, nearestPosition.y - state.player.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = id;
    }
  }
  return { itemId: nearest, distance: minDist };
}

/** Returns whether an item occupies the requested floor. */
export function isItemOnFloor(item: WorldItem, z: number): boolean {
  const floorZs = item.params.floorZs;
  return Array.isArray(floorZs)
    ? floorZs.some((floorZ) => Number(floorZ) === z)
    : item.z <= z && z <= (item.endZ ?? item.z);
}

/** Returns whether an item footprint occupies a world cell on a floor. */
export function itemOccupiesPosition(item: WorldItem, x: number, y: number, z: number): boolean {
  if (!isItemOnFloor(item, z)) return false;
  if (hasItemBounds(item)) {
    return item.x <= x && x <= (item.endX ?? item.x) && item.y <= y && y <= (item.endY ?? item.y);
  }
  return item.occupiedOffsets.some((offset) => item.x + offset.x === x && item.y + offset.y === y);
}

/** Returns the occupied item cell nearest to a listener position. */
export function getNearestItemPosition(item: WorldItem, x: number, y: number): { x: number; y: number } {
  if (hasItemBounds(item)) {
    return { x: Math.max(item.x, Math.min(item.endX ?? item.x, x)), y: Math.max(item.y, Math.min(item.endY ?? item.y, y)) };
  }
  let nearest = { x: item.x, y: item.y };
  let nearestDistance = Infinity;
  for (const offset of item.occupiedOffsets) {
    const candidate = { x: item.x + offset.x, y: item.y + offset.y };
    const distance = Math.hypot(candidate.x - x, candidate.y - y);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Whether an instance supplies a compact rectangular footprint. */
export function hasItemBounds(item: WorldItem): boolean {
  return item.endX !== undefined || item.endY !== undefined || item.endZ !== undefined;
}

/** Inclusive bounds; old items retain their anchor as the endpoint. */
export function itemBounds(item: WorldItem): { startX: number; startY: number; startZ: number; endX: number; endY: number; endZ: number } {
  return { startX: item.x, startY: item.y, startZ: item.z, endX: item.endX ?? item.x, endY: item.endY ?? item.y, endZ: item.endZ ?? item.z };
}
