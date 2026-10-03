/**
 * Minimal socket abstraction so networking code runs unchanged over browser WebSockets,
 * Node `ws` sockets (bots, tests) or a future WebTransport/datachannel implementation.
 */
export interface SocketLike {
  readonly isOpen: boolean;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen: (() => void) | null;
  onMessage: ((data: string | Uint8Array) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  onError: ((message: string) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export type Unsubscribe = () => void;
