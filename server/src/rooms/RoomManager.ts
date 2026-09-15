import { Room } from './Room';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid typos
const IDLE_ROOM_MS = 60 * 60 * 1000;

/**
 * In-memory room registry. Every lookup goes through this class so swapping it
 * for a Redis-backed store later only touches this file.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    setInterval(() => this.reapIdle(), 60_000).unref?.();
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  create(): Room {
    const code = this.generateCode();
    const room = new Room(code, (c) => this.rooms.delete(c));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  get size() {
    return this.rooms.size;
  }

  private reapIdle() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isEmpty && now - room.lastActivity > IDLE_ROOM_MS) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }
}
