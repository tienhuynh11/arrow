import type { ServerMessage } from '../../../shared/protocol.js';

export interface Connection {
  id: string;
  ping: number;
  send(msg: ServerMessage): void;
  close(): void;
}
