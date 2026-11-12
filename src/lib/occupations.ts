// The occupation vocabulary: about 250 occupations from medieval times to today, each with a stable id and search keywords.
// The labels are in the dictionary (src/lib/i18n/areas/occupations.ts, a file per language; German has a masculine and a
// feminine form). Ids are forever: never rename one, only add. The helpers at the end turn a stored code into the label a
// reader should see.
import { namesInEveryLanguage, tablesVersion, translate, type Key } from './i18n/dictionary.ts';
import type { Locale } from './i18n/types.ts';

/** One occupation. */
export interface Occupation {
  /** Stable, lowercase ASCII with underscores, e.g. 'baker', 'software_developer'. Never reused. */
  id: string;
  /** Extra search words in any language (lowercase), synonyms and related words; 2–6 per entry. Include the English/German/Afrikaans spelling variants a user might type, without accents where a plain form is common (e.g. 'backer' as well as 'bäcker'). */
  keywords: string[];
}

export const OCCUPATIONS: readonly Occupation[] = [
  { id: 'farmer', keywords: ['farm', 'landwirt', 'landwirtschaft', 'crops', 'boer'] },
  { id: 'dairy_farmer', keywords: ['milk', 'cows', 'dairy', 'milchwirtschaft', 'kuh'] },
  { id: 'fruit_grower', keywords: ['fruit', 'orchard', 'obst', 'obstbau', 'orchards'] },
  { id: 'vintner', keywords: ['wine', 'grapes', 'winzer', 'wein', 'winemaker'] },
  { id: 'beekeeper', keywords: ['bees', 'honey', 'bienen', 'imkerei', 'honig'] },
  { id: 'shepherd', keywords: ['sheep', 'flock', 'herde', 'schäfer', 'schaefer'] },
  { id: 'hunter', keywords: ['game', 'hunting', 'jäger', 'jagd', 'trapper'] },
  { id: 'fisherman', keywords: ['fishing', 'fish', 'fischerei', 'angler', 'vis'] },
  { id: 'forester', keywords: ['forest', 'woodland', 'forst', 'wald', 'ranger'] },
  { id: 'lumberjack', keywords: ['wood', 'logging', 'trees', 'holzfaeller', 'timber'] },
  { id: 'gardener', keywords: ['garden', 'plants', 'gartner', 'horticulture', 'tuin'] },
  { id: 'landscape_gardener', keywords: ['landscaping', 'garden', 'landschaft', 'design', 'tuin'] },
  { id: 'miller', keywords: ['mill', 'miller', 'mühle', 'muhle', 'grain'] },
  { id: 'baker', keywords: ['bread', 'oven', 'bäckerei', 'bakery', 'brot'] },
  { id: 'confectioner', keywords: ['cakes', 'pastry', 'sweets', 'konditorei', 'patisserie'] },
  { id: 'butcher', keywords: ['meat', 'sausage', 'fleischer', 'fleisch', 'wurst'] },
  { id: 'brewer', keywords: ['beer', 'brewery', 'bier', 'brauerei', 'brew'] },
  { id: 'distiller', keywords: ['spirits', 'whisky', 'schnaps', 'distillery', 'brennerei'] },
  { id: 'cooper', keywords: ['barrels', 'casks', 'barrel', 'kufer', 'fass'] },
  { id: 'tanner', keywords: ['leather', 'hides', 'tanning', 'gerberei', 'leder'] },
  { id: 'saddler', keywords: ['saddle', 'harness', 'sattlerei', 'leather', 'zaum'] },
  { id: 'blacksmith', keywords: ['smithy', 'forge', 'metal', 'schmiede', 'anvil'] },
  { id: 'locksmith', keywords: ['locks', 'keys', 'schlüssel', 'schluessel', 'schlosserei'] },
  { id: 'goldsmith', keywords: ['gold', 'jewellery', 'jewelry', 'schmuck', 'goldschmiede'] },
  { id: 'jeweller', keywords: ['jewelry', 'gems', 'schmuck', 'juwelen', 'jeweler'] },
  { id: 'watchmaker', keywords: ['watches', 'clocks', 'uhr', 'uhrmacherei', 'clockmaker'] },
  { id: 'weaver', keywords: ['loom', 'cloth', 'textile', 'weberei', 'weben'] },
  { id: 'spinner', keywords: ['yarn', 'thread', 'spinnen', 'spinnerei', 'wool'] },
  { id: 'dyer', keywords: ['dye', 'colour', 'color', 'farben', 'faerber'] },
  { id: 'seamstress', keywords: ['sewing', 'stitching', 'nähen', 'naehen', 'mending'] },
  { id: 'tailor', keywords: ['clothes', 'sewing', 'suits', 'schneiderei', 'kleider'] },
  { id: 'hatter', keywords: ['hats', 'millinery', 'hut', 'huete', 'milliner'] },
  { id: 'shoemaker', keywords: ['shoes', 'cobbler', 'schuster', 'boots', 'schuh'] },
  { id: 'potter', keywords: ['clay', 'pottery', 'ceramics', 'toepfer', 'keramik'] },
  { id: 'glassblower', keywords: ['glass', 'glassworks', 'glas', 'glaser', 'glasmacher'] },
  { id: 'glazier', keywords: ['glass', 'windows', 'glaserei', 'panes', 'fenster'] },
  { id: 'carpenter', keywords: ['wood', 'timber', 'joinery', 'zimmerei', 'holz'] },
  { id: 'cabinetmaker', keywords: ['furniture', 'wood', 'carpentry', 'tischlerei', 'möbel'] },
  { id: 'mason', keywords: ['bricks', 'stone', 'masonry', 'mauer', 'bricklayer'] },
  { id: 'roofer', keywords: ['roof', 'roofing', 'tiles', 'dach', 'dakke'] },
  { id: 'thatcher', keywords: ['thatch', 'reed', 'reetdach', 'roof', 'riet'] },
  { id: 'painter', keywords: ['paint', 'decorator', 'anstreicher', 'painting', 'maler'] },
  { id: 'tiler', keywords: ['tiles', 'floor', 'flooring', 'fliesen', 'tegels'] },
  { id: 'plumber', keywords: ['pipes', 'plumbing', 'sanitär', 'sanitaer', 'water'] },
  { id: 'electrician', keywords: ['electricity', 'wiring', 'electrical', 'elektro', 'strom'] },
  { id: 'chimney_sweep', keywords: ['chimney', 'soot', 'schornstein', 'sweep', 'kamin'] },
  { id: 'tinker', keywords: ['mender', 'repairs', 'kesselflicker', 'wanderer', 'tinsmith'] },
  { id: 'rope_maker', keywords: ['rope', 'cord', 'seil', 'twine', 'ropewalk'] },
  { id: 'chandler', keywords: ['candles', 'wax', 'kerze', 'candle', 'kerzen'] },
  { id: 'basket_maker', keywords: ['baskets', 'wicker', 'korb', 'weiden', 'basketry'] },
  { id: 'miner', keywords: ['mine', 'coal', 'bergbau', 'mining', 'kumpel'] },
  { id: 'sailor', keywords: ['sea', 'ship', 'seefahrt', 'navy', 'marine'] },
  { id: 'ship_captain', keywords: ['captain', 'ship', 'skipper', 'schiff', 'kapitän'] },
  { id: 'shipwright', keywords: ['ships', 'boats', 'shipyard', 'schiffbau', 'boat'] },
  { id: 'welder', keywords: ['welding', 'metal', 'schweißen', 'schweissen', 'steel'] },
  { id: 'machinist', keywords: ['machine', 'machines', 'maschinen', 'cnc', 'factory'] },
  { id: 'foundry_worker', keywords: ['casting', 'metal', 'foundry', 'giesserei', 'gießerei'] },
  { id: 'steelworker', keywords: ['steel', 'mill', 'stahl', 'hütte', 'huette'] },
  { id: 'factory_worker', keywords: ['factory', 'manufacturing', 'assembly', 'fabrik', 'industry'] },
  { id: 'bookbinder', keywords: ['books', 'binding', 'bookbinding', 'buchbinderei', 'buch'] },
  { id: 'printer', keywords: ['printing', 'press', 'typesetter', 'druck', 'druckerei'] },
  { id: 'mechanic', keywords: ['repair', 'engine', 'motor', 'werkstatt', 'car'] },
  { id: 'construction_worker', keywords: ['building', 'site', 'construction', 'bau', 'labourer'] },
  { id: 'crane_operator', keywords: ['crane', 'construction', 'lifting', 'kran', 'hoist'] },
  { id: 'surveyor', keywords: ['land', 'maps', 'survey', 'vermessung', 'landmesser'] },
  { id: 'cartographer', keywords: ['maps', 'mapping', 'cartography', 'karte', 'karten'] },
  { id: 'scaffolder', keywords: ['scaffolding', 'construction', 'gerüst', 'geruest', 'steier'] },
  { id: 'knight', keywords: ['medieval', 'chivalry', 'sword', 'ritterlich', 'crusade'] },
  { id: 'servant', keywords: ['serf', 'domestic', 'hired hand', 'dienstbote', 'dienstbode'] },
  { id: 'maid', keywords: ['housemaid', 'domestic', 'dienstmagd', 'hausmädchen', 'meid'] },
  { id: 'housekeeper', keywords: ['household', 'domestic', 'haushalt', 'hausdame', 'cleaning'] },
  { id: 'cook', keywords: ['kitchen', 'chef', 'food', 'küche', 'kochen'] },
  { id: 'innkeeper', keywords: ['inn', 'tavern', 'wirt', 'gasthaus', 'herberg'] },
  { id: 'hotelier', keywords: ['hotel', 'hotels', 'hospitality', 'hotelbetreiber', 'hostel'] },
  { id: 'waiter', keywords: ['restaurant', 'service', 'serving', 'kellnern', 'server'] },
  { id: 'barista', keywords: ['coffee', 'café', 'cafe', 'kaffee', 'espresso'] },
  { id: 'sommelier', keywords: ['wine', 'wine waiter', 'weinkellner', 'wine expert', 'wein'] },
  { id: 'barber', keywords: ['hair', 'haircut', 'barbier', 'haare', 'hairdresser'] },
  { id: 'beautician', keywords: ['beauty', 'cosmetics', 'makeup', 'kosmetik', 'schönheit'] },
  { id: 'tattoo_artist', keywords: ['tattoo', 'tattoos', 'tätowieren', 'taetowierer', 'ink'] },
  { id: 'cleaner', keywords: ['cleaning', 'housekeeping', 'reinigung', 'putzfrau', 'putzmann'] },
  { id: 'janitor', keywords: ['caretaker', 'building', 'porter', 'hausverwalter', 'concierge'] },
  { id: 'security_guard', keywords: ['security', 'guard', 'wachdienst', 'bewacher', 'watchman'] },
  { id: 'childminder', keywords: ['childcare', 'nanny', 'kinder', 'babysitter', 'tagesmutter'] },
  { id: 'coachman', keywords: ['carriage', 'horse', 'coach', 'kutsche', 'driver'] },
  { id: 'carter', keywords: ['cart', 'carriage', 'haulage', 'carrier', 'fuhr'] },
  { id: 'falconer', keywords: ['falcons', 'birds of prey', 'falke', 'hawk', 'medieval'] },
  { id: 'mercenary', keywords: ['soldier', 'army', 'medieval', 'soeldner', 'hired'] },
  { id: 'armourer', keywords: ['armour', 'armor', 'weapons', 'rüstung', 'ruestung'] },
  { id: 'steward', keywords: ['estate', 'manager', 'administrator', 'verwalter', 'estate manager'] },
  { id: 'herbalist', keywords: ['herbs', 'kräuter', 'kraeuter', 'plants', 'healer'] },
  { id: 'pedlar', keywords: ['peddler', 'hawker', 'trader', 'street', 'hausieren'] },
  { id: 'town_crier', keywords: ['crier', 'announcer', 'herald', 'town', 'ausrufer'] },
  { id: 'gravedigger', keywords: ['graves', 'cemetery', 'grave', 'friedhof', 'sexton'] },
  { id: 'midwife', keywords: ['birth', 'obstetrics', 'childbirth', 'geburt', 'hebamme'] },
  { id: 'doctor', keywords: ['physician', 'medic', 'medicine', 'mediziner', 'gp'] },
  { id: 'surgeon', keywords: ['surgery', 'operations', 'operation', 'chirurgie', 'arzt'] },
  { id: 'pediatrician', keywords: ['children', 'paediatrician', 'pediatrics', 'kinder', 'kinderheilkunde'] },
  { id: 'gynaecologist', keywords: ['gynecologist', 'women', 'obstetrics', 'gynäkologie', 'frauenarzt'] },
  { id: 'pathologist', keywords: ['pathology', 'tissue', 'autopsy', 'pathologie', 'laboratory'] },
  { id: 'veterinarian', keywords: ['vet', 'animals', 'veterinär', 'veterinaer', 'tiere'] },
  { id: 'dentist', keywords: ['teeth', 'dental', 'zahn', 'zahnmedizin', 'tand'] },
  { id: 'pharmacist', keywords: ['pharmacy', 'drugs', 'medicine', 'apotheke', 'drogist'] },
  { id: 'nurse', keywords: ['hospital', 'care', 'pflege', 'pflegekraft', 'carer'] },
  { id: 'paramedic', keywords: ['ambulance', 'emergency', 'rettung', 'sanitäter', 'sanitaeter'] },
  { id: 'physiotherapist', keywords: ['physio', 'therapy', 'massage', 'physiotherapie', 'rehab'] },
  { id: 'occupational_therapist', keywords: ['therapy', 'rehab', 'ergotherapie', 'occupational', 'hands'] },
  { id: 'speech_therapist', keywords: ['speech', 'language', 'logopädie', 'logopaedie', 'therapy'] },
  { id: 'nutritionist', keywords: ['nutrition', 'diet', 'ernährung', 'ernaehrung', 'food'] },
  { id: 'psychologist', keywords: ['therapy', 'mind', 'psychology', 'psychologie', 'therapeut'] },
  { id: 'psychiatrist', keywords: ['mental health', 'psychiatry', 'psychiatrie', 'therapy', 'medicine'] },
  { id: 'therapist', keywords: ['therapy', 'counselling', 'counseling', 'therapie', 'healing'] },
  { id: 'optician', keywords: ['glasses', 'eyes', 'optik', 'brille', 'eyewear'] },
  { id: 'radiographer', keywords: ['x-ray', 'radiology', 'imaging', 'röntgen', 'roentgen'] },
  { id: 'lab_technician', keywords: ['lab', 'laboratory', 'science', 'labor', 'technician'] },
  { id: 'priest', keywords: ['clergy', 'church', 'cleric', 'kirche', 'pastor'] },
  { id: 'pastor', keywords: ['minister', 'church', 'vicar', 'pfarramt', 'prediger'] },
  { id: 'monk', keywords: ['monastery', 'abbey', 'cloister', 'kloster', 'nun'] },
  { id: 'organist', keywords: ['organ', 'church', 'music', 'orgel', 'musician'] },
  { id: 'scribe', keywords: ['writer', 'copyist', 'manuscripts', 'schreiber', 'clerk'] },
  { id: 'teacher', keywords: ['school', 'education', 'schule', 'lehrkraft', 'pädagoge'] },
  { id: 'kindergarten_teacher', keywords: ['kindergarten', 'preschool', 'kita', 'erzieher', 'nursery'] },
  { id: 'headteacher', keywords: ['school', 'principal', 'head', 'schulleitung', 'skoolhoof'] },
  { id: 'tutor', keywords: ['private', 'lessons', 'nachhilfe', 'coach', 'teaching'] },
  { id: 'driving_instructor', keywords: ['driving', 'driver', 'cars', 'fahren', 'fahrschule'] },
  { id: 'professor', keywords: ['university', 'academic', 'hochschule', 'universität', 'universitaet'] },
  { id: 'lecturer', keywords: ['university', 'academic', 'lecture', 'hochschule', 'dozentur'] },
  { id: 'librarian', keywords: ['library', 'books', 'bibliothek', 'libraries', 'bücher'] },
  { id: 'archivist', keywords: ['archive', 'records', 'history', 'archiv', 'documents'] },
  { id: 'historian', keywords: ['history', 'past', 'historie', 'researcher', 'geschichte'] },
  { id: 'curator', keywords: ['museum', 'exhibition', 'gallery', 'kuratorin', 'art'] },
  { id: 'translator', keywords: ['language', 'languages', 'translation', 'uebersetzer', 'übersetzung'] },
  { id: 'interpreter', keywords: ['translator', 'speech', 'interpreting', 'dolmetschen', 'language'] },
  { id: 'writer', keywords: ['author', 'novelist', 'books', 'literature', 'autor'] },
  { id: 'journalist', keywords: ['reporter', 'news', 'press', 'journalismus', 'zeitung'] },
  { id: 'editor', keywords: ['newspaper', 'publishing', 'magazine', 'redaktion', 'editing'] },
  { id: 'photographer', keywords: ['camera', 'photos', 'photography', 'foto', 'lichtbild'] },
  { id: 'actor', keywords: ['theatre', 'film', 'stage', 'acting', 'schauspiel'] },
  { id: 'film_director', keywords: ['film', 'movie', 'director', 'cinema', 'theatre'] },
  { id: 'screenwriter', keywords: ['film', 'scripts', 'tv', 'writer', 'drehbuch'] },
  { id: 'film_editor', keywords: ['cutter', 'video', 'montage', 'editing', 'film'] },
  { id: 'musician', keywords: ['music', 'band', 'orchestra', 'musik', 'instrument'] },
  { id: 'singer', keywords: ['vocal', 'voice', 'singing', 'song', 'gesang'] },
  { id: 'dancer', keywords: ['ballet', 'dance', 'tanz', 'tanzen', 'choreographer'] },
  { id: 'artist', keywords: ['art', 'painting', 'sculpture', 'kunst', 'creative'] },
  { id: 'sculptor', keywords: ['sculpture', 'statues', 'art', 'bildhauerei', 'stone'] },
  { id: 'architect', keywords: ['buildings', 'design', 'building', 'architektur', 'plans'] },
  { id: 'civil_engineer', keywords: ['construction', 'roads', 'bridges', 'bau', 'civil'] },
  { id: 'engineer', keywords: ['engineering', 'technical', 'technik', 'machines', 'engineer'] },
  { id: 'urban_planner', keywords: ['city', 'planning', 'stadtplanung', 'town', 'zoning'] },
  { id: 'chemist', keywords: ['chemistry', 'lab', 'laboratory', 'chemie', 'labor'] },
  { id: 'biologist', keywords: ['biology', 'science', 'life', 'biologie', 'research'] },
  { id: 'physicist', keywords: ['physics', 'science', 'research', 'physik', 'quantum'] },
  { id: 'mathematician', keywords: ['maths', 'math', 'numbers', 'mathematik', 'wissenschaft'] },
  { id: 'scientist', keywords: ['research', 'science', 'researcher', 'forschung', 'labor'] },
  { id: 'geologist', keywords: ['geology', 'rocks', 'earth', 'geologie', 'minerals'] },
  { id: 'astronomer', keywords: ['stars', 'space', 'astronomie', 'telescope', 'sterre'] },
  { id: 'lawyer', keywords: ['law', 'attorney', 'legal', 'advocate', 'anwalt'] },
  { id: 'notary', keywords: ['legal', 'documents', 'notariat', 'notar', 'certification'] },
  { id: 'judge', keywords: ['court', 'law', 'justice', 'richter', 'gericht'] },
  { id: 'police_officer', keywords: ['police', 'cop', 'officer', 'polizei', 'constable'] },
  { id: 'detective', keywords: ['investigator', 'crime', 'ermittler', 'spy', 'detektei'] },
  { id: 'firefighter', keywords: ['fire', 'rescue', 'feuerwehr', 'brandweer', 'fireman'] },
  { id: 'soldier', keywords: ['army', 'military', 'wehrdienst', 'armee', 'troops'] },
  { id: 'army_officer', keywords: ['army', 'military', 'officer', 'bundeswehr', 'leutnant'] },
  { id: 'diplomat', keywords: ['embassy', 'foreign', 'diplomatie', 'consul', 'ambassador'] },
  { id: 'politician', keywords: ['government', 'parliament', 'politik', 'politics', 'mp'] },
  { id: 'mayor', keywords: ['town', 'city', 'bürgermeister', 'buergermeister', 'council'] },
  { id: 'civil_servant', keywords: ['government', 'public service', 'beamtentum', 'amt', 'official'] },
  { id: 'social_worker', keywords: ['welfare', 'social', 'sozialpädagoge', 'sozialpaedagoge', 'sozial'] },
  { id: 'customs_officer', keywords: ['border', 'customs', 'zoll', 'import', 'douane'] },
  { id: 'prison_guard', keywords: ['prison', 'jail', 'guard', 'gefängnis', 'gefaengnis'] },
  { id: 'postal_worker', keywords: ['mail', 'post', 'letter carrier', 'briefträger', 'postman'] },
  { id: 'railway_worker', keywords: ['train', 'rail', 'railroad', 'bahn', 'eisenbahn'] },
  { id: 'train_driver', keywords: ['locomotive', 'train', 'engine driver', 'lokomotive', 'bahn'] },
  { id: 'train_conductor', keywords: ['conductor', 'train', 'tickets', 'schaffner', 'bahn'] },
  { id: 'bus_driver', keywords: ['bus', 'transport', 'driver', 'omnibus', 'fahrer'] },
  { id: 'taxi_driver', keywords: ['taxi', 'cab', 'driver', 'fahrer', 'chauffeur'] },
  { id: 'truck_driver', keywords: ['lorry', 'trucker', 'hgv', 'lastwagen', 'lkw'] },
  { id: 'delivery_driver', keywords: ['delivery', 'van', 'lieferant', 'driver', 'courier'] },
  { id: 'chauffeur', keywords: ['driver', 'car', 'limousine', 'fahrer', 'driving'] },
  { id: 'courier', keywords: ['delivery', 'messenger', 'bote', 'kurierdienst', 'parcels'] },
  { id: 'pilot', keywords: ['aviation', 'aircraft', 'flying', 'flug', 'flugzeug'] },
  { id: 'flight_attendant', keywords: ['cabin crew', 'steward', 'stewardess', 'airline', 'flug'] },
  { id: 'air_traffic_controller', keywords: ['air traffic', 'atc', 'aviation', 'flughafen', 'tower'] },
  { id: 'athlete', keywords: ['sport', 'sports', 'olympic', 'athletics', 'athletik'] },
  { id: 'coach', keywords: ['training', 'sports', 'trainer', 'fitness', 'instructor'] },
  { id: 'referee', keywords: ['umpire', 'sports', 'match', 'schiedsrichter', 'official'] },
  { id: 'park_ranger', keywords: ['park', 'wildlife', 'national park', 'nature', 'ranger'] },
  { id: 'pensioner', keywords: ['retired', 'pension', 'rente', 'ruhestand', 'retiree'] },
  { id: 'apprentice', keywords: ['trainee', 'learner', 'lehrling', 'ausbildung', 'lehre'] },
  { id: 'clerk', keywords: ['office', 'admin', 'clerical', 'büro', 'buero'] },
  { id: 'secretary', keywords: ['assistant', 'office', 'admin', 'sekretariat', 'secretarial'] },
  { id: 'typist', keywords: ['typing', 'typewriter', 'stenographer', 'schreibmaschine', 'keyboard'] },
  { id: 'telephone_operator', keywords: ['switchboard', 'operator', 'telephone', 'vermittlung', 'phone'] },
  { id: 'telegraph_operator', keywords: ['telegraph', 'morse', 'wireless', 'telegrafie', 'radio'] },
  { id: 'bookkeeper', keywords: ['books', 'ledger', 'accounts', 'buchhaltung', 'finance'] },
  { id: 'accountant', keywords: ['audit', 'accounts', 'tax', 'finance', 'accountancy'] },
  { id: 'tax_advisor', keywords: ['tax', 'taxes', 'steuern', 'steuer', 'accountant'] },
  { id: 'actuary', keywords: ['insurance', 'risk', 'statistics', 'mathematik', 'versicherung'] },
  { id: 'economist', keywords: ['economics', 'finance', 'economy', 'wirtschaft', 'ökonom'] },
  { id: 'banker', keywords: ['bank', 'finance', 'money', 'bankkaufmann', 'kredit'] },
  { id: 'financial_advisor', keywords: ['finance', 'investment', 'money', 'finanz', 'berater'] },
  { id: 'insurance_agent', keywords: ['insurance', 'policy', 'versicherung', 'agent', 'broker'] },
  { id: 'real_estate_agent', keywords: ['property', 'estate', 'realtor', 'immobilien', 'makler'] },
  { id: 'stock_trader', keywords: ['stock', 'trading', 'finance', 'börse', 'boerse'] },
  { id: 'consultant', keywords: ['advisor', 'consulting', 'consultancy', 'beratung', 'consultant'] },
  { id: 'human_resources_manager', keywords: ['hr', 'recruiting', 'personnel', 'personal', 'hiring'] },
  { id: 'marketing_manager', keywords: ['marketing', 'advertising', 'brand', 'werbung', 'werbefachmann'] },
  { id: 'entrepreneur', keywords: ['business', 'startup', 'founder', 'unternehmen', 'gründer'] },
  { id: 'merchant', keywords: ['trader', 'dealer', 'trade', 'händler', 'haendler'] },
  { id: 'shopkeeper', keywords: ['shop', 'store', 'retail', 'laden', 'winkel'] },
  { id: 'salesperson', keywords: ['sales', 'retail', 'vendor', 'verkauf', 'shop'] },
  { id: 'cashier', keywords: ['till', 'checkout', 'register', 'kasse', 'supermarket'] },
  { id: 'grocer', keywords: ['groceries', 'food', 'grocery', 'lebensmittel', 'shop'] },
  { id: 'fishmonger', keywords: ['fish', 'seafood', 'fischerei', 'market', 'fisch'] },
  { id: 'florist', keywords: ['flowers', 'bouquet', 'blumen', 'blumenladen', 'plants'] },
  { id: 'bookseller', keywords: ['books', 'bookshop', 'buchhandel', 'literature', 'buch'] },
  { id: 'warehouse_worker', keywords: ['warehouse', 'stock', 'storage', 'lager', 'logistik'] },
  { id: 'call_centre_agent', keywords: ['customer service', 'support', 'hotline', 'helpdesk', 'call center'] },
  { id: 'tour_guide', keywords: ['guide', 'travel', 'tourism', 'reiseführer', 'reisefuehrer'] },
  { id: 'homemaker', keywords: ['housewife', 'housekeeping', 'household', 'hausfrau', 'huisvrou'] },
  { id: 'software_developer', keywords: ['programmer', 'coder', 'developer', 'software', 'programmierer'] },
  { id: 'game_developer', keywords: ['games', 'video games', 'gamedev', 'spiele', 'unity'] },
  { id: 'data_analyst', keywords: ['data', 'analytics', 'statistics', 'analysis', 'daten'] },
  { id: 'it_specialist', keywords: ['it', 'tech support', 'helpdesk', 'computers', 'technik'] },
  { id: 'system_administrator', keywords: ['sysadmin', 'servers', 'it', 'admin', 'linux'] },
  { id: 'network_engineer', keywords: ['networking', 'network', 'cisco', 'netzwerk', 'routers'] },
  { id: 'database_administrator', keywords: ['database', 'sql', 'dba', 'datenbank', 'data'] },
  { id: 'devops_engineer', keywords: ['devops', 'infrastructure', 'cloud', 'deployment', 'pipelines'] },
  { id: 'machine_learning_engineer', keywords: ['ai', 'ml', 'machine learning', 'data', 'künstliche intelligenz'] },
  { id: 'cybersecurity_specialist', keywords: ['security', 'hacker', 'cyber', 'sicherheit', 'it'] },
  { id: 'qa_tester', keywords: ['testing', 'quality', 'qa', 'tests', 'testen'] },
  { id: 'web_designer', keywords: ['web', 'website', 'design', 'css', 'webseite'] },
  { id: 'ux_designer', keywords: ['ux', 'user experience', 'ui', 'usability', 'interface'] },
  { id: 'graphic_designer', keywords: ['graphics', 'design', 'layout', 'logo', 'grafik'] },
  { id: 'designer', keywords: ['design', 'creative', 'ontwerp', 'gestalter', 'layout'] },
  { id: 'product_manager', keywords: ['product', 'pm', 'roadmap', 'produkt', 'manager'] },
  { id: 'project_manager', keywords: ['project', 'projects', 'manage', 'pm', 'projekt'] },
  { id: 'content_creator', keywords: ['content', 'video', 'influencer', 'social media', 'creator'] },
];

