// 09: a network fault on the send is retried transparently; a 404 on the send shows the error banner;
// the next send works (recovery) and the banner clears on its own. The plan wrote this scenario as a network fault
// showing the banner; the client absorbs one network fault with its retry policy (status 0, 5xx and 429 retry,
// 401 refreshes), so the banner assertion uses the one status the client never retries.
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
  await ctx.step('the error banner clears after the successful send', async () => {
    // A send that reaches the server clears a send-error banner (session-store afterSend); nothing is dismissed by hand.
    const banner = await d.waitFor(() => {
      const b = window.__claudsidian.store.banner.value;
      return b && b.kind === 'error' ? null : { cleared: true, banner: b };
    }, 3000, 'the error banner to clear');
    ctx.note('banner after recovery', banner.banner ? `${banner.banner.kind}: ${banner.banner.text}` : 'cleared');
    assert(!(await d.exists(`${SIDEBAR} >> text*=Injected 404`)), 'the 404 banner is still rendered');
  });
}
