// node --test src/lib/i18n/steady-dates.test.ts — abbreviated months are Kindred's own, because engines disagree on them
// (Node and Workers write "Sept" for British English, Safari "Sep"), and a page drawn on the server must read the same in the
// browser. This keeps the helper right and keeps every abbreviated date going through it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { dateText, formatDate } from './dictionary.ts';

const september = Date.UTC(1959, 8, 10, 12);

test('an abbreviated month reads the same whatever the engine says', () => {
  const day = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } as const;
  assert.equal(dateText(september, 'en', day), '10 Sep 1959');
  assert.equal(dateText(september, 'de', day), '10. Sept. 1959');
  assert.equal(dateText(september, 'af', day), '10 Sep. 1959');
  assert.equal(dateText(september, 'en', { month: 'short', timeZone: 'UTC' }), 'Sep');
  assert.equal(formatDate('1959-09-10', 'en', { month: 'short' }), '10 Sep 1959');
  // The month is the one in the date's own time zone, not the machine's.
  assert.equal(dateText(Date.UTC(2001, 8, 30, 23), 'en', { day: 'numeric', month: 'short', timeZone: 'Pacific/Kiritimati' }), '1 Oct');
});

test('a long month, and a medium date written in numbers, are left to Intl', () => {
  assert.equal(dateText(september, 'en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), '10 September 1959');
  assert.equal(dateText(september, 'de', { dateStyle: 'medium', timeZone: 'UTC' }), '10.09.1959');
  assert.equal(dateText(september, 'en', { dateStyle: 'medium', timeZone: 'UTC' }), '10 Sep 1959');
});

test('no other file abbreviates a month by itself', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !path.endsWith(join('i18n', 'dictionary.ts'))) {
        const text = readFileSync(path, 'utf8');
        // An abbreviated month, or a medium date, handed straight to Intl or to a Date's own formatter.
        for (const line of text.split('\n')) {
          if (/(DateTimeFormat\(|toLocale(Date|Time)?String\()/.test(line) && /month: ['"]short['"]|dateStyle: ['"]medium['"]/.test(line)) offenders.push(`${path}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'use dateText (src/lib/i18n/dictionary.ts) for a date with an abbreviated month');
});

test('a year alone takes the language’s own form', () => {
  assert.equal(formatDate('1890', 'en'), '1890');
  assert.equal(formatDate('1890', 'de'), '1890');
  assert.equal(formatDate('1890', 'ja'), '1890年');
  assert.equal(formatDate('1890', 'zh-Hans'), '1890年');
  assert.equal(formatDate('~1890', 'ja'), '約1890年');
});