// ---------- helpers ----------
// A person's occupation is stored twice: `occupation` is the text as the family wrote it, and
// `occupation_code` is the id of the vocabulary entry it names (NULL when none). The code wins for display,
// so each reader sees the entry in their language; without a code the text is shown as written.

export type Sex = 'm' | 'f' | 'x' | null | undefined;

const BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));

export const occupationById = (id: string | null | undefined): Occupation | undefined => (id ? BY_ID.get(id) : undefined);
export const isOccupationId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);

const keyOf = (o: Occupation) => `occupation.${o.id}` as Key;

/** "Lehrer" + "Lehrerin" → "Lehrer:in". Equal forms stay one word; other pairs read "Bauer/Bäuerin". */
export function germanPair(m: string, f: string): string {
  if (m === f) return m;
  if (f.startsWith(m)) return `${m}:${f.slice(m.length)}`;
  return `${m}/${f}`;
}

/** The masculine and the feminine form a language's label holds ("Bäcker|Bäckerin"); a label without two is both. */
const formsOf = (label: string): [m: string, f: string] => {
  const [m, f = m] = label.split('|');
  return [m, f];
};

/**
 * The label in the reader's language. A language with a masculine and a feminine form gives the one for the person's sex;
 * for 'x' or an unknown sex it gives the pair: "Lehrer:in" in German, "masculine/feminine" in another language.
 */
