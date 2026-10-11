// 05: "perm one" shows a permission card; Allow sends a control_response and "Allowed, done." arrives.
import { SESSIONS, SIDEBAR, assert, controlResponses, openSession, sendMessage, waitForAssistantText } from './helpers.mjs';

export const meta = { title: 'Permission card round trip' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', () => openSession(d, ctx, SESSIONS.vault));
  await ctx.step('send "perm one"', () => sendMessage(d, ctx, 'perm one'));
  await ctx.step('permission card shows the command', async () => {
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.turn === 'needs_input', 8000, 'turn needs_input');
    await d.waitFor(`${SIDEBAR} >> text*=rm -rf /tmp/x`, 3000, 'the command in the card');
    await d.waitFor(`${SIDEBAR} >> text=Allow`, 3000, 'an Allow button');
  });
  await ctx.step('status says Needs you', async () => {
    await d.waitFor(`${SIDEBAR} >> text*=Needs you`, 3000, 'the Needs you status');
  });
  await ctx.step('Allow sends a control_response', async () => {
    await d.click(`${SIDEBAR} >> text=Allow`);
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.pending.length === 0, 5000, 'pending cleared');
    const responses = controlResponses(ctx, SESSIONS.vault.id);
    assert(responses.length === 1, `expected one control_response, got ${responses.length}`);
    assert(responses[0].response?.behavior === 'allow', `response was ${JSON.stringify(responses[0])}`);
  });
  await ctx.step('"Allowed, done." arrives', async () => {
    await waitForAssistantText(d, 'Allowed, done.', 6000);
    await d.waitFor(`${SIDEBAR} >> text*=Allowed, done.`, 2000, 'the reply rendered');
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.turn === 'idle', 5000, 'turn idle');
  });
}
