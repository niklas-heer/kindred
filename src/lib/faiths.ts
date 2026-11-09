// Every faith the field editor offers, as a table to review: tradition, then its denominations and branches, each
// named in English, German and Afrikaans, in the words the community uses for itself where that is known. Free text is
// always allowed, so anything missing here can still be written down.
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

export type FaithLocale = 'en' | 'de' | 'af';
type Row = [id: string, en: string, de: string, af: string, aliases?: readonly string[]];
export interface Tradition { id: string; en: string; de: string; af: string; source: string; faiths: readonly Row[] }

export const FAITH_TRADITIONS: readonly Tradition[] = [
  { id: 'african', en: 'African traditional religions', de: 'Afrikanische traditionelle Religionen', af: 'Afrikaanse tradisionele godsdienste', source: 'Wikipedia: Religion in South Africa, Traditional African religions; Olupona, African Religions (ref.)', faiths: [
    ['african-general', 'African traditional religion', 'Afrikanische traditionelle Religion', 'Afrikaanse tradisionele godsdiens', ['sangoma', 'amadlozi', 'ancestral']],
    ['akan', 'Akan traditional religion', 'Traditionelle Religion der Akan', 'Tradisionele godsdiens van die Akan'],
    ['igbo', 'Odinani (Igbo)', 'Odinani (Igbo)', 'Odinani (Igbo)'],
    ['khoisan', 'Khoe and San traditional belief', 'Traditioneller Glaube der Khoe und San', 'Tradisionele geloof van die Khoe en San', ['khoisan']],
    ['kongo', 'Kongo traditional religion (Bukongo)', 'Traditionelle Religion der Kongo (Bukongo)', 'Tradisionele godsdiens van die Kongo (Bukongo)'],
    ['serer', 'Serer religion (A ƭat Roog)', 'Serer-Religion (A ƭat Roog)', 'Serer-godsdiens (A ƭat Roog)'],
    ['shona', 'Chivanhu (Shona)', 'Chivanhu (Shona)', 'Chivanhu (Shona)'],
    ['sotho-tswana', 'Sotho-Tswana traditional belief (Badimo)', 'Traditioneller Glaube der Sotho-Tswana (Badimo)', 'Tradisionele geloof van die Sotho-Tswana (Badimo)'],
    ['tsonga', 'Tsonga traditional belief', 'Traditioneller Glaube der Tsonga', 'Tradisionele geloof van die Tsonga'],
    ['venda', 'Venda traditional belief', 'Traditioneller Glaube der Venda', 'Tradisionele geloof van die Venda', ['vhavenda']],
    ['vodun', 'Vodun (West Africa)', 'Vodun (Westafrika)', 'Vodun (Wes-Afrika)'],
    ['xhosa', 'Xhosa traditional belief', 'Traditioneller Glaube der Xhosa', 'Tradisionele geloof van die Xhosa'],
    ['yoruba', 'Ìṣẹ̀ṣe (Yoruba)', 'Ìṣẹ̀ṣe (Yoruba)', 'Ìṣẹ̀ṣe (Yoruba)', ['yoruba religion', 'isese']],
    ['zulu', 'Zulu traditional belief', 'Traditioneller Glaube der Zulu', 'Tradisionele geloof van die Zulu'],
  ] },
  { id: 'diaspora', en: 'African diaspora religions', de: 'Religionen der afrikanischen Diaspora', af: 'Godsdienste van die Afrikaanse diaspora', source: 'Wikipedia: Afro-American religion, Winti, Spiritual Baptist; Clarke, Encyclopedia of New Religious Movements (ref.)', faiths: [
    ['candomble', 'Candomblé', 'Candomblé', 'Candomblé'],
    ['kumina', 'Kumina', 'Kumina', 'Kumina'],
    ['palo', 'Palo', 'Palo', 'Palo'],
    ['rastafari', 'Rastafari', 'Rastafari', 'Rastafari', ['rasta']],
    ['santeria', 'Lucumí (Santería)', 'Lucumí (Santería)', 'Lucumí (Santería)', ['santeria', 'regla de ocha']],
    ['spiritual-baptist', 'Spiritual Baptist', 'Spiritual Baptists', 'Spiritual Baptist', ['shouter baptist']],
    ['umbanda', 'Umbanda', 'Umbanda', 'Umbanda'],
    ['winti', 'Winti', 'Winti', 'Winti'],
    ['vodou', 'Vodou (Haiti)', 'Vodou (Haiti)', 'Vodou (Haïti)', ['voodoo']],
  ] },
  { id: 'bahai', en: 'Bahá’í', de: 'Bahá’í', af: 'Bahá’í', source: 'Bahá’í-Gemeinde in Deutschland (bahai.de); Bahá’í International Community (ref.)', faiths: [
    ['bahai', 'Bahá’í Faith', 'Bahá’í-Religion', 'Bahá’í-geloof', ['bahai']],
  ] },
  { id: 'bon', en: 'Bön', de: 'Bön', af: 'Bön', source: 'Yungdrung Bon Monastic Centre (message from the Dalai Lama); Wikipedia: Bon; Karmay, The Treasury of Good Sayings (ref.)', faiths: [
    ['bon', 'Yungdrung Bön', 'Yungdrung Bön', 'Yungdrung Bön', ['bon', 'bön']],
  ] },
  { id: 'buddhist', en: 'Buddhist', de: 'Buddhistisch', af: 'Boeddhisties', source: 'af.wikipedia: Boeddhisme; Harvey, An Introduction to Buddhism (ref.)', faiths: [
    ['buddhist', 'Buddhist', 'Buddhistisch', 'Boeddhis'],
    ['chan-zen', 'Zen (Chan, Seon, Thiền)', 'Zen (Chan, Seon, Thiền)', 'Zen (Chan, Seon, Thiền)'],
    ['mahayana', 'Mahayana', 'Mahayana', 'Mahayana'],
    ['navayana', 'Navayana (Ambedkarite)', 'Navayana (Ambedkar-Buddhismus)', 'Navayana (Ambedkar)'],
    ['nichiren', 'Nichiren', 'Nichiren', 'Nichiren'],
    ['pure-land', 'Pure Land', 'Reines Land', 'Suiwer Land'],
    ['soka', 'Soka Gakkai', 'Soka Gakkai', 'Soka Gakkai'],
    ['theravada', 'Theravada', 'Theravada', 'Theravada'],
    ['tibetan', 'Tibetan Buddhist (Vajrayana)', 'Tibetischer Buddhismus (Vajrayana)', 'Tibettaanse Boeddhisme (Vajrayana)'],
  ] },
  { id: 'chr-general', en: 'Christian', de: 'Christlich', af: 'Christelik', source: 'Wikipedia: Christian Community, Evangelical Church in Germany; Melton, Encyclopedia of American Religions (ref.)', faiths: [
    ['christian', 'Christian', 'Christlich', 'Christen'],
    ['christian-community', 'The Christian Community', 'Die Christengemeinschaft', 'Die Christengemeenskap', ['christengemeinschaft']],
    ['christian-science', 'Christian Science', 'Christliche Wissenschaft', 'Christelike Wetenskap'],
    ['evangelical', 'Evangelical (the movement)', 'Evangelikal', 'Evangelikaal', ['evangelikal']],
    ['protestant', 'Protestant', 'Protestantisch', 'Protestants'],
  ] },
  { id: 'chr-aic', en: 'Christian: African-initiated churches', de: 'Christlich: afrikanische unabhängige Kirchen', af: 'Christelik: Afrikaanse onafhanklike kerke', source: 'Wikipedia: African-initiated church, Nazareth Baptist Church, Legio Maria, Apostles of Johane Marange, International Pentecostal Holiness Church (Africa); Sowetan and City Press reports on the IPHC; Anderson, African Reformation (ref.)', faiths: [
    ['aic', 'African Independent Church', 'Afrikanische unabhängige Kirche', 'Afrikaanse onafhanklike kerk'],
    ['aladura', 'Aladura', 'Aladura', 'Aladura'],
    ['marange', 'African Apostolic Church of Johane Marange', 'African Apostolic Church of Johane Marange', 'African Apostolic Church of Johane Marange', ['johane marange', 'maranke']],
    ['celestial', 'Celestial Church of Christ', 'Celestial Church of Christ', 'Celestial Church of Christ'],
    ['cherubim', 'Cherubim and Seraphim', 'Cherubim and Seraphim', 'Cherubim and Seraphim'],
    ['christ-apostolic', 'Christ Apostolic Church', 'Christ Apostolic Church', 'Christ Apostolic Church'],
    ['church-lord', 'Church of the Lord (Aladura)', 'Church of the Lord (Aladura)', 'Church of the Lord (Aladura)'],
    ['ethiopian-type', 'Ethiopian-type church (southern Africa)', 'Äthiopianistische Kirche (südliches Afrika)', 'Etiopiese kerk (Suider-Afrika)', ['ethiopianism']],
    ['harrist', 'Harrist Church', 'Harristische Kirche', 'Harris-kerk'],
    ['iphc', 'International Pentecost Holiness Church', 'International Pentecost Holiness Church', 'International Pentecost Holiness Church', ['iphc', 'modise', 'international pentecostal holiness church']],
    ['kimbanguist', 'Kimbanguist Church', 'Kimbanguistische Kirche', 'Kimbanguistiese Kerk'],
    ['legio-maria', 'Legio Maria', 'Legio Maria', 'Legio Maria', ['maria legio']],
    ['shembe', 'iBandla lamaNazaretha (Shembe)', 'iBandla lamaNazaretha (Shembe)', 'iBandla lamaNazaretha (Shembe)', ['nazareth baptist church', 'nazarite', 'shembe']],
    ['st-engenas', 'St Engenas Zion Christian Church', 'St. Engenas Zion Christian Church', 'St Engenas Zion Christian Church', ['st engenas zcc']],
    ['st-john', 'St John’s Apostolic Faith Mission', 'St. John’s Apostolic Faith Mission', 'St. John’s Apostolic Faith Mission'],
    ['zcc', 'Zion Christian Church', 'Zion Christian Church', 'Zion Christian Church', ['zcc', 'lekganyane']],
    ['zionist', 'Zionist church (southern Africa)', 'Zionistische Kirche (südliches Afrika)', 'Sionistiese kerk (Suider-Afrika)'],
  ] },
  { id: 'chr-adventist', en: 'Christian: Adventist and Restorationist', de: 'Christlich: adventistisch und restaurationistisch', af: 'Christelik: Adventisties en Restourasionisties', source: 'The Church of Jesus Christ of Latter-day Saints (Afrikaans scriptures); adventist.nl and Stellenbosch University records for the Afrikaans; the churches’ own names (ref.)', faiths: [
    ['christadelphian', 'Christadelphians', 'Christadelphians', 'Christadelphiane'],
    ['church-of-christ', 'Churches of Christ', 'Gemeinden Christi', 'Kerke van Christus'],
    ['iglesia', 'Iglesia ni Cristo', 'Iglesia ni Cristo', 'Iglesia ni Cristo'],
    ['jw', 'Jehovah’s Witnesses', 'Zeugen Jehovas', 'Jehovah se Getuies'],
    ['lds', 'The Church of Jesus Christ of Latter-day Saints', 'Kirche Jesu Christi der Heiligen der Letzten Tage', 'Die Kerk van Jesus Christus van die Heiliges van die Laaste Dae', ['mormon']],
    ['sda', 'Seventh-day Adventist', 'Siebenten-Tags-Adventisten', 'Sewendedag-Adventiste'],
  ] },
  { id: 'chr-anabaptist', en: 'Christian: Anabaptist and peace churches', de: 'Christlich: täuferische und Friedenskirchen', af: 'Christelik: Anabaptiste en vredeskerke', source: 'Deutsche Jahresversammlung der Quäker (quaeker.org); Mennonite World Conference (ref.)', faiths: [
    ['amish', 'Amish', 'Amische', 'Amish'],
    ['brethren', 'Church of the Brethren', 'Church of the Brethren', 'Church of the Brethren'],
    ['hutterite', 'Hutterite', 'Hutterer', 'Hutteriete'],
    ['mennonite', 'Mennonite', 'Mennoniten', 'Menniste'],
    ['quaker', 'Religious Society of Friends (Quakers)', 'Religiöse Gesellschaft der Freunde (Quäker)', 'Godsdienstige Genootskap van Vriende (Kwakers)', ['quaker', 'quäker']],
  ] },
  { id: 'chr-anglican', en: 'Christian: Anglican', de: 'Christlich: anglikanisch', af: 'Christelik: Anglikaans', source: 'Wikipedia: Religion in South Africa; Anglican Communion (ref.)', faiths: [
    ['acsa', 'Anglican Church of Southern Africa', 'Anglikanische Kirche im südlichen Afrika', 'Anglikaanse Kerk van Suider-Afrika'],
    ['anglican', 'Anglican', 'Anglikanisch', 'Anglikaans'],
    ['coe', 'Church of England', 'Kirche von England', 'Kerk van Engeland'],
    ['episcopal', 'Episcopal Church', 'Episkopalkirche', 'Episkopaalse Kerk'],
  ] },
  { id: 'chr-apostolic', en: 'Christian: Apostolic (Irvingian)', de: 'Christlich: apostolisch (katholisch-apostolische Tradition)', af: 'Christelik: Apostolies (Irvingiaans)', source: 'Wikipedia: Old Apostolic Church, New Apostolic Church, Reformed Old Apostolic Church', faiths: [
    ['new-apostolic', 'New Apostolic Church', 'Neuapostolische Kirche', 'Nuwe Apostoliese Kerk'],
    ['old-apostolic', 'Old Apostolic Church', 'Old Apostolic Church', 'Ou Apostoliese Kerk', ['ou apostoliese']],
    ['reformed-old-apostolic', 'Reformed Old Apostolic Church', 'Reformed Old Apostolic Church', 'Reformed Old Apostolic Church'],
  ] },
  { id: 'chr-baptist', en: 'Christian: Baptist', de: 'Christlich: baptistisch', af: 'Christelik: Baptiste', source: 'Bund Evangelisch-Freikirchlicher Gemeinden (befg.de); Wikipedia: Religion in South Africa; Baptist World Alliance (ref.)', faiths: [
    ['baptist', 'Baptist', 'Baptisten', 'Baptis'],
    ['baptist-union', 'Baptist Union of Southern Africa', 'Baptist Union of Southern Africa', 'Baptiste-unie van Suider-Afrika'],
    ['befg', 'Union of Evangelical Free Churches (Baptist, BEFG)', 'Evangelisch-Freikirchlich (Baptisten, BEFG)', 'Evangelies-Vrykerklik (Baptiste, BEFG)'],
    ['southern-baptist', 'Southern Baptist', 'Südliche Baptisten', 'Suidelike Baptiste'],
  ] },
  { id: 'chr-catholic', en: 'Christian: Catholic', de: 'Christlich: katholisch', af: 'Christelik: Katoliek', source: 'Wikipedia: Eastern Catholic Churches; Katholisches Bistum der Alt-Katholiken in Deutschland (alt-katholisch.de); Annuario Pontificio (ref.)', faiths: [
    ['armenian-catholic', 'Armenian Catholic', 'Armenisch-katholisch', 'Armeens-Katoliek'],
    ['catholic', 'Roman Catholic', 'Römisch-katholisch', 'Rooms-Katoliek', ['catholic', 'katholisch', 'katoliek']],
    ['chaldean', 'Chaldean Catholic', 'Chaldäisch-katholisch', 'Chaldese Katoliek'],
    ['coptic-catholic', 'Coptic Catholic', 'Koptisch-katholisch', 'Koptiese Katoliek'],
    ['greek-catholic', 'Eastern Catholic (Greek Catholic)', 'Griechisch-katholisch', 'Oosterse Katoliek (Grieks-Katoliek)'],
    ['maronite', 'Maronite Catholic', 'Maronitisch-katholisch', 'Maronitiese Katoliek'],
    ['melkite', 'Melkite Greek Catholic', 'Melkitisch griechisch-katholisch', 'Melkitiese Grieks-Katoliek'],
    ['old-catholic', 'Old Catholic', 'Alt-Katholisch', 'Oud-Katoliek', ['altkatholisch']],
    ['syriac-catholic', 'Syriac Catholic', 'Syrisch-katholisch', 'Siries-Katoliek'],
    ['syro-malabar', 'Syro-Malabar Catholic', 'Syro-malabarisch', 'Siro-Malabar Katoliek'],
    ['ukr-greek-catholic', 'Ukrainian Greek Catholic', 'Ukrainisch griechisch-katholisch', 'Oekraïens Grieks-Katoliek'],
  ] },
  { id: 'chr-free', en: 'Christian: Evangelical free churches', de: 'Christlich: evangelische Freikirchen', af: 'Christelik: Evangeliese vrykerke', source: 'Wikipedia: Evangelical Church in Germany (evangelisch and evangelikal); Verbum et Ecclesia (Morawiese Kerk); Vereinigung Evangelischer Freikirchen (ref.)', faiths: [
    ['free-church', 'Evangelical free church', 'Evangelische Freikirche', 'Evangeliese vrykerk'],
    ['feg', 'Free Evangelical Church (FeG)', 'Freie evangelische Gemeinde (FeG)', 'Vrye Evangeliese Gemeente (FeG)'],
    ['moravian', 'Moravian Church', 'Herrnhuter Brüdergemeine', 'Morawiese Kerk', ['broederkerk']],
    ['non-denominational', 'Non-denominational Christian', 'Überkonfessionell christlich', 'Nie-denominasioneel Christen'],
    ['plymouth', 'Brethren (Plymouth)', 'Brüderbewegung', 'Broederbeweging'],
  ] },
  { id: 'chr-lutheran', en: 'Christian: Lutheran and United', de: 'Christlich: evangelisch-lutherisch und uniert', af: 'Christelik: Luthers en Verenig', source: 'Selbständige Evangelisch-Lutherische Kirche (selk.de); Wikipedia: Evangelical Church in Germany; Lutheran World Federation (ref.)', faiths: [
    ['elca-sa', 'Evangelical Lutheran Church in Southern Africa', 'Evangelisch-Lutherische Kirche im südlichen Afrika', 'Evangelies-Lutherse Kerk in Suider-Afrika'],
    ['evangelisch', 'Protestant (German regional church, EKD)', 'Evangelisch (Landeskirche, EKD)', 'Evangelies (Duitse streekskerk, EKD)', ['evangelisch', 'evangelical german', 'german evangelical', 'landeskirche']],
    ['lutheran', 'Lutheran', 'Evangelisch-lutherisch', 'Luthers', ['lutherisch']],
    ['selk', 'Independent Evangelical Lutheran Church (SELK)', 'Selbständige Evangelisch-Lutherische Kirche (SELK)', 'Onafhanklike Evangelies-Lutherse Kerk (SELK)'],
    ['united', 'United Protestant', 'Evangelisch-uniert', 'Verenigde Protestant', ['uniert']],
  ] },
  { id: 'chr-methodist', en: 'Christian: Methodist', de: 'Christlich: methodistisch', af: 'Christelik: Metodisties', source: 'Evangelisch-methodistische Kirche (emk.de); Wikipedia: Religion in South Africa; World Methodist Council (ref.)', faiths: [
    ['emk', 'United Methodist Church (EmK)', 'Evangelisch-methodistische Kirche (EmK)', 'Verenigde Metodistekerk (EmK)'],
    ['mcsa', 'Methodist Church of Southern Africa', 'Methodistische Kirche im südlichen Afrika', 'Metodistekerk van Suider-Afrika'],
    ['methodist', 'Methodist', 'Methodistisch', 'Metodis'],
    ['salvation-army', 'The Salvation Army', 'Die Heilsarmee', 'Die Heilsleër'],
    ['wesleyan', 'Wesleyan', 'Wesleyanisch', 'Wesleyaans'],
  ] },
  { id: 'chr-eastern', en: 'Christian: Eastern Orthodox', de: 'Christlich: östlich-orthodox', af: 'Christelik: Oosters-Ortodoks', source: 'Wikipedia: Autocephaly; the churches’ own names (ref.)', faiths: [
    ['albanian', 'Albanian Orthodox', 'Albanisch-orthodox', 'Albanees-Ortodoks'],
    ['antiochian', 'Antiochian Orthodox', 'Antiochenisch-orthodox', 'Antiochiese Ortodoks'],
    ['bulgarian', 'Bulgarian Orthodox', 'Bulgarisch-orthodox', 'Bulgaars-Ortodoks'],
    ['eastern-orthodox', 'Eastern Orthodox', 'Orthodox', 'Oosters-Ortodoks'],
    ['georgian', 'Georgian Orthodox', 'Georgisch-orthodox', 'Georgies-Ortodoks'],
    ['greek-orthodox', 'Greek Orthodox', 'Griechisch-orthodox', 'Grieks-Ortodoks'],
    ['macedonian', 'Macedonian Orthodox', 'Mazedonisch-orthodox', 'Masedonies-Ortodoks'],
    ['old-believers', 'Old Believers', 'Altgläubige', 'Ou-Gelowiges'],
    ['romanian', 'Romanian Orthodox', 'Rumänisch-orthodox', 'Roemeens-Ortodoks'],
    ['russian', 'Russian Orthodox', 'Russisch-orthodox', 'Russies-Ortodoks'],
    ['serbian', 'Serbian Orthodox', 'Serbisch-orthodox', 'Serwies-Ortodoks'],
    ['ukrainian', 'Ukrainian Orthodox', 'Ukrainisch-orthodox', 'Oekraïens-Ortodoks'],
  ] },
  { id: 'chr-oriental', en: 'Christian: Oriental Orthodox and Church of the East', de: 'Christlich: orientalisch-orthodox und Kirche des Ostens', af: 'Christelik: Oriëntaals-Ortodoks en Kerk van die Ooste', source: 'Wikipedia: Oriental Orthodox Churches; the churches’ own names (ref.)', faiths: [
    ['armenian', 'Armenian Apostolic', 'Armenisch-apostolisch', 'Armeens-Apostolies'],
    ['assyrian', 'Assyrian Church of the East', 'Assyrische Kirche des Ostens', 'Assiriese Kerk van die Ooste'],
    ['coptic', 'Coptic Orthodox', 'Koptisch-orthodox', 'Kopties-Ortodoks'],
    ['eritrean', 'Eritrean Orthodox Tewahedo', 'Eritreisch-orthodox (Tewahedo)', 'Eritrees-Ortodoks (Tewahedo)'],
    ['ethiopian', 'Ethiopian Orthodox Tewahedo', 'Äthiopisch-orthodox (Tewahedo)', 'Etiopies-Ortodoks (Tewahedo)'],
    ['malankara', 'Malankara Orthodox', 'Malankara-orthodox', 'Malankara-Ortodoks'],
    ['syriac', 'Syriac Orthodox', 'Syrisch-orthodox', 'Siries-Ortodoks'],
  ] },
  { id: 'chr-pentecostal', en: 'Christian: Pentecostal and Charismatic', de: 'Christlich: pfingstlich und charismatisch', af: 'Christelik: Pinkster en Charismaties', source: 'The Apostolic Faith Mission of South Africa (afm-ags.org); Bund Freikirchlicher Pfingstgemeinden (bfp.de); Full Gospel Church of God (fgcsa.co.za); Pentecostal World Fellowship (ref.)', faiths: [
    ['afm', 'Apostolic Faith Mission of South Africa', 'Apostolic Faith Mission of South Africa', 'Apostoliese Geloofsending', ['ags', 'afm']],
    ['aog', 'Assemblies of God', 'Assemblies of God', 'Assemblies of God'],
    ['bfp', 'Federation of Pentecostal Churches (BFP)', 'Bund Freikirchlicher Pfingstgemeinden (BFP)', 'Bond van Pinkstergemeentes (BFP)'],
    ['charismatic', 'Charismatic', 'Charismatisch', 'Charismaties'],
    ['church-of-god', 'Church of God (Pentecostal)', 'Gemeinde Gottes (pfingstlich)', 'Kerk van God (Pinkster)'],
    ['church-of-pentecost', 'Church of Pentecost', 'Church of Pentecost', 'Church of Pentecost'],
    ['foursquare', 'Foursquare Church', 'Foursquare-Kirche', 'Foursquare-kerk'],
    ['full-gospel', 'Full Gospel Church of God', 'Full Gospel Church of God', 'Volle Evangelie Kerk van God', ['full gospel', 'volle evangelie', 'volles evangelium']],
    ['pentecostal', 'Pentecostal', 'Pfingstlich', 'Pinkster'],
    ['rccg', 'Redeemed Christian Church of God', 'Redeemed Christian Church of God', 'Redeemed Christian Church of God', ['rccg']],
    ['rhema', 'Rhema Bible Church', 'Rhema Bible Church', 'Rhema Bible Church'],
    ['winners', 'Living Faith Church (Winners Chapel)', 'Living Faith Church (Winners Chapel)', 'Living Faith Church (Winners Chapel)'],
  ] },
  { id: 'chr-reformed', en: 'Christian: Reformed and Presbyterian', de: 'Christlich: reformiert und presbyterianisch', af: 'Christelik: Gereformeerd en Presbiteriaans', source: 'The churches’ own sites (ngkerk.org.za, nhka.org, gksa.org.za); Library of Congress (VGKSA); Wikipedia: Religion in South Africa, Waldensian Evangelical Church, Dutch Reformed Church in Africa, Free Reformed Churches of South Africa, Afrikaans Protestant Church', faiths: [
    ['apk', 'Afrikaanse Protestantse Kerk', 'Afrikaanse Protestantse Kerk', 'Afrikaanse Protestantse Kerk', ['apk', 'afrikaans protestant church']],
    ['church-of-scotland', 'Church of Scotland', 'Kirche von Schottland', 'Kerk van Skotland'],
    ['congregational', 'Congregational', 'Kongregationalistisch', 'Kongregasionaal'],
    ['drca', 'Dutch Reformed Church in Africa', 'Niederländisch-reformierte Kirche in Afrika', 'Nederduitse Gereformeerde Kerk in Afrika', ['ngka']],
    ['frcsa', 'Free Reformed Churches of South Africa', 'Vrye Gereformeerde Kerke in Suid-Afrika', 'Vrye Gereformeerde Kerke in Suid-Afrika'],
    ['gksa', 'Gereformeerde Kerke in Suid-Afrika (GKSA)', 'Gereformeerde Kerke in Suid-Afrika (GKSA)', 'Gereformeerde Kerke in Suid-Afrika (GKSA)', ['dopper', 'doppers', 'gksa', 'reformed churches in south africa']],
    ['huguenot', 'Huguenot (French Reformed)', 'Hugenottisch', 'Hugenote'],
    ['ng', 'Dutch Reformed Church (NG Kerk)', 'Niederländisch-reformierte Kirche in Südafrika (NG Kerk)', 'Nederduitse Gereformeerde Kerk (NG Kerk)', ['ng kerk', 'ngk']],
    ['nhk', 'Nederduitsch Hervormde Kerk van Afrika', 'Nederduitsch Hervormde Kerk van Afrika', 'Nederduitsch Hervormde Kerk van Afrika', ['nhk', 'nhka', 'hervormde kerk']],
    ['pkn', 'Protestant Church in the Netherlands', 'Protestantische Kirche in den Niederlanden', 'Protestantse Kerk in Nederland', ['pkn', 'nederlandse hervormde kerk', 'nederlands hervormd', 'dutch reformed netherlands']],
    ['pca', 'Presbyterian Church of Africa', 'Presbyterian Church of Africa', 'Presbyterian Church of Africa'],
    ['presbyterian', 'Presbyterian', 'Presbyterianisch', 'Presbiteriaans'],
    ['reformed', 'Reformed', 'Reformiert', 'Gereformeerd', ['calvinist', 'evangelisch-reformiert']],
    ['rca', 'Reformed Church in Africa', 'Reformed Church in Africa', 'Reformed Church in Africa'],
    ['uccsa', 'United Congregational Church of Southern Africa', 'United Congregational Church of Southern Africa', 'United Congregational Church of Southern Africa', ['uccsa']],
    ['upcsa', 'Uniting Presbyterian Church in Southern Africa', 'Uniting Presbyterian Church in Southern Africa', 'Uniting Presbyterian Church in Southern Africa', ['upcsa']],
    ['urcsa', 'Uniting Reformed Church in Southern Africa', 'Vereinigende Reformierte Kirche im südlichen Afrika', 'Verenigende Gereformeerde Kerk in Suider-Afrika', ['vgk', 'vgksa', 'urcsa']],
    ['waldensian', 'Waldensian Evangelical Church', 'Waldenser', 'Waldense', ['waldensian']],
  ] },
  { id: 'east-asian', en: 'East Asian religions', de: 'Ostasiatische Religionen', af: 'Oos-Asiatiese godsdienste', source: 'af.wikipedia: Godsdiens, Konfusianisme; Oxford Handbook of Chinese Religions (ref.)', faiths: [
    ['caodai', 'Cao Đài', 'Cao Đài', 'Cao Đài', ['cao dai']],
    ['cheondoism', 'Cheondoism (Cheondogyo)', 'Cheondoismus (Cheondogyo)', 'Cheondoïsme (Cheondogyo)', ['cheondogyo']],
    ['chinese-folk', 'Chinese folk religion', 'Chinesische Volksreligion', 'Chinese volksgodsdiens'],
    ['confucian', 'Confucian', 'Konfuzianisch', 'Konfusiaans'],
    ['falun', 'Falun Dafa (Falun Gong)', 'Falun Dafa (Falun Gong)', 'Falun Dafa (Falun Gong)', ['falun gong']],
    ['hoa-hao', 'Hòa Hảo', 'Hòa Hảo', 'Hòa Hảo', ['hoa hao']],
    ['muism', 'Muism (Korean shamanism)', 'Muismus (koreanischer Schamanismus)', 'Muïsme (Koreaanse sjamanisme)'],
    ['shinto', 'Shinto', 'Shintō', 'Sjinto'],
    ['taoist', 'Taoist', 'Taoistisch', 'Taoïsties', ['daoist']],
    ['tenrikyo', 'Tenrikyo', 'Tenrikyō', 'Tenrikyo'],
  ] },
  { id: 'hindu', en: 'Hindu', de: 'Hinduistisch', af: 'Hindoe', source: 'Wikipedia: Hindu denominations; af.wikipedia: Hindoeïsme; Flood, An Introduction to Hinduism (ref.)', faiths: [
    ['arya-samaj', 'Arya Samaj', 'Arya Samaj', 'Arya Samaj'],
    ['hindu', 'Hindu (Sanatana Dharma)', 'Hinduistisch (Sanatana Dharma)', 'Hindoe (Sanatana Dharma)'],
    ['iskcon', 'ISKCON (Hare Krishna)', 'ISKCON (Hare Krishna)', 'ISKCON (Hare Krishna)'],
    ['lingayat', 'Lingayat', 'Lingayat', 'Lingayat'],
    ['shaiva', 'Shaiva', 'Shivaitisch', 'Sjaiwa'],
    ['shakta', 'Shakta', 'Shaktistisch', 'Sjakta'],
    ['smarta', 'Smarta', 'Smarta', 'Smarta'],
    ['swaminarayan', 'Swaminarayan', 'Swaminarayan', 'Swaminarayan'],
    ['vaishnava', 'Vaishnava', 'Vishnuitisch', 'Waisjnawa'],
  ] },
  { id: 'indigenous', en: 'Indigenous traditions', de: 'Indigene Traditionen', af: 'Inheemse tradisies', source: 'Planet Wissen and SRF (German usage for Indigenous peoples); Haus der Kunst, Karrabing glossary; Harvey, Indigenous Religions: A Companion (ref.)', faiths: [
    ['aboriginal', 'Aboriginal Australian spirituality', 'Spiritualität der Aboriginal Peoples (Australien)', 'Aboriginale spiritualiteit van Australië', ['aborigines']],
    ['andean', 'Andean tradition', 'Andine Tradition', 'Andes-tradisie'],
    ['first-nations', 'First Nations tradition', 'Tradition der First Nations', 'Tradisie van die Eerste Nasies'],
    ['hawaiian', 'Native Hawaiian tradition', 'Hawaiianische Tradition', 'Hawaiiaanse tradisie'],
    ['inuit', 'Inuit tradition', 'Tradition der Inuit', 'Inuit-tradisie'],
    ['maori', 'Māori tradition', 'Tradition der Māori', 'Māori-tradisie'],
    ['mesoamerican', 'Mesoamerican tradition', 'Mesoamerikanische Tradition', 'Meso-Amerikaanse tradisie'],
    ['native-american', 'Native American tradition', 'Indigene Tradition Nordamerikas', 'Inheemse Amerikaanse tradisie'],
    ['native-american-church', 'Native American Church', 'Native American Church', 'Native American Church'],
    ['sami', 'Sámi tradition', 'Tradition der Sámi', 'Sámi-tradisie'],
    ['shamanic', 'Shamanic tradition', 'Schamanische Tradition', 'Sjamanistiese tradisie'],
  ] },
  { id: 'islam', en: 'Islam', de: 'Islam', af: 'Islam', source: 'bpb Islam-Lexikon: Alawiten; Wikipedia: Deobandi movement, Alawites; Oxford Dictionary of Islam (ref.)', faiths: [
    ['ahmadi', 'Ahmadi Muslim', 'Ahmadiyya', 'Ahmadi-Moslem', ['ahmadiyya']],
    ['alawite', 'Alawite', 'Alawitisch', 'Alawiet'],
    ['alevi', 'Alevi', 'Alevitisch', 'Alewiet', ['alevite']],
    ['barelvi', 'Sunni: Barelvi', 'Sunnitisch: Barelwi', 'Soenniet: Barelwi', ['barelwi']],
    ['deobandi', 'Sunni: Deobandi', 'Sunnitisch: Deobandi', 'Soenniet: Deobandi'],
    ['hanafi', 'Sunni: Hanafi', 'Sunnitisch: hanafitisch', 'Soenniet: Hanafi'],
    ['hanbali', 'Sunni: Hanbali', 'Sunnitisch: hanbalitisch', 'Soenniet: Hanbali'],
    ['ibadi', 'Ibadi', 'Ibaditisch', 'Ibadi'],
    ['ismaili', 'Shia: Ismaili', 'Schiitisch: ismailitisch', 'Sjia: Ismaili'],
    ['maliki', 'Sunni: Maliki', 'Sunnitisch: malikitisch', 'Soenniet: Maliki'],
    ['muslim', 'Muslim', 'Muslimisch', 'Moslem', ['islam']],
    ['quranist', 'Quranist', 'Koranist', 'Koranis', ['qurani', 'koraniten']],
    ['salafi', 'Sunni: Salafi', 'Sunnitisch: salafistisch', 'Soenniet: Salafi'],
    ['shafii', 'Sunni: Shafi‘i', 'Sunnitisch: schafiitisch', 'Soenniet: Sjafi‘i', ['shafi']],
    ['shia', 'Shia', 'Schiitisch', 'Sjia', ['shiite']],
    ['sufi', 'Sufi', 'Sufi', 'Soefi'],
    ['sunni', 'Sunni', 'Sunnitisch', 'Soenniet'],
    ['twelver', 'Shia: Twelver', 'Schiitisch: Zwölfer', 'Sjia: Twaalwers'],
    ['zaydi', 'Shia: Zaydi', 'Schiitisch: zaiditisch', 'Sjia: Zaidi'],
  ] },
  { id: 'jain', en: 'Jain', de: 'Jainistisch', af: 'Djain', source: 'af.wikipedia: Godsdiens (Djainisme); Dundas, The Jains (ref.)', faiths: [
    ['digambara', 'Digambara', 'Digambara', 'Digambara'],
    ['jain', 'Jain', 'Jaina', 'Djain-geloof'],
    ['svetambara', 'Śvētāmbara', 'Shvetambara', 'Sjwetambara', ['svetambara', 'shvetambara']],
  ] },
  { id: 'jewish', en: 'Jewish', de: 'Jüdisch', af: 'Joods', source: 'bpb: Strömungen des Judentums in Deutschland; Encyclopaedia Judaica (ref.)', faiths: [
    ['ashkenazi', 'Ashkenazi', 'Aschkenasisch', 'Asjkenasies'],
    ['beta-israel', 'Beta Israel', 'Beta Israel', 'Beta Israel'],
    ['conservative', 'Conservative (Masorti)', 'Masorti (konservativ)', 'Konserwatief (Masorti)'],
    ['haredi', 'Haredi', 'Charedisch', 'Charedies'],
    ['hasidic', 'Hasidic', 'Chassidisch', 'Chassidies'],
    ['humanistic-jewish', 'Humanistic Jewish', 'Humanistisch-jüdisch', 'Humanisties-Joods'],
    ['jewish', 'Jewish', 'Jüdisch', 'Jood'],
    ['karaite', 'Karaite', 'Karäisch', 'Karaïet'],
    ['mizrahi', 'Mizrahi', 'Misrachisch', 'Mizrahi'],
    ['modern-orthodox', 'Modern Orthodox', 'Modern-orthodox', 'Modern-Ortodoks'],
    ['orthodox-jewish', 'Orthodox Jewish', 'Orthodox-jüdisch', 'Ortodoks-Joods'],
    ['reconstructionist', 'Reconstructionist', 'Rekonstruktionistisch', 'Rekonstruksionisties'],
    ['reform', 'Reform or Liberal Jewish', 'Liberal-jüdisch (Reform)', 'Progressief of Hervormd Joods', ['progressive']],
    ['sephardi', 'Sephardi', 'Sephardisch', 'Sefardies'],
  ] },
  { id: 'messianic', en: 'Messianic', de: 'Messianisch', af: 'Messiaans', source: 'My Jewish Learning, Who Are Messianic “Jews”?; bartehrman.com; Wikipedia: Messianic Judaism', faiths: [
    ['messianic', 'Messianic Judaism', 'Messianisches Judentum', 'Messiaanse Judaïsme', ['hebrew christian']],
  ] },
  { id: 'near-eastern', en: 'Near Eastern traditions', de: 'Traditionen des Nahen Ostens', af: 'Tradisies van die Nabye Ooste', source: 'Wikipedia: Yazidis; Oxford Handbook of Religious Diversity (ref.)', faiths: [
    ['druze', 'Druze (Muwahhidun)', 'Drusisch (Muwahhidun)', 'Druse (Muwahhidun)'],
    ['mandaean', 'Mandaean', 'Mandäisch', 'Mandeër'],
    ['samaritan', 'Samaritan', 'Samaritanisch', 'Samaritaan'],
    ['yarsan', 'Yarsan (Ahl-e Haqq)', 'Yarsan (Ahl-e Haqq)', 'Yarsan (Ahl-e Haqq)'],
    ['yazidi', 'Yazidi (Êzidî)', 'Jesidisch (Êzidî)', 'Jesidi (Êzidî)', ['ezidi', 'yezidi']],
    ['zoroastrian', 'Zoroastrian (Parsi, Irani)', 'Zoroastrisch (Parsen)', 'Zoroastries (Parsi)', ['parsi']],
  ] },
  { id: 'none', en: 'No religion or no answer', de: 'Keine Religion oder keine Angabe', af: 'Geen godsdiens of geen antwoord', source: 'Pew Research Center, Religious “Nones” in America (2024)', faiths: [
    ['agnostic', 'Agnostic', 'Agnostisch', 'Agnosties'],
    ['atheist', 'Atheist', 'Atheistisch', 'Ateïs'],
    ['freethinker', 'Freethinker', 'Freidenkerisch', 'Vrydenker', ['freidenker']],
    ['humanist', 'Humanist', 'Humanistisch', 'Humanis'],
    ['no-religion', 'No religion', 'Keine Religion', 'Geen godsdiens', ['none', 'keine', 'konfessionslos', 'konfessionsfrei', 'nothing in particular']],
    ['prefer-not', 'Prefer not to say', 'Keine Angabe', 'Verkies om nie te sê nie'],
    ['spiritual', 'Spiritual, not religious', 'Spirituell, nicht religiös', 'Geestelik, nie godsdienstig nie'],
    ['unknown', 'Unknown', 'Unbekannt', 'Onbekend'],
  ] },
  { id: 'pagan', en: 'Pagan and contemporary spirituality', de: 'Paganismus und zeitgenössische Spiritualität', af: 'Paganisme en hedendaagse spiritualiteit', source: 'Clarke, Encyclopedia of New Religious Movements', faiths: [
    ['anthroposophy', 'Anthroposophy', 'Anthroposophie', 'Antroposofie'],
    ['asatru', 'Heathenry (Ásatrú)', 'Germanisches Heidentum (Ásatrú)', 'Heidendom (Ásatrú)', ['asatru']],
    ['druidry', 'Druidry', 'Druidentum', 'Druïdisme'],
    ['hellenic', 'Hellenic polytheism (Hellenism)', 'Hellenischer Polytheismus (Hellenismos)', 'Griekse politeïsme (Hellenisme)', ['hellenismos']],
    ['new-age', 'New Age', 'New Age', 'Nuwe Era'],
    ['pagan', 'Pagan', 'Heidnisch', 'Heidens', ['paganism']],
    ['rodnovery', 'Rodnovery', 'Rodnoverie', 'Rodnoverie', ['slavic']],
    ['spiritism', 'Spiritism', 'Spiritismus', 'Spiritisme'],
    ['theosophy', 'Theosophy', 'Theosophie', 'Teosofie'],
    ['wicca', 'Wicca', 'Wicca', 'Wicca'],
  ] },
  { id: 'sikh', en: 'Sikh', de: 'Sikh', af: 'Sikh', source: 'Singh, The Oxford Handbook of Sikh Studies (ref.)', faiths: [
    ['khalsa', 'Khalsa (Amritdhari)', 'Khalsa (Amritdhari)', 'Khalsa (Amritdhari)'],
    ['namdhari', 'Namdhari', 'Namdhari', 'Namdhari'],
    ['nanakpanthi', 'Nanakpanthi', 'Nanakpanthi', 'Nanakpanthi'],
    ['sikh', 'Sikh (Sikhi)', 'Sikh (Sikhi)', 'Sikh (Sikhi)', ['sikhism']],
  ] },
  { id: 'unitarian', en: 'Unitarian and free religious', de: 'Unitarisch und freireligiös', af: 'Unitaries en vrysinnig', source: 'de.wikipedia: Unitarier', faiths: [
    ['free-religious', 'Free religious (Freireligiös)', 'Freireligiös', 'Vrysinnig (Freireligiös)'],
    ['unitarian-christian', 'Unitarian (Christian)', 'Unitarisch (christlich)', 'Unitaries (Christelik)'],
    ['unitarian', 'Unitarian Universalist', 'Unitarisch-universalistisch', 'Unitaries-Universalisties'],
  ] },
];