export function occupationLabel(o: Occupation, locale: Locale, sex: Sex): string {
  const [m, f] = formsOf(translate(locale, keyOf(o)));
  if (sex === 'm') return m;
  if (sex === 'f') return f;
  return locale === 'de' ? germanPair(m, f) : m === f ? m : `${m}/${f}`;
}

/** The English label: the occupation's name in the key, which other labels are compared with. */
export const occupationEnglish = (o: Occupation) => translate('en', keyOf(o));

/** What to show for a person: the vocabulary label when a code is set, else the free text exactly as entered. */
export function occupationText(p: { occupation?: string | null; occupationCode?: string | null; sex?: Sex }, locale: Locale): string | undefined {
  const o = occupationById(p.occupationCode);
  if (o) return occupationLabel(o, locale, p.sex);
  return p.occupation ?? undefined;
}

/** Case folding and accent folding for search: "Bäckerin" matches "backerin" and "BÄCKERIN". */
export const foldOccupation = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');

/** Every label an entry is known by in the languages this page has: each form, and with `pairs` the written-out pair too. */
function labelsOf(o: Occupation, pairs = false): string[] {
  return namesInEveryLanguage(keyOf(o)).flatMap((label) => {
    const [m, f] = formsOf(label);
    return m === f ? [m] : pairs ? [m, f, germanPair(m, f)] : [m, f];
  });
}

