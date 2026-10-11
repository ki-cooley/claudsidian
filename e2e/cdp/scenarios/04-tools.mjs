// 04: "tools one" shows two tool cards; expanding one reveals its input and result.
import { SESSIONS, SIDEBAR, assert, openSession, sendMessage, waitForAssistantText } from './helpers.mjs';

export const meta = { title: 'Tool cards expand to input and result' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', () => openSession(d, ctx, SESSIONS.vault));
  await ctx.step('send "tools one"', () => sendMessage(d, ctx, 'tools one'));
  await ctx.step('two tool items finish', async () => {
    await d.waitFor(() => {
      const items = window.__claudsidian.store.transcript('cse_vault').value.items.filter((i) => i.kind === 'tool');
      return items.length === 2 && items.every((i) => i.status === 'done') ? items.map((i) => i.name) : null;
    }, 8000, 'two finished tool items');
    await waitForAssistantText(d, 'renamed the crudo course');
  });
  await ctx.step('two tool cards render with their summaries', async () => {
    await d.waitFor(`${SIDEBAR} >> text*=Read menus/latitude 10/menu.md`, 3000, 'the Read card');
    await d.waitFor(`${SIDEBAR} >> text*=Edit menus/latitude 10/menu.md`, 3000, 'the Edit card');
  });
  await ctx.step('expanding the Read card shows the result', async () => {
    await d.click(`${SIDEBAR} >> text*=Read menus/latitude 10/menu.md`);
    await d.waitFor(`${SIDEBAR} >> text*=Chawanmushi`, 3000, 'the Read result (menu lines) inside the card');
  });
  await ctx.step('expanding the Edit card shows old and new text', async () => {
    await d.click(`${SIDEBAR} >> text*=Edit menus/latitude 10/menu.md`);
    await d.waitFor(`${SIDEBAR} >> text*=Crudo of fluke`, 3000, 'the Edit new_string');
    assert(await d.exists(`${SIDEBAR} >> text*=2. Crudo`), 'old string shown');
  });
}
