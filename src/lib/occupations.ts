// The occupation vocabulary: about 250 occupations from medieval times to today, each with a stable id, an
// English label, German masculine and feminine forms, an Afrikaans label and search keywords. Ids are forever:
// never rename one, only add. The helpers at the end turn a stored code into the label a reader should see.
import type { Locale } from './i18n/types.ts';

/** One occupation. Labels are singular; `de` holds the masculine and feminine forms. */
export interface Occupation {
  /** Stable, lowercase ASCII with underscores, e.g. 'baker', 'software_developer'. Never reused. */
  id: string;
  /** English label, singular, capitalised, e.g. 'Baker'. */
  en: string;
  /** German: masculine and feminine forms, e.g. { m: 'Bäcker', f: 'Bäckerin' }. */
  de: { m: string; f: string };
  /** Afrikaans label, singular, capitalised, natural Afrikaans, e.g. 'Bakker'. */
  af: string;
  /** Extra search words in any language (lowercase), synonyms and related words; 2–6 per entry. Include the English/German/Afrikaans spelling variants a user might type, without accents where a plain form is common (e.g. 'backer' as well as 'bäcker'). */
  keywords: string[];
}

export const OCCUPATIONS: readonly Occupation[] = [
  { id: 'farmer', en: 'Farmer', de: { m: 'Bauer', f: 'Bäuerin' }, af: 'Boer', keywords: ['farm', 'landwirt', 'landwirtschaft', 'crops', 'boer'] },
  { id: 'dairy_farmer', en: 'Dairy farmer', de: { m: 'Milchbauer', f: 'Milchbäuerin' }, af: 'Melkboer', keywords: ['milk', 'cows', 'dairy', 'milchwirtschaft', 'kuh'] },
  { id: 'fruit_grower', en: 'Fruit grower', de: { m: 'Obstbauer', f: 'Obstbäuerin' }, af: 'Vrugteboer', keywords: ['fruit', 'orchard', 'obst', 'obstbau', 'orchards'] },
  { id: 'vintner', en: 'Vintner', de: { m: 'Winzer', f: 'Winzerin' }, af: 'Wynmaker', keywords: ['wine', 'grapes', 'winzer', 'wein', 'winemaker'] },
  { id: 'beekeeper', en: 'Beekeeper', de: { m: 'Imker', f: 'Imkerin' }, af: 'Byeboer', keywords: ['bees', 'honey', 'bienen', 'imkerei', 'honig'] },
  { id: 'shepherd', en: 'Shepherd', de: { m: 'Hirte', f: 'Hirtin' }, af: 'Herder', keywords: ['sheep', 'flock', 'herde', 'schäfer', 'schaefer'] },
  { id: 'hunter', en: 'Hunter', de: { m: 'Jäger', f: 'Jägerin' }, af: 'Jagter', keywords: ['game', 'hunting', 'jäger', 'jagd', 'trapper'] },
  { id: 'fisherman', en: 'Fisherman', de: { m: 'Fischer', f: 'Fischerin' }, af: 'Visserman', keywords: ['fishing', 'fish', 'fischerei', 'angler', 'vis'] },
  { id: 'forester', en: 'Forester', de: { m: 'Förster', f: 'Försterin' }, af: 'Boswagter', keywords: ['forest', 'woodland', 'forst', 'wald', 'ranger'] },
  { id: 'lumberjack', en: 'Lumberjack', de: { m: 'Holzfäller', f: 'Holzfällerin' }, af: 'Houtkapper', keywords: ['wood', 'logging', 'trees', 'holzfaeller', 'timber'] },
  { id: 'gardener', en: 'Gardener', de: { m: 'Gärtner', f: 'Gärtnerin' }, af: 'Tuinier', keywords: ['garden', 'plants', 'gartner', 'horticulture', 'tuin'] },
  { id: 'landscape_gardener', en: 'Landscape gardener', de: { m: 'Landschaftsgärtner', f: 'Landschaftsgärtnerin' }, af: 'Tuinargitek', keywords: ['landscaping', 'garden', 'landschaft', 'design', 'tuin'] },
  { id: 'miller', en: 'Miller', de: { m: 'Müller', f: 'Müllerin' }, af: 'Meulenaar', keywords: ['mill', 'miller', 'mühle', 'muhle', 'grain'] },
  { id: 'baker', en: 'Baker', de: { m: 'Bäcker', f: 'Bäckerin' }, af: 'Bakker', keywords: ['bread', 'oven', 'bäckerei', 'bakery', 'brot'] },
  { id: 'confectioner', en: 'Confectioner', de: { m: 'Konditor', f: 'Konditorin' }, af: 'Banketbakker', keywords: ['cakes', 'pastry', 'sweets', 'konditorei', 'patisserie'] },
  { id: 'butcher', en: 'Butcher', de: { m: 'Metzger', f: 'Metzgerin' }, af: 'Slagter', keywords: ['meat', 'sausage', 'fleischer', 'fleisch', 'wurst'] },
  { id: 'brewer', en: 'Brewer', de: { m: 'Brauer', f: 'Brauerin' }, af: 'Brouer', keywords: ['beer', 'brewery', 'bier', 'brauerei', 'brew'] },
  { id: 'distiller', en: 'Distiller', de: { m: 'Brenner', f: 'Brennerin' }, af: 'Distilleerder', keywords: ['spirits', 'whisky', 'schnaps', 'distillery', 'brennerei'] },
  { id: 'cooper', en: 'Cooper', de: { m: 'Küfer', f: 'Küferin' }, af: 'Kuiper', keywords: ['barrels', 'casks', 'barrel', 'kufer', 'fass'] },
  { id: 'tanner', en: 'Tanner', de: { m: 'Gerber', f: 'Gerberin' }, af: 'Leerlooier', keywords: ['leather', 'hides', 'tanning', 'gerberei', 'leder'] },
  { id: 'saddler', en: 'Saddler', de: { m: 'Sattler', f: 'Sattlerin' }, af: 'Saalmaker', keywords: ['saddle', 'harness', 'sattlerei', 'leather', 'zaum'] },
  { id: 'blacksmith', en: 'Blacksmith', de: { m: 'Schmied', f: 'Schmiedin' }, af: 'Smid', keywords: ['smithy', 'forge', 'metal', 'schmiede', 'anvil'] },
  { id: 'locksmith', en: 'Locksmith', de: { m: 'Schlosser', f: 'Schlosserin' }, af: 'Slotmaker', keywords: ['locks', 'keys', 'schlüssel', 'schluessel', 'schlosserei'] },
  { id: 'goldsmith', en: 'Goldsmith', de: { m: 'Goldschmied', f: 'Goldschmiedin' }, af: 'Goudsmid', keywords: ['gold', 'jewellery', 'jewelry', 'schmuck', 'goldschmiede'] },
  { id: 'jeweller', en: 'Jeweller', de: { m: 'Juwelier', f: 'Juwelierin' }, af: 'Juwelier', keywords: ['jewelry', 'gems', 'schmuck', 'juwelen', 'jeweler'] },
  { id: 'watchmaker', en: 'Watchmaker', de: { m: 'Uhrmacher', f: 'Uhrmacherin' }, af: 'Horlosiemaker', keywords: ['watches', 'clocks', 'uhr', 'uhrmacherei', 'clockmaker'] },
  { id: 'weaver', en: 'Weaver', de: { m: 'Weber', f: 'Weberin' }, af: 'Wewer', keywords: ['loom', 'cloth', 'textile', 'weberei', 'weben'] },
  { id: 'spinner', en: 'Spinner', de: { m: 'Spinner', f: 'Spinnerin' }, af: 'Spinner', keywords: ['yarn', 'thread', 'spinnen', 'spinnerei', 'wool'] },
  { id: 'dyer', en: 'Dyer', de: { m: 'Färber', f: 'Färberin' }, af: 'Verwer', keywords: ['dye', 'colour', 'color', 'farben', 'faerber'] },
  { id: 'seamstress', en: 'Seamstress', de: { m: 'Näher', f: 'Näherin' }, af: 'Naaister', keywords: ['sewing', 'stitching', 'nähen', 'naehen', 'mending'] },
  { id: 'tailor', en: 'Tailor', de: { m: 'Schneider', f: 'Schneiderin' }, af: 'Snyer', keywords: ['clothes', 'sewing', 'suits', 'schneiderei', 'kleider'] },
  { id: 'hatter', en: 'Hatter', de: { m: 'Hutmacher', f: 'Hutmacherin' }, af: 'Hoedemaker', keywords: ['hats', 'millinery', 'hut', 'huete', 'milliner'] },
  { id: 'shoemaker', en: 'Shoemaker', de: { m: 'Schuhmacher', f: 'Schuhmacherin' }, af: 'Skoenmaker', keywords: ['shoes', 'cobbler', 'schuster', 'boots', 'schuh'] },
  { id: 'potter', en: 'Potter', de: { m: 'Töpfer', f: 'Töpferin' }, af: 'Pottebakker', keywords: ['clay', 'pottery', 'ceramics', 'toepfer', 'keramik'] },
  { id: 'glassblower', en: 'Glassblower', de: { m: 'Glasbläser', f: 'Glasbläserin' }, af: 'Glasblaser', keywords: ['glass', 'glassworks', 'glas', 'glaser', 'glasmacher'] },
  { id: 'glazier', en: 'Glazier', de: { m: 'Glaser', f: 'Glaserin' }, af: 'Glasmeester', keywords: ['glass', 'windows', 'glaserei', 'panes', 'fenster'] },
  { id: 'carpenter', en: 'Carpenter', de: { m: 'Zimmermann', f: 'Zimmerin' }, af: 'Timmerman', keywords: ['wood', 'timber', 'joinery', 'zimmerei', 'holz'] },
  { id: 'cabinetmaker', en: 'Cabinetmaker', de: { m: 'Tischler', f: 'Tischlerin' }, af: 'Meubelmaker', keywords: ['furniture', 'wood', 'carpentry', 'tischlerei', 'möbel'] },
  { id: 'mason', en: 'Mason', de: { m: 'Maurer', f: 'Maurerin' }, af: 'Messelaar', keywords: ['bricks', 'stone', 'masonry', 'mauer', 'bricklayer'] },
  { id: 'roofer', en: 'Roofer', de: { m: 'Dachdecker', f: 'Dachdeckerin' }, af: 'Dakwerker', keywords: ['roof', 'roofing', 'tiles', 'dach', 'dakke'] },
  { id: 'thatcher', en: 'Thatcher', de: { m: 'Reetdachdecker', f: 'Reetdachdeckerin' }, af: 'Rietdekker', keywords: ['thatch', 'reed', 'reetdach', 'roof', 'riet'] },
  { id: 'painter', en: 'Painter', de: { m: 'Maler', f: 'Malerin' }, af: 'Skilder', keywords: ['paint', 'decorator', 'anstreicher', 'painting', 'maler'] },
  { id: 'tiler', en: 'Tiler', de: { m: 'Fliesenleger', f: 'Fliesenlegerin' }, af: 'Teëlsetter', keywords: ['tiles', 'floor', 'flooring', 'fliesen', 'tegels'] },
  { id: 'plumber', en: 'Plumber', de: { m: 'Klempner', f: 'Klempnerin' }, af: 'Loodgieter', keywords: ['pipes', 'plumbing', 'sanitär', 'sanitaer', 'water'] },
  { id: 'electrician', en: 'Electrician', de: { m: 'Elektriker', f: 'Elektrikerin' }, af: 'Elektrisien', keywords: ['electricity', 'wiring', 'electrical', 'elektro', 'strom'] },
  { id: 'chimney_sweep', en: 'Chimney sweep', de: { m: 'Schornsteinfeger', f: 'Schornsteinfegerin' }, af: 'Skoorsteenveër', keywords: ['chimney', 'soot', 'schornstein', 'sweep', 'kamin'] },
  { id: 'tinker', en: 'Tinker', de: { m: 'Kesselflicker', f: 'Kesselflickerin' }, af: 'Ketellapper', keywords: ['mender', 'repairs', 'kesselflicker', 'wanderer', 'tinsmith'] },
  { id: 'rope_maker', en: 'Rope maker', de: { m: 'Seiler', f: 'Seilerin' }, af: 'Touwmaker', keywords: ['rope', 'cord', 'seil', 'twine', 'ropewalk'] },
  { id: 'chandler', en: 'Chandler', de: { m: 'Kerzenmacher', f: 'Kerzenmacherin' }, af: 'Kersmaker', keywords: ['candles', 'wax', 'kerze', 'candle', 'kerzen'] },
  { id: 'basket_maker', en: 'Basket maker', de: { m: 'Korbmacher', f: 'Korbmacherin' }, af: 'Mandjiemaker', keywords: ['baskets', 'wicker', 'korb', 'weiden', 'basketry'] },
  { id: 'miner', en: 'Miner', de: { m: 'Bergmann', f: 'Bergarbeiterin' }, af: 'Mynwerker', keywords: ['mine', 'coal', 'bergbau', 'mining', 'kumpel'] },
  { id: 'sailor', en: 'Sailor', de: { m: 'Seemann', f: 'Seemann' }, af: 'Matroos', keywords: ['sea', 'ship', 'seefahrt', 'navy', 'marine'] },
  { id: 'ship_captain', en: 'Ship captain', de: { m: 'Kapitän', f: 'Kapitänin' }, af: 'Kaptein', keywords: ['captain', 'ship', 'skipper', 'schiff', 'kapitän'] },
  { id: 'shipwright', en: 'Shipwright', de: { m: 'Schiffbauer', f: 'Schiffbauerin' }, af: 'Skeepsbouer', keywords: ['ships', 'boats', 'shipyard', 'schiffbau', 'boat'] },
  { id: 'welder', en: 'Welder', de: { m: 'Schweißer', f: 'Schweißerin' }, af: 'Sweiser', keywords: ['welding', 'metal', 'schweißen', 'schweissen', 'steel'] },
  { id: 'machinist', en: 'Machinist', de: { m: 'Maschinist', f: 'Maschinistin' }, af: 'Masjinis', keywords: ['machine', 'machines', 'maschinen', 'cnc', 'factory'] },
  { id: 'foundry_worker', en: 'Foundry worker', de: { m: 'Gießer', f: 'Gießerin' }, af: 'Gieter', keywords: ['casting', 'metal', 'foundry', 'giesserei', 'gießerei'] },
  { id: 'steelworker', en: 'Steelworker', de: { m: 'Stahlarbeiter', f: 'Stahlarbeiterin' }, af: 'Staalwerker', keywords: ['steel', 'mill', 'stahl', 'hütte', 'huette'] },
  { id: 'factory_worker', en: 'Factory worker', de: { m: 'Fabrikarbeiter', f: 'Fabrikarbeiterin' }, af: 'Fabrieksarbeider', keywords: ['factory', 'manufacturing', 'assembly', 'fabrik', 'industry'] },
  { id: 'bookbinder', en: 'Bookbinder', de: { m: 'Buchbinder', f: 'Buchbinderin' }, af: 'Boekbinder', keywords: ['books', 'binding', 'bookbinding', 'buchbinderei', 'buch'] },
  { id: 'printer', en: 'Printer', de: { m: 'Drucker', f: 'Druckerin' }, af: 'Drukker', keywords: ['printing', 'press', 'typesetter', 'druck', 'druckerei'] },
  { id: 'mechanic', en: 'Mechanic', de: { m: 'Mechaniker', f: 'Mechanikerin' }, af: 'Monteur', keywords: ['repair', 'engine', 'motor', 'werkstatt', 'car'] },
  { id: 'construction_worker', en: 'Construction worker', de: { m: 'Bauarbeiter', f: 'Bauarbeiterin' }, af: 'Bouwerker', keywords: ['building', 'site', 'construction', 'bau', 'labourer'] },
  { id: 'crane_operator', en: 'Crane operator', de: { m: 'Kranführer', f: 'Kranführerin' }, af: 'Kraanoperateur', keywords: ['crane', 'construction', 'lifting', 'kran', 'hoist'] },
  { id: 'surveyor', en: 'Surveyor', de: { m: 'Vermessungsingenieur', f: 'Vermessungsingenieurin' }, af: 'Landmeter', keywords: ['land', 'maps', 'survey', 'vermessung', 'landmesser'] },
  { id: 'cartographer', en: 'Cartographer', de: { m: 'Kartograf', f: 'Kartografin' }, af: 'Kartograaf', keywords: ['maps', 'mapping', 'cartography', 'karte', 'karten'] },
  { id: 'scaffolder', en: 'Scaffolder', de: { m: 'Gerüstbauer', f: 'Gerüstbauerin' }, af: 'Steierwerker', keywords: ['scaffolding', 'construction', 'gerüst', 'geruest', 'steier'] },
  { id: 'knight', en: 'Knight', de: { m: 'Ritter', f: 'Ritter' }, af: 'Ridder', keywords: ['medieval', 'chivalry', 'sword', 'ritterlich', 'crusade'] },
  { id: 'servant', en: 'Servant', de: { m: 'Knecht', f: 'Magd' }, af: 'Bediende', keywords: ['serf', 'domestic', 'hired hand', 'dienstbote', 'dienstbode'] },
  { id: 'maid', en: 'Maid', de: { m: 'Dienstmädchen', f: 'Dienstmädchen' }, af: 'Diensmeisie', keywords: ['housemaid', 'domestic', 'dienstmagd', 'hausmädchen', 'meid'] },
  { id: 'housekeeper', en: 'Housekeeper', de: { m: 'Haushälter', f: 'Haushälterin' }, af: 'Huishoudster', keywords: ['household', 'domestic', 'haushalt', 'hausdame', 'cleaning'] },
  { id: 'cook', en: 'Cook', de: { m: 'Koch', f: 'Köchin' }, af: 'Kok', keywords: ['kitchen', 'chef', 'food', 'küche', 'kochen'] },
  { id: 'innkeeper', en: 'Innkeeper', de: { m: 'Gastwirt', f: 'Gastwirtin' }, af: 'Herbergier', keywords: ['inn', 'tavern', 'wirt', 'gasthaus', 'herberg'] },
  { id: 'hotelier', en: 'Hotelier', de: { m: 'Hotelier', f: 'Hotelière' }, af: 'Hotelhouer', keywords: ['hotel', 'hotels', 'hospitality', 'hotelbetreiber', 'hostel'] },
  { id: 'waiter', en: 'Waiter', de: { m: 'Kellner', f: 'Kellnerin' }, af: 'Kelner', keywords: ['restaurant', 'service', 'serving', 'kellnern', 'server'] },
  { id: 'barista', en: 'Barista', de: { m: 'Barista', f: 'Barista' }, af: 'Barista', keywords: ['coffee', 'café', 'cafe', 'kaffee', 'espresso'] },
  { id: 'sommelier', en: 'Sommelier', de: { m: 'Sommelier', f: 'Sommelière' }, af: 'Sommelier', keywords: ['wine', 'wine waiter', 'weinkellner', 'wine expert', 'wein'] },
  { id: 'barber', en: 'Barber', de: { m: 'Friseur', f: 'Friseurin' }, af: 'Kapper', keywords: ['hair', 'haircut', 'barbier', 'haare', 'hairdresser'] },
  { id: 'beautician', en: 'Beautician', de: { m: 'Kosmetiker', f: 'Kosmetikerin' }, af: 'Skoonheidsterapeut', keywords: ['beauty', 'cosmetics', 'makeup', 'kosmetik', 'schönheit'] },
  { id: 'tattoo_artist', en: 'Tattoo artist', de: { m: 'Tätowierer', f: 'Tätowiererin' }, af: 'Tatoeëerder', keywords: ['tattoo', 'tattoos', 'tätowieren', 'taetowierer', 'ink'] },
  { id: 'cleaner', en: 'Cleaner', de: { m: 'Reinigungskraft', f: 'Reinigungskraft' }, af: 'Skoonmaker', keywords: ['cleaning', 'housekeeping', 'reinigung', 'putzfrau', 'putzmann'] },
  { id: 'janitor', en: 'Janitor', de: { m: 'Hausmeister', f: 'Hausmeisterin' }, af: 'Opsigter', keywords: ['caretaker', 'building', 'porter', 'hausverwalter', 'concierge'] },
  { id: 'security_guard', en: 'Security guard', de: { m: 'Wachmann', f: 'Wachfrau' }, af: 'Sekuriteitswag', keywords: ['security', 'guard', 'wachdienst', 'bewacher', 'watchman'] },
  { id: 'childminder', en: 'Childminder', de: { m: 'Tagesvater', f: 'Tagesmutter' }, af: 'Kinderoppasser', keywords: ['childcare', 'nanny', 'kinder', 'babysitter', 'tagesmutter'] },
  { id: 'coachman', en: 'Coachman', de: { m: 'Kutscher', f: 'Kutscherin' }, af: 'Koetsier', keywords: ['carriage', 'horse', 'coach', 'kutsche', 'driver'] },
  { id: 'carter', en: 'Carter', de: { m: 'Fuhrmann', f: 'Fuhrfrau' }, af: 'Voerman', keywords: ['cart', 'carriage', 'haulage', 'carrier', 'fuhr'] },
  { id: 'falconer', en: 'Falconer', de: { m: 'Falkner', f: 'Falknerin' }, af: 'Valkenier', keywords: ['falcons', 'birds of prey', 'falke', 'hawk', 'medieval'] },
  { id: 'mercenary', en: 'Mercenary', de: { m: 'Söldner', f: 'Söldnerin' }, af: 'Huursoldaat', keywords: ['soldier', 'army', 'medieval', 'soeldner', 'hired'] },
  { id: 'armourer', en: 'Armourer', de: { m: 'Waffenschmied', f: 'Waffenschmiedin' }, af: 'Wapensmid', keywords: ['armour', 'armor', 'weapons', 'rüstung', 'ruestung'] },
  { id: 'steward', en: 'Steward', de: { m: 'Verwalter', f: 'Verwalterin' }, af: 'Rentmeester', keywords: ['estate', 'manager', 'administrator', 'verwalter', 'estate manager'] },
  { id: 'herbalist', en: 'Herbalist', de: { m: 'Kräuterheiler', f: 'Kräuterheilerin' }, af: 'Kruiekenner', keywords: ['herbs', 'kräuter', 'kraeuter', 'plants', 'healer'] },
  { id: 'pedlar', en: 'Pedlar', de: { m: 'Hausierer', f: 'Hausiererin' }, af: 'Smous', keywords: ['peddler', 'hawker', 'trader', 'street', 'hausieren'] },
  { id: 'town_crier', en: 'Town crier', de: { m: 'Ausrufer', f: 'Ausruferin' }, af: 'Uitroeper', keywords: ['crier', 'announcer', 'herald', 'town', 'ausrufer'] },
  { id: 'gravedigger', en: 'Gravedigger', de: { m: 'Totengräber', f: 'Totengräberin' }, af: 'Doodgraaf', keywords: ['graves', 'cemetery', 'grave', 'friedhof', 'sexton'] },
  { id: 'midwife', en: 'Midwife', de: { m: 'Hebamme', f: 'Hebamme' }, af: 'Vroedvrou', keywords: ['birth', 'obstetrics', 'childbirth', 'geburt', 'hebamme'] },
  { id: 'doctor', en: 'Doctor', de: { m: 'Arzt', f: 'Ärztin' }, af: 'Dokter', keywords: ['physician', 'medic', 'medicine', 'mediziner', 'gp'] },
  { id: 'surgeon', en: 'Surgeon', de: { m: 'Chirurg', f: 'Chirurgin' }, af: 'Chirurg', keywords: ['surgery', 'operations', 'operation', 'chirurgie', 'arzt'] },
  { id: 'pediatrician', en: 'Pediatrician', de: { m: 'Kinderarzt', f: 'Kinderärztin' }, af: 'Kinderarts', keywords: ['children', 'paediatrician', 'pediatrics', 'kinder', 'kinderheilkunde'] },
  { id: 'gynaecologist', en: 'Gynaecologist', de: { m: 'Gynäkologe', f: 'Gynäkologin' }, af: 'Ginekoloog', keywords: ['gynecologist', 'women', 'obstetrics', 'gynäkologie', 'frauenarzt'] },
  { id: 'pathologist', en: 'Pathologist', de: { m: 'Pathologe', f: 'Pathologin' }, af: 'Patoloog', keywords: ['pathology', 'tissue', 'autopsy', 'pathologie', 'laboratory'] },
  { id: 'veterinarian', en: 'Veterinarian', de: { m: 'Tierarzt', f: 'Tierärztin' }, af: 'Veeartse', keywords: ['vet', 'animals', 'veterinär', 'veterinaer', 'tiere'] },
  { id: 'dentist', en: 'Dentist', de: { m: 'Zahnarzt', f: 'Zahnärztin' }, af: 'Tandarts', keywords: ['teeth', 'dental', 'zahn', 'zahnmedizin', 'tand'] },
  { id: 'pharmacist', en: 'Pharmacist', de: { m: 'Apotheker', f: 'Apothekerin' }, af: 'Apteker', keywords: ['pharmacy', 'drugs', 'medicine', 'apotheke', 'drogist'] },
  { id: 'nurse', en: 'Nurse', de: { m: 'Krankenpfleger', f: 'Krankenschwester' }, af: 'Verpleegkundige', keywords: ['hospital', 'care', 'pflege', 'pflegekraft', 'carer'] },
  { id: 'paramedic', en: 'Paramedic', de: { m: 'Notfallsanitäter', f: 'Notfallsanitäterin' }, af: 'Paramedikus', keywords: ['ambulance', 'emergency', 'rettung', 'sanitäter', 'sanitaeter'] },
  { id: 'physiotherapist', en: 'Physiotherapist', de: { m: 'Physiotherapeut', f: 'Physiotherapeutin' }, af: 'Fisioterapeut', keywords: ['physio', 'therapy', 'massage', 'physiotherapie', 'rehab'] },
  { id: 'occupational_therapist', en: 'Occupational therapist', de: { m: 'Ergotherapeut', f: 'Ergotherapeutin' }, af: 'Arbeidsterapeut', keywords: ['therapy', 'rehab', 'ergotherapie', 'occupational', 'hands'] },
  { id: 'speech_therapist', en: 'Speech therapist', de: { m: 'Logopäde', f: 'Logopädin' }, af: 'Spraakterapeut', keywords: ['speech', 'language', 'logopädie', 'logopaedie', 'therapy'] },
  { id: 'nutritionist', en: 'Nutritionist', de: { m: 'Ernährungsberater', f: 'Ernährungsberaterin' }, af: 'Voedingkundige', keywords: ['nutrition', 'diet', 'ernährung', 'ernaehrung', 'food'] },
  { id: 'psychologist', en: 'Psychologist', de: { m: 'Psychologe', f: 'Psychologin' }, af: 'Sielkundige', keywords: ['therapy', 'mind', 'psychology', 'psychologie', 'therapeut'] },
  { id: 'psychiatrist', en: 'Psychiatrist', de: { m: 'Psychiater', f: 'Psychiaterin' }, af: 'Psigiater', keywords: ['mental health', 'psychiatry', 'psychiatrie', 'therapy', 'medicine'] },
  { id: 'therapist', en: 'Therapist', de: { m: 'Therapeut', f: 'Therapeutin' }, af: 'Terapeut', keywords: ['therapy', 'counselling', 'counseling', 'therapie', 'healing'] },
  { id: 'optician', en: 'Optician', de: { m: 'Optiker', f: 'Optikerin' }, af: 'Optisyn', keywords: ['glasses', 'eyes', 'optik', 'brille', 'eyewear'] },
  { id: 'radiographer', en: 'Radiographer', de: { m: 'Radiologieassistent', f: 'Radiologieassistentin' }, af: 'Radiograaf', keywords: ['x-ray', 'radiology', 'imaging', 'röntgen', 'roentgen'] },
  { id: 'lab_technician', en: 'Lab technician', de: { m: 'Laborant', f: 'Laborantin' }, af: 'Laboratoriumtegnikus', keywords: ['lab', 'laboratory', 'science', 'labor', 'technician'] },
  { id: 'priest', en: 'Priest', de: { m: 'Priester', f: 'Priesterin' }, af: 'Priester', keywords: ['clergy', 'church', 'cleric', 'kirche', 'pastor'] },
  { id: 'pastor', en: 'Pastor', de: { m: 'Pfarrer', f: 'Pfarrerin' }, af: 'Predikant', keywords: ['minister', 'church', 'vicar', 'pfarramt', 'prediger'] },
  { id: 'monk', en: 'Monk', de: { m: 'Mönch', f: 'Nonne' }, af: 'Monnik', keywords: ['monastery', 'abbey', 'cloister', 'kloster', 'nun'] },
  { id: 'organist', en: 'Organist', de: { m: 'Organist', f: 'Organistin' }, af: 'Organis', keywords: ['organ', 'church', 'music', 'orgel', 'musician'] },
  { id: 'scribe', en: 'Scribe', de: { m: 'Schreiber', f: 'Schreiberin' }, af: 'Skrifgeleerde', keywords: ['writer', 'copyist', 'manuscripts', 'schreiber', 'clerk'] },
  { id: 'teacher', en: 'Teacher', de: { m: 'Lehrer', f: 'Lehrerin' }, af: 'Onderwyser', keywords: ['school', 'education', 'schule', 'lehrkraft', 'pädagoge'] },
  { id: 'kindergarten_teacher', en: 'Kindergarten teacher', de: { m: 'Erzieher', f: 'Erzieherin' }, af: 'Kleuteronderwyser', keywords: ['kindergarten', 'preschool', 'kita', 'erzieher', 'nursery'] },
  { id: 'headteacher', en: 'Headteacher', de: { m: 'Schulleiter', f: 'Schulleiterin' }, af: 'Skoolhoof', keywords: ['school', 'principal', 'head', 'schulleitung', 'skoolhoof'] },
  { id: 'tutor', en: 'Tutor', de: { m: 'Nachhilfelehrer', f: 'Nachhilfelehrerin' }, af: 'Privaatonderwyser', keywords: ['private', 'lessons', 'nachhilfe', 'coach', 'teaching'] },
  { id: 'driving_instructor', en: 'Driving instructor', de: { m: 'Fahrlehrer', f: 'Fahrlehrerin' }, af: 'Bestuuronderwyser', keywords: ['driving', 'driver', 'cars', 'fahren', 'fahrschule'] },
  { id: 'professor', en: 'Professor', de: { m: 'Professor', f: 'Professorin' }, af: 'Professor', keywords: ['university', 'academic', 'hochschule', 'universität', 'universitaet'] },
  { id: 'lecturer', en: 'Lecturer', de: { m: 'Dozent', f: 'Dozentin' }, af: 'Dosent', keywords: ['university', 'academic', 'lecture', 'hochschule', 'dozentur'] },
  { id: 'librarian', en: 'Librarian', de: { m: 'Bibliothekar', f: 'Bibliothekarin' }, af: 'Bibliotekaris', keywords: ['library', 'books', 'bibliothek', 'libraries', 'bücher'] },
  { id: 'archivist', en: 'Archivist', de: { m: 'Archivar', f: 'Archivarin' }, af: 'Argivaris', keywords: ['archive', 'records', 'history', 'archiv', 'documents'] },
  { id: 'historian', en: 'Historian', de: { m: 'Historiker', f: 'Historikerin' }, af: 'Historikus', keywords: ['history', 'past', 'historie', 'researcher', 'geschichte'] },
  { id: 'curator', en: 'Curator', de: { m: 'Kurator', f: 'Kuratorin' }, af: 'Kurator', keywords: ['museum', 'exhibition', 'gallery', 'kuratorin', 'art'] },
  { id: 'translator', en: 'Translator', de: { m: 'Übersetzer', f: 'Übersetzerin' }, af: 'Vertaler', keywords: ['language', 'languages', 'translation', 'uebersetzer', 'übersetzung'] },
  { id: 'interpreter', en: 'Interpreter', de: { m: 'Dolmetscher', f: 'Dolmetscherin' }, af: 'Tolk', keywords: ['translator', 'speech', 'interpreting', 'dolmetschen', 'language'] },
  { id: 'writer', en: 'Writer', de: { m: 'Schriftsteller', f: 'Schriftstellerin' }, af: 'Skrywer', keywords: ['author', 'novelist', 'books', 'literature', 'autor'] },
  { id: 'journalist', en: 'Journalist', de: { m: 'Journalist', f: 'Journalistin' }, af: 'Joernalis', keywords: ['reporter', 'news', 'press', 'journalismus', 'zeitung'] },
  { id: 'editor', en: 'Editor', de: { m: 'Redakteur', f: 'Redakteurin' }, af: 'Redakteur', keywords: ['newspaper', 'publishing', 'magazine', 'redaktion', 'editing'] },
  { id: 'photographer', en: 'Photographer', de: { m: 'Fotograf', f: 'Fotografin' }, af: 'Fotograaf', keywords: ['camera', 'photos', 'photography', 'foto', 'lichtbild'] },
  { id: 'actor', en: 'Actor', de: { m: 'Schauspieler', f: 'Schauspielerin' }, af: 'Akteur', keywords: ['theatre', 'film', 'stage', 'acting', 'schauspiel'] },
  { id: 'film_director', en: 'Film director', de: { m: 'Regisseur', f: 'Regisseurin' }, af: 'Regisseur', keywords: ['film', 'movie', 'director', 'cinema', 'theatre'] },
  { id: 'screenwriter', en: 'Screenwriter', de: { m: 'Drehbuchautor', f: 'Drehbuchautorin' }, af: 'Draaiboekskrywer', keywords: ['film', 'scripts', 'tv', 'writer', 'drehbuch'] },
  { id: 'film_editor', en: 'Film editor', de: { m: 'Cutter', f: 'Cutterin' }, af: 'Filmredigeerder', keywords: ['cutter', 'video', 'montage', 'editing', 'film'] },
  { id: 'musician', en: 'Musician', de: { m: 'Musiker', f: 'Musikerin' }, af: 'Musikant', keywords: ['music', 'band', 'orchestra', 'musik', 'instrument'] },
  { id: 'singer', en: 'Singer', de: { m: 'Sänger', f: 'Sängerin' }, af: 'Sanger', keywords: ['vocal', 'voice', 'singing', 'song', 'gesang'] },
  { id: 'dancer', en: 'Dancer', de: { m: 'Tänzer', f: 'Tänzerin' }, af: 'Danser', keywords: ['ballet', 'dance', 'tanz', 'tanzen', 'choreographer'] },
  { id: 'artist', en: 'Artist', de: { m: 'Künstler', f: 'Künstlerin' }, af: 'Kunstenaar', keywords: ['art', 'painting', 'sculpture', 'kunst', 'creative'] },
  { id: 'sculptor', en: 'Sculptor', de: { m: 'Bildhauer', f: 'Bildhauerin' }, af: 'Beeldhouer', keywords: ['sculpture', 'statues', 'art', 'bildhauerei', 'stone'] },
  { id: 'architect', en: 'Architect', de: { m: 'Architekt', f: 'Architektin' }, af: 'Argitek', keywords: ['buildings', 'design', 'building', 'architektur', 'plans'] },
  { id: 'civil_engineer', en: 'Civil engineer', de: { m: 'Bauingenieur', f: 'Bauingenieurin' }, af: 'Siviele ingenieur', keywords: ['construction', 'roads', 'bridges', 'bau', 'civil'] },
  { id: 'engineer', en: 'Engineer', de: { m: 'Ingenieur', f: 'Ingenieurin' }, af: 'Ingenieur', keywords: ['engineering', 'technical', 'technik', 'machines', 'engineer'] },
  { id: 'urban_planner', en: 'Urban planner', de: { m: 'Stadtplaner', f: 'Stadtplanerin' }, af: 'Stadsbeplanner', keywords: ['city', 'planning', 'stadtplanung', 'town', 'zoning'] },
  { id: 'chemist', en: 'Chemist', de: { m: 'Chemiker', f: 'Chemikerin' }, af: 'Chemikus', keywords: ['chemistry', 'lab', 'laboratory', 'chemie', 'labor'] },
  { id: 'biologist', en: 'Biologist', de: { m: 'Biologe', f: 'Biologin' }, af: 'Bioloog', keywords: ['biology', 'science', 'life', 'biologie', 'research'] },
  { id: 'physicist', en: 'Physicist', de: { m: 'Physiker', f: 'Physikerin' }, af: 'Fisikus', keywords: ['physics', 'science', 'research', 'physik', 'quantum'] },
  { id: 'mathematician', en: 'Mathematician', de: { m: 'Mathematiker', f: 'Mathematikerin' }, af: 'Wiskundige', keywords: ['maths', 'math', 'numbers', 'mathematik', 'wissenschaft'] },
  { id: 'scientist', en: 'Scientist', de: { m: 'Wissenschaftler', f: 'Wissenschaftlerin' }, af: 'Wetenskaplike', keywords: ['research', 'science', 'researcher', 'forschung', 'labor'] },
  { id: 'geologist', en: 'Geologist', de: { m: 'Geologe', f: 'Geologin' }, af: 'Geoloog', keywords: ['geology', 'rocks', 'earth', 'geologie', 'minerals'] },
  { id: 'astronomer', en: 'Astronomer', de: { m: 'Astronom', f: 'Astronomin' }, af: 'Sterrekundige', keywords: ['stars', 'space', 'astronomie', 'telescope', 'sterre'] },
  { id: 'lawyer', en: 'Lawyer', de: { m: 'Rechtsanwalt', f: 'Rechtsanwältin' }, af: 'Advokaat', keywords: ['law', 'attorney', 'legal', 'advocate', 'anwalt'] },
  { id: 'notary', en: 'Notary', de: { m: 'Notar', f: 'Notarin' }, af: 'Notaris', keywords: ['legal', 'documents', 'notariat', 'notar', 'certification'] },
  { id: 'judge', en: 'Judge', de: { m: 'Richter', f: 'Richterin' }, af: 'Regter', keywords: ['court', 'law', 'justice', 'richter', 'gericht'] },
  { id: 'police_officer', en: 'Police officer', de: { m: 'Polizist', f: 'Polizistin' }, af: 'Polisiebeampte', keywords: ['police', 'cop', 'officer', 'polizei', 'constable'] },
  { id: 'detective', en: 'Detective', de: { m: 'Detektiv', f: 'Detektivin' }, af: 'Speurder', keywords: ['investigator', 'crime', 'ermittler', 'spy', 'detektei'] },
  { id: 'firefighter', en: 'Firefighter', de: { m: 'Feuerwehrmann', f: 'Feuerwehrfrau' }, af: 'Brandweerman', keywords: ['fire', 'rescue', 'feuerwehr', 'brandweer', 'fireman'] },
  { id: 'soldier', en: 'Soldier', de: { m: 'Soldat', f: 'Soldatin' }, af: 'Soldaat', keywords: ['army', 'military', 'wehrdienst', 'armee', 'troops'] },
  { id: 'army_officer', en: 'Army officer', de: { m: 'Offizier', f: 'Offizierin' }, af: 'Offisier', keywords: ['army', 'military', 'officer', 'bundeswehr', 'leutnant'] },
  { id: 'diplomat', en: 'Diplomat', de: { m: 'Diplomat', f: 'Diplomatin' }, af: 'Diplomaat', keywords: ['embassy', 'foreign', 'diplomatie', 'consul', 'ambassador'] },
  { id: 'politician', en: 'Politician', de: { m: 'Politiker', f: 'Politikerin' }, af: 'Politikus', keywords: ['government', 'parliament', 'politik', 'politics', 'mp'] },
  { id: 'mayor', en: 'Mayor', de: { m: 'Bürgermeister', f: 'Bürgermeisterin' }, af: 'Burgemeester', keywords: ['town', 'city', 'bürgermeister', 'buergermeister', 'council'] },
  { id: 'civil_servant', en: 'Civil servant', de: { m: 'Beamter', f: 'Beamtin' }, af: 'Staatsamptenaar', keywords: ['government', 'public service', 'beamtentum', 'amt', 'official'] },
  { id: 'social_worker', en: 'Social worker', de: { m: 'Sozialarbeiter', f: 'Sozialarbeiterin' }, af: 'Maatskaplike werker', keywords: ['welfare', 'social', 'sozialpädagoge', 'sozialpaedagoge', 'sozial'] },
  { id: 'customs_officer', en: 'Customs officer', de: { m: 'Zollbeamter', f: 'Zollbeamtin' }, af: 'Doeanebeampte', keywords: ['border', 'customs', 'zoll', 'import', 'douane'] },
  { id: 'prison_guard', en: 'Prison guard', de: { m: 'Justizvollzugsbeamter', f: 'Justizvollzugsbeamtin' }, af: 'Gevangenisbewaarder', keywords: ['prison', 'jail', 'guard', 'gefängnis', 'gefaengnis'] },
  { id: 'postal_worker', en: 'Postal worker', de: { m: 'Postbote', f: 'Postbotin' }, af: 'Posbode', keywords: ['mail', 'post', 'letter carrier', 'briefträger', 'postman'] },
  { id: 'railway_worker', en: 'Railway worker', de: { m: 'Eisenbahner', f: 'Eisenbahnerin' }, af: 'Spoorwegwerker', keywords: ['train', 'rail', 'railroad', 'bahn', 'eisenbahn'] },
  { id: 'train_driver', en: 'Train driver', de: { m: 'Lokführer', f: 'Lokführerin' }, af: 'Lokomotiefbestuurder', keywords: ['locomotive', 'train', 'engine driver', 'lokomotive', 'bahn'] },
  { id: 'train_conductor', en: 'Train conductor', de: { m: 'Zugbegleiter', f: 'Zugbegleiterin' }, af: 'Treinkondukteur', keywords: ['conductor', 'train', 'tickets', 'schaffner', 'bahn'] },
  { id: 'bus_driver', en: 'Bus driver', de: { m: 'Busfahrer', f: 'Busfahrerin' }, af: 'Busbestuurder', keywords: ['bus', 'transport', 'driver', 'omnibus', 'fahrer'] },
  { id: 'taxi_driver', en: 'Taxi driver', de: { m: 'Taxifahrer', f: 'Taxifahrerin' }, af: 'Taxibestuurder', keywords: ['taxi', 'cab', 'driver', 'fahrer', 'chauffeur'] },
  { id: 'truck_driver', en: 'Truck driver', de: { m: 'Lkw-Fahrer', f: 'Lkw-Fahrerin' }, af: 'Vragmotorbestuurder', keywords: ['lorry', 'trucker', 'hgv', 'lastwagen', 'lkw'] },
  { id: 'delivery_driver', en: 'Delivery driver', de: { m: 'Lieferfahrer', f: 'Lieferfahrerin' }, af: 'Afleweringsbestuurder', keywords: ['delivery', 'van', 'lieferant', 'driver', 'courier'] },
  { id: 'chauffeur', en: 'Chauffeur', de: { m: 'Chauffeur', f: 'Chauffeurin' }, af: 'Sjoffeur', keywords: ['driver', 'car', 'limousine', 'fahrer', 'driving'] },
  { id: 'courier', en: 'Courier', de: { m: 'Kurier', f: 'Kurierin' }, af: 'Koerier', keywords: ['delivery', 'messenger', 'bote', 'kurierdienst', 'parcels'] },
  { id: 'pilot', en: 'Pilot', de: { m: 'Pilot', f: 'Pilotin' }, af: 'Vlieënier', keywords: ['aviation', 'aircraft', 'flying', 'flug', 'flugzeug'] },
  { id: 'flight_attendant', en: 'Flight attendant', de: { m: 'Flugbegleiter', f: 'Flugbegleiterin' }, af: 'Lugwaardin', keywords: ['cabin crew', 'steward', 'stewardess', 'airline', 'flug'] },
  { id: 'air_traffic_controller', en: 'Air traffic controller', de: { m: 'Fluglotse', f: 'Fluglotsin' }, af: 'Lugverkeersleier', keywords: ['air traffic', 'atc', 'aviation', 'flughafen', 'tower'] },
  { id: 'athlete', en: 'Athlete', de: { m: 'Sportler', f: 'Sportlerin' }, af: 'Atleet', keywords: ['sport', 'sports', 'olympic', 'athletics', 'athletik'] },
  { id: 'coach', en: 'Coach', de: { m: 'Trainer', f: 'Trainerin' }, af: 'Afrigter', keywords: ['training', 'sports', 'trainer', 'fitness', 'instructor'] },
  { id: 'referee', en: 'Referee', de: { m: 'Schiedsrichter', f: 'Schiedsrichterin' }, af: 'Skeidsregter', keywords: ['umpire', 'sports', 'match', 'schiedsrichter', 'official'] },
  { id: 'park_ranger', en: 'Park ranger', de: { m: 'Ranger', f: 'Rangerin' }, af: 'Wildwagter', keywords: ['park', 'wildlife', 'national park', 'nature', 'ranger'] },
  { id: 'pensioner', en: 'Pensioner', de: { m: 'Rentner', f: 'Rentnerin' }, af: 'Pensioenaris', keywords: ['retired', 'pension', 'rente', 'ruhestand', 'retiree'] },
  { id: 'apprentice', en: 'Apprentice', de: { m: 'Auszubildender', f: 'Auszubildende' }, af: 'Leerling', keywords: ['trainee', 'learner', 'lehrling', 'ausbildung', 'lehre'] },
  { id: 'clerk', en: 'Clerk', de: { m: 'Büroangestellter', f: 'Büroangestellte' }, af: 'Klerk', keywords: ['office', 'admin', 'clerical', 'büro', 'buero'] },
  { id: 'secretary', en: 'Secretary', de: { m: 'Sekretär', f: 'Sekretärin' }, af: 'Sekretaris', keywords: ['assistant', 'office', 'admin', 'sekretariat', 'secretarial'] },
  { id: 'typist', en: 'Typist', de: { m: 'Schreibkraft', f: 'Schreibkraft' }, af: 'Tikster', keywords: ['typing', 'typewriter', 'stenographer', 'schreibmaschine', 'keyboard'] },
  { id: 'telephone_operator', en: 'Telephone operator', de: { m: 'Telefonist', f: 'Telefonistin' }, af: 'Telefonis', keywords: ['switchboard', 'operator', 'telephone', 'vermittlung', 'phone'] },
  { id: 'telegraph_operator', en: 'Telegraph operator', de: { m: 'Telegrafist', f: 'Telegrafistin' }, af: 'Telegrafis', keywords: ['telegraph', 'morse', 'wireless', 'telegrafie', 'radio'] },
  { id: 'bookkeeper', en: 'Bookkeeper', de: { m: 'Buchhalter', f: 'Buchhalterin' }, af: 'Boekhouer', keywords: ['books', 'ledger', 'accounts', 'buchhaltung', 'finance'] },
  { id: 'accountant', en: 'Accountant', de: { m: 'Wirtschaftsprüfer', f: 'Wirtschaftsprüferin' }, af: 'Rekenmeester', keywords: ['audit', 'accounts', 'tax', 'finance', 'accountancy'] },
  { id: 'tax_advisor', en: 'Tax advisor', de: { m: 'Steuerberater', f: 'Steuerberaterin' }, af: 'Belastingadviseur', keywords: ['tax', 'taxes', 'steuern', 'steuer', 'accountant'] },
  { id: 'actuary', en: 'Actuary', de: { m: 'Aktuar', f: 'Aktuarin' }, af: 'Aktuaris', keywords: ['insurance', 'risk', 'statistics', 'mathematik', 'versicherung'] },
  { id: 'economist', en: 'Economist', de: { m: 'Volkswirt', f: 'Volkswirtin' }, af: 'Ekonoom', keywords: ['economics', 'finance', 'economy', 'wirtschaft', 'ökonom'] },
  { id: 'banker', en: 'Banker', de: { m: 'Banker', f: 'Bankerin' }, af: 'Bankier', keywords: ['bank', 'finance', 'money', 'bankkaufmann', 'kredit'] },
  { id: 'financial_advisor', en: 'Financial advisor', de: { m: 'Finanzberater', f: 'Finanzberaterin' }, af: 'Finansiële adviseur', keywords: ['finance', 'investment', 'money', 'finanz', 'berater'] },
  { id: 'insurance_agent', en: 'Insurance agent', de: { m: 'Versicherungskaufmann', f: 'Versicherungskauffrau' }, af: 'Versekeringsagent', keywords: ['insurance', 'policy', 'versicherung', 'agent', 'broker'] },
  { id: 'real_estate_agent', en: 'Real estate agent', de: { m: 'Immobilienmakler', f: 'Immobilienmaklerin' }, af: 'Eiendomsagent', keywords: ['property', 'estate', 'realtor', 'immobilien', 'makler'] },
  { id: 'stock_trader', en: 'Stock trader', de: { m: 'Börsenhändler', f: 'Börsenhändlerin' }, af: 'Effektehandelaar', keywords: ['stock', 'trading', 'finance', 'börse', 'boerse'] },
  { id: 'consultant', en: 'Consultant', de: { m: 'Berater', f: 'Beraterin' }, af: 'Konsultant', keywords: ['advisor', 'consulting', 'consultancy', 'beratung', 'consultant'] },
  { id: 'human_resources_manager', en: 'Human resources manager', de: { m: 'Personalreferent', f: 'Personalreferentin' }, af: 'Personeelbestuurder', keywords: ['hr', 'recruiting', 'personnel', 'personal', 'hiring'] },
  { id: 'marketing_manager', en: 'Marketing manager', de: { m: 'Marketingmanager', f: 'Marketingmanagerin' }, af: 'Bemarkingsbestuurder', keywords: ['marketing', 'advertising', 'brand', 'werbung', 'werbefachmann'] },
  { id: 'entrepreneur', en: 'Entrepreneur', de: { m: 'Unternehmer', f: 'Unternehmerin' }, af: 'Ondernemer', keywords: ['business', 'startup', 'founder', 'unternehmen', 'gründer'] },
  { id: 'merchant', en: 'Merchant', de: { m: 'Kaufmann', f: 'Kauffrau' }, af: 'Handelaar', keywords: ['trader', 'dealer', 'trade', 'händler', 'haendler'] },
  { id: 'shopkeeper', en: 'Shopkeeper', de: { m: 'Ladenbesitzer', f: 'Ladenbesitzerin' }, af: 'Winkelhouer', keywords: ['shop', 'store', 'retail', 'laden', 'winkel'] },
  { id: 'salesperson', en: 'Salesperson', de: { m: 'Verkäufer', f: 'Verkäuferin' }, af: 'Verkoper', keywords: ['sales', 'retail', 'vendor', 'verkauf', 'shop'] },
  { id: 'cashier', en: 'Cashier', de: { m: 'Kassierer', f: 'Kassiererin' }, af: 'Kassier', keywords: ['till', 'checkout', 'register', 'kasse', 'supermarket'] },
  { id: 'grocer', en: 'Grocer', de: { m: 'Lebensmittelhändler', f: 'Lebensmittelhändlerin' }, af: 'Kruidenier', keywords: ['groceries', 'food', 'grocery', 'lebensmittel', 'shop'] },
  { id: 'fishmonger', en: 'Fishmonger', de: { m: 'Fischhändler', f: 'Fischhändlerin' }, af: 'Vishandelaar', keywords: ['fish', 'seafood', 'fischerei', 'market', 'fisch'] },
  { id: 'florist', en: 'Florist', de: { m: 'Florist', f: 'Floristin' }, af: 'Blomiste', keywords: ['flowers', 'bouquet', 'blumen', 'blumenladen', 'plants'] },
  { id: 'bookseller', en: 'Bookseller', de: { m: 'Buchhändler', f: 'Buchhändlerin' }, af: 'Boekhandelaar', keywords: ['books', 'bookshop', 'buchhandel', 'literature', 'buch'] },
  { id: 'warehouse_worker', en: 'Warehouse worker', de: { m: 'Lagerarbeiter', f: 'Lagerarbeiterin' }, af: 'Pakhuiswerker', keywords: ['warehouse', 'stock', 'storage', 'lager', 'logistik'] },
  { id: 'call_centre_agent', en: 'Call centre agent', de: { m: 'Callcenter-Agent', f: 'Callcenter-Agentin' }, af: 'Oproepsentrumagent', keywords: ['customer service', 'support', 'hotline', 'helpdesk', 'call center'] },
  { id: 'tour_guide', en: 'Tour guide', de: { m: 'Reiseleiter', f: 'Reiseleiterin' }, af: 'Toergids', keywords: ['guide', 'travel', 'tourism', 'reiseführer', 'reisefuehrer'] },
  { id: 'homemaker', en: 'Homemaker', de: { m: 'Hausmann', f: 'Hausfrau' }, af: 'Huishouer', keywords: ['housewife', 'housekeeping', 'household', 'hausfrau', 'huisvrou'] },
  { id: 'software_developer', en: 'Software developer', de: { m: 'Softwareentwickler', f: 'Softwareentwicklerin' }, af: 'Sagteware-ontwikkelaar', keywords: ['programmer', 'coder', 'developer', 'software', 'programmierer'] },
  { id: 'game_developer', en: 'Game developer', de: { m: 'Spieleentwickler', f: 'Spieleentwicklerin' }, af: 'Speletjie-ontwikkelaar', keywords: ['games', 'video games', 'gamedev', 'spiele', 'unity'] },
  { id: 'data_analyst', en: 'Data analyst', de: { m: 'Datenanalyst', f: 'Datenanalystin' }, af: 'Data-analis', keywords: ['data', 'analytics', 'statistics', 'analysis', 'daten'] },
  { id: 'it_specialist', en: 'IT specialist', de: { m: 'IT-Spezialist', f: 'IT-Spezialistin' }, af: 'IT-spesialis', keywords: ['it', 'tech support', 'helpdesk', 'computers', 'technik'] },
  { id: 'system_administrator', en: 'System administrator', de: { m: 'Systemadministrator', f: 'Systemadministratorin' }, af: 'Stelseladministrateur', keywords: ['sysadmin', 'servers', 'it', 'admin', 'linux'] },
  { id: 'network_engineer', en: 'Network engineer', de: { m: 'Netzwerktechniker', f: 'Netzwerktechnikerin' }, af: 'Netwerkingenieur', keywords: ['networking', 'network', 'cisco', 'netzwerk', 'routers'] },
  { id: 'database_administrator', en: 'Database administrator', de: { m: 'Datenbankadministrator', f: 'Datenbankadministratorin' }, af: 'Databasisadministrateur', keywords: ['database', 'sql', 'dba', 'datenbank', 'data'] },
  { id: 'devops_engineer', en: 'DevOps engineer', de: { m: 'DevOps-Ingenieur', f: 'DevOps-Ingenieurin' }, af: 'DevOps-ingenieur', keywords: ['devops', 'infrastructure', 'cloud', 'deployment', 'pipelines'] },
  { id: 'machine_learning_engineer', en: 'Machine learning engineer', de: { m: 'Machine-Learning-Ingenieur', f: 'Machine-Learning-Ingenieurin' }, af: 'Masjienleer-ingenieur', keywords: ['ai', 'ml', 'machine learning', 'data', 'künstliche intelligenz'] },
  { id: 'cybersecurity_specialist', en: 'Cybersecurity specialist', de: { m: 'IT-Sicherheitsspezialist', f: 'IT-Sicherheitsspezialistin' }, af: 'Kuberveiligheidspesialis', keywords: ['security', 'hacker', 'cyber', 'sicherheit', 'it'] },
  { id: 'qa_tester', en: 'QA tester', de: { m: 'Tester', f: 'Testerin' }, af: 'Toetser', keywords: ['testing', 'quality', 'qa', 'tests', 'testen'] },
  { id: 'web_designer', en: 'Web designer', de: { m: 'Webdesigner', f: 'Webdesignerin' }, af: 'Webontwerper', keywords: ['web', 'website', 'design', 'css', 'webseite'] },
  { id: 'ux_designer', en: 'UX designer', de: { m: 'UX-Designer', f: 'UX-Designerin' }, af: 'UX-ontwerper', keywords: ['ux', 'user experience', 'ui', 'usability', 'interface'] },
  { id: 'graphic_designer', en: 'Graphic designer', de: { m: 'Grafikdesigner', f: 'Grafikdesignerin' }, af: 'Grafiese ontwerper', keywords: ['graphics', 'design', 'layout', 'logo', 'grafik'] },
  { id: 'designer', en: 'Designer', de: { m: 'Designer', f: 'Designerin' }, af: 'Ontwerper', keywords: ['design', 'creative', 'ontwerp', 'gestalter', 'layout'] },
  { id: 'product_manager', en: 'Product manager', de: { m: 'Produktmanager', f: 'Produktmanagerin' }, af: 'Produkbestuurder', keywords: ['product', 'pm', 'roadmap', 'produkt', 'manager'] },
  { id: 'project_manager', en: 'Project manager', de: { m: 'Projektmanager', f: 'Projektmanagerin' }, af: 'Projekbestuurder', keywords: ['project', 'projects', 'manage', 'pm', 'projekt'] },
  { id: 'content_creator', en: 'Content creator', de: { m: 'Content-Creator', f: 'Content-Creatorin' }, af: 'Inhoudskepper', keywords: ['content', 'video', 'influencer', 'social media', 'creator'] },
];

