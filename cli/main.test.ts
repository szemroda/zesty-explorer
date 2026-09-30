// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCommand } from './main.js';

describe('parseCommand', () => {
  it('defaults to port 5173 and opening the browser', () => {
    expect(parseCommand([])).toEqual({ kind: 'serve', port: 5173, open: true });
  });

  it('accepts a custom port and --no-open', () => {
    expect(parseCommand(['--port', '8080', '--no-open'])).toEqual({
      kind: 'serve',
      port: 8080,
      open: false,
    });
  });

  it.each(['0', '65536', '80.5', 'abc', '-1'])('rejects port %s', (port) => {
    expect(() => parseCommand([`--port=${port}`])).toThrow(`Invalid port "${port}"`);
  });

  it('skips port validation for help and version', () => {
    expect(parseCommand(['--help', '--port', 'x'])).toEqual({ kind: 'help' });
    expect(parseCommand(['--version', '--port', 'x'])).toEqual({ kind: 'version' });
  });

  it('rejects unknown options with a pointer to --help', () => {
    expect(() => parseCommand(['--host'])).toThrow('Run zestyx --help for usage.');
  });
});