interface Entry { row: Row; tradition: Tradition }
const ENTRIES: readonly Entry[] = FAITH_TRADITIONS.flatMap((tradition) => tradition.faiths.map((row) => ({ row, tradition })));
const nameIn = ({ row }: Entry, l: FaithLocale) => row[l === 'en' ? 1 : l === 'de' ? 2 : 3];
const allNames = ({ row }: Entry) => [row[1], row[2], row[3], ...(row[4] ?? [])];
const LOCALES: readonly FaithLocale[] = ['en', 'de', 'af'];

/**
 * The faiths for a text box: the family's own first, then every match by tradition, alphabetically in the reader's
 * language. What is typed narrows the list and never reorders it, and a family's own wording stays offered.
 */
export function faithSuggestions(query: string, locale: FaithLocale, used: readonly Used[] = []): Suggestion[] {
  const q = foldText(query);
  const collator = new Intl.Collator(locale);
  const counts = new Map<Entry, number>();
  const ownWords: Used[] = [];
  for (const u of used) {
    const f = foldText(u.value);
    if (!f) continue;
    const e = ENTRIES.find((x) => allNames(x).some((n) => foldText(n) === f));
    if (e) counts.set(e, (counts.get(e) ?? 0) + u.n); else ownWords.push(u);
  }
  const words = (e: Entry) => [...allNames(e), e.tradition.en, e.tradition.de, e.tradition.af];
  const matches = (e: Entry) => !q || words(e).some((n) => { const f = foldText(n); return f.startsWith(q) || f.includes(` ${q}`); });
  const hintOf = (e: Entry) => {
    if (!q) return undefined;
    const name = foldText(nameIn(e, locale));
    if (name.startsWith(q) || name.includes(` ${q}`)) return undefined;
    return allNames(e).find((n) => foldText(n).startsWith(q));
  };

  const own: Suggestion[] = [
    ...[...counts].filter(([e]) => matches(e)).sort((a, b) => b[1] - a[1] || collator.compare(nameIn(a[0], locale), nameIn(b[0], locale)))
      .map(([e]): Suggestion => ({ value: nameIn(e, locale), label: nameIn(e, locale), used: true })),
    ...ownWords.filter((u) => !q || foldText(u.value).includes(q)).sort((a, b) => b.n - a.n || collator.compare(a.value, b.value))
      .map((u): Suggestion => ({ value: u.value, label: u.value, used: true })),
  ];
  const rest = FAITH_TRADITIONS
    .map((t) => ({ t, name: t[locale] }))
    .sort((a, b) => collator.compare(a.name, b.name))
    .flatMap(({ t, name }) => ENTRIES
      .filter((e) => e.tradition === t && !counts.has(e) && matches(e))
      .sort((a, b) => collator.compare(nameIn(a, locale), nameIn(b, locale)))
      .map((e): Suggestion => { const hint = hintOf(e); return { value: nameIn(e, locale), label: nameIn(e, locale), group: name, ...(hint && { hint }) }; }));
  return [...own, ...rest];
}

/** Every language a name has, for the table's tests. */
export const faithLocales = LOCALES;
