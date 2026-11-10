// The pictures in README.md (mise run screenshots): builds the Node server, fills a scratch data folder with the two
// invented families (scripts/gen-realm.ts, gen-modern.ts and seed.ts), starts the server on it with the fake AI
// provider and no daily jobs, signs up the first steward with a virtual passkey, says who "me" is in each family, and
// drives the installed Brave (KINDRED_E2E_BROWSER names another Chromium, as for mise run e2e) to take the pictures
// into docs/images/. Nothing here reaches the network beyond this machine, and no real family is read.
//   node scripts/screenshots.ts [--use-dist] [--only tree,person,...] [--out <folder>]
//   --use-dist  skip the build and serve the dist/ that is already there (built with KINDRED_TARGET=node)
//   --only      take just these pictures (names as in SHOTS below)
//   --out       write the pictures here instead of docs/images/
//   --keep-png  also leave the full-size PNGs beside the WebP files (to look at them)
//   --port      the port to serve on (default: the first free one from 4632)
// The server runs on a clock of its own (scripts/lib/shot-clock.ts): first on 3 November 2026, when the steward turns the
// Campaign on and a relative is invited, then on 7 November, the day the invented modern family is set on, so the season is
// four days old, the week's question is the same every time, and the pictures differ between runs only where the data does.
// Screenshots are PNG from Playwright; cwebp (brew install webp) makes the WebP files, at the best quality that fits
// MAX_BYTES. The scratch folder and the server are removed again whether or not a step fails.
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
process.chdir(root);

const args = process.argv.slice(2);
const useDist = args.includes('--use-dist');
const flagValue = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keepPng = args.includes('--keep-png');
const only = flagValue('--only')?.split(',');
const outDir = resolve(flagValue('--out') ?? 'docs/images');

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const executablePath = process.env.KINDRED_E2E_BROWSER || (existsSync(BRAVE) ? BRAVE : undefined);
const SETUP_CODE = 'SHOT-TEST-SETUP-CODE';
/** The size every picture is taken at: CSS pixels, at twice the density. */
const VIEWPORT = { width: 1440, height: 900 };
/** The day the invented modern family is set on (gen-modern.ts), and the day the Campaign's season began four days before. */
const NOW = '2026-11-07T12:00:00Z';
const SEASON_START = '2026-11-03T12:00:00Z';
/** Aim for no more than this per WebP file (cwebp's size search lands a little over or under), in bytes: the README is the front page and loads four or five of them. */
const MAX_BYTES = 145_000;

const work = mkdtempSync(join(tmpdir(), 'kindred-shots-'));
const dataDir = join(work, 'data');
const raw = join(work, 'png');
let server: ChildProcess | undefined;
let serverLog = '';

const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(from: number): Promise<number> {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise<boolean>((done) => {
      const s = createServer();
      s.once('error', () => done(false));
      s.listen(port, '127.0.0.1', () => s.close(() => done(true)));
    });
    if (free) return port;
  }
  throw new Error(`no free port from ${from}`);
}

