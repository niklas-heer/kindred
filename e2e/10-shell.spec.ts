// Journey 10: two things the shell must never do again. On a phone the profile page stays inside the screen (a visually
// hidden heading once let the whole app scroll away under the top bar), and the account and language menus open above
// the chat window's layer, not behind it.
import { expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

/** The chat window's layer (`.ai-drawer` in assistant.css). The menus in the top bar must open above it. */
const CHAT_LAYER = 60;

test('a phone profile never scrolls the app away', async ({ page }) => {
  const tree = await openFamily(page);
  await page.goto(`/${tree}/people`);
  await settled(page);
  const href = await page.locator('.reg-name a').filter({ hasText: STEWARD.given }).first().getAttribute('href');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(href!);
  await settled(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const shell = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.page')!;
    scroller.scrollTop = scroller.scrollHeight;
    // What is absolutely placed inside the page must be laid out against the page, so it scrolls with it.
    const hidden = [...scroller.querySelectorAll<HTMLElement>('.sr-only')];
    return {
      positioned: getComputedStyle(scroller).position !== 'static',
      strays: hidden.filter((el) => !scroller.contains(el.offsetParent)).length,
      document: document.documentElement.scrollHeight,
      screen: window.innerHeight,
      topbar: document.querySelector('.topbar')!.getBoundingClientRect().top,
    };
  });
  expect(shell.positioned, 'the page scroller is positioned').toBe(true);
  expect(shell.strays, 'visually hidden elements laid out against the document').toBe(0);
  expect(shell.document, 'the document is exactly one screen tall').toBe(shell.screen);
  expect(shell.topbar, 'the top bar stays at the top').toBe(0);
});

test('the account and language menus open above the chat layer', async ({ page }) => {
  await openFamily(page);
  // A stand-in for the chat window: something on its layer over the whole screen. It lets clicks through.
  await page.evaluate((layer) => {
    const veil = document.createElement('div');
    veil.id = 'e2e-chat-layer';
    veil.style.cssText = `position: fixed; inset: 0; z-index: ${layer}; pointer-events: none;`;
    document.body.append(veil);
  }, CHAT_LAYER);

  /** Whether the menu, corner to corner, is what a pointer would meet. */
  const onTop = (selector: string) => page.evaluate((sel) => {
    const menu = document.querySelector(sel)!;
    const veil = document.getElementById('e2e-chat-layer')!;
    veil.style.pointerEvents = 'auto';
    const r = menu.getBoundingClientRect();
    const points = [[r.left + 8, r.top + 8], [r.right - 8, r.bottom - 8], [r.left + r.width / 2, r.bottom - 8]];
    const hits = points.map(([x, y]) => menu.contains(document.elementFromPoint(x, y)));
    veil.style.pointerEvents = 'none';
    return hits;
  }, selector);

  await page.locator('.acct-trigger').click();
  await expect(page.locator('.acct-menu')).toBeVisible();
  expect(await onTop('.acct-menu'), 'account menu').toEqual([true, true, true]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.acct-menu')).toHaveCount(0);

  await page.getByRole('combobox', { name: /: English$/ }).click();
  await expect(page.locator('.lang-pop')).toBeVisible();
  expect(await onTop('.lang-pop'), 'language menu').toEqual([true, true, true]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lang-pop')).toHaveCount(0);

  // Closed, the bar is back under the chat layer, so a full-screen chat on a phone still covers it.
  const bar = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.topbar')!).zIndex));
  expect(bar).toBeLessThan(CHAT_LAYER);
});
