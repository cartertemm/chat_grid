import { GRID_SIZE, hasItemBounds, itemBounds, isItemOnFloor, type GameState, type PeerState, type WorldItem } from '../state/gameState';

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private squarePixelSize: number;
  private gridSize: number;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create 2D context');
    }
    this.ctx = ctx;
    this.gridSize = GRID_SIZE;
    this.squarePixelSize = canvas.width / this.gridSize;
  }

  setGridSize(gridSize: number): void {
    if (!Number.isInteger(gridSize) || gridSize <= 0) return;
    this.gridSize = Math.min(gridSize, GRID_SIZE);
    this.squarePixelSize = this.canvas.width / this.gridSize;
  }

  draw(state: GameState): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Keep the original two floors framed as before. Follow players on an expanded map.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const platform of state.platforms.values()) {
      if (platform.z !== state.player.z) continue;
      minX = Math.min(minX, platform.startX);
      minY = Math.min(minY, platform.startY);
      maxX = Math.max(maxX, platform.endX);
      maxY = Math.max(maxY, platform.endY);
    }
    const origin = (position: number, min: number, max: number) => Number.isFinite(min)
      ? Math.max(min, Math.min(Math.floor(position - this.gridSize / 2), max - this.gridSize + 1)) : 0;
    const left = origin(state.player.x, minX, maxX);
    const bottom = origin(state.player.y, minY, maxY);
    ctx.save();
    ctx.translate(-left * this.squarePixelSize, bottom * this.squarePixelSize);
    ctx.fillStyle = '#1e293b';
    for (const platform of state.platforms.values()) {
      if (platform.z === state.player.z) ctx.fillRect(platform.startX * this.squarePixelSize,
        this.canvas.height - (platform.endY + 1) * this.squarePixelSize,
        (platform.endX - platform.startX + 1) * this.squarePixelSize,
        (platform.endY - platform.startY + 1) * this.squarePixelSize);
    }
    ctx.fillStyle = 'rgba(45, 212, 191, 0.12)';
    for (const ambiance of state.ambiances.values()) {
      if (ambiance.floorZ !== state.player.z) continue;
      ctx.fillRect(
        ambiance.startX * this.squarePixelSize,
        this.canvas.height - (ambiance.endY + 1) * this.squarePixelSize,
        (ambiance.endX - ambiance.startX + 1) * this.squarePixelSize,
        (ambiance.endY - ambiance.startY + 1) * this.squarePixelSize,
      );
    }
    ctx.strokeStyle = '#374151';
    for (let i = 0; i <= this.gridSize; i += 1) {
      ctx.beginPath();
      const x = (left + i) * this.squarePixelSize;
      const y = (i - bottom) * this.squarePixelSize;
      ctx.moveTo(x, -bottom * this.squarePixelSize);
      ctx.lineTo(x, this.canvas.height - bottom * this.squarePixelSize);
      ctx.moveTo(left * this.squarePixelSize, y);
      ctx.lineTo(this.canvas.width + left * this.squarePixelSize, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#f3f4f6';
    ctx.lineWidth = Math.max(2, this.squarePixelSize * 0.12);
    for (const wall of state.structures.values()) {
      if (wall.floorZ !== state.player.z) continue;
      const horizontal = wall.orientation === 'horizontal';
      for (let offset = 0; offset < wall.length; offset++) {
        const door = wall.doors?.find((entry) => entry.offset === offset);
        ctx.strokeStyle = door ? (door.isOpen ? '#34d399' : '#f59e0b') : '#f3f4f6';
        const x = (wall.startX + (horizontal ? offset : 0)) * this.squarePixelSize;
        const y = this.canvas.height - (wall.startY + (horizontal ? 0 : offset)) * this.squarePixelSize;
        const span = this.squarePixelSize * (door?.isOpen ? 0.22 : 1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (horizontal ? span : 0), y - (horizontal ? 0 : span));
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;

    for (const peer of state.peers.values()) {
      if (peer.z !== state.player.z) continue;
      this.drawObject(peer, '#f87171', peer.nickname);
    }
    for (const item of state.items.values()) {
      if (item.carrierId) continue;
      if (!isItemOnFloor(item, state.player.z)) continue;
      if (hasItemBounds(item)) {
        const bounds = itemBounds(item);
        this.drawItem(item, 0, 0, bounds.endX - item.x + 1, bounds.endY - item.y + 1);
      } else {
        for (const offset of item.occupiedOffsets) this.drawItem(item, offset.x, offset.y);
      }
    }
    this.drawObject(state.player, '#34d399', state.player.nickname);
    ctx.restore();

    if (state.mode === 'nickname' || state.mode === 'chat' || state.mode === 'itemPropertyEdit' || state.mode === 'worldBuilderAmbianceEdit' || state.mode === 'worldBuilderRegionEdit' || state.mode === 'worldBuilderPlatformEdit') {
      const label =
        state.mode === 'nickname' ? 'New Nickname' : state.mode === 'chat' ? 'Message' : 'Property Value';
      this.drawTextOverlay(state, label);
    }
  }

  private drawObject(obj: Pick<PeerState, 'x' | 'y' | 'nickname'>, color: string, name: string): void {
    const drawX = obj.x * this.squarePixelSize;
    const drawY = this.canvas.height - (obj.y * this.squarePixelSize) - this.squarePixelSize;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(drawX, drawY, this.squarePixelSize, this.squarePixelSize);
    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Courier New';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(name, drawX + this.squarePixelSize / 2, drawY - 5);
  }

  private drawTextOverlay(state: GameState, label: string): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, this.canvas.height / 2 - 30, this.canvas.width, 60);
    ctx.fillStyle = 'white';
    ctx.font = '24px Courier New';
    ctx.textAlign = 'center';

    const text = `${label}: ${state.nicknameInput}`;
    const textMetrics = ctx.measureText(text);
    const preCursorText = `${label}: ${state.nicknameInput.substring(0, state.cursorPos)}`;
    const preCursorWidth = ctx.measureText(preCursorText).width;
    const textX = this.canvas.width / 2;

    ctx.fillText(text, textX, this.canvas.height / 2);
    if (state.cursorVisible) {
      ctx.fillRect(textX - textMetrics.width / 2 + preCursorWidth, this.canvas.height / 2 - 20, 2, 24);
    }
  }

  private drawItem(item: WorldItem, offsetX: number, offsetY: number, width = 1, depth = 1): void {
    const drawX = (item.x + offsetX) * this.squarePixelSize;
    const drawY = this.canvas.height - ((item.y + offsetY) * this.squarePixelSize) - this.squarePixelSize;
    this.ctx.fillStyle =
      item.type === 'radio_station'
        ? '#fbbf24'
        : item.type === 'wheel'
          ? '#f97316'
          : item.type === 'piano'
            ? '#c4b5fd'
          : item.type === 'clock'
            ? '#86efac'
            : item.type === 'elevator'
              ? '#9ca3af'
            : item.type === 'widget'
              ? '#22d3ee'
              : '#60a5fa';
    this.ctx.fillRect(drawX, drawY - (depth - 1) * this.squarePixelSize, width * this.squarePixelSize, depth * this.squarePixelSize);
    this.ctx.fillStyle = '#111827';
    this.ctx.font = 'bold 12px Courier New';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      item.type === 'radio_station'
        ? 'R'
        : item.type === 'wheel'
          ? 'W'
          : item.type === 'piano'
            ? 'P'
          : item.type === 'clock'
            ? 'C'
            : item.type === 'elevator'
              ? 'E'
            : item.type === 'widget'
              ? 'B'
              : 'D',
      drawX + this.squarePixelSize / 2,
      drawY + 13,
    );
  }
}
