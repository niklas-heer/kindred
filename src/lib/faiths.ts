// Every faith the field editor offers, as a table to review: tradition, then its denominations and branches, each
// named in English, German and Afrikaans, in the words the community uses for itself where that is known. Free text is
// always allowed, so anything missing here can still be written down.
//
// Nothing here ranks: the list is shown with the family's own first, then alphabetically by tradition in the reader's
// language, and within a tradition alphabetically.
//
// `source` says whose usage a tradition's names follow: the bodies' own names, and for the rest the reference works
// named. Compiled from those references without checking each one online; the Afrikaans has had no native reader yet.
import { foldText } from './address.ts';
import type { Suggestion, Used } from './field-suggest.ts';

export type FaithLocale = 'en' | 'de' | 'af';
type Row = [id: string, en: string, de: string, af: string, aliases?: readonly string[]];
export interface Tradition { id: string; en: string; de: string; af: string; source: string; faiths: readonly Row[] }

export const FAITH_TRADITIONS: readonly Tradition[] = [
  { id: 'african', en: 'African traditional religions', de: 'Afrikanische traditionelle Religionen', af: 'Afrikaanse tradisionele godsdienste', source: 'Olupona, African Religions (OUP); Mbiti, African Religions and Philosophy', faiths: [
    ['african-general', 'African traditional religion', 'Afrikanische traditionelle Religion', 'Afrikaanse tradisionele godsdiens'],
    ['akan', 'Akan traditional religion', 'Traditionelle Religion der Akan', 'Tradisionele godsdiens van die Akan'],
    ['igbo', 'Odinani (Igbo)', 'Odinani (Igbo)', 'Odinani (Igbo)'],
    ['khoisan', 'Khoe and San traditional belief', 'Traditioneller Glaube der Khoe und San', 'Tradisionele geloof van die Khoe en San', ['khoisan']],
    ['serer', 'Serer religion (A ƭat Roog)', 'Serer-Religion (A ƭat Roog)', 'Serer-godsdiens (A ƭat Roog)'],
    ['shona', 'Chivanhu (Shona)', 'Chivanhu (Shona)', 'Chivanhu (Shona)'],
    ['sotho-tswana', 'Sotho-Tswana traditional belief (Badimo)', 'Traditioneller Glaube der Sotho-Tswana (Badimo)', 'Tradisionele geloof van die Sotho-Tswana (Badimo)'],
    ['vodun', 'Vodun (West Africa)', 'Vodun (Westafrika)', 'Vodun (Wes-Afrika)'],
    ['xhosa', 'Xhosa traditional belief', 'Traditioneller Glaube der Xhosa', 'Tradisionele geloof van die Xhosa'],
    ['yoruba', 'Ìṣẹ̀ṣe (Yoruba)', 'Ìṣẹ̀ṣe (Yoruba)', 'Ìṣẹ̀ṣe (Yoruba)', ['yoruba religion', 'isese']],
    ['zulu', 'Zulu traditional belief', 'Traditioneller Glaube der Zulu', 'Tradisionele geloof van die Zulu'],
  ] },
  { id: 'diaspora', en: 'African diaspora religions', de: 'Religionen der afrikanischen Diaspora', af: 'Godsdienste van die Afrikaanse diaspora', source: 'Clarke, Encyclopedia of New Religious Movements', faiths: [
    ['candomble', 'Candomblé', 'Candomblé', 'Candomblé'],
    ['palo', 'Palo', 'Palo', 'Palo'],
    ['rastafari', 'Rastafari', 'Rastafari', 'Rastafari', ['rasta']],
    ['santeria', 'Lucumí (Santería)', 'Lucumí (Santería)', 'Lucumí (Santería)', ['santeria']],
    ['umbanda', 'Umbanda', 'Umbanda', 'Umbanda'],
    ['vodou', 'Vodou (Haiti)', 'Vodou (Haiti)', 'Vodou (Haïti)', ['voodoo']],
  ] },
  { id: 'bahai', en: 'Bahá’í', de: 'Bahá’í', af: 'Bahá’í', source: 'Bahá’í International Community', faiths: [
    ['bahai', 'Bahá’í Faith', 'Bahá’í-Religion', 'Bahá’í-geloof', ['bahai']],
  ] },
  { id: 'bon', en: 'Bön', de: 'Bön', af: 'Bön', source: 'Karmay, The Treasury of Good Sayings; the Bön community’s own name', faiths: [
    ['bon', 'Yungdrung Bön', 'Yungdrung Bön', 'Yungdrung Bön', ['bon', 'bön']],
  ] },
  { id: 'buddhist', en: 'Buddhist', de: 'Buddhistisch', af: 'Boeddhisties', source: 'Harvey, An Introduction to Buddhism', faiths: [
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
  { id: 'chr-general', en: 'Christian', de: 'Christlich', af: 'Christelik', source: 'World Council of Churches; Melton, Encyclopedia of American Religions', faiths: [
    ['christian', 'Christian', 'Christlich', 'Christen'],
    ['messianic', 'Messianic Judaism', 'Messianisches Judentum', 'Messiaanse Judaïsme'],
    ['protestant', 'Protestant', 'Protestantisch', 'Protestants'],
  ] },
  { id: 'chr-aic', en: 'Christian: African-initiated churches', de: 'Christlich: afrikanische unabhängige Kirchen', af: 'Christelik: Afrikaanse onafhanklike kerke', source: 'Organization of African Instituted Churches; Anderson, African Reformation', faiths: [
    ['aic', 'African Independent Church', 'Afrikanische unabhängige Kirche', 'Afrikaanse onafhanklike kerk'],
    ['aladura', 'Aladura', 'Aladura', 'Aladura'],
    ['celestial', 'Celestial Church of Christ', 'Celestial Church of Christ', 'Celestial Church of Christ'],
    ['ethiopian-type', 'Ethiopian-type church', 'Äthiopische Kirche (Südafrika)', 'Etiopiese kerk (Suid-Afrika)'],
    ['kimbanguist', 'Kimbanguist Church', 'Kimbanguistische Kirche', 'Kimbanguistiese Kerk'],
    ['shembe', 'iBandla lamaNazaretha (Shembe)', 'iBandla lamaNazaretha (Shembe)', 'iBandla lamaNazaretha (Shembe)', ['nazareth baptist church', 'nazarite']],
    ['st-john', 'St John’s Apostolic Faith Mission', 'St. John’s Apostolic Faith Mission', 'St. John’s Apostolic Faith Mission'],
    ['zcc', 'Zion Christian Church', 'Zion Christian Church', 'Zion Christian Church', ['zcc']],
    ['zionist', 'Zionist church (southern Africa)', 'Zionistische Kirche (südliches Afrika)', 'Sionistiese kerk (Suider-Afrika)'],
  ] },
  { id: 'chr-adventist', en: 'Christian: Adventist and Restorationist', de: 'Christlich: adventistisch und restaurationistisch', af: 'Christelik: Adventisties en Restourasionisties', source: 'The churches’ own names', faiths: [
    ['christadelphian', 'Christadelphians', 'Christadelphians', 'Christadelphiane'],
    ['christian-science', 'Christian Science', 'Christliche Wissenschaft', 'Christelike Wetenskap'],
    ['church-of-christ', 'Churches of Christ', 'Gemeinden Christi', 'Kerke van Christus'],
    ['iglesia', 'Iglesia ni Cristo', 'Iglesia ni Cristo', 'Iglesia ni Cristo'],
    ['jw', 'Jehovah’s Witnesses', 'Zeugen Jehovas', 'Jehovah se Getuies'],
    ['lds', 'The Church of Jesus Christ of Latter-day Saints', 'Kirche Jesu Christi der Heiligen der Letzten Tage', 'Kerk van Jesus Christus van die Heiliges van die Laaste Dae', ['mormon']],
    ['new-apostolic', 'New Apostolic Church', 'Neuapostolische Kirche', 'Nuwe Apostoliese Kerk'],
    ['sda', 'Seventh-day Adventist', 'Siebenten-Tags-Adventisten', 'Sewende-dag Adventiste'],
  ] },
  { id: 'chr-anabaptist', en: 'Christian: Anabaptist and peace churches', de: 'Christlich: täuferische und Friedenskirchen', af: 'Christelik: Anabaptiste en vredeskerke', source: 'Mennonite World Conference; Friends World Committee for Consultation', faiths: [
    ['amish', 'Amish', 'Amische', 'Amish'],
    ['brethren', 'Church of the Brethren', 'Church of the Brethren', 'Church of the Brethren'],
    ['hutterite', 'Hutterite', 'Hutterer', 'Hutteriete'],
    ['mennonite', 'Mennonite', 'Mennoniten', 'Menniste'],
    ['quaker', 'Religious Society of Friends (Quakers)', 'Religiöse Gesellschaft der Freunde (Quäker)', 'Godsdienstige Genootskap van Vriende (Kwakers)', ['quaker', 'quäker']],
  ] },
  { id: 'chr-anglican', en: 'Christian: Anglican', de: 'Christlich: anglikanisch', af: 'Christelik: Anglikaans', source: 'Anglican Communion', faiths: [
    ['acsa', 'Anglican Church of Southern Africa', 'Anglikanische Kirche im südlichen Afrika', 'Anglikaanse Kerk van Suider-Afrika'],
    ['anglican', 'Anglican', 'Anglikanisch', 'Anglikaans'],
    ['coe', 'Church of England', 'Kirche von England', 'Kerk van Engeland'],
    ['episcopal', 'Episcopal Church', 'Episkopalkirche', 'Episkopaalse Kerk'],
  ] },
  { id: 'chr-baptist', en: 'Christian: Baptist', de: 'Christlich: baptistisch', af: 'Christelik: Baptiste', source: 'Baptist World Alliance', faiths: [
    ['baptist', 'Baptist', 'Baptisten', 'Baptis'],
    ['befg', 'Evangelical Free Church (Baptist, BEFG)', 'Evangelisch-Freikirchlich (Baptisten, BEFG)', 'Evangelies-Vrykerklik (Baptiste, BEFG)'],
    ['southern-baptist', 'Southern Baptist', 'Südliche Baptisten', 'Suidelike Baptiste'],
  ] },
  { id: 'chr-catholic', en: 'Christian: Catholic', de: 'Christlich: katholisch', af: 'Christelik: Katoliek', source: 'Holy See, Annuario Pontificio; Union of Utrecht', faiths: [
    ['catholic', 'Roman Catholic', 'Römisch-katholisch', 'Rooms-Katoliek', ['catholic', 'katholisch', 'katoliek']],
    ['chaldean', 'Chaldean Catholic', 'Chaldäisch-katholisch', 'Chaldese Katoliek'],
    ['coptic-catholic', 'Coptic Catholic', 'Koptisch-katholisch', 'Koptiese Katoliek'],
    ['greek-catholic', 'Eastern Catholic (Greek Catholic)', 'Griechisch-katholisch', 'Oosterse Katoliek (Grieks-Katoliek)'],
    ['maronite', 'Maronite Catholic', 'Maronitisch', 'Maronitiese Katoliek'],
    ['old-catholic', 'Old Catholic', 'Altkatholisch', 'Oud-Katoliek'],
    ['syro-malabar', 'Syro-Malabar Catholic', 'Syro-malabarisch', 'Siro-Malabar Katoliek'],
    ['ukr-greek-catholic', 'Ukrainian Greek Catholic', 'Ukrainisch griechisch-katholisch', 'Oekraïens Grieks-Katoliek'],
  ] },
  { id: 'chr-free', en: 'Christian: Evangelical free churches', de: 'Christlich: evangelische Freikirchen', af: 'Christelik: Evangeliese vrykerke', source: 'Vereinigung Evangelischer Freikirchen; World Evangelical Alliance', faiths: [
    ['free-church', 'Evangelical free church', 'Evangelische Freikirche', 'Evangeliese vrykerk'],
    ['feg', 'Free Evangelical Church (FeG)', 'Freie evangelische Gemeinde (FeG)', 'Vrye Evangeliese Gemeente (FeG)'],
    ['moravian', 'Moravian Church', 'Herrnhuter Brüdergemeine', 'Morawiese Kerk'],
    ['non-denominational', 'Non-denominational Christian', 'Überkonfessionell christlich', 'Nie-denominasioneel Christen'],
    ['plymouth', 'Brethren (Plymouth)', 'Brüderbewegung', 'Broederbeweging'],
    ['waldensian', 'Waldensian', 'Waldenser', 'Waldense'],
  ] },
  { id: 'chr-lutheran', en: 'Christian: Lutheran and United', de: 'Christlich: evangelisch-lutherisch und uniert', af: 'Christelik: Luthers en Verenig', source: 'Evangelische Kirche in Deutschland; Lutheran World Federation', faiths: [
    ['elca-sa', 'Evangelical Lutheran Church in Southern Africa', 'Evangelisch-Lutherische Kirche im südlichen Afrika', 'Evangelies-Lutherse Kerk in Suider-Afrika'],
    ['evangelisch', 'Protestant (German regional church, EKD)', 'Evangelisch (Landeskirche, EKD)', 'Evangelies (Duitse streekskerk, EKD)', ['evangelisch', 'evangelical german', 'german evangelical', 'landeskirche']],
    ['lutheran', 'Lutheran', 'Evangelisch-lutherisch', 'Luthers', ['lutherisch']],
    ['selk', 'Independent Evangelical Lutheran Church (SELK)', 'Selbständige Evangelisch-Lutherische Kirche (SELK)', 'Onafhanklike Evangelies-Lutherse Kerk (SELK)'],
    ['united', 'United Protestant', 'Evangelisch-uniert', 'Verenigde Protestant', ['uniert']],
  ] },
  { id: 'chr-methodist', en: 'Christian: Methodist', de: 'Christlich: methodistisch', af: 'Christelik: Metodisties', source: 'World Methodist Council', faiths: [
    ['emk', 'United Methodist Church (EmK)', 'Evangelisch-methodistische Kirche (EmK)', 'Verenigde Metodistekerk (EmK)'],
    ['mcsa', 'Methodist Church of Southern Africa', 'Methodistische Kirche im südlichen Afrika', 'Metodistekerk van Suider-Afrika'],
    ['methodist', 'Methodist', 'Methodistisch', 'Metodis'],
    ['salvation-army', 'The Salvation Army', 'Die Heilsarmee', 'Die Heilsleër'],
    ['wesleyan', 'Wesleyan', 'Wesleyanisch', 'Wesleyaans'],
  ] },
  { id: 'chr-eastern', en: 'Christian: Eastern Orthodox', de: 'Christlich: östlich-orthodox', af: 'Christelik: Oosters-Ortodoks', source: 'The autocephalous churches’ own names', faiths: [
    ['antiochian', 'Antiochian Orthodox', 'Antiochenisch-orthodox', 'Antiochiese Ortodoks'],
    ['bulgarian', 'Bulgarian Orthodox', 'Bulgarisch-orthodox', 'Bulgaars-Ortodoks'],
    ['eastern-orthodox', 'Eastern Orthodox', 'Orthodox', 'Oosters-Ortodoks'],
    ['georgian', 'Georgian Orthodox', 'Georgisch-orthodox', 'Georgies-Ortodoks'],
    ['greek-orthodox', 'Greek Orthodox', 'Griechisch-orthodox', 'Grieks-Ortodoks'],
    ['romanian', 'Romanian Orthodox', 'Rumänisch-orthodox', 'Roemeens-Ortodoks'],
    ['russian', 'Russian Orthodox', 'Russisch-orthodox', 'Russies-Ortodoks'],
    ['serbian', 'Serbian Orthodox', 'Serbisch-orthodox', 'Serwies-Ortodoks'],
    ['ukrainian', 'Ukrainian Orthodox', 'Ukrainisch-orthodox', 'Oekraïens-Ortodoks'],
  ] },
  { id: 'chr-oriental', en: 'Christian: Oriental Orthodox and Church of the East', de: 'Christlich: orientalisch-orthodox und Kirche des Ostens', af: 'Christelik: Oriëntaals-Ortodoks en Kerk van die Ooste', source: 'The churches’ own names', faiths: [
    ['armenian', 'Armenian Apostolic', 'Armenisch-apostolisch', 'Armeens-Apostolies'],
    ['assyrian', 'Assyrian Church of the East', 'Assyrische Kirche des Ostens', 'Assiriese Kerk van die Ooste'],
    ['coptic', 'Coptic Orthodox', 'Koptisch-orthodox', 'Kopties-Ortodoks'],
    ['eritrean', 'Eritrean Orthodox Tewahedo', 'Eritreisch-orthodox (Tewahedo)', 'Eritrees-Ortodoks (Tewahedo)'],
    ['ethiopian', 'Ethiopian Orthodox Tewahedo', 'Äthiopisch-orthodox (Tewahedo)', 'Etiopies-Ortodoks (Tewahedo)'],
    ['malankara', 'Malankara Orthodox', 'Malankara-orthodox', 'Malankara-Ortodoks'],
    ['syriac', 'Syriac Orthodox', 'Syrisch-orthodox', 'Siries-Ortodoks'],
  ] },
  { id: 'chr-pentecostal', en: 'Christian: Pentecostal and Charismatic', de: 'Christlich: pfingstlich und charismatisch', af: 'Christelik: Pinkster en Charismaties', source: 'Pentecostal World Fellowship', faiths: [
    ['afm', 'Apostolic Faith Mission', 'Apostolic Faith Mission', 'Apostoliese Geloofsending', ['agS', 'ags']],
    ['aog', 'Assemblies of God', 'Assemblies of God', 'Assemblies of God'],
    ['bfp', 'Federation of Pentecostal Churches (BFP)', 'Bund Freikirchlicher Pfingstgemeinden (BFP)', 'Bond van Pinkstergemeentes (BFP)'],
    ['charismatic', 'Charismatic', 'Charismatisch', 'Charismaties'],
    ['church-of-god', 'Church of God (Pentecostal)', 'Gemeinde Gottes (pfingstlich)', 'Kerk van God (Pinkster)'],
    ['foursquare', 'Foursquare Church', 'Foursquare-Kirche', 'Foursquare-kerk'],
    ['full-gospel', 'Full Gospel Church', 'Volles Evangelium', 'Volle Evangelie Kerk'],
    ['pentecostal', 'Pentecostal', 'Pfingstlich', 'Pinkster'],
  ] },
  { id: 'chr-reformed', en: 'Christian: Reformed and Presbyterian', de: 'Christlich: reformiert und presbyterianisch', af: 'Christelik: Gereformeerd en Presbiteriaans', source: 'World Communion of Reformed Churches; the churches’ own names', faiths: [
    ['church-of-scotland', 'Church of Scotland', 'Kirche von Schottland', 'Kerk van Skotland'],
    ['congregational', 'Congregational', 'Kongregationalistisch', 'Kongregasionaal'],
    ['gkv', 'Gereformeerde Kerke in Suid-Afrika', 'Gereformeerde Kerke in Südafrika', 'Gereformeerde Kerke in Suid-Afrika', ['dopper']],
    ['huguenot', 'Huguenot (French Reformed)', 'Hugenottisch', 'Hugenote'],
    ['ng', 'Dutch Reformed Church (NG Kerk)', 'Niederländisch-reformierte Kirche (NG Kerk)', 'Nederduitse Gereformeerde Kerk (NG Kerk)', ['ng kerk', 'ngk']],
    ['nhk', 'Nederduitsch Hervormde Kerk', 'Nederduitsch Hervormde Kerk (Südafrika)', 'Nederduitsch Hervormde Kerk'],
    ['presbyterian', 'Presbyterian', 'Presbyterianisch', 'Presbiteriaans'],
    ['reformed', 'Reformed', 'Reformiert', 'Gereformeerd', ['calvinist']],
    ['urcsa', 'Uniting Reformed Church in Southern Africa', 'Vereinigende Reformierte Kirche im südlichen Afrika', 'Verenigende Gereformeerde Kerk in Suider-Afrika', ['vgk']],
  ] },
  { id: 'east-asian', en: 'East Asian religions', de: 'Ostasiatische Religionen', af: 'Oos-Asiatiese godsdienste', source: 'Oxford Handbook of Chinese Religions; the communities’ own names', faiths: [
    ['caodai', 'Cao Đài', 'Cao Đài', 'Cao Đài', ['cao dai']],
    ['cheondoism', 'Cheondoism', 'Cheondoismus', 'Cheondoïsme'],
    ['chinese-folk', 'Chinese folk religion', 'Chinesische Volksreligion', 'Chinese volksgodsdiens'],
    ['confucian', 'Confucian', 'Konfuzianisch', 'Konfuciaans'],
    ['muism', 'Muism (Korean shamanism)', 'Muismus (koreanischer Schamanismus)', 'Muïsme (Koreaanse sjamanisme)'],
    ['shinto', 'Shinto', 'Shintō', 'Sjinto'],
    ['taoist', 'Taoist', 'Taoistisch', 'Taoïsties', ['daoist']],
    ['tenrikyo', 'Tenrikyo', 'Tenrikyō', 'Tenrikjo', ['tenrikyo']],
  ] },
  { id: 'hindu', en: 'Hindu', de: 'Hinduistisch', af: 'Hindoe', source: 'Flood, An Introduction to Hinduism', faiths: [
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
  { id: 'indigenous', en: 'Indigenous traditions', de: 'Indigene Traditionen', af: 'Inheemse tradisies', source: 'Harvey, Indigenous Religions: A Companion', faiths: [
    ['aboriginal', 'Aboriginal Australian spirituality', 'Spiritualität der Aborigines', 'Aboriginale spiritualiteit van Australië'],
    ['andean', 'Andean tradition', 'Andine Tradition', 'Andes-tradisie'],
    ['first-nations', 'First Nations tradition', 'Tradition der First Nations', 'Tradisie van die Eerste Nasies'],
    ['hawaiian', 'Native Hawaiian tradition', 'Hawaiianische Tradition', 'Hawaiiaanse tradisie'],
    ['inuit', 'Inuit tradition', 'Tradition der Inuit', 'Inuit-tradisie'],
    ['maori', 'Māori tradition', 'Tradition der Māori', 'Māori-tradisie'],
    ['mesoamerican', 'Mesoamerican tradition', 'Mesoamerikanische Tradition', 'Meso-Amerikaanse tradisie'],
    ['native-american', 'Native American tradition', 'Tradition der amerikanischen Ureinwohner', 'Inheemse Amerikaanse tradisie'],
    ['sami', 'Sámi tradition', 'Tradition der Sámi', 'Sámi-tradisie'],
    ['shamanic', 'Shamanic tradition', 'Schamanische Tradition', 'Sjamanistiese tradisie'],
  ] },
  { id: 'islam', en: 'Islam', de: 'Islam', af: 'Islam', source: 'Oxford Dictionary of Islam; Encyclopaedia of Islam', faiths: [
    ['ahmadi', 'Ahmadi Muslim', 'Ahmadiyya', 'Ahmadi-Moslem', ['ahmadiyya']],
    ['alawite', 'Alawite', 'Alawitisch', 'Alawiet'],
    ['alevi', 'Alevi', 'Alevitisch', 'Alewiet', ['alevite']],
    ['hanafi', 'Sunni: Hanafi', 'Sunnitisch: hanafitisch', 'Soenniet: Hanafi'],
    ['hanbali', 'Sunni: Hanbali', 'Sunnitisch: hanbalitisch', 'Soenniet: Hanbali'],
    ['ibadi', 'Ibadi', 'Ibaditisch', 'Ibadi'],
    ['ismaili', 'Shia: Ismaili', 'Schiitisch: ismailitisch', 'Sjia: Ismaili'],
    ['maliki', 'Sunni: Maliki', 'Sunnitisch: malikitisch', 'Soenniet: Maliki'],
    ['muslim', 'Muslim', 'Muslimisch', 'Moslem', ['islam']],
    ['quranist', 'Quranist', 'Koranisch', 'Koranis'],
    ['shafii', 'Sunni: Shafi‘i', 'Sunnitisch: schafiitisch', 'Soenniet: Sjafi‘i', ['shafi']],
    ['shia', 'Shia', 'Schiitisch', 'Sjia', ['shiite']],
    ['sufi', 'Sufi', 'Sufi', 'Soefi'],
    ['sunni', 'Sunni', 'Sunnitisch', 'Soenniet'],
    ['twelver', 'Shia: Twelver', 'Schiitisch: Zwölfer', 'Sjia: Twaalwers'],
    ['zaydi', 'Shia: Zaydi', 'Schiitisch: zaiditisch', 'Sjia: Zaidi'],
  ] },
  { id: 'jain', en: 'Jain', de: 'Jainistisch', af: 'Djain', source: 'Dundas, The Jains', faiths: [
    ['digambara', 'Digambara', 'Digambara', 'Digambara'],
    ['jain', 'Jain', 'Jaina', 'Djain-geloof'],
    ['svetambara', 'Śvētāmbara', 'Shvetambara', 'Sjwetambara', ['svetambara', 'shvetambara']],
  ] },
  { id: 'jewish', en: 'Jewish', de: 'Jüdisch', af: 'Joods', source: 'Encyclopaedia Judaica; World Union for Progressive Judaism', faiths: [
    ['beta-israel', 'Beta Israel', 'Beta Israel', 'Beta Israel'],
    ['conservative', 'Conservative (Masorti)', 'Masorti (konservativ)', 'Konserwatief (Masorti)'],
    ['haredi', 'Haredi', 'Charedisch', 'Charedies'],
    ['hasidic', 'Hasidic', 'Chassidisch', 'Chassidies'],
    ['humanistic-jewish', 'Humanistic Jewish', 'Humanistisch-jüdisch', 'Humanisties-Joods'],
    ['jewish', 'Jewish', 'Jüdisch', 'Jood'],
    ['karaite', 'Karaite', 'Karäisch', 'Karaïet'],
    ['modern-orthodox', 'Modern Orthodox', 'Modern-orthodox', 'Modern-Ortodoks'],
    ['orthodox-jewish', 'Orthodox Jewish', 'Orthodox-jüdisch', 'Ortodoks-Joods'],
    ['reconstructionist', 'Reconstructionist', 'Rekonstruktionistisch', 'Rekonstruksionisties'],
    ['reform', 'Reform or Liberal Jewish', 'Liberal-jüdisch (Reform)', 'Hervormd of Liberaal Joods'],
  ] },
  { id: 'near-eastern', en: 'Near Eastern traditions', de: 'Traditionen des Nahen Ostens', af: 'Tradisies van die Nabye Ooste', source: 'Oxford Handbook of Religious Diversity; the communities’ own names', faiths: [
    ['druze', 'Druze (Muwahhidun)', 'Drusisch (Muwahhidun)', 'Druse (Muwahhidun)'],
    ['mandaean', 'Mandaean', 'Mandäisch', 'Mandeër'],
    ['samaritan', 'Samaritan', 'Samaritanisch', 'Samaritaan'],
    ['yarsan', 'Yarsan (Ahl-e Haqq)', 'Yarsan (Ahl-e Haqq)', 'Yarsan (Ahl-e Haqq)'],
    ['yazidi', 'Yazidi', 'Jesidisch', 'Jesidi', ['ezidi', 'yezidi']],
    ['zoroastrian', 'Zoroastrian (Parsi, Irani)', 'Zoroastrisch (Parsen)', 'Zoroastries (Parsi)', ['parsi']],
  ] },
  { id: 'none', en: 'No religion or no answer', de: 'Keine Religion oder keine Angabe', af: 'Geen godsdiens of geen antwoord', source: 'Pew Research Center religious categories', faiths: [
    ['agnostic', 'Agnostic', 'Agnostisch', 'Agnosties'],
    ['atheist', 'Atheist', 'Atheistisch', 'Ateïs'],
    ['freethinker', 'Freethinker', 'Freidenkend', 'Vrydenker'],
    ['humanist', 'Humanist', 'Humanistisch', 'Humanis'],
    ['no-religion', 'No religion', 'Keine Religion', 'Geen godsdiens', ['none', 'keine', 'konfessionslos']],
    ['prefer-not', 'Prefer not to say', 'Keine Angabe', 'Verkies om nie te sê nie'],
    ['spiritual', 'Spiritual, not religious', 'Spirituell, nicht religiös', 'Geestelik, nie godsdienstig nie'],
    ['unknown', 'Unknown', 'Unbekannt', 'Onbekend'],
  ] },
  { id: 'pagan', en: 'Pagan and contemporary spirituality', de: 'Paganismus und zeitgenössische Spiritualität', af: 'Paganisme en hedendaagse spiritualiteit', source: 'Clarke, Encyclopedia of New Religious Movements', faiths: [
    ['anthroposophy', 'Anthroposophy', 'Anthroposophie', 'Antroposofie', ['christengemeinschaft']],
    ['asatru', 'Heathenry (Ásatrú)', 'Germanisches Heidentum (Ásatrú)', 'Heidendom (Ásatrú)', ['asatru']],
    ['druidry', 'Druidry', 'Druidentum', 'Druïdisme'],
    ['hellenic', 'Hellenism (Hellenic polytheism)', 'Hellenismus (hellenischer Polytheismus)', 'Hellenisme (Griekse politeïsme)'],
    ['new-age', 'New Age', 'New Age', 'Nuwe Era'],
    ['pagan', 'Pagan', 'Heidnisch', 'Heidens', ['paganism']],
    ['rodnovery', 'Rodnovery', 'Rodnoverie', 'Rodnoverie', ['slavic']],
    ['spiritism', 'Spiritism', 'Spiritismus', 'Spiritisme'],
    ['theosophy', 'Theosophy', 'Theosophie', 'Teosofie'],
    ['unitarian', 'Unitarian Universalist', 'Unitarisch', 'Unitaries'],
    ['wicca', 'Wicca', 'Wicca', 'Wicca'],
  ] },
  { id: 'sikh', en: 'Sikh', de: 'Sikh', af: 'Sikh', source: 'Singh, The Oxford Handbook of Sikh Studies', faiths: [
    ['khalsa', 'Khalsa (Amritdhari)', 'Khalsa (Amritdhari)', 'Khalsa (Amritdhari)'],
    ['namdhari', 'Namdhari', 'Namdhari', 'Namdhari'],
    ['nanakpanthi', 'Nanakpanthi', 'Nanakpanthi', 'Nanakpanthi'],
    ['sikh', 'Sikh (Sikhi)', 'Sikh (Sikhi)', 'Sikh (Sikhi)', ['sikhism']],
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
