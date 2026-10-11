// 07: the New session sheet creates a session in the vault environment and opens it.
import { SIDEBAR, assert, waitForSessions } from './helpers.mjs';

export const meta = { title: 'New session in the vault environment' };

export async function run(d, ctx) {
  await ctx.step('list loaded', () => waitForSessions(d, 5));
  await ctx.step('open the New session sheet', async () => {
    const candidates = [`${SIDEBAR} >> text=New session`, `${SIDEBAR} >> text=New`, `${SIDEBAR} >> button[aria-label="New session"]`];
    let opened = false;
    for (const sel of candidates) {
      if (await d.exists(sel)) {
        await d.click(sel);
        opened = true;
        break;
      }
    }
    assert(opened, `no New button (tried ${candidates.join(' | ')})`);
    await d.waitFor(`${SIDEBAR} >> select`, 5000, 'the environment select in the sheet');
  });
  await ctx.step('vault environment preselected', async () => {
    const value = await d.eval(() => {
      const sel = window.__harness.find('#sidebar >> select');
      return sel ? { value: sel.value, label: sel.options[sel.selectedIndex]?.textContent } : null;
    });
    assert(value && value.value === 'env_vault', `environment select holds ${JSON.stringify(value)}`);
  });
  await ctx.step('title and create', async () => {
    const titleSel = `${SIDEBAR} >> input[type="text"]`;
    await d.waitFor(titleSel, 3000, 'the title input');
    await d.fill(titleSel, 'Harness session');
    await d.click(`${SIDEBAR} >> text=Create`);
  });
  await ctx.step('the new session exists in the vault environment and opens', async () => {
    const id = await d.waitFor(() => {
      const s = window.__claudsidian.store;
      const id = s.selectedId.value;
      return id && id.startsWith('cse_new') ? id : null;
    }, 8000, 'a new session selected');
    const session = ctx.mock.state.sessions.get(id);
    assert(session, `mock has no session ${id}`);
    assert(session.environment_id === 'env_vault', `created in ${session.environment_id}`);
    assert(session.title === 'Harness session', `title is ${JSON.stringify(session.title)}`);
    await d.waitFor(`${SIDEBAR} >> text*=Harness session`, 3000, 'the new session title in the header');
    await d.waitFor(`${SIDEBAR} >> textarea`, 3000, 'the composer for the new session');
  });
}
