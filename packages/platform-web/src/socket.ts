import type { WebWindow } from './web-window.ts';
import type { SocketFactory, SocketLike } from '@huddle/shared';

/** Adapts the browser WebSocket to the transport-agnostic `SocketLike`. */
export function createWebSocketFactory(win: WebWindow): SocketFactory {
  return (url: string): SocketLike => {
    const ws = new win.WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const socket: SocketLike = {
      get isOpen() {
        return ws.readyState === ws.OPEN;
      },
      send: (data) => {
        if (ws.readyState !== ws.OPEN) return;
        if (typeof data === 'string') ws.send(data);
        else ws.send(data.slice().buffer);
      },
      close: (code, reason) => ws.close(code, reason),
      onOpen: null,
      onMessage: null,
      onClose: null,
      onError: null,
    };
    ws.onopen = () => socket.onOpen?.();
    ws.onmessage = (ev: MessageEvent<unknown>) => {
      const data = ev.data;
      if (typeof data === 'string') socket.onMessage?.(data);
      else if (data instanceof ArrayBuffer) socket.onMessage?.(new Uint8Array(data));
    };
    ws.onclose = (ev) => socket.onClose?.(ev.code, ev.reason);
    ws.onerror = () => socket.onError?.('WebSocket error');
    return socket;
  };
}
