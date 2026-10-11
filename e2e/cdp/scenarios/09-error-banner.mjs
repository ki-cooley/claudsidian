// 09: a network fault on the send is retried transparently; a 404 on the send shows the error banner;
// the next send works (recovery). The client absorbs one network fault with its retry policy, so the banner
// assertion uses the one status the client never retries.
import { SESSIONS, SIDEBAR, assert, openSession, sendMessage, sentUserTexts, waitForAssistantText } from './helpers.mjs';

export const meta = { title: 'Error banner and recovery' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', () => openSession(d, ctx, SESSIONS.vault));
  await ctx.step('a dropped socket on the send is retried and the echo still arrives', async () => {
    const before = ctx.mock.state.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/events')).length;
    ctx.mock.fault({ once: 'network' });
    await sendMessage(d, ctx, 'hello again');
    await waitForAssistantText(d, 'Echo: hello again', 10_000);
    const after = ctx.mock.state.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/events')).length;
    ctx.note('event POSTs', `${before} before, ${after} after (the fault consumed one request, the client retried)`);
    assert(sentUserTexts(ctx, SESSIONS.vault.id).filter((t) => t.startsWith('hello again')).length === 1, 'message duplicated by the retry');
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.turn === 'idle', 5000, 'turn idle');
  });
  await ctx.step('a 404 on the send shows the error banner', async () => {
    ctx.mock.fault({ once: 404 });
    await sendMessage(d, ctx, 'after fault');
    const banner = await d.waitFor(() => {
      const b = window.__claudsidian.store.banner.value;
      return b && b.kind === 'error' ? b.text : null;
    }, 8000, 'an error banner in the store');
    ctx.note('banner', banner);
    await d.waitFor(`${SIDEBAR} >> text*=${banner.slice(0, 24)}`, 3000, 'the banner text rendered');
    assert(sentUserTexts(ctx, SESSIONS.vault.id).filter((t) => t.startsWith('after fault')).length === 0, 'the failed message was recorded by the mock');
  });
  await ctx.step('the next send succeeds', async () => {
    await d.waitFor(`${SIDEBAR} >> textarea`, 3000, 'the composer');
    await sendMessage(d, ctx, 'recovered');
    await waitForAssistantText(d, 'Echo: recovered', 8000);
  });
  await ctx.step('banner state after recovery', async () => {
    const banner = await d.eval(() => window.__claudsidian.store.banner.value);
    ctx.note('banner after recovery', banner ? `${banner.kind}: ${banner.text}` : 'cleared');
    const dismiss = `${SIDEBAR} >> text=Dismiss`;
    if (banner && (await d.exists(dismiss))) {
      await d.click(dismiss);
      await d.waitFor(() => window.__claudsidian.store.banner.value === null, 2000, 'banner dismissed');
    }
  });
}
