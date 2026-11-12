// The record of processing activities (GDPR Art. 30) this server's operator keeps, generated from how the server is set up: who
// runs it, what Kindred processes and why, for whom, who receives it (subprocessors.ts), how long it is kept (retention, the
// history's years) and the technical measures Kindred takes. The operator downloads it from the console as Markdown (to read,
// edit and file) or JSON (to process), and completes what Kindred cannot know (their own address, their DPO, their host when it
// is not Cloudflare). It is written in English, as such records usually are; it is not legal advice (docs/gdpr.md).
import { instanceSettings } from '../operator/settings.server.ts';
import { configuration, subprocessorsOf, type Configuration } from './subprocessors.ts';
import { ACCOUNT_MONTHS, RECORD_YEARS, STALE_DAYS, retentionMode } from './retention.server.ts';
import { keepYears } from '../history.server.ts';
import type { Subprocessor } from '../operator/shared.ts';

export interface Activity {
  name: string;
  /** 'controller' for the operator's own processing, 'processor' for what they do on a family's instructions. */
  role: 'controller' | 'processor';
  purposes: string;
  legalBasis: string;
  subjects: string;
  data: string;
  recipients: string;
  transfers: string;
  retention: string;
}

export interface ProcessingRecord {
  format: 'kindred-art30-record';
  version: 1;
  generated: string;
  controller: { name: string; contact: string; note: string };
  activities: Activity[];
  subprocessors: Subprocessor[];
  measures: string[];
  notes: string[];
}

const FROM_CONFIG = (c: Configuration, subs: Subprocessor[]) => ({
  recipients: subs.length ? subs.map((s) => s.name).join('; ') : 'None besides the operator.',
  transfers: subs.some((s) => s.where !== 'DE' && s.where !== 'EU')
    ? 'Possible transfers to third countries through the subprocessors listed (check each one\'s safeguards, e.g. the EU-US Data Privacy Framework or standard contractual clauses).'
    : 'None known.',
  ai: c.aiProviders.length > 0,
});

