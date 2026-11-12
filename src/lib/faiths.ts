// Every faith the field editor offers, as a table to review: tradition, then its denominations and branches. Their names
// are in the dictionary (src/lib/i18n/areas/faiths.ts, and a file per language), in the words the community uses for
// itself where that is known; this table holds the ids, the search aliases and the sources. Free text is always allowed,
// so anything missing here can still be written down.
//
// Nothing here ranks: the list is shown with the family's own first, then alphabetically by tradition in the reader's
// language, and within a tradition alphabetically.
//
// `source` names what a tradition's names were checked against. Everything named was read online on 2026-11-09, unless
// marked (ref.): those are standard reference works the first draft was written from and were not re-read.
//
// Two placements are judgment calls, made for what is least likely to offend:
// - Messianic Judaism has its own heading. All the major Jewish denominations and Israel's Supreme Court reject it as a form of
//   Judaism, so it cannot sit under Jewish; its adherents call it Jewish, so filing it under Christian overrides their own
//   word, although scholars and most Christians class it as Christian. A heading of its own asserts neither.
// - Bön has its own heading. Bönpo regard it as a religion older than Buddhism in Tibet and current scholarship treats it as an
//   independent tradition. The Dalai Lama counts it as a fifth school beside the four Buddhist ones, and a separate heading
//   contradicts neither view, where filing it under Buddhist would contradict the Bönpo.
//
// A native Afrikaans reader should check: chr-anabaptist quaker, mennonite, hutterite; hindu shaiva, shakta, vaishnava; jain;
// islam sjia and soenniet forms; jewish reform, haredi, hasidic; mandaean; christian-community; old-apostolic; bfp; evangelical; free-religious.
import { foldText } from './address.ts';
import type { Suggestion, Used } from './field-suggest.ts';
import { locales, namesInEveryLanguage, translate, type Key, type Locale } from './i18n/dictionary.ts';

type Row = [id: string, aliases?: readonly string[]];
export interface Tradition { id: string; source: string; faiths: readonly Row[] }

