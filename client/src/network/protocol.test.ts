import { describe, expect, it } from 'vitest';
import { incomingMessageSchema } from './protocol';

describe('item target protocol messages', () => {
  it('parses checkpoint previews with the revision required for a safe restore', () => {
    const packet = { type: 'checkpoint_result', action: 'preview', ok: true, message: '', preview: {
      checkpoint: { id: 'saved', label: 'Before remodel', createdAt: 1, createdBy: 'Builder', counts: { items: 3 } },
      worldRevision: 'revision', changes: { items: { added: 1, removed: 2, modified: 0 } }, warnings: [],
    } };
    expect(incomingMessageSchema.parse(packet)).toMatchObject(packet);
    expect(incomingMessageSchema.safeParse({ ...packet, preview: { ...packet.preview, worldRevision: undefined } }).success).toBe(false);
  });

  it('parses transfer and hand target responses as distinct message types', () => {
    const transfer = incomingMessageSchema.parse({
      type: 'item_transfer_targets',
      itemId: 'ground-item',
      targets: [{ userId: 'offline-user', username: 'Offline user', online: false }],
    });
    const hand = incomingMessageSchema.parse({
      type: 'item_hand_targets',
      itemId: 'held-item',
      targets: [{ userId: 'nearby-user', username: 'Nearby user', online: true }],
    });

    expect(transfer.type).toBe('item_transfer_targets');
    expect(hand.type).toBe('item_hand_targets');
  });

  it('accepts hand as an item action result', () => {
    const result = incomingMessageSchema.parse({
      type: 'item_action_result',
      ok: true,
      action: 'hand',
      itemId: 'held-item',
      message: 'Handed item.',
    });

    expect(result).toMatchObject({ type: 'item_action_result', action: 'hand' });
  });
});

describe('player facing protocol messages', () => {
  it('accepts canonical facing on presence updates and rejects arbitrary degrees', () => {
    const position = incomingMessageSchema.parse({
      type: 'update_position',
      id: 'peer-1',
      x: 4,
      y: 5,
      z: 0,
      facingDeg: 315,
      acousticZoneId: 'floor:0',
    });

    expect(position).toMatchObject({ type: 'update_position', facingDeg: 315 });
    expect(() => incomingMessageSchema.parse({
      type: 'update_position',
      id: 'peer-1',
      x: 4,
      y: 5,
      z: 0,
      facingDeg: 22,
      acousticZoneId: 'floor:0',
    })).toThrow();
  });
});
