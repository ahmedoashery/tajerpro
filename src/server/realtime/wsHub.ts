import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { RealtimeEvent } from '../../shared/types.ts';

export class RealtimeHub {
  private wss: WebSocketServer | null = null;
  public readonly enabled: boolean;

  constructor(httpServer: HttpServer | null) {
    if (!httpServer) {
      this.enabled = false;
      return;
    }

    this.enabled = true;
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname !== '/ws') return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', (socket) => {
      const count = this.getClientCount();
      this.sendTo(socket, {
        type: 'connected',
        connectedTerminals: count,
        serverTime: new Date().toISOString(),
      });
      this.broadcast({
        type: 'presence:updated',
        connectedTerminals: count,
      });

      socket.on('close', () => {
        this.broadcast({
          type: 'presence:updated',
          connectedTerminals: this.getClientCount(),
        });
      });

      socket.on('error', () => {
        // Ignore transient client socket errors
      });
    });
  }

  public getClientCount(): number {
    if (!this.wss) return 1;
    let active = 0;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        active += 1;
      }
    }
    return Math.max(1, active);
  }

  private sendTo(socket: WebSocket, event: RealtimeEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  public broadcast(event: RealtimeEvent): void {
    if (!this.wss) return;
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
