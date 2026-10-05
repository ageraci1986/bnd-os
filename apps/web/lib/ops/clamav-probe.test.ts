import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { probeClamav } from './clamav-probe';

/**
 * Vrais serveurs TCP locaux sur port éphémère (spec §3 « Sonde ») — pas de
 * mock de `node:net`, on exerce le vrai chemin socket.
 */

const servers: Server[] = [];
const sockets = new Set<Socket>();

function listen(onCommand: (socket: Socket, command: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => undefined);
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => onCommand(socket, chunk));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

/** Port libre sans écouteur : on ouvre puis referme un serveur. */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('probeClamav', () => {
  it('returns true when clamd answers PONG to zPING', async () => {
    const commands: string[] = [];
    const port = await listen((socket, command) => {
      commands.push(command);
      socket.end('PONG\0');
    });

    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 1000 })).resolves.toBe(true);
    expect(commands.join('')).toBe('zPING\0');
  });

  it('returns true when PONG arrives split across chunks', async () => {
    const port = await listen((socket) => {
      socket.write('PO');
      setTimeout(() => socket.end('NG\0'), 20);
    });

    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 1000 })).resolves.toBe(true);
  });

  it('returns false on an unexpected reply', async () => {
    const port = await listen((socket) => {
      socket.end('UNKNOWN COMMAND\0');
    });

    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 1000 })).resolves.toBe(false);
  });

  it('returns false when the server closes without answering', async () => {
    const port = await listen((socket) => {
      socket.end();
    });

    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 1000 })).resolves.toBe(false);
  });

  it('returns false when nothing listens on the port (connection refused)', async () => {
    const port = await closedPort();

    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 1000 })).resolves.toBe(false);
  });

  it('returns false within the timeout when the server never answers', async () => {
    const port = await listen(() => undefined);

    const started = Date.now();
    await expect(probeClamav({ host: '127.0.0.1', port, timeoutMs: 100 })).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