export const FAITH_TRADITIONS: readonly Tradition[] = [
  { id: 'african', source: 'Wikipedia: Religion in South Africa, Traditional African religions; Olupona, African Religions (ref.)', faiths: [
    ['african-general', ['sangoma', 'amadlozi', 'ancestral']],
    ['akan'],
    ['igbo'],
    ['khoisan', ['khoisan']],
    ['kongo'],
    ['serer'],
    ['shona'],
    ['sotho-tswana'],
    ['tsonga'],
    ['venda', ['vhavenda']],
    ['vodun'],
    ['xhosa'],
    ['yoruba', ['yoruba religion', 'isese']],
    ['zulu'],
  ] },
  { id: 'diaspora', source: 'Wikipedia: Afro-American religion, Winti, Spiritual Baptist; Clarke, Encyclopedia of New Religious Movements (ref.)', faiths: [
    ['candomble'],
    ['kumina'],
    ['palo'],
    ['rastafari', ['rasta']],
    ['santeria', ['santeria', 'regla de ocha']],
    ['spiritual-baptist', ['shouter baptist']],
    ['umbanda'],
    ['winti'],
    ['vodou', ['voodoo']],
  ] },
  { id: 'bahai', source: 'Bahá’í-Gemeinde in Deutschland (bahai.de); Bahá’í International Community (ref.)', faiths: [
    ['bahai', ['bahai']],
  ] },
  { id: 'bon', source: 'Yungdrung Bon Monastic Centre (message from the Dalai Lama); Wikipedia: Bon; Karmay, The Treasury of Good Sayings (ref.)', faiths: [
    ['bon', ['bon', 'bön']],
  ] },
  { id: 'buddhist', source: 'af.wikipedia: Boeddhisme; Harvey, An Introduction to Buddhism (ref.)', faiths: [
    ['buddhist'],
    ['chan-zen'],
    ['mahayana'],
    ['navayana'],
    ['nichiren'],
    ['pure-land'],
    ['soka'],
    ['theravada'],
    ['tibetan'],
  ] },
  { id: 'chr-general', source: 'Wikipedia: Christian Community, Evangelical Church in Germany; Melton, Encyclopedia of American Religions (ref.)', faiths: [
    ['christian'],
    ['christian-community', ['christengemeinschaft']],
    ['christian-science'],
    ['evangelical', ['evangelikal']],
    ['protestant'],
  ] },
  { id: 'chr-aic', source: 'Wikipedia: African-initiated church, Nazareth Baptist Church, Legio Maria, Apostles of Johane Marange, International Pentecostal Holiness Church (Africa); Sowetan and City Press reports on the IPHC; Anderson, African Reformation (ref.)', faiths: [
    ['aic'],
    ['aladura'],
    ['marange', ['johane marange', 'maranke']],
    ['celestial'],
    ['cherubim'],
    ['christ-apostolic'],
    ['church-lord'],
    ['ethiopian-type', ['ethiopianism']],
    ['harrist'],
    ['iphc', ['iphc', 'modise', 'international pentecostal holiness church']],
    ['kimbanguist'],
    ['legio-maria', ['maria legio']],
    ['shembe', ['nazareth baptist church', 'nazarite', 'shembe']],
    ['st-engenas', ['st engenas zcc']],
    ['st-john'],
    ['zcc', ['zcc', 'lekganyane']],
    ['zionist'],
  ] },
  { id: 'chr-adventist', source: 'The Church of Jesus Christ of Latter-day Saints (Afrikaans scriptures); adventist.nl and Stellenbosch University records for the Afrikaans; the churches’ own names (ref.)', faiths: [
    ['christadelphian'],
    ['church-of-christ'],
    ['iglesia'],
    ['jw'],
    ['lds', ['mormon']],
    ['sda'],
  ] },
  { id: 'chr-anabaptist', source: 'Deutsche Jahresversammlung der Quäker (quaeker.org); Mennonite World Conference (ref.)', faiths: [
    ['amish'],
    ['brethren'],
    ['hutterite'],
    ['mennonite'],
    ['quaker', ['quaker', 'quäker']],
  ] },
  { id: 'chr-anglican', source: 'Wikipedia: Religion in South Africa; Anglican Communion (ref.)', faiths: [
    ['acsa'],
    ['anglican'],
    ['coe'],
    ['episcopal'],
  ] },
  { id: 'chr-apostolic', source: 'Wikipedia: Old Apostolic Church, New Apostolic Church, Reformed Old Apostolic Church', faiths: [
    ['new-apostolic'],
    ['old-apostolic', ['ou apostoliese']],
    ['reformed-old-apostolic'],
  ] },
  { id: 'chr-baptist', source: 'Bund Evangelisch-Freikirchlicher Gemeinden (befg.de); Wikipedia: Religion in South Africa; Baptist World Alliance (ref.)', faiths: [
    ['baptist'],
    ['baptist-union'],
    ['befg'],
    ['southern-baptist'],
  ] },
  { id: 'chr-catholic', source: 'Wikipedia: Eastern Catholic Churches; Katholisches Bistum der Alt-Katholiken in Deutschland (alt-katholisch.de); Annuario Pontificio (ref.)', faiths: [
    ['armenian-catholic'],
    ['catholic', ['catholic', 'katholisch', 'katoliek']],
    ['chaldean'],
    ['coptic-catholic'],
    ['greek-catholic'],
    ['maronite'],
    ['melkite'],
    ['old-catholic', ['altkatholisch']],
    ['syriac-catholic'],
    ['syro-malabar'],
    ['ukr-greek-catholic'],
  ] },
  { id: 'chr-free', source: 'Wikipedia: Evangelical Church in Germany (evangelisch and evangelikal); Verbum et Ecclesia (Morawiese Kerk); Vereinigung Evangelischer Freikirchen (ref.)', faiths: [
    ['free-church'],
    ['feg'],
    ['moravian', ['broederkerk']],
    ['non-denominational'],
    ['plymouth'],
  ] },
  { id: 'chr-lutheran', source: 'Selbständige Evangelisch-Lutherische Kirche (selk.de); Wikipedia: Evangelical Church in Germany; Lutheran World Federation (ref.)', faiths: [
    ['elca-sa'],
    ['evangelisch', ['evangelisch', 'evangelical german', 'german evangelical', 'landeskirche']],
    ['lutheran', ['lutherisch']],
    ['selk'],
    ['united', ['uniert']],
  ] },
  { id: 'chr-methodist', source: 'Evangelisch-methodistische Kirche (emk.de); Wikipedia: Religion in South Africa; World Methodist Council (ref.)', faiths: [
    ['emk'],
    ['mcsa'],
    ['methodist'],
    ['salvation-army'],
    ['wesleyan'],
  ] },
  { id: 'chr-eastern', source: 'Wikipedia: Autocephaly; the churches’ own names (ref.)', faiths: [
    ['albanian'],
    ['antiochian'],
    ['bulgarian'],
    ['eastern-orthodox'],
    ['georgian'],
    ['greek-orthodox'],
    ['macedonian'],
    ['old-believers'],
    ['romanian'],
    ['russian'],
    ['serbian'],
    ['ukrainian'],
  ] },
  { id: 'chr-oriental', source: 'Wikipedia: Oriental Orthodox Churches; the churches’ own names (ref.)', faiths: [
    ['armenian'],
    ['assyrian'],
    ['coptic'],
    ['eritrean'],
    ['ethiopian'],
    ['malankara'],
    ['syriac'],
  ] },
  { id: 'chr-pentecostal', source: 'The Apostolic Faith Mission of South Africa (afm-ags.org); Bund Freikirchlicher Pfingstgemeinden (bfp.de); Full Gospel Church of God (fgcsa.co.za); Pentecostal World Fellowship (ref.)', faiths: [
    ['afm', ['ags', 'afm']],
    ['aog'],
    ['bfp'],
    ['charismatic'],
    ['church-of-god'],
    ['church-of-pentecost'],
    ['foursquare'],
    ['full-gospel', ['full gospel', 'volle evangelie', 'volles evangelium']],
    ['pentecostal'],
    ['rccg', ['rccg']],
    ['rhema'],
    ['winners'],
  ] },
  { id: 'chr-reformed', source: 'The churches’ own sites (ngkerk.org.za, nhka.org, gksa.org.za); Library of Congress (VGKSA); Wikipedia: Religion in South Africa, Waldensian Evangelical Church, Dutch Reformed Church in Africa, Free Reformed Churches of South Africa, Afrikaans Protestant Church', faiths: [
    ['apk', ['apk', 'afrikaans protestant church']],
    ['church-of-scotland'],
    ['congregational'],
    ['drca', ['ngka']],
    ['frcsa'],
    ['gksa', ['dopper', 'doppers', 'gksa', 'reformed churches in south africa']],
    ['huguenot'],
    ['ng', ['ng kerk', 'ngk']],
    ['nhk', ['nhk', 'nhka', 'hervormde kerk']],
    ['pkn', ['pkn', 'nederlandse hervormde kerk', 'nederlands hervormd', 'dutch reformed netherlands']],
    ['pca'],
    ['presbyterian'],
    ['reformed', ['calvinist', 'evangelisch-reformiert']],
    ['rca'],
    ['uccsa', ['uccsa']],
    ['upcsa', ['upcsa']],
    ['urcsa', ['vgk', 'vgksa', 'urcsa']],
    ['waldensian', ['waldensian']],
  ] },
  { id: 'east-asian', source: 'af.wikipedia: Godsdiens, Konfusianisme; Oxford Handbook of Chinese Religions (ref.)', faiths: [
    ['caodai', ['cao dai']],
    ['cheondoism', ['cheondogyo']],
    ['chinese-folk'],
    ['confucian'],
    ['falun', ['falun gong']],
    ['hoa-hao', ['hoa hao']],
    ['muism'],
    ['shinto'],
    ['taoist', ['daoist']],
    ['tenrikyo'],
  ] },
  { id: 'hindu', source: 'Wikipedia: Hindu denominations; af.wikipedia: Hindoeïsme; Flood, An Introduction to Hinduism (ref.)', faiths: [
    ['arya-samaj'],
    ['hindu'],
    ['iskcon'],
    ['lingayat'],
    ['shaiva'],
    ['shakta'],
    ['smarta'],
    ['swaminarayan'],
    ['vaishnava'],
  ] },
  { id: 'indigenous', source: 'Planet Wissen and SRF (German usage for Indigenous peoples); Haus der Kunst, Karrabing glossary; Harvey, Indigenous Religions: A Companion (ref.)', faiths: [
    ['aboriginal', ['aborigines']],
    ['andean'],
    ['first-nations'],
    ['hawaiian'],
    ['inuit'],
    ['maori'],
    ['mesoamerican'],
    ['native-american'],
    ['native-american-church'],
    ['sami'],
    ['shamanic'],
  ] },
  { id: 'islam', source: 'bpb Islam-Lexikon: Alawiten; Wikipedia: Deobandi movement, Alawites; Oxford Dictionary of Islam (ref.)', faiths: [
    ['ahmadi', ['ahmadiyya']],
    ['alawite'],
    ['alevi', ['alevite']],
    ['barelvi', ['barelwi']],
    ['deobandi'],
    ['hanafi'],
    ['hanbali'],
    ['ibadi'],
    ['ismaili'],
    ['maliki'],
    ['muslim', ['islam']],
    ['quranist', ['qurani', 'koraniten']],
    ['salafi'],
    ['shafii', ['shafi']],
    ['shia', ['shiite']],
    ['sufi'],
    ['sunni'],
    ['twelver'],
    ['zaydi'],
  ] },
  { id: 'jain', source: 'af.wikipedia: Godsdiens (Djainisme); Dundas, The Jains (ref.)', faiths: [
    ['digambara'],
    ['jain'],
    ['svetambara', ['svetambara', 'shvetambara']],
  ] },
  { id: 'jewish', source: 'bpb: Strömungen des Judentums in Deutschland; Encyclopaedia Judaica (ref.)', faiths: [
    ['ashkenazi'],
    ['beta-israel'],
    ['conservative'],
    ['haredi'],
    ['hasidic'],
    ['humanistic-jewish'],
    ['jewish'],
    ['karaite'],
    ['mizrahi'],
    ['modern-orthodox'],
    ['orthodox-jewish'],
    ['reconstructionist'],
    ['reform', ['progressive']],
    ['sephardi'],
  ] },
  { id: 'messianic', source: 'My Jewish Learning, Who Are Messianic “Jews”?; bartehrman.com; Wikipedia: Messianic Judaism', faiths: [
    ['messianic', ['hebrew christian']],
  ] },
  { id: 'near-eastern', source: 'Wikipedia: Yazidis; Oxford Handbook of Religious Diversity (ref.)', faiths: [
    ['druze'],
    ['mandaean'],
    ['samaritan'],
    ['yarsan'],
    ['yazidi', ['ezidi', 'yezidi']],
    ['zoroastrian', ['parsi']],
  ] },
  { id: 'none', source: 'Pew Research Center, Religious “Nones” in America (2024)', faiths: [
    ['agnostic'],
    ['atheist'],
    ['freethinker', ['freidenker']],
    ['humanist'],
    ['no-religion', ['none', 'keine', 'konfessionslos', 'konfessionsfrei', 'nothing in particular']],
    ['prefer-not'],
    ['spiritual'],
    ['unknown'],
  ] },
  { id: 'pagan', source: 'Clarke, Encyclopedia of New Religious Movements', faiths: [
    ['anthroposophy'],
    ['asatru', ['asatru']],
    ['druidry'],
    ['hellenic', ['hellenismos']],
    ['new-age'],
    ['pagan', ['paganism']],
    ['rodnovery', ['slavic']],
    ['spiritism'],
    ['theosophy'],
    ['wicca'],
  ] },
  { id: 'sikh', source: 'Singh, The Oxford Handbook of Sikh Studies (ref.)', faiths: [
    ['khalsa'],
    ['namdhari'],
    ['nanakpanthi'],
    ['sikh', ['sikhism']],
  ] },
  { id: 'unitarian', source: 'de.wikipedia: Unitarier', faiths: [
    ['free-religious'],
    ['unitarian-christian'],
    ['unitarian'],
  ] },
];