// ---------- helpers ----------
// A person's occupation is stored twice: `occupation` is the text as the family wrote it, and
// `occupation_code` is the id of the vocabulary entry it names (NULL when none). The code wins for display,
// so each reader sees the entry in their language; without a code the text is shown as written.

export type Sex = 'm' | 'f' | 'x' | null | undefined;

const BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));

export const occupationById = (id: string | null | undefined): Occupation | undefined => (id ? BY_ID.get(id) : undefined);
export const isOccupationId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);

/** "Lehrer" + "Lehrerin" → "Lehrer:in". Equal forms stay one word; other pairs read "Bauer/Bäuerin". */
export function germanPair(m: string, f: string): string {
  if (m === f) return m;
  if (f.startsWith(m)) return `${m}:${f.slice(m.length)}`;
  return `${m}/${f}`;
}

/** The German form for a person's sex. For 'x' or an unknown sex, the pair: "Lehrer:in". */
export function germanLabel(o: Occupation, sex: Sex): string {
  if (sex === 'm') return o.de.m;
  if (sex === 'f') return o.de.f;
  return germanPair(o.de.m, o.de.f);
}

/** The label in the reader's language. Only German depends on sex. */
export function occupationLabel(o: Occupation, locale: Locale, sex: Sex): string {
  if (locale === 'de') return germanLabel(o, sex);
  if (locale === 'af') return o.af;
  return o.en;
}

