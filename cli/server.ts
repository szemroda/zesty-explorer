import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { extname, join, relative, sep } from 'node:path';

/** Identifies a running zestyx server so a second launch can reuse it. */
export const versionHeader = 'x-zestyx-version';

/** An expected failure whose message is shown to the user as-is, without a stack trace. */
export class CliError extends Error {}

/** The packaged build or manifest cannot be read. */
export class InstallationError extends CliError {
  constructor() {
    super(
      'The zestyx installation is incomplete. Run the command again, or run `pnpm build` in a repository checkout.',
    );
  }
}

type Asset = { body: Buffer; contentType: string };

export type Assets = { index: Asset; files: ReadonlyMap<string, Asset> };

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Reads the frontend build once, so requests never touch the filesystem. */
export async function loadAssets(directory: string): Promise<Assets> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(
    () => null,
  );
  if (!entries) throw new InstallationError();
  const files = new Map<string, Asset>();
  for (const entry of entries.filter((entry) => entry.isFile())) {
    const file = join(entry.parentPath, entry.name);
    files.set(`/${relative(directory, file).split(sep).join('/')}`, {
      body: await readFile(file),
      contentType: contentTypes[extname(file)] ?? 'application/octet-stream',
    });
  }
  const index = files.get('/index.html');
  if (!index) throw new InstallationError();
  return { index, files };
}

/** Serves the SPA: known assets by path, and `index.html` for any extensionless page path. */
export function createRequestListener({ index, files }: Assets, version: string): RequestListener {
  return (request, response) => {
    response.setHeader(versionHeader, version);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Foreign host names indicate DNS rebinding. The port is ignored because browsers omit
    // the default one. 127.0.0.1 stays reachable so index.html can redirect it (docs/adr/0003).
    const hostname = request.headers.host?.replace(/:\d+$/, '');
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const isPage = !path.startsWith('/assets/') && !extname(path);
    const asset = files.get(path) ?? (isPage ? index : undefined);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Content-Length': asset.body.length,
    });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  };
}

export type StartResult =
  { kind: 'started'; stop: () => Promise<void> } | { kind: 'already-running'; version: string };

/**
 * Listens on both loopback addresses, because browsers may resolve `localhost` to either.
 * A port held by another zestyx is reported as `already-running`; other failures throw CliError.
 */
export async function startServer(listener: RequestListener, port: number): Promise<StartResult> {
  const ipv4 = createServer(listener);
  const ipv4Error = await listen(ipv4, port, '127.0.0.1');
  if (ipv4Error) {
    const runningVersion = ipv4Error.code === 'EADDRINUSE' ? await probeVersion(port) : null;
    if (runningVersion) return { kind: 'already-running', version: runningVersion };
    throw new CliError(describeListenError(ipv4Error, port));
  }

  // Systems without IPv6 are still served through 127.0.0.1.
  const ipv6 = createServer(listener);
  const ipv6Error = await listen(ipv6, port, '::1');
  const ipv6Unavailable = ipv6Error?.code === 'EADDRNOTAVAIL' || ipv6Error?.code === 'EAFNOSUPPORT';
  if (ipv6Error && !ipv6Unavailable) {
    await close(ipv4);
    throw new CliError(describeListenError(ipv6Error, port));
  }
  const servers = ipv6Error ? [ipv4] : [ipv4, ipv6];
  return {
    kind: 'started',
    stop: async () => {
      await Promise.all(servers.map(close));
    },
  };
}

function listen(server: Server, port: number, host: string) {
  return new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
    server.once('error', resolve);
    server.listen(port, host, () => {
      server.off('error', resolve);
      resolve(undefined);
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function probeVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000),
    });
    return response.headers.get(versionHeader);
  } catch {
    return null;
  }
}

function describeListenError(error: NodeJS.ErrnoException, port: number): string {
  const alternative = `run: npx zestyx@latest --port ${port < 65535 ? port + 1 : port - 1}`;
  if (error.code === 'EADDRINUSE') {
    return `Port ${port} is already in use by another application.\nStop it, or ${alternative}`;
  }
  if (error.code === 'EACCES') {
    return `Port ${port} is reserved by the system or needs elevated permissions.\nTo use another port, ${alternative}`;
  }
  return `Could not start the server on port ${port}: ${error.message}`;
}