interface Entry { row: Row; tradition: Tradition }
const ENTRIES: readonly Entry[] = FAITH_TRADITIONS.flatMap((tradition) => tradition.faiths.map((row) => ({ row, tradition })));
const nameKey = (e: Entry) => `faith.name.${e.row[0]}` as Key;
const traditionKey = (t: Tradition) => `faith.tradition.${t.id}` as Key;
/** A faith's name in a language (English where that language has not named it yet). */
const faithName = (e: Entry, locale: Locale) => translate(locale, nameKey(e));
/** A tradition's name in a language. */
const traditionName = (t: Tradition, locale: Locale) => translate(locale, traditionKey(t));
/** Every name a faith answers to in the languages this page has, and its aliases. */
const allNames = (e: Entry) => [...namesInEveryLanguage(nameKey(e)), ...(e.row[1] ?? [])];

/**
 * The faiths for a text box: the family's own first, then every match by tradition, alphabetically in the reader's
 * language. What is typed narrows the list and never reorders it, and a family's own wording stays offered.
 */
export function faithSuggestions(query: string, locale: Locale, used: readonly Used[] = []): Suggestion[] {
  const q = foldText(query);
  const collator = new Intl.Collator(locales[locale]);
  const counts = new Map<Entry, number>();
  const ownWords: Used[] = [];
  for (const u of used) {
    const f = foldText(u.value);
    if (!f) continue;
    const e = ENTRIES.find((x) => allNames(x).some((n) => foldText(n) === f));
    if (e) counts.set(e, (counts.get(e) ?? 0) + u.n); else ownWords.push(u);
  }
  const words = (e: Entry) => [...allNames(e), ...namesInEveryLanguage(traditionKey(e.tradition))];
  const matches = (e: Entry) => !q || words(e).some((n) => { const f = foldText(n); return f.startsWith(q) || f.includes(` ${q}`); });
  const hintOf = (e: Entry) => {
    if (!q) return undefined;
    const name = foldText(faithName(e, locale));
    if (name.startsWith(q) || name.includes(` ${q}`)) return undefined;
    return allNames(e).find((n) => foldText(n).startsWith(q));
  };

  const own: Suggestion[] = [
    ...[...counts].filter(([e]) => matches(e)).sort((a, b) => b[1] - a[1] || collator.compare(faithName(a[0], locale), faithName(b[0], locale)))
      .map(([e]): Suggestion => ({ value: faithName(e, locale), label: faithName(e, locale), used: true })),
    ...ownWords.filter((u) => !q || foldText(u.value).includes(q)).sort((a, b) => b.n - a.n || collator.compare(a.value, b.value))
      .map((u): Suggestion => ({ value: u.value, label: u.value, used: true })),
  ];
  const rest = FAITH_TRADITIONS
    .map((t) => ({ t, name: traditionName(t, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name))
    .flatMap(({ t, name }) => ENTRIES
      .filter((e) => e.tradition === t && !counts.has(e) && matches(e))
      .sort((a, b) => collator.compare(faithName(a, locale), faithName(b, locale)))
      .map((e): Suggestion => { const hint = hintOf(e); return { value: faithName(e, locale), label: faithName(e, locale), group: name, ...(hint && { hint }) }; }));
  return [...own, ...rest];
}
