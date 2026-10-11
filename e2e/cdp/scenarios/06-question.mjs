// 06: "ask one" shows a question card; answering sends the answers and the reply lists them.
import { SESSIONS, SIDEBAR, assert, controlResponses, openSession, sendMessage, waitForAssistantText } from './helpers.mjs';

export const meta = { title: 'Question card round trip' };

export async function run(d, ctx) {
  await ctx.step('open the vault session', () => openSession(d, ctx, SESSIONS.vault));
  await ctx.step('send "ask one"', () => sendMessage(d, ctx, 'ask one'));
  await ctx.step('question card shows both questions', async () => {
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.turn === 'needs_input', 8000, 'turn needs_input');
    await d.waitFor(`${SIDEBAR} >> text*=Which course gets the change?`, 3000, 'question one');
    await d.waitFor(`${SIDEBAR} >> text*=Which garnishes stay?`, 3000, 'question two');
  });
  await ctx.step('pick Crudo, then Chive and Yuzu', async () => {
    await d.click(`${SIDEBAR} >> text=Crudo`);
    await d.click(`${SIDEBAR} >> text=Chive`);
    await d.click(`${SIDEBAR} >> text=Yuzu`);
  });
  await ctx.step('send the answers', async () => {
    await d.waitFor(`${SIDEBAR} >> text=Send answers`, 3000, 'the Send answers button');
    await d.click(`${SIDEBAR} >> text=Send answers`);
    await d.waitFor(() => window.__claudsidian.store.transcript('cse_vault').value.pending.length === 0, 5000, 'pending cleared');
    const responses = controlResponses(ctx, SESSIONS.vault.id);
    assert(responses.length === 1, `expected one control_response, got ${responses.length}`);
    const answers = responses[0].response?.updatedInput?.answers ?? {};
    assert(answers['Which course gets the change?'] === 'Crudo', `course answer ${JSON.stringify(answers)}`);
    const garnish = answers['Which garnishes stay?'];
    const joined = Array.isArray(garnish) ? garnish.join(', ') : garnish;
    assert(joined === 'Chive, Yuzu', `garnish answer ${JSON.stringify(garnish)}`);
  });
  await ctx.step('the reply lists the answers', async () => {
    const text = await waitForAssistantText(d, 'Answers:', 6000);
    assert(text.includes('Crudo') && text.includes('Chive, Yuzu'), `reply was ${JSON.stringify(text)}`);
    await d.waitFor(`${SIDEBAR} >> text*=Answers:`, 2000, 'the reply rendered');
  });
}