function sh(label: string, cmd: string, cmdArgs: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}):\n${(r.stdout ?? '').slice(-1500)}\n${(r.stderr ?? '').slice(-1500)}`);
}

/** The people each family is seen as: the person the seed opens the tree on, who "me" is. */
interface Seed { id: string; focus: string; people: { id: string; given: string; surname?: string }[] }
const seed = (id: string): Seed => JSON.parse(readFileSync(join(root, 'data/seed', `${id}.json`), 'utf8'));

/** Waits until the page has stopped moving: network quiet, fonts loaded, finite animations done, two frames drawn. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
  // Images and drawn portraits that have not arrived yet are placeholders: wait for them too.
  // (A picture far down a long page that loads only when it is scrolled to is not waited for: it is not in the picture.)
  await page.waitForFunction(() => [...document.images].every((i) => {
    if (i.complete) return true;
    const box = i.getBoundingClientRect();
    return i.loading === 'lazy' && (box.top > innerHeight + 200 || box.bottom < -200 || box.width === 0);
  }));
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await sleep(400);
}

async function createAccount(page: Page, origin: string, name: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(`${origin}/setup`);
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create your passkey' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });
}

/** Opens a family's tree and answers "Who are you in this family?" with the given person (the one the seed opens on by default). */
async function sayWhoIAm(page: Page, origin: string, tree: string, personId?: string) {
  const s = seed(tree);
  const me = s.people.find((p) => p.id === (personId ?? s.focus))!;
  await page.goto(`${origin}/${tree}`);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 20_000 });
  await dialog.getByRole('textbox', { name: 'Search for yourself by name' }).fill([me.given, me.surname].filter(Boolean).join(' '));
  await dialog.locator('.who-item').first().click();
  await dialog.getByRole('button', { name: 'Yes, this is me' }).click();
  await dialog.waitFor({ state: 'detached' });
  // The offer of the tour comes a moment later: turn it down, once.
  const offer = page.getByRole('complementary', { name: 'Would you like a quick tour?' });
  await offer.getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);
}

/** A steward makes an invitation link on the Access page, the way the page's own button does. */
async function invite(page: Page, origin: string, tree: string): Promise<string> {
  await page.goto(`${origin}/${tree}/access`);
  await settle(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Make an invitation link' }).click();
  const url = await dialog.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();
  return url;
}

/** A relative opens an invitation in a browser of their own (with a virtual passkey) and says who they are. */
async function joinByInvite(page: Page, origin: string, url: string, name: string, tree: string, personId: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(url.replace(/^https?:\/\/[^/]+/, origin));
  await page.getByRole('textbox', { name: 'What should the family call you?' }).fill(name);
  await page.getByRole('button', { name: 'Create your passkey' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/invite'), { timeout: 30_000 }).catch(() => undefined);
  await sayWhoIAm(page, origin, tree, personId);
}

/** Switches a game on or off under Games, as a steward does. */
async function setGame(page: Page, origin: string, tree: string, name: string, on: boolean) {
  await page.goto(`${origin}/${tree}/settings/games`);
  await settle(page);
  const toggle = page.getByRole('switch', { name });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await page.locator(`[role="switch"][aria-checked="${on}"]`).first().waitFor();
}

/** Answers this week's question on Today from the person the dialog starts with (the reader, if they said who they are). */
async function answerQuestion(page: Page, origin: string, tree: string, text: string) {
  await page.goto(`${origin}/${tree}/today`);
  await settle(page);
  const week = page.getByRole('region', { name: 'Question of the week' });
  await week.getByRole('button', { name: 'Tell your story' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your answer' });
  await dialog.getByLabel('What do you remember?').fill(text);
  await dialog.getByRole('button', { name: 'Share with the family' }).click();
  await dialog.waitFor({ state: 'detached' });
  await week.getByRole('heading', { name: /answers? this week/ }).waitFor();
}

/**
 * Takes today's quiz. The choices come in an order the server's seed fixes (family, day), and on 7 November that gives the
 * same question every run, so the picture shows a right answer by taking the choice that is right on that day: the second.
 */
const QUIZ_PICK = 1;
/** (The server judges; a different day would only make the picture show "Not quite".) */
async function takeQuiz(page: Page, origin: string, tree: string) {
  await page.goto(`${origin}/${tree}/today`);
  await settle(page);
  const quiz = page.getByRole('region', { name: 'Do you know your family?' });
  const radios = quiz.getByRole('radio');
  if (await radios.count()) await radios.nth(QUIZ_PICK).check();
  await quiz.getByRole('button', { name: 'That is my answer' }).click();
  await quiz.getByRole('status').waitFor();
}

interface Shot { name: string; /** The viewport's height, for a page that wants more than 900 px. */ height?: number; run(page: Page, origin: string): Promise<void> }

/** What the family writes in answer to the week's question on 7 November ("What did the kitchen of your childhood look like?"): invented, and short enough to read in a picture. */
const ANSWERS = {
  steward: 'A wood stove that was never allowed to go out, a yellow oilcloth on the table, and a jar of cardamom buns on the shelf above the sink. It smelled of coffee from five in the morning.',
  relative: 'It was small and always warm. Everyone sat on the bench along the wall, so there was never a chair for the person who was cooking, and my aunt Signe stood and stirred the whole time.',
};

const SHOTS: Shot[] = [
  {
    name: 'tree',
    async run(page, origin) {
      await page.goto(`${origin}/realm?view=dynasty&focus=p0089&sel=p0089`);
      await settle(page);
      await grab(page, 'tree');
    },
  },
  {
    name: 'person',
    async run(page, origin) {
      await page.goto(`${origin}/modern/person/p0061`);
      await settle(page);
      await grab(page, 'person');
    },
  },
  {
    name: 'today',
    height: 1700,
    async run(page, origin) {
      await page.goto(`${origin}/modern/today`);
      await settle(page);
      // The page remembers how far down the reader was (answering the question and the quiz scrolled it): from the top.
      await page.locator('.page').evaluate((el) => el.scrollTo(0, 0));
      await grab(page, 'today');
    },
  },
  {
    name: 'campaign',
    height: 1085,
    async run(page, origin) {
      await page.goto(`${origin}/modern/campaign`);
      await settle(page);
      // A province of the house with an order on it: raise its garrison, then get an attack on a neighbour ready to send.
      await page.locator('.cm-prov[data-mine]').first().click();
      const orders = page.getByRole('complementary', { name: 'Your orders' });
      await orders.getByRole('button', { name: /^Muster \d+ troops? at / }).click();
      await orders.getByRole('region', { name: 'Chronicle of the campaign' }).or(page.getByRole('region', { name: 'Chronicle of the campaign' })).getByText(/mustered/).first().waitFor();
      await orders.getByRole('button', { name: 'Attack' }).first().click();
      await orders.getByLabel(/battle cry/i).fill('For Grandma!');
      await grab(page, 'campaign');
    },
  },
  {
    name: 'book',
    height: 1210,
    async run(page, origin) {
      await page.goto(`${origin}/modern/print?product=book&scope=person&person=p0146`);
      await settle(page);
      await page.locator('.pr-doc').and(page.locator('[data-ready="true"]')).waitFor();
      // The person's own page, the one after the cover and the contents.
      await page.locator('.pr-sheet').nth(2).scrollIntoViewIfNeeded();
      await page.locator('.pr-sheet').nth(2).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await grab(page, 'book');
    },
  },
  {
    name: 'house',
    async run(page, origin) {
      await page.goto(`${origin}/modern/house/lindqvist`);
      await settle(page);
      await grab(page, 'house');
    },
  },
  {
    name: 'atlas',
    async run(page, origin) {
      await page.goto(`${origin}/modern/atlas`);
      await settle(page);
      // Zoom out until every place is in view (the note about places beyond the view goes), as a visitor would with the wheel.
      await page.mouse.move(1100, 450);
      for (let i = 0; i < 8 && (await page.locator('.atlas-scope-btn').count()); i++) {
        await page.mouse.wheel(0, 120);
        await sleep(500);
      }
      await page.mouse.move(0, 0);
      await settle(page);
      await grab(page, 'atlas');
    },
  },
  {
    name: 'arms',
    async run(page, origin) {
      await page.goto(`${origin}/modern/house/lindqvist`);
      await settle(page);
      await page.getByRole('button', { name: 'Edit arms' }).click();
      await page.getByRole('dialog').waitFor();
      await grab(page, 'arms');
    },
  },
  {
    name: 'phone',
    async run(page, origin) {
      const phone = await page.context().browser()!.newContext({
        storageState: await page.context().storageState(),
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        locale: 'en-GB',
        timezoneId: 'UTC',
        reducedMotion: 'reduce',
      });
      try {
        await phone.clock.install({ time: new Date(NOW) });
        const small = await phone.newPage();
        await small.goto(`${origin}/modern/today`);
        await grab(small, 'phone');
      } finally {
        await phone.close();
      }
    },
  },
];

/** A PNG's pixels (8 bits a channel, as Playwright writes them), row after row, and how many bytes a pixel takes. */
function pixelsOf(png: Buffer): { data: Buffer; width: number; height: number; bpp: number } | null {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const bpp = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  if (png[24] !== 8 || !bpp) return null;
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const packed = inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1, to = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? data[to + x - bpp]! : 0;
      const up = y ? data[to + x - stride]! : 0;
      const corner = y && x >= bpp ? data[to + x - stride - bpp]! : 0;
      const p = left + up - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      data[to + x] = (packed[from + x]! + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth : 0)) & 255;
    }
  }
  return { data, width, height, bpp };
}

/** Two pictures of a page that is holding still: the same size, and at most a few pixels apart by at most two shades. */
function asGoodAsSame(a: Buffer, b: Buffer): boolean {
  const p = pixelsOf(a), q = pixelsOf(b);
  if (!p || !q || p.width !== q.width || p.height !== q.height || p.bpp !== q.bpp) return false;
  let apart = 0;
  for (let i = 0; i < p.data.length; i++) {
    if (p.data[i] === q.data[i]) continue;
    if (Math.abs(p.data[i]! - q.data[i]!) > 2 || ++apart > 24) return false;
  }
  return true;
}

/** Takes the PNG of the whole viewport. */
async function grab(page: Page, name: string) {
  await settle(page);
  // No focus ring or pointer left over from the clicks that got here.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  // Some things (the tree centring itself, a map fitting its bounds) move by fractions of a pixel for a while after the
  // network is quiet: take pictures until two in a row are the same. "The same" allows a handful of pixels one shade apart:
  // the graphics card rounds an edge now one way, now the other, on a page that is not moving at all.
  let last: Buffer | undefined;
  for (let i = 0; i < 20; i++) {
    const shot = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    if (last && (shot.equals(last) || asGoodAsSame(last, shot))) { writeFileSync(join(raw, `${name}.png`), shot); return; }
    last = shot;
    await sleep(300);
  }
  throw new Error(`${name} never held still`);
}

/** PNG to WebP: the best quality (cwebp's size search) that stays under MAX_BYTES. */
function toWebp(name: string) {
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, `${name}.webp`);
  sh(`cwebp ${name}`, 'cwebp', ['-quiet', '-m', '6', '-pass', '10', '-sharp_yuv', '-size', String(MAX_BYTES), join(raw, `${name}.png`), '-o', target]);
  if (keepPng) copyFileSync(join(raw, `${name}.png`), join(outDir, `${name}.png`));
  log(`  ${name}.webp  ${(statSync(target).size / 1024).toFixed(1)} kB`);
}

async function startServer(port: number, origin: string, now: string) {
  serverLog = '';
  server = spawn(process.execPath, ['--import', join(root, 'scripts/lib/shot-clock.ts'), 'server/node.ts'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      KINDRED_ORIGIN: origin,
      KINDRED_DATA_DIR: dataDir,
      KINDRED_ACCOUNTS_DB: join(dataDir, 'accounts.db'),
      KINDRED_AI_FAKE: '1',
      KINDRED_JOBS: 'off',
      KINDRED_SETUP_CODE: SETUP_CODE,
      KINDRED_SHOT_NOW: now,
    },
  });
  const keep = (d: Buffer) => { serverLog = (serverLog + d.toString()).slice(-4000); };
  server.stdout!.on('data', keep);
  server.stderr!.on('data', keep);
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}):\n${serverLog}`);
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`the server did not come up:\n${serverLog}`);
}

