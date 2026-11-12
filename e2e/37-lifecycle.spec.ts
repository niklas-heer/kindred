// Journey 37: the lifecycle of quiet families (docs/hosting-many-families.md, "Lifecycle"). The operator makes a family; the
// journey makes it look long quiet (the daily jobs are off in the journeys, and a year cannot pass, so its lifecycle rows are
// written into the accounts database as the job writes them) with the steward of the main family as its steward. She sees the
// warning at the bottom of its pages and hides it for 30 days; once it is read-only she reads why on the bar and turns it back on
// with one click. In the console's Families tab the operator sees the Lifecycle section, its dry run and the settings, and turns
// it off again. Leaves the server as it found it, but for the new family with no members (as journeys 27 and 33 leave theirs).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

const TREE = 'the-quietbys';
const DAY = 86_400_000;
const accountsDb = () => new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = accountsDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

test('a quiet family: the warning, read-only and turned back on by its steward, and the console’s Lifecycle section', async ({ page }) => {
  await openFamily(page);

  // The operator makes a family for someone.
  await page.goto('/operator');
  await settled(page);
  const make = page.getByRole('region', { name: 'Make a family for someone' });
  await make.getByLabel('Name', { exact: true }).fill('The Quietbys');
  await make.getByLabel('Its first steward').fill('Quinn Quietby');
  await make.getByRole('button', { name: 'Make the family and the link' }).click();
  await expect(page.getByLabel('Invitation link for Quinn Quietby')).toBeVisible();

  // Thirteen months later, as the daily run leaves it: the lifecycle on, the family warned, its stewards told. The main family's
  // steward (this browser's account, the server's first) stewards it.
  const now = Date.now();
  const me = withDb((db) => {
    const { id } = db.prepare('SELECT id FROM user WHERE operator = 1 ORDER BY created LIMIT 1').get() as { id: string };
    db.prepare("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', ?)").run(id, TREE, now);
    db.prepare("INSERT INTO instance_setting (key, value, updated_at) VALUES ('lifecycle', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ on: true, warnMonths: 12, readOnlyMonths: 18, deleteMonths: 24, autoDelete: false }), now);
    db.prepare("INSERT INTO family_lifecycle (tree, stage, quiet_since, warned_at) VALUES (?, 'warned', ?, ?)").run(TREE, now - 400 * DAY, now - DAY);
    db.prepare("INSERT INTO steward_notice (tree, kind, vars, at) VALUES (?, 'lifecycle_warning', '{}', ?)").run(TREE, now - DAY);
    return id;
  });

  try {
    await page.goto(`/${TREE}`);
    await settled(page);
    const warning = page.getByRole('region', { name: 'A quiet family' });
    await expect(warning.getByText('Nobody had opened this family for 12 months')).toBeVisible();
    await expect(warning.getByText(/becomes read-only on .+ and may be deleted from/)).toBeVisible();
    await expect(warning.getByRole('link', { name: 'GEDCOM' })).toHaveAttribute('href', `/api/export/${TREE}?format=gedcom`);
    await checkAxe(page, 'lifecycle warning');
    await warning.getByRole('button', { name: 'Hide for 30 days' }).click();
    await expect(warning).toBeHidden();
    await page.reload();
    await settled(page);
    await expect(page.getByRole('region', { name: 'A quiet family' })).toBeHidden();

    // Six months on: read-only, by the lifecycle.
    withDb((db) => {
      db.prepare("UPDATE family_lifecycle SET stage = 'readonly', readonly_at = ? WHERE tree = ?").run(now - DAY, TREE);
      db.prepare(`UPDATE family_admin SET status = 'suspended', closed = 0, status_reason = 'Nobody visited.', status_ground = 'other', status_at = ?,
        status_by = 'lifecycle' WHERE tree = ?`).run(now - DAY, TREE);
    });
    await page.goto(`/${TREE}`);
    await settled(page);
    const bar = page.getByRole('status').filter({ hasText: 'This family has been read-only since' });
    await expect(bar.getByText(/because nobody visited for 18 months\. A steward can turn it back on\./)).toBeVisible();
    await checkAxe(page, 'lifecycle read-only bar');
    await bar.getByRole('button', { name: 'Turn it back on' }).click();
    await expect(page.getByText('This family has been read-only since')).toBeHidden();
    expect(withDb((db) => db.prepare('SELECT status, status_by FROM family_admin WHERE tree = ?').get(TREE))).toMatchObject({ status: 'active', status_by: null });

    // The console: the section, its dry run, and the switch.
    await page.goto('/operator');
    await settled(page);
    const section = page.getByRole('region', { name: /^Lifecycle/ });
    await expect(section.getByText('If it ran now')).toBeVisible();
    await expect(section.getByText('No family is in the lifecycle.')).toBeVisible();
    await expect(section.getByLabel('Warn after (months)')).toHaveValue('12');
    await checkAxe(page, 'operator lifecycle');
    const toggle = section.getByRole('switch', { name: 'Look after quiet families' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Saved.')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  } finally {
    withDb((db) => {
      db.prepare('DELETE FROM membership WHERE user = ? AND tree = ?').run(me, TREE);
      db.prepare("DELETE FROM instance_setting WHERE key = 'lifecycle'").run();
      db.prepare('DELETE FROM family_lifecycle WHERE tree = ?').run(TREE);
      db.prepare('DELETE FROM steward_notice_dismissal WHERE tree = ?').run(TREE);
    });
  }
});
