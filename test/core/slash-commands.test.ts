// Tests for the slash command catalogue and the composer's detection and filtering helpers.
import { describe, expect, it } from 'vitest';
import { REMOTE_SLASH_COMMANDS, filterSlashCommands, isSlashCommand } from '../../src/core/slash-commands';

describe('slash commands', () => {
  it('lists the remote commands the host runs locally', () => {
    const names = REMOTE_SLASH_COMMANDS.map((c) => c.name);
    for (const n of ['compact', 'clear', 'context', 'usage', 'recap', 'model', 'effort', 'fast', 'rename', 'mcp', 'autocompact']) {
      expect(names).toContain(n);
    }
    expect(REMOTE_SLASH_COMMANDS.find((c) => c.name === 'model')?.args).toBe('<name>');
  });

  it('detects slash commands', () => {
    expect(isSlashCommand('/model x')).toBe(true);
    expect(isSlashCommand('/compact')).toBe(true);
    expect(isSlashCommand('  /clear  ')).toBe(true);
    expect(isSlashCommand('/ not')).toBe(false);
    expect(isSlashCommand('not /model')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
    expect(isSlashCommand('/')).toBe(false);
  });

  it('filters by name prefix', () => {
    expect(filterSlashCommands('mo').map((c) => c.name)).toEqual(['model']);
    expect(filterSlashCommands('/mo').map((c) => c.name)).toEqual(['model']);
    expect(filterSlashCommands('/model opus').map((c) => c.name)).toEqual(['model']);
    expect(filterSlashCommands('').length).toBe(REMOTE_SLASH_COMMANDS.length);
    expect(filterSlashCommands('zzz')).toEqual([]);
  });

  it('falls back to a substring match on the name', () => {
    expect(filterSlashCommands('compact').map((c) => c.name)).toEqual(['compact', 'autocompact']);
  });
});