/** The record, as data. */
export async function processingRecord(now = new Date(), env: (name: string) => string | undefined = (n) => process.env[n]): Promise<ProcessingRecord> {
  const [s, c, mode] = await Promise.all([instanceSettings(), configuration(), retentionMode()]);
  const subs = subprocessorsOf(c);
  const cfg = FROM_CONFIG(c, subs);
  const historyYears = keepYears(env);
  const activities: Activity[] = [
    {
      name: 'Accounts and sign-in', role: 'controller',
      purposes: 'Letting members sign in to their families; keeping sessions; protecting accounts (throttling, proofs before risky steps).',
      legalBasis: 'Art. 6(1)(b) (the service the member asked for); Art. 6(1)(f) for security.',
      subjects: 'Members of the families on this server, operators, people who asked to join.',
      data: 'Name, email address (when given), passkey public keys, password hashes and second factors (when those sign-ins are on), sessions, last visit, language.',
      recipients: c.workers ? 'Cloudflare (hosting).' : 'The operator\'s host.',
      transfers: cfg.transfers,
      retention: `While the account exists. Accounts without a family, unseen for ${ACCOUNT_MONTHS} months, are deleted by the retention job (${mode === 'delete' ? 'deleting' : 'currently reporting only'}). Sessions end after 30 days without use.`,
    },
    {
      name: 'Family trees (on behalf of each family)', role: 'processor',
      purposes: 'Keeping each family\'s tree, stories, pictures and conversations as the family\'s stewards direct.',
      legalBasis: 'For the family: usually the household exemption (Art. 2(2)(c)); otherwise the family\'s own basis. For the operator: the processing agreement with each family (Art. 28).',
      subjects: 'The people in each family\'s records, living and dead (relatives who are not members among them), and its members.',
      data: 'Names, dates and places of life events, relationships, pictures, stories, contact details the family adds; possibly special categories (health, religion) the family writes down (Art. 9).',
      recipients: cfg.recipients,
      transfers: cfg.transfers,
      retention: `Until the family deletes it, or the operator deletes the family. The change history is kept ${historyYears ? `${historyYears} years` : 'without limit'} (KINDRED_HISTORY_YEARS).`,
    },
    {
      name: 'Requests to the operator', role: 'controller',
      purposes: 'Answering requests for a family and requests from people about data about them.',
      legalBasis: 'Art. 6(1)(c) (answering data requests is a legal duty); Art. 6(1)(b) or (f) for family requests.',
      subjects: 'Anyone who uses the public forms.',
      data: 'Name, email address, the family named, the message, a short hash of the network (to brake floods).',
      recipients: c.turnstile ? 'Cloudflare Turnstile (bot check).' : 'None.',
      transfers: c.turnstile ? 'Possible (Cloudflare, global network).' : 'None.',
      retention: `Declined family requests ${STALE_DAYS} days after the decision; answered data requests ${RECORD_YEARS} years after the answer.`,
    },
    {
      name: 'Usage statistics', role: 'controller',
      purposes: 'Counting how families use the server, to run and size it.',
      legalBasis: 'Art. 6(1)(f) (legitimate interest in running the service); families can switch their statistics off.',
      subjects: 'Members and guests.',
      data: 'Daily counts per family; a one-way hash per member for active counts. No account ids.',
      recipients: 'None.', transfers: 'None.', retention: 'Three years.',
    },
    {
      name: 'Operator audit log and acceptance records', role: 'controller',
      purposes: 'Accountability for what operators did; proof that terms and the processing agreement were accepted.',
      legalBasis: 'Art. 6(1)(c) and (f).',
      subjects: 'Operators; stewards who accepted the terms.',
      data: 'Account id and name, action, family id, time; the version of the text accepted.',
      recipients: 'None.', transfers: 'None.',
      retention: `The audit log is kept while the server runs; acceptance records ${RECORD_YEARS} years after the account is gone.`,
    },
  ];
  if (cfg.ai) activities.push({
    name: 'AI features (on behalf of each family that turns them on)', role: 'processor',
    purposes: 'The assistant, painted portraits and background tasks a family\'s stewards switch on.',
    legalBasis: 'As the family trees; the AI provider is a subprocessor.',
    subjects: 'People in the family\'s records; members who chat with the assistant.',
    data: 'The parts of the family\'s records a request needs; chat messages; pictures a member sends.',
    recipients: subs.filter((x) => x.purpose === 'ai').map((x) => x.name).join('; '),
    transfers: 'To the providers listed (United States).',
    retention: 'Conversations stay until the member or the family deletes them; providers keep requests as their own terms say.',
  });
  if (c.push) activities.push({
    name: 'Reminders and notifications', role: 'processor',
    purposes: 'Pushes members asked for: birthdays, news of the week, new posts.',
    legalBasis: 'Consent of the member, given on the device (Art. 6(1)(a)).',
    subjects: 'Members who switched pushes on.',
    data: 'The device\'s push subscription; the push text, written when it is sent and not stored.',
    recipients: 'The browsers\' push services.', transfers: 'Possible.', retention: 'Until the member switches it off or signs out on that device.',
  });
  if (c.githubArchive) activities.push({
    name: 'Nightly archive to GitHub', role: 'processor',
    purposes: 'A readable copy of the family\'s records, as the family set up.',
    legalBasis: 'As the family trees.', subjects: 'People in that family\'s records.', data: 'The family\'s records as Markdown.',
    recipients: 'GitHub (a private repository the family or operator owns).', transfers: 'United States.',
    retention: 'In the repository\'s history until it is rewritten or deleted; erasure in Kindred does not reach past commits.',
  });
  return {
    format: 'kindred-art30-record', version: 1, generated: now.toISOString(),
    controller: { name: s.instanceName || '(the operator of this server: add name and address)', contact: s.contactEmail || '(add a contact address)', note: 'Add your postal address and, if you have one, your data protection officer.' },
    activities,
    subprocessors: subs,
    measures: [
      'Sign-in by passkeys (and, where enabled, passwords hashed with PBKDF2-SHA-256, second factors); sessions stored only as hashes.',
      'A fresh proof of identity before deleting a family, an account or a person.',
      'Roles per family (viewer to steward); every server function checks the role on the server.',
      'Share links can protect living people; guests never see private fields.',
      'Each family in its own database; the operator console shows how a family is run, never its records.',
      'Secrets sealed with the server\'s key (KINDRED_SECRET); AI keys never sent to the browser.',
      'Security headers and a Content Security Policy; form throttling and an optional bot check.',
      'Backups as the deployment provides them (see docs/gdpr.md, "Backups").',
    ],
    notes: [
      'Generated by Kindred from this server\'s configuration. Check and complete it; it is not legal advice.',
      'Families keeping their own tree are usually within the household exemption; the operator is never (docs/gdpr.md).',
    ],
  };
}

const esc = (s: string) => s.replace(/\|/g, '\\|');

/** The record as Markdown, for the operator to read, complete and file. */
export function recordMarkdown(r: ProcessingRecord): string {
  const out: string[] = [
    '# Record of processing activities (GDPR Art. 30)', '',
    `Generated ${r.generated} by Kindred. ${r.notes.join(' ')}`, '',
    '## Controller', '', `- Name: ${r.controller.name}`, `- Contact: ${r.controller.contact}`, `- ${r.controller.note}`, '',
    '## Processing activities', '',
  ];
  for (const a of r.activities) {
    out.push(`### ${a.name}`, '', `- Role: ${a.role}`, `- Purposes: ${a.purposes}`, `- Legal basis: ${a.legalBasis}`, `- Data subjects: ${a.subjects}`,
      `- Personal data: ${a.data}`, `- Recipients: ${a.recipients}`, `- Transfers to third countries: ${a.transfers}`, `- Retention: ${a.retention}`, '');
  }
  out.push('## Subprocessors', '');
  if (!r.subprocessors.length) out.push('None besides the operator\'s own host.', '');
  else {
    out.push('| Name | Purpose | Where | Privacy |', '| --- | --- | --- | --- |');
    for (const s of r.subprocessors) out.push(`| ${esc(s.name)} | ${s.purpose} | ${s.where} | ${s.url} |`);
    out.push('');
  }
  out.push('## Technical and organisational measures (Art. 32)', '', ...r.measures.map((m) => `- ${m}`), '');
  return out.join('\n');
}