/** Every spelling an entry answers to in any language: its labels in each form, plus its keywords. */
function namesOf(o: Occupation): string[] {
  return [...labelsOf(o, true), ...o.keywords];
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
    const labels = [own, ...labelsOf(o).map(foldOccupation)];
    let score = Infinity;
    if (labels[0].startsWith(q)) score = 0;
    else if (labels[0].split(/[\s/:-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (labels[0].includes(q)) score = 2;
    else if (labels.some((l) => l.startsWith(q))) score = 3;
    else if (labels.some((l) => l.includes(q))) score = 4;
    else if (namesOf(o).some((n) => foldOccupation(n).includes(q))) score = 5;
    if (score !== Infinity) scored.push({ o, score });
  }
  return scored.sort((a, b) => a.score - b.score || occupationEnglish(a.o).localeCompare(occupationEnglish(b.o))).slice(0, limit).map((x) => x.o);
}

/** Label (lower case) → the ids that carry it, built from the languages this page has and rebuilt when one arrives. */
let exact: { version: number; map: Map<string, Set<string>> } | undefined;
function exactLabels() {
  const version = tablesVersion();
  if (exact?.version === version) return exact.map;
  const map = new Map<string, Set<string>>();
  for (const o of OCCUPATIONS) {
    for (const label of labelsOf(o, true)) {
      const key = label.trim().toLowerCase();
      const ids = map.get(key) ?? new Set<string>();
      ids.add(o.id);
      map.set(key, ids);
    }
  }
  exact = { version, map };
  return map;
}

/**
 * The one entry a piece of free text names: an exact or case-insensitive match against any language's label.
 * Undefined when nothing matches, or when two entries share the label (a guess would be wrong), so the text
 * stays free text.
 */
export function occupationForText(text: string | null | undefined): Occupation | undefined {
  const key = (text ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const ids = exactLabels().get(key);
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
