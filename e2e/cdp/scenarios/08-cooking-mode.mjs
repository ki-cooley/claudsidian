// 08: toggle cooking mode in the open chat: quick replies visible, tap targets at least 48 px, screenshot.
import { SESSIONS, SIDEBAR, assert, openSession } from './helpers.mjs';

export const meta = { title: 'Cooking mode' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', () => openSession(d, ctx, SESSIONS.vault));
  await ctx.step('toggle cooking mode', async () => {
    const how = await d.eval(async () => {
      const h = window.__claudsidian;
      const before = h.settings().cookingMode;
      if (h.commands.commands['claudsidian:toggle-cooking']) {
        h.runCommand('toggle-cooking');
        await new Promise((r) => setTimeout(r, 50));
        if (h.settings().cookingMode !== before) return 'command';
      }
      if (typeof h.plugin.saveSettings === 'function') {
        h.plugin.settings.cookingMode = true;
        await h.plugin.saveSettings({ cookingMode: true });
        return 'saveSettings';
      }
      return null;
    });
    assert(how, 'no way to toggle cooking mode (no toggle-cooking command, no saveSettings)');
    ctx.note('toggled via', how);
    await d.waitFor(() => window.__claudsidian.settings().cookingMode === true, 2000, 'cookingMode on');
  });
  await ctx.step('quick replies visible', async () => {
    for (const reply of ['yes', 'go ahead', 'stop', 'what next?']) {
      await d.waitFor(`${SIDEBAR} >> text=${reply}`, 4000, `quick reply "${reply}"`);
    }
  });
  await ctx.step('tap targets at least 48 px', async () => {
    const small = await d.eval(() => {
      const out = [];
      const els = document.querySelectorAll('#sidebar button, #sidebar [role="button"], #sidebar a[href]');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 48 || r.width < 48) out.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    assert(small.length === 0, `targets under 48 px: ${small.join('; ')}`);
  });
  await ctx.step('a quick reply sends its text', async () => {
    await d.click(`${SIDEBAR} >> text=what next?`);
    await d.waitFor(() => {
      const items = window.__claudsidian.store.transcript('cse_vault').value.items;
      return items.some((i) => i.kind === 'assistant_text' && !i.partial && i.text.includes('Echo: what next?'));
    }, 6000, 'the echo of the quick reply');
    const rows = ctx.mock.state.events.get('cse_vault') ?? [];
    const sent = rows.filter((r) => r.source === 'client' && r.payload.type === 'user').map((r) => (r.payload.message.content[0] ?? {}).text ?? '');
    const last = sent[sent.length - 1] ?? '';
    assert(last === 'what next?', `quick reply sent ${JSON.stringify(last)} (should carry no context block)`);
  });
}
