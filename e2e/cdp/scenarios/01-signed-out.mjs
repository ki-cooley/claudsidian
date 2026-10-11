// 01: signed out, the sidebar shows the sign-in card; the sign-in modal opens with a URL field.
import { SIDEBAR, assert } from './helpers.mjs';

export const meta = { title: 'Signed out shows the sign-in card', query: { signedout: '1' } };

export async function run(d, ctx) {
  await ctx.step('sign-in card visible', async () => {
    await d.waitFor(`${SIDEBAR} >> text=Sign in`, ctx.timeoutMs, 'a "Sign in" button in the sidebar');
  });
  await ctx.step('modal opens with a URL field', async () => {
    await d.click(`${SIDEBAR} >> text=Sign in`);
    await d.waitFor('.modal-container .claudsidian-sign-in', 5000, 'the sign-in modal');
    const url = await d.waitFor(() => {
      const el = document.querySelector('.claudsidian-sign-in-url input');
      return el && el.value ? el.value : null;
    }, 5000, 'the authorize URL in the modal');
    assert(/^https?:\/\//.test(url), `URL field holds ${JSON.stringify(url)}`);
    assert(url.includes('code_challenge='), 'authorize URL carries a PKCE challenge');
    assert(await d.exists('.modal-container >> input[placeholder="Paste the code here"]'), 'code field present');
  });
  await ctx.step('closing the modal keeps the card', async () => {
    await d.click('.modal-container .modal-close-button');
    await d.waitFor(() => !document.querySelector('.modal-container'), 3000, 'the modal to close');
    assert(await d.exists(`${SIDEBAR} >> text=Sign in`), 'sign-in card still shown');
  });
}
