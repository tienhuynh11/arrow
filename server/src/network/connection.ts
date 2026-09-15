import type { ServerMessage } from '../../../shared/protocol';

export interface Connection {
  id: string;
  ping: number;
  send(msg: ServerMessage): void;
  close(): void;
}
