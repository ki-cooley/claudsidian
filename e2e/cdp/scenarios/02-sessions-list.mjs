// 02: the sessions list shows the three groups with the vault group first and the blocked session marked "Needs you".
import { SESSIONS, SIDEBAR, assert, waitForSessions } from './helpers.mjs';

export const meta = { title: 'Sessions list groups and status' };

export async function run(d, ctx) {
  await ctx.step('list loads all seeded sessions', async () => {
    const n = await waitForSessions(d, 5);
    assert(n === 5, `expected 5 sessions (3 pages of the mock list), got ${n}`);
    await d.waitFor(`${SIDEBAR} >> text=${SESSIONS.vault.title}`);
  });
  await ctx.step('three groups in order: This vault, Other local, Cloud', async () => {
    // The vault group needs the environments' cwd (bridge_info.directory from GET /v1/environments); the store
    // fetches it once per minute, so the wait is bounded by --timeout. On failure, record what the page and the
    // mock saw so a slow or failed GET can be told apart from a render that never picked it up.
    let order;
    try {
      order = await d.waitFor(() => {
        const text = document.querySelector('#sidebar').innerText;
        const idx = ['This vault', 'Other local', 'Cloud'].map((g) => text.indexOf(g));
        return idx.every((i) => i >= 0) ? idx : null;
      }, ctx.timeoutMs, 'the three group headings (This vault, Other local, Cloud)');
    } catch (err) {
      const diag = await groupingDiagnostics(d, ctx);
      ctx.note('grouping diagnostics', diag);
      throw new Error(`${err instanceof Error ? err.message : String(err)}; ${JSON.stringify(diag)}`);
    }
    assert(order[0] < order[1] && order[1] < order[2], `groups out of order: ${JSON.stringify(order)}`);
  });
  await ctx.step('vault sessions sit under This vault, before the other groups', async () => {
    const pos = await d.eval((vaultTitle, wsTitle, cloudTitle) => {
      const text = document.querySelector('#sidebar').innerText;
      return { vault: text.indexOf(vaultTitle), ws: text.indexOf(wsTitle), cloud: text.indexOf(cloudTitle), other: text.indexOf('Other local') };
    }, SESSIONS.vault.title, SESSIONS.ws.title, SESSIONS.cloud.title);
    assert(pos.vault >= 0 && pos.vault < pos.other, `vault session not in the first group: ${JSON.stringify(pos)}`);
    assert(pos.ws > pos.other, 'workspace session not under Other local');
    assert(pos.cloud > pos.ws, 'cloud session not last');
  });
  await ctx.step('blocked session marked Needs you', async () => {
    const ok = await d.eval((title) => {
      const walker = document.createTreeWalker(document.querySelector('#sidebar'), NodeFilter.SHOW_TEXT);
      let node;
      let titleNode = null;
      while ((node = walker.nextNode())) if (node.textContent.trim() === title) titleNode = node;
      if (!titleNode) return 'title not found';
      // Walk up until an ancestor contains "Needs you" but not another session title.
      let el = titleNode.parentElement;
      while (el && el.id !== 'sidebar') {
        const t = el.innerText;
        if (/needs you/i.test(t)) return t.includes('L10 menu questions') ? 'container also holds another session' : true;
        el = el.parentElement;
      }
      return 'no ancestor shows Needs you';
    }, SESSIONS.blocked.title);
    assert(ok === true, `blocked row: ${ok}`);
  });
  await ctx.step('archived session hidden by default', async () => {
    assert(!(await d.exists(`${SIDEBAR} >> text=${SESSIONS.old.title}`)), 'archived session visible');
  });
}

/** What the mock served and what the store holds, for a failed grouping wait. */
async function groupingDiagnostics(d, ctx) {
  const envRequests = ctx.mock.state.requests.filter((r) => r.path === '/v1/environments').map((r) => `${r.method} ${r.at}`);
  const page = await d.eval(() => {
    const s = window.__claudsidian && window.__claudsidian.store;
    if (!s) return { store: null };
    const envs = typeof s.environments === 'function' ? s.environments().map((e) => ({ id: e.id, kind: e.kind, cwd: e.cwd ?? null, online: e.online ?? null, sessionCount: e.sessionCount })) : 'no environments()';
    const sessions = s.sessions.value.slice(0, 5).map((x) => ({ id: x.id, environmentId: x.environmentId ?? null, cwd: x.cwd ?? null }));
    const headings = Array.from(document.querySelectorAll('#sidebar h3, #sidebar h4, #sidebar [class*="group"]'))
      .map((el) => el.textContent.trim())
      .filter((t) => t && t.length < 40)
      .slice(0, 8);
    return { environments: envs, sessions, headings, banner: s.banner.value, listError: s.sessionsError ? s.sessionsError.value : null };
  });
  return { environmentsRequests: envRequests.length ? envRequests : 'none served', ...page };
}
