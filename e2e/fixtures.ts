// What every journey shares: it fails on a hydration warning or an uncaught console error, and has helpers for
// passkeys and axe. Use this `test`, not Playwright's.
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_AXE } from './axe-known.ts';

export { expect };

/** The family journey 01 makes, and the steward in it. */
export const FAMILY = 'Testerby';
export const STEWARD = { given: 'Ada', surname: 'Testerby' };

// React says "Minified React error #418" (and #423, #425) for a hydration mismatch in a production build.
const HYDRATION = /hydrat|did not match|Minified React error #4(18|19|21|22|23|25)/i;

export interface Issues {
  /** Everything seen so far. */
  readonly seen: string[];
  /** Tolerates console errors matching this. For failures the journey causes on purpose, such as a refused write. */
  allow(pattern: RegExp): void;
  /** Watches another browser context, such as a guest's. */
  watch(context: BrowserContext): void;
  /** Waits for what a failure is still finding out about itself. */
  settle(): Promise<void>;
}

function collector(): Issues {
  const seen: string[] = [];
  const allowed: RegExp[] = [];
  const pending: Promise<void>[] = [];
  const add = (text: string) => { if (!allowed.some((p) => p.test(text))) seen.push(text); };
  const issues: Issues = {
    seen,
    allow: (pattern) => { allowed.push(pattern); },
    watch(context) {
      // The server's HTML as it arrived, kept so a hydration failure can say where the browser's own render differs.
      void context.addInitScript(() => {
        document.addEventListener('readystatechange', () => {
          if (document.readyState === 'interactive') (window as unknown as { __ssr?: string }).__ssr = document.body?.innerHTML;
        });
      });
      context.on('console', (m) => {
        const text = m.text();
        if (m.type() === 'error' || HYDRATION.test(text)) add(`[console.${m.type()}] ${text}${m.location().url ? ` (${m.location().url})` : ''}`);
      });
      context.on('weberror', (e) => {
        const text = `[uncaught] ${e.error().stack ?? e.error().message}`;
        add(text);
        if (HYDRATION.test(text) || /React error #4(18|23|25)/.test(text)) pending.push(whereItDiffers(e.page()).then((d) => { if (d) add(d); }));
      });
    },
    settle: async () => { await Promise.all(pending); },
  };
  return issues;
}

/**
 * After a failed hydration React draws the page again in the browser. This finds the first place where that differs from
 * the server's HTML, with the page's address: a minified production error says neither.
 */
async function whereItDiffers(page: Page | null): Promise<string | null> {
  if (!page) return null;
  try {
    await page.waitForTimeout(400);
    return await page.evaluate(() => {
      const server = (window as unknown as { __ssr?: string }).__ssr;
      if (!server) return null;
      const browser = document.body.innerHTML;
      let i = 0;
      while (i < server.length && i < browser.length && server[i] === browser[i]) i++;
      const cut = (text: string) => text.slice(Math.max(0, i - 200), i + 300);
      return `[hydration] ${location.pathname} first differs at ${i}\n  server:  ${cut(server)}\n  browser: ${cut(browser)}`;
    });
  } catch {
    return null;
  }
}

export const test = base.extend<{ issues: Issues }>({
  issues: [async ({ context }, use) => {
    const issues = collector();
    issues.watch(context);
    await use(issues);
    await issues.settle();
    expect(issues.seen, 'hydration warnings and uncaught console errors').toEqual([]);
  }, { auto: true }],
});

/** Gives a page a virtual passkey device (a platform authenticator that says yes by itself). */
export async function addPasskeyDevice(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** Opens the family from the home address, and waits for the app to hydrate. Returns the family's id. */
export async function openFamily(page: Page): Promise<string> {
  await page.goto('/');
  await page.waitForURL((u) => u.pathname !== '/' && !u.pathname.startsWith('/signin'));
  await settled(page);
  return new URL(page.url()).pathname.split('/')[1];
}

/** Waits until network requests have stopped, so hydration has happened and data has arrived. */
export async function settled(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForLoadState('networkidle');
}

/** Sets the theme and marks the choice as the reader's, as the switch in the top bar does. */
export async function setTheme(page: Page, theme: 'codex' | 'modern' | 'night') {
  await page.evaluate((t) => { localStorage.setItem('kindred:theme', t); document.documentElement.dataset.theme = t; }, theme);
}

const IMPACTS = new Set(['serious', 'critical']);

/**
 * Runs axe on what the page shows now, and fails the journey (softly, so the rest of it still runs) on a serious or
 * critical WCAG A/AA problem that axe-known.ts does not list. Everything found, listed or not, goes in the summary
 * teardown.ts prints. `where` names the page for that list, such as "tree" or "arms designer (night)".
 */
export async function checkAxe(page: Page, where: string) {
  // Colours fade between themes and dialogs fade in, and axe would measure them half-way. Two frames first, so that a
  // change made just now has started its transitions; endless animations, such as a spinner, are not waited for.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const found = violations.filter((v) => IMPACTS.has(v.impact ?? ''));
  const fresh: string[] = [];
  for (const v of found) {
    const known = KNOWN_AXE.some((k) => k.rule === v.id && k.where.test(where));
    appendFileSync(join(process.env.KINDRED_E2E_DATA!, 'axe.jsonl'), `${JSON.stringify({ where, rule: v.id, impact: v.impact, known, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(' '), detail: v.nodes[0]?.failureSummary?.split('\n').slice(1, 3).join(' ').trim(), html: v.nodes[0]?.html.slice(0, 200) })}\n`);
    if (!known) fresh.push(`${where}: ${v.id} (${v.impact}, ${v.nodes.length}x) e.g. ${v.nodes[0]?.target.join(' ')}`);
  }
  expect.soft(fresh, `axe on ${where}`).toEqual([]);
}