async function stopServer() {
  const s = server;
  if (!s || s.exitCode !== null) return;
  s.kill('SIGTERM');
  for (let i = 0; i < 40 && s.exitCode === null; i++) await sleep(100);
  if (s.exitCode === null) s.kill('SIGKILL');
}

async function main() {
  const wanted = SHOTS.filter((s) => !only || only.includes(s.name));
  if (only && wanted.length !== only.length) throw new Error(`unknown picture in --only; known: ${SHOTS.map((s) => s.name).join(', ')}`);
  if (spawnSync('cwebp', ['-version'], { encoding: 'utf8' }).status !== 0) throw new Error('cwebp is missing (brew install webp)');

  if (!useDist) {
    log('building the Node server');
    sh('build', process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], { KINDRED_TARGET: 'node' });
  } else if (!existsSync(join(root, 'dist/server/server.js'))) {
    throw new Error('--use-dist, but there is no dist/ (mise run build:node)');
  }

  log('generating the two families');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(raw, { recursive: true });
  sh('gen-realm', process.execPath, ['scripts/gen-realm.ts']);
  sh('gen-modern', process.execPath, ['scripts/gen-modern.ts']);
  // The families' feed is dated back from the day of the pictures, not from today (scripts/seed.ts).
  sh('seed', process.execPath, ['scripts/seed.ts', 'data/seed/realm.json', 'data/seed/modern.json'], { KINDRED_DATA_DIR: dataDir, KINDRED_SEED_NOW: NOW });

  const port = flagValue('--port') ? Number(flagValue('--port')) : await freePort(4632);
  const origin = `http://localhost:${port}`;
  log(`starting the server on ${origin}`);
  await startServer(port, origin, SEASON_START);

  const browser = await chromium.launch({ executablePath, args: ['--hide-scrollbars'] });
  try {
    const open = async () => {
      const context: BrowserContext = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        locale: 'en-GB',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      // The browser's clock follows the server's, so ages, birthdays and "today" read the same on every run.
      await context.clock.install({ time: new Date(NOW) });
      await context.addInitScript(() => {
        try {
          localStorage.setItem('kindred:theme', 'codex');
        } catch { /* a locked-down browser */ }
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => aborts.push(e.message));
      return { context, page };
    };
    const aborts: string[] = [];
    const { context, page } = await open();
    const relative = await open();

    const realm = seed('realm');
    const steward = realm.people.find((p) => p.id === realm.focus)!;
    log('creating the first account');
    await createAccount(page, origin, [steward.given, steward.surname].filter(Boolean).join(' '));
    await sayWhoIAm(page, origin, 'realm');
    await sayWhoIAm(page, origin, 'modern');

    // Four days before the day of the pictures: the steward starts the Campaign, and invites a relative.
    log('turning the Campaign on, and inviting a relative');
    await setGame(page, origin, 'modern', 'The Campaign is on for this family', true);
    const link = await invite(page, origin, 'modern');
    await joinByInvite(relative.page, origin, link, 'Johan Lindqvist', 'modern', 'p0018');

    // The day of the pictures: the season is four days old, and the family has been busy.
    log('moving the server to the day of the pictures');
    await stopServer();
    await startServer(port, origin, NOW);
    log('answering the question, taking the quiz, playing the Campaign');
    await answerQuestion(relative.page, origin, 'modern', ANSWERS.relative);
    await answerQuestion(page, origin, 'modern', ANSWERS.steward);
    await takeQuiz(page, origin, 'modern');
    await page.goto(`${origin}/modern/campaign`);
    await settle(page);
    await page.getByRole('dialog', { name: 'How the Campaign works' }).getByRole('button', { name: 'To the map' }).click({ timeout: 4000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Serve Lindqvist' }).click();
    await page.getByRole('complementary', { name: 'Your orders' }).getByTestId('orders-left').waitFor();
    await relative.context.close();

    for (const shot of wanted) {
      log(`taking ${shot.name}`);
      await page.setViewportSize({ width: VIEWPORT.width, height: shot.height ?? VIEWPORT.height });
      await shot.run(page, origin);
      toWebp(shot.name);
    }
    if (aborts.length) log(`page errors seen: ${aborts.join(' | ')}`);
    await context.close();
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main()
  .then(() => { log('done'); })
  .catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; })
  .finally(async () => {
    await stopServer();
    rmSync(work, { recursive: true, force: true });
  });
