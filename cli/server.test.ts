// @vitest-environment node
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InstallationError,
  createRequestListener,
  loadAssets,
  startServer,
  versionHeader,
} from './server.js';
import type { StartResult } from './server.js';

const index = { body: Buffer.from('<div id="root"></div>'), contentType: 'text/html' };
const assets = {
  index,
  files: new Map([
    ['/index.html', index],
    ['/assets/app.js', { body: Buffer.from('export {};'), contentType: 'text/javascript' }],
  ]),
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(port: number, version = '1.0.0'): Promise<StartResult> {
  const result = await startServer(createRequestListener(assets, version), port);
  if (result.kind === 'started') cleanups.push(result.stop);
  return result;
}

describe('loadAssets', () => {
  it('reports a missing build as an incomplete installation', async () => {
    const missing = join(tmpdir(), 'zestyx-missing-build');
    await expect(loadAssets(missing)).rejects.toBeInstanceOf(InstallationError);
  });
});

describe('request listener', () => {
  it('serves assets, falls back to index.html for page paths, and rejects the rest', async () => {
    const port = await freePort();
    await start(port);
    const get = (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${port}${path}`, init);

    const page = await get('/saved/view?lang=en-US');
    expect(page.status).toBe(200);
    expect(page.headers.get(versionHeader)).toBe('1.0.0');
    expect(await page.text()).toBe('<div id="root"></div>');
    expect((await get('/assets/app.js')).headers.get('content-type')).toBe('text/javascript');
    expect(await (await get('/assets/app.js', { method: 'HEAD' })).text()).toBe('');
    expect((await get('/assets/missing')).status).toBe(404);
    expect((await get('/favicon.ico')).status).toBe(404);
    expect((await get('/', { method: 'POST' })).status).toBe(405);
  });

  it('accepts localhost with or without a port and rejects foreign host names', async () => {
    const port = await freePort();
    await start(port);
    const statusFor = (host: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        request({ port, host: '127.0.0.1', headers: { host } })
          .on('response', (response) => resolve(response.statusCode))
          .on('error', reject)
          .end();
      });

    // Browsers send a bare `localhost` when the app runs on the default HTTP port.
    expect(await statusFor('localhost')).toBe(200);
    expect(await statusFor(`attacker.example:${port}`)).toBe(403);
    expect(await statusFor(`[::1]:${port}`)).toBe(403);
  });
});

describe('startServer', () => {
  it('reports a zestyx server that already holds the port', async () => {
    const port = await freePort();
    await start(port, '1.0.0');
    expect(await start(port, '2.0.0')).toEqual({ kind: 'already-running', version: '1.0.0' });
  });

  it('explains a port held by another application', async () => {
    const port = await freePort();
    const other = createServer((_, response) => response.end()).listen(port, '127.0.0.1');
    cleanups.push(() => new Promise((resolve) => other.close(() => resolve())));
    await new Promise((resolve) => other.once('listening', resolve));

    await expect(start(port)).rejects.toThrow(
      `Port ${port} is already in use by another application.\nStop it, or run: npx zestyx@latest --port ${port + 1}`,
    );
  });
});
