// 10: the header pickers (overflow, model) open as full bottom sheets over the chat, not clipped to the header.
// Regression for 2026-10-24: the positioned header was the sheets' containing block, so the model picker showed
// as a sliver under the header with the transcript readable below it.
import { SESSIONS, SIDEBAR, assert, openSession } from './helpers.mjs';

export const meta = { title: 'Header sheets cover the chat' };

function sheetGeometry() {
  const chat = document.querySelector('.claudsidian-chat');
  const backdrop = document.querySelector('.claudsidian-chat .claudsidian-sheet-backdrop');
  const sheet = backdrop && backdrop.querySelector('.claudsidian-sheet');
  if (!chat || !sheet) return null;
  const c = chat.getBoundingClientRect();
  const b = backdrop.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  return { chatH: c.height, backdropH: b.height, sheetBottomGap: c.bottom - s.bottom, clipped: sheet.scrollHeight > sheet.clientHeight + 1 };
}

async function assertCovers(d, what) {
  const g = await d.eval(sheetGeometry);
  assert(g, `no ${what} sheet rendered`);
  assert(Math.abs(g.backdropH - g.chatH) < 2, `${what} backdrop is ${g.backdropH}px tall, the chat is ${g.chatH}px`);
  assert(Math.abs(g.sheetBottomGap) < 2, `${what} sheet sits ${g.sheetBottomGap}px above the chat bottom`);
  assert(!g.clipped, `${what} sheet scrolls its own options`);
}

export async function run(d, ctx) {
  await ctx.step('open the vault session', async () => {
    await openSession(d, ctx, SESSIONS.vault);
    await d.waitForText('Latitude 10 runs eight courses');
  });
  await ctx.step('the overflow sheet covers the chat', async () => {
    await d.click(`${SIDEBAR} >> button[aria-label="More actions"]`);
    await d.waitFor(`${SIDEBAR} >> text=Permission mode`, 2000, 'the overflow sheet');
    await assertCovers(d, 'overflow');
  });
  await ctx.step('the model sheet covers the chat', async () => {
    await d.click(`${SIDEBAR} >> text=Model`);
    await d.waitFor(`${SIDEBAR} >> input[aria-label="Custom model id"]`, 2000, 'the model sheet');
    await assertCovers(d, 'model');
  });
}