/** What to show for a person: the vocabulary label when a code is set, else the free text exactly as entered. */
export function occupationText(p: { occupation?: string | null; occupationCode?: string | null; sex?: Sex }, locale: Locale): string | undefined {
  const o = occupationById(p.occupationCode);
  if (o) return occupationLabel(o, locale, p.sex);
  return p.occupation ?? undefined;
}

/** Case folding and accent folding for search: "Bäckerin" matches "backerin" and "BÄCKERIN". */
export const foldOccupation = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');

/** Every spelling an entry answers to in any language: its labels in each form, plus its keywords. */
function namesOf(o: Occupation): string[] {
  return [o.en, o.de.m, o.de.f, germanPair(o.de.m, o.de.f), o.af, ...o.keywords];
}

/**
 * Entries for a search, best first. An entry whose label in the reader's language starts with the text ranks
 * above one that merely contains it, and labels rank above keywords. Matches in other languages still count.
 */
export function suggestOccupations(query: string, locale: Locale, limit = 8): Occupation[] {
  const q = foldOccupation(query);
  if (!q) return [];
  const scored: { o: Occupation; score: number }[] = [];
  for (const o of OCCUPATIONS) {
    const own = foldOccupation(occupationLabel(o, locale, 'x'));
    const labels = [own, ...[o.en, o.de.m, o.de.f, o.af].map(foldOccupation)];
    let score = Infinity;
    if (labels[0].startsWith(q)) score = 0;
    else if (labels[0].split(/[\s/:-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (labels[0].includes(q)) score = 2;
    else if (labels.some((l) => l.startsWith(q))) score = 3;
    else if (labels.some((l) => l.includes(q))) score = 4;
    else if (namesOf(o).some((n) => foldOccupation(n).includes(q))) score = 5;
    if (score !== Infinity) scored.push({ o, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.o.en.localeCompare(b.o.en)).slice(0, limit).map((x) => x.o);
}

/** Every label an entry is known by, in every language and both German forms, for exact matching. */
function exactLabels(o: Occupation): string[] {
  return [o.en, o.de.m, o.de.f, germanPair(o.de.m, o.de.f), o.af];
}

const EXACT = (() => {
  const map = new Map<string, Set<string>>();
  for (const o of OCCUPATIONS) {
    for (const label of exactLabels(o)) {
      const key = label.trim().toLowerCase();
      const ids = map.get(key) ?? new Set<string>();
      ids.add(o.id);
      map.set(key, ids);
    }
  }
  return map;
})();

/**
 * The one entry a piece of free text names: an exact or case-insensitive match against any language's label.
 * Undefined when nothing matches, or when two entries share the label (a guess would be wrong), so the text
 * stays free text.
 */
export function occupationForText(text: string | null | undefined): Occupation | undefined {
  const key = (text ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const ids = EXACT.get(key);
  return ids && ids.size === 1 ? occupationById([...ids][0]) : undefined;
}

/**
 * The code to store with an occupation. An explicit choice from the vocabulary wins (a stale or unknown id is
 * dropped). Otherwise a text that names exactly one entry gets its code. Anything else is NULL.
 * Every write path uses this, so a code and its text can't disagree on the way in.
 */
export function occupationCodeFor(text: string | null | undefined, explicit?: string | null): string | null {
  if (isOccupationId(explicit)) return explicit;
  return occupationForText(text)?.id ?? null;
}

/** Every label and keyword, in every language, as one string, for the person search. */
export function occupationSearchText(code: string | null | undefined): string {
  const o = occupationById(code);
  return o ? namesOf(o).join(' ') : '';
}
