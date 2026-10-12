// 03: open the vault session, type hello, send; the user bubble shows at once, the echo arrives within 5 s,
// the context chips named the active note, and the sent message carried the [Obsidian context] block.
// Enter sends on every profile and Shift+Enter inserts a newline (owner: hit Enter to send, keyboard dismisses on mobile).
import { COMPOSER, SESSIONS, SIDEBAR, assert, openSession, sentUserTexts, waitForAssistantText } from './helpers.mjs';

export const meta = { title: 'Chat send and reply with context' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', async () => {
    await openSession(d, ctx, SESSIONS.vault);
    await d.waitForText('Latitude 10 runs eight courses');
  });
  await ctx.step('context chips show the active note', async () => {
    await d.waitFor(`${SIDEBAR} >> text*=menu.md`, 5000, 'a chip naming menu.md');
  });
  await ctx.step('Shift+Enter inserts a newline', async () => {
    await d.fill(COMPOSER, 'hello');
    await d.focus(COMPOSER);
    await d.press('Shift+Enter');
    const value = await d.text(COMPOSER);
    assert(value.includes('\n'), `composer holds ${JSON.stringify(value)}, expected a newline`);
    const sent = sentUserTexts(ctx, SESSIONS.vault.id).filter((t) => t.startsWith('hello'));
    assert(sent.length === 0, 'the newline key sent the message');
    await d.fill(COMPOSER, 'hello');
  });
  await ctx.step('Enter sends', async () => {
    await d.focus(COMPOSER);
    await d.press('Enter');
  });
  if (ctx.profile.mobile) {
    await ctx.step('the composer loses focus after a send on mobile (keyboard dismissed)', async () => {
      await d.waitFor(() => !(document.activeElement && document.activeElement.matches('.claudsidian-composer-input')), 1000, 'the textarea to blur');
    });
  }
  await ctx.step('user bubble appears immediately', async () => {
    await d.waitFor(() => {
      const s = window.__claudsidian.store;
      const items = s.transcript('cse_vault').value.items;
      return items.some((i) => i.kind === 'user' && i.text === 'hello');
    }, 400, 'the optimistic user item');
    await d.waitFor(`${SIDEBAR} >> text=hello`, 1000, 'the user bubble');
  });
  await ctx.step('Echo: hello arrives within 5 s', async () => {
    await waitForAssistantText(d, 'Echo: hello', 5000);
    await d.waitFor(`${SIDEBAR} >> text*=Echo: hello`, 2000, 'the echo rendered');
  });
  await ctx.step('the sent message carried the Obsidian context block', async () => {
    const texts = sentUserTexts(ctx, SESSIONS.vault.id).filter((t) => t.startsWith('hello'));
    assert(texts.length === 1, `expected one hello message, found ${texts.length}`);
    const text = texts[0];
    assert(text.includes('[Obsidian context]'), `no context block in ${JSON.stringify(text)}`);
    assert(text.includes('active note: menus/latitude 10/menu.md'), 'context names the active note');
    assert(!text.includes('vault:'), 'vault line should be omitted when the session cwd is the vault');
    ctx.note('sent text', text);
  });
  await ctx.step('composer is empty and enabled after the turn', async () => {
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.turn === 'idle', 5000, 'turn idle');
    const value = await d.text(COMPOSER);
    assert(value === '', `composer still holds ${JSON.stringify(value)}`);
  });
}
