import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CliError,
  InstallationError,
  createRequestListener,
  loadAssets,
  startServer,
} from './server.js';

const help = `Usage: zestyx [options]

Starts Zesty Explorer on this computer and opens it in the default browser.

Options:
  --port <number>  Port to serve on (default: 5173)
  --no-open        Do not open the browser
  --version        Print the version
  --help           Print this help

Keep this terminal open while using the app. Press Ctrl+C to stop.`;

export type Command =
  { kind: 'help' } | { kind: 'version' } | { kind: 'serve'; port: number; open: boolean };

/** Parses command-line arguments, throwing CliError with a user-facing message. */
export function parseCommand(args: readonly string[]): Command {
  const values = parseFlags(args);
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  const portText = values.port ?? '5173';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new CliError(`Invalid port "${portText}". Use a whole number from 1 to 65535.`);
  }
  return { kind: 'serve', port, open: !values['no-open'] };
}

function parseFlags(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      options: {
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    }).values;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`${reason}\nRun zestyx --help for usage.`);
  }
}

/** Runs the zestyx command. Expected failures print a message and set a non-zero exit code. */
export async function main(args: readonly string[]): Promise<void> {
  try {
    await run(parseCommand(args));
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function run(command: Command): Promise<void> {
  if (command.kind === 'help') {
    console.log(help);
    return;
  }
  const version = await readVersion();
  if (command.kind === 'version') {
    console.log(version);
    return;
  }

  const { port, open } = command;
  const url = `http://localhost:${port}`;
  const assets = await loadAssets(fileURLToPath(new URL('../../dist/', import.meta.url)));
  const result = await startServer(createRequestListener(assets, version), port);
  if (result.kind === 'already-running') {
    console.log(`Zestyx ${result.version} is already running at ${url}`);
    if (result.version !== version) {
      console.log(
        `To use ${version} instead, stop it with Ctrl+C in its terminal and run this command again.`,
      );
    }
    if (open) openBrowser(url);
    return;
  }

  console.log(`Zestyx ${version} is running at ${url}\nPress Ctrl+C to stop.`);
  if (open) openBrowser(url);
  const stop = () => {
    void result.stop().then(() => console.log('Zestyx stopped.'));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function readVersion(): Promise<string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  } catch {
    throw new InstallationError();
  }
  const version =
    manifest && typeof manifest === 'object' && 'version' in manifest ? manifest.version : null;
  if (typeof version === 'string') return version;
  throw new InstallationError();
}

// Failures stay silent: the URL is always printed, and Windows' opener reports success anyway.
function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
