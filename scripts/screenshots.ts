// The pictures in README.md (mise run screenshots): builds the Node server, fills a scratch data folder with the two
// invented families (scripts/gen-realm.ts, gen-modern.ts and seed.ts), starts the server on it with the fake AI
// provider and no daily jobs, signs up the first steward with a virtual passkey, says who "me" is in each family, and
// drives the installed Brave (KINDRED_E2E_BROWSER names another Chromium, as for mise run e2e) to take the pictures
// into docs/images/. Nothing here reaches the network beyond this machine, and no real family is read.
//   node scripts/screenshots.ts [--use-dist] [--only tree,person,...] [--out <folder>]
//   --use-dist  skip the build and serve the dist/ that is already there (built with KINDRED_TARGET=node)
//   --only      take just these pictures (names as in SHOTS below)
//   --out       write the pictures here instead of docs/images/
// Screenshots are PNG from Playwright; cwebp (brew install webp) makes the WebP files, at the best quality that fits
// MAX_BYTES. The scratch folder and the server are removed again whether or not a step fails.
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
process.chdir(root);

const args = process.argv.slice(2);
const useDist = args.includes('--use-dist');
const flagValue = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = flagValue('--only')?.split(',');
const outDir = resolve(flagValue('--out') ?? 'docs/images');

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const executablePath = process.env.KINDRED_E2E_BROWSER || (existsSync(BRAVE) ? BRAVE : undefined);
const SETUP_CODE = 'SHOT-TEST-SETUP-CODE';
/** The size every picture is taken at: CSS pixels, at twice the density. */
const VIEWPORT = { width: 1440, height: 900 };
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
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
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

/** Opens a family's tree and answers "Who are you in this family?" with the person the seed opens on. */
async function sayWhoIAm(page: Page, origin: string, tree: string) {
  const s = seed(tree);
  const me = s.people.find((p) => p.id === s.focus)!;
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

interface Shot { name: string; run(page: Page, origin: string): Promise<void> }

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
      await page.goto(`${origin}/realm/person/p0001`);
      await grab(page, 'person');
    },
  },
  {
    name: 'house',
    async run(page, origin) {
      await page.goto(`${origin}/modern/house/lindqvist`);
      await grab(page, 'house');
    },
  },
  {
    name: 'atlas',
    async run(page, origin) {
      await page.goto(`${origin}/modern/atlas`);
      await settle(page);
      await page.getByRole('button', { name: /Show all/ }).click();
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
        await phone.clock.install({ time: new Date('2026-11-07T12:00:00Z') });
        const small = await phone.newPage();
        await small.goto(`${origin}/modern?focus=p0084`);
        await grab(small, 'phone');
      } finally {
        await phone.close();
      }
    },
  },
];

/** Takes the PNG of the whole viewport. */
async function grab(page: Page, name: string) {
  await settle(page);
  // No focus ring or pointer left over from the clicks that got here.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  // Some things (the tree centring itself, a map fitting its bounds) move by fractions of a pixel for a while after the
  // network is quiet: take pictures until two in a row are identical.
  let last: Buffer | undefined;
  for (let i = 0; i < 20; i++) {
    const shot = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    if (last && shot.equals(last)) { writeFileSync(join(raw, `${name}.png`), shot); return; }
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
  log(`  ${name}.webp  ${(statSync(target).size / 1024).toFixed(1)} kB`);
}

async function startServer(port: number, origin: string) {
  server = spawn(process.execPath, ['server/node.ts'], {
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
  sh('seed', process.execPath, ['scripts/seed.ts', 'data/seed/realm.json', 'data/seed/modern.json'], { KINDRED_DATA_DIR: dataDir });

  const port = await freePort(5361);
  const origin = `http://localhost:${port}`;
  log(`starting the server on ${origin}`);
  await startServer(port, origin);

  const browser = await chromium.launch({ executablePath, args: ['--hide-scrollbars'] });
  try {
    const context: BrowserContext = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      locale: 'en-GB',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    // The day the invented modern family is set on (gen-modern.ts), so ages and "today" read the same on every run.
    await context.clock.install({ time: new Date('2026-11-07T12:00:00Z') });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('kindred:theme', 'codex');
      } catch { /* a locked-down browser */ }
    });
    const page = await context.newPage();
    const aborts: string[] = [];
    page.on('pageerror', (e) => aborts.push(e.message));

    const realm = seed('realm');
    const steward = realm.people.find((p) => p.id === realm.focus)!;
    log('creating the first account');
    await createAccount(page, origin, [steward.given, steward.surname].filter(Boolean).join(' '));
    await sayWhoIAm(page, origin, 'realm');
    await sayWhoIAm(page, origin, 'modern');

    for (const shot of wanted) {
      log(`taking ${shot.name}`);
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
