// Canting arms: arms that pun on the bearer's name, as heralds have always made them ("Müller: the miller's
// wheel"). An offline generator built on a curated table of surname elements in German, English, Dutch and the
// Scandinavian languages, plus a fallback on the initial's sound.
//
// Everything goes through one JSON shape, `CantingIdea`, so a later AI provider can answer the same question
// (`CantingRequest` in, `CantingResponse` out) and `cantingFromIdeas` turns either into drawable arms.
import { translate, type Key, type Vars } from '~/lib/i18n/dictionary';
import type { ArmsLayer, ArmsV2, ChargeLayer, FieldDivision, OrdinaryKind, PartitionLine, ShieldShape, TinctureV2 } from '~/lib/seed-format';
import { chargeDef } from './registry';
import { cantingResponseSchema, type Symbolism } from './canting-schema.ts';
import { contrastFor, underOf } from './rules';
import { kindOf } from './tinctures';

// ---------- the JSON shape ----------

/** What a canting generator (this table, or an AI provider) is asked. */
export interface CantingRequest {
  surname: string;
  /** ISO 3166 code of the house's country, lower case; steers the language and the shield shape. */
  country?: string;
}

/** One idea for arms, in plain parts. Unknown charges are dropped and tinctures repaired when it is drawn. */
export interface CantingIdea {
  /** One line for the reader: "Müller: the miller's wheel". */
  explanation: string;
  /** The part of the name the idea plays on. */
  element?: string;
  /** The id of the meaning it draws on, when the reader chose meanings to design from (see components/ai/arms). */
  meaningId?: string;
  field?: TinctureV2[];
  division?: FieldDivision;
  /** A mount, water or a green field across the foot of the shield. */
  base?: 'mount' | 'water' | 'field';
  ordinary?: { kind: OrdinaryKind; tincture?: TinctureV2; line?: PartitionLine };
  charges?: { charge: string; tincture?: TinctureV2; count?: number; on?: 'field' | 'ordinary' | 'chief' }[];
  /** What the colours and charges stand for, in the reader's words (AI only; the offline table leaves it out). */
  symbolism?: Symbolism[];
}

export interface CantingResponse {
  suggestions: CantingIdea[];
}

export { cantingResponseSchema, symbolismItemSchema } from './canting-schema.ts';

/** Where the offline suggestions come from, for the reader. */
export const CANTING_SOURCE_NOTE: Key = 'canting.source';

/** Translates an explanation's words. The Designer passes its own `t`; without one, the English text. */
export type Tr = (key: Key, vars?: Vars) => string;
const english: Tr = (key, vars) => translate('en', key, vars);

export interface CantingSuggestion {
  arms: ArmsV2;
  explanation: string;
  element?: string;
  meaningId?: string;
  symbolism?: Symbolism[];
}

// ---------- the table ----------

interface Element {
  /** Matched against the normalised surname: ä→ae, ö→oe, ü→ue, ß→ss, å→aa, ø→oe, æ→ae, lower case. */
  re: RegExp;
  /** What the element means, for the explanation: "the miller's wheel". */
  means: Key;
  /** Ideas, best first. */
  ideas: Omit<CantingIdea, 'explanation' | 'element'>[];
  /** Only for these countries (when a country is given). */
  only?: string[];
}

const C = (charge: string, tincture?: TinctureV2, count?: number, on?: 'field' | 'ordinary' | 'chief') => ({ charge, tincture, count, on });

/** Whole names and occupations: checked first, they win over the parts. */
const OCCUPATIONS: Element[] = [
  { re: /^(mue?ller|moeller|miller|millar|molenaar|moller|moellmann|mullner|mueller)/, means: 'canting.the_millers_wheel', ideas: [
    { field: ['azure'], charges: [C('mill-wheel', 'or')] }, { field: ['or'], charges: [C('mill-rind', 'sable', 3)] }, { field: ['gules'], charges: [C('windmill', 'argent')] }, { field: ['argent'], ordinary: { kind: 'chevron', tincture: 'azure' }, charges: [C('millstone', 'sable', 3)] }] },
  { re: /^(schmi[dt]+t?|schmitz|smith|smyth|smid|smit|smed|smedt|smidt|kowal)/, means: 'canting.the_smiths_hammer_and_anvil', ideas: [
    { field: ['gules'], charges: [C('anvil', 'argent'), C('hammer', 'or', 1, 'chief')] }, { field: ['sable'], charges: [C('smith-hammer', 'or', 3)] }, { field: ['azure'], ordinary: { kind: 'chevron', tincture: 'or' }, charges: [C('horseshoe', 'argent', 3)] }] },
  { re: /^(fischer|fisher|visser|fiske|fisker|fischler|vischer)/, means: 'canting.the_fishers_fish', ideas: [
    { field: ['azure'], charges: [C('fish', 'argent', 3)] }, { base: 'water', field: ['argent'], charges: [C('fish', 'azure')] }, { field: ['vert'], ordinary: { kind: 'fess', tincture: 'argent', line: 'wavy' }, charges: [C('fish', 'or', 2)] }] },
  { re: /^(becker|baecker|baker|bakker|bager|backer|baeck|pfister)/, means: 'canting.the_bakers_pretzel', ideas: [
    { field: ['azure'], charges: [C('pretzel', 'or')] }, { field: ['gules'], charges: [C('garb', 'or', 3)] }, { field: ['or'], ordinary: { kind: 'chief', tincture: 'gules' }, charges: [C('bread', 'proper'), C('pretzel', 'or', 2, 'chief')] }] },
  { re: /^(hof+mann?|hofman|hoffman|hovmand|hovmann)/, means: 'canting.the_farmstead_of_the_steward_of_the_court', ideas: [
    { field: ['vert'], charges: [C('barn', 'argent')] }, { field: ['gules'], charges: [C('gate', 'or')] }, { field: ['or'], base: 'field', charges: [C('garb', 'vert')] }] },
  { re: /^(bauer|baur|boer|bonde|farmer|buur|bouwman|landmann)/, means: 'canting.the_farmers_plough_and_sheaf', ideas: [
    { field: ['vert'], charges: [C('plough', 'or')] }, { field: ['azure'], charges: [C('garb', 'or', 3)] }, { field: ['or'], ordinary: { kind: 'fess', tincture: 'vert' }, charges: [C('wheat', 'or', 3, 'ordinary')] }] },
  { re: /^(mei?er|mai?er|mayer|meyr|meijer|meyer)/, means: 'canting.the_farm_stewards_key_and_sheaf', ideas: [
    { field: ['or'], charges: [C('garb', 'vert')] }, { field: ['azure'], ordinary: { kind: 'bend', tincture: 'or' }, charges: [C('key', 'azure', 1, 'ordinary')] }] },
  { re: /^(schneider|snyder|snijder|schnider|taylor|tailor|skraeddare|schroeder|schroder)/, means: 'canting.the_tailors_shears', ideas: [
    { field: ['gules'], charges: [C('shears', 'argent')] }, { field: ['azure'], charges: [C('needle', 'or', 3)] }] },
  { re: /^(wagner|wainwright|wagenaar|wegner|vagner)/, means: 'canting.the_wheelwrights_wheel', ideas: [
    { field: ['or'], charges: [C('wheel', 'gules')] }, { field: ['azure'], charges: [C('wheel', 'or', 3)] }] },
  { re: /^(weber|weaver|wever|webber|waever|vaever|webster)/, means: 'canting.the_weavers_wheel', ideas: [
    { field: ['azure'], charges: [C('spinning-wheel', 'or')] }, { field: ['gules', 'argent'], division: 'paly', charges: [C('spinning-wheel', 'sable', 1, 'chief')] }] },
  { re: /^(zimmer+man+|carpenter|timmerman|toemrer|timmermann|snickare)/, means: 'canting.the_carpenters_axe_and_saw', ideas: [
    { field: ['vert'], charges: [C('war-axe', 'or')] }, { field: ['gules'], ordinary: { kind: 'chevron', tincture: 'argent' }, charges: [C('saw', 'or', 3)] }] },
  { re: /^(koch|kock|cook|kok|kokk)$/, means: 'canting.the_cooks_cauldron', ideas: [{ field: ['gules'], charges: [C('cauldron', 'or')] }] },
  { re: /^(schae?fer|schaefer|shepherd|sheppard|schaper|herder|herter|hirt)/, means: 'canting.the_shepherds_sheep', ideas: [
    { field: ['vert'], charges: [C('sheep', 'argent')] }, { field: ['azure'], base: 'mount', charges: [C('ram', 'argent')] }] },
  { re: /^(jae?ger|hunter|jager|jaeger|jeger|jaegher)/, means: 'canting.the_hunters_horn', ideas: [
    { field: ['argent'], charges: [C('hunting-horn', 'sable')] }, { field: ['vert'], charges: [C('deer', 'or')] }] },
  { re: /^(krueger|kruger|krug)/, means: 'canting.the_innkeepers_jug', ideas: [{ field: ['azure'], charges: [C('jug', 'or')] }, { field: ['gules'], charges: [C('tankard', 'argent', 3)] }] },
  { re: /^(brauer|brewer|brouwer|bryggare|brygger)/, means: 'canting.the_brewers_hops_and_barrel', ideas: [{ field: ['vert'], charges: [C('hops', 'or', 3)] }, { field: ['or'], charges: [C('barrel', 'sable')] }] },
  { re: /^(richter|judge|rechter|domare|dommer)/, means: 'canting.the_judges_balance', ideas: [{ field: ['azure'], charges: [C('scales', 'or')] }] },
  { re: /^(vogt|voigt|foged|fogde|voogd)/, means: 'canting.the_reeves_key_and_sword', ideas: [{ field: ['gules'], charges: [C('key', 'or'), C('sword', 'argent', 1, 'chief')] }] },
  { re: /^(schul[tz]+e?|scholz|schol[tz]e?)/, means: 'canting.the_village_mayors_key', ideas: [{ field: ['azure'], charges: [C('key', 'or', 2)] }] },
  { re: /^(keller|kellner|cellar)/, means: 'canting.the_cellarers_barrel_and_key', ideas: [{ field: ['or'], charges: [C('barrel', 'gules')] }, { field: ['sable'], charges: [C('key', 'or', 3)] }] },
  { re: /^(fleischer|fleischmann|metzger|butcher|slager|slagter|slaktare)/, means: 'canting.the_butchers_ox_and_axe', ideas: [{ field: ['gules'], charges: [C('bull', 'argent')] }, { field: ['argent'], charges: [C('axe', 'gules', 2)] }] },
  { re: /^(kaiser|keizer|keyser|kejser)/, means: 'canting.the_emperors_crown', ideas: [{ field: ['or'], charges: [C('eagle', 'sable'), C('imperial-crown', 'or', 1, 'chief')] }, { field: ['purpure'], charges: [C('imperial-crown', 'or')] }] },
  { re: /^(koenig|konig|king|koning|kung|konge|kuenig)/, means: 'canting.the_kings_crown', ideas: [{ field: ['azure'], charges: [C('crown', 'or')] }, { field: ['gules'], charges: [C('crown', 'or', 3)] }] },
  { re: /^(graf|graaf|grave|greve|count)$/, means: 'canting.the_counts_coronet', ideas: [{ field: ['gules'], charges: [C('coronet', 'or')] }] },
  { re: /^(herzog|hertog|duke|hertig)/, means: 'canting.the_dukes_coronet', ideas: [{ field: ['azure'], charges: [C('coronet', 'or')] }] },
  { re: /^(ritter|knight|ridder|riddare)/, means: 'canting.the_knights_helm_and_sword', ideas: [{ field: ['sable'], charges: [C('helm', 'argent')] }, { field: ['gules'], charges: [C('sword', 'argent', 2)] }] },
  { re: /^(bischo?f+|bishop|bisschop|biskop)/, means: 'canting.the_bishops_mitre', ideas: [{ field: ['gules'], charges: [C('tiara', 'argent')] }] },
  { re: /^(gaertner|gartner|gardner|gardener|tuinman|traedgaard)/, means: 'canting.the_gardeners_rose', ideas: [{ field: ['argent'], charges: [C('rose-slipped', 'gules')] }, { field: ['vert'], charges: [C('spade', 'argent'), C('rose', 'gules', 2, 'chief')] }] },
  { re: /^(foerster|forster|forester|foster|forstner|skogvaktare)/, means: 'canting.the_foresters_trees_and_horn', ideas: [{ field: ['argent'], charges: [C('pine', 'vert', 3)] }, { field: ['vert'], charges: [C('hunting-horn', 'or')] }] },
  { re: /^(schiffer|schipper|skipper|schiffmann|seemann|seaman|zeeman|sjoeman|sjoman)/, means: 'canting.the_sailors_ship_and_anchor', ideas: [{ base: 'water', field: ['azure'], charges: [C('ship', 'or')] }, { field: ['azure'], charges: [C('anchor', 'argent')] }] },
  { re: /^(kaufmann|koopman|chapman|merchant|koepman|kjoebmand)/, means: 'canting.the_merchants_balance', ideas: [{ field: ['azure'], charges: [C('scales', 'or')] }, { field: ['sable'], charges: [C('roundel', 'or', 3)] }] },
  { re: /^(wirth?|wirtz)$/, means: 'canting.the_hosts_tankard', ideas: [{ field: ['gules'], charges: [C('tankard', 'argent')] }] },
  { re: /^(ziegler|tegler|tiler|steenbakker)/, means: 'canting.the_brick_makers_bricks', ideas: [{ field: ['argent'], charges: [C('billet', 'gules', 3)] }] },
  { re: /^(imker|beekeeper|bijenhouder|biodlare)/, means: 'canting.the_beekeepers_hive', ideas: [{ field: ['vert'], charges: [C('beehive', 'or')] }, { field: ['azure'], charges: [C('bee', 'or', 3)] }] },
  { re: /^(gloeckner|glockner|bell|klokker|klockare)/, means: 'canting.the_bell_ringers_bell', ideas: [{ field: ['azure'], charges: [C('bell', 'or')] }] },
  { re: /^(schue?tz[e]?|schutz|archer|bowman|schutter|skytte)/, means: 'canting.the_archers_bow', ideas: [{ field: ['vert'], charges: [C('bow', 'or')] }, { field: ['gules'], charges: [C('pheon', 'argent', 3)] }] },
  { re: /^(toepfer|topfer|potter|pottebakker|krukmakare)/, means: 'canting.the_potters_ewer', ideas: [{ field: ['azure'], charges: [C('jug', 'argent', 3)] }] },
  { re: /^(glaser|glazier|glazenmaker)/, means: 'canting.the_glaziers_glass', ideas: [{ field: ['sable'], charges: [C('wine', 'argent')] }] },
  { re: /^(bergmann|bergman|miner|mijnwerker|gruvarbetare)/, means: 'canting.the_miners_hammer_and_mountain', ideas: [{ field: ['argent'], base: 'mount', charges: [C('hammer', 'sable')] }] },
  // Trades with a charge of their own: the tools, the goods and the work.
  { re: /^(schuster|schuhmacher|schumacher|schumaker|schoenmaker|schoenmacher|skoenmaker|skomaker|cobbler|shoemaker|sutor)/, means: 'canting.the_cobblers_boot', ideas: [
    { field: ['gules'], charges: [C('boot', 'argent')] }, { field: ['azure'], charges: [C('clogs', 'or')] }] },
  { re: /^(schlosser|schlossmacher|slotenmaker|locksmith)/, means: 'canting.the_locksmiths_padlock', ideas: [
    { field: ['azure'], charges: [C('padlock', 'or')] }, { field: ['gules'], charges: [C('key', 'argent', 2)] }] },
  { re: /^(steinmetz|maurer|mason|metselaar|murer|steenmetser)/, means: 'canting.the_masons_trowel', ideas: [
    { field: ['gules'], charges: [C('trowel', 'argent')] }, { field: ['argent'], charges: [C('stone', 'sable')] }] },
  { re: /^(barbier|barber|balbier|scherer|scheerder)/, means: 'canting.the_barbers_razor', ideas: [
    { field: ['azure'], charges: [C('razor', 'argent')] }] },
  { re: /^(seiler|reepslager|ropemaker|reepmaker|ropewalker)/, means: 'canting.the_ropemakers_rope', ideas: [
    { field: ['or'], charges: [C('rope', 'sable')] }] },
  { re: /^(kuefer|kuiper|cooper|boettcher|bottcher|boettger|bodeker)/, means: 'canting.the_coopers_barrel', ideas: [
    { field: ['argent'], charges: [C('barrel', 'gules')] }, { field: ['vert'], charges: [C('barrels', 'or')] }] },
  { re: /^(holzfaller|houthakker|woodcutter|hauer|hewer)/, means: 'canting.the_woodcutters_axe', ideas: [
    { field: ['vert'], charges: [C('wood-axe', 'argent')] }, { field: ['or'], charges: [C('hatchet', 'sable')] }] },
  // Patronymics: the sons of saints carry their saint's emblem.
  { re: /^(peter[sz]?(en|sen|son|s)?|pieters(en|e)?|petersen|pedersen|persson|peers)$/, means: 'canting.st_peters_keys_for_the_son_of_peter', ideas: [{ field: ['gules'], charges: [C('key', 'or', 2)] }, { field: ['azure'], charges: [C('keys', 'or')] }] },
  { re: /^(andersen|anderson|andersson|andreas|andres(en)?|andrews?)$/, means: 'canting.st_andrews_saltire_for_the_son_of_andrew', ideas: [{ field: ['azure'], ordinary: { kind: 'saltire', tincture: 'argent' } }, { field: ['or'], ordinary: { kind: 'saltire', tincture: 'gules', line: 'engrailed' } }] },
  { re: /^(jacob[s]?(en|sen|son)?|jakob(sen|sson)?|jacobs|james|jameson|jaakobs)$/, means: 'canting.st_jamess_scallop_for_the_son_of_jacob', ideas: [{ field: ['azure'], charges: [C('escallop', 'or', 3)] }, { field: ['gules'], charges: [C('escallop', 'argent')] }] },
  { re: /^(nil[s]+(en|on|son)?|nielsen|nicolai|nicola[s]?|nichols?(on)?|claes(en|sen)?|klaas(en)?)$/, means: 'canting.st_nicholass_three_gold_balls_for_the_son_of_nils', ideas: [{ field: ['azure'], charges: [C('roundel', 'or', 3)] }] },
  { re: /^(jens(en)?|jans(en|sen)?|johans?(s?on|sen)|johnson|hansen|hanssen|hans(on)?|janssen)$/, means: 'canting.st_johns_lamb_for_the_son_of_johannes', ideas: [{ field: ['azure'], charges: [C('sheep', 'argent')] }, { field: ['gules'], ordinary: { kind: 'cross', tincture: 'argent' } }] },
  { re: /^(joergensen|jorgensen|juergens|jurgens|georg[e]?s?|georgsson|george)$/, means: 'canting.st_georges_cross_for_the_son_of_georg', ideas: [{ field: ['argent'], ordinary: { kind: 'cross', tincture: 'gules' } }, { field: ['vert'], charges: [C('dragon', 'or')] }] },
  { re: /^(ol(e|a)?[fv]?s(en|on|son)|olsen|olsson|olafsson|olav(sen)?)$/, means: 'canting.st_olafs_axe_for_the_son_of_olaf', ideas: [{ field: ['gules'], charges: [C('axe', 'or')] }] },
  { re: /^(kristens?en|christens?en|christians(en|on)|kristiansen|karstens?)$/, means: 'canting.the_cross_of_christ_for_the_son_of_christian', ideas: [{ field: ['azure'], charges: [C('cross-crosslet', 'or', 3)] }, { field: ['gules'], ordinary: { kind: 'cross', tincture: 'argent' } }] },
  { re: /^(michael(sen|son|is)?|mikkelsen|michelsen|mikaelsson)$/, means: 'canting.st_michaels_sword_and_balance', ideas: [{ field: ['azure'], charges: [C('sword', 'argent'), C('scales', 'or', 1, 'chief')] }] },
  { re: /^(mathi(as|essen|sen)|matthews?|mathews|mattsson|matthiesen)$/, means: 'canting.st_matthiass_axe', ideas: [{ field: ['sable'], charges: [C('war-axe', 'argent')] }] },
  { re: /^(lars(en|son)?|laurs(en|on)?|lorenz(en)?|lawrence|lauritzen)$/, means: 'canting.the_laurel_of_laurentius', ideas: [{ field: ['or'], charges: [C('laurel', 'vert')] }] },
  { re: /^(martin[s]?|martens(en)?|mortensen|martinsson)$/, means: 'canting.st_martins_geese', ideas: [{ field: ['vert'], charges: [C('goose', 'argent', 3)] }] },
];

/** Name parts: prefixes and suffixes. `base` parts lie across the foot of the shield; others are charges. */
interface Part { re: RegExp; at: 'start' | 'end' | 'any'; means: Key; base?: CantingIdea['base']; ordinary?: CantingIdea['ordinary']; charge?: string; tincture?: TinctureV2; field?: TinctureV2; only?: string[] }
const PARTS: Part[] = [
  // Landscape.
  { re: /(holm|holmen|holme|hulme)/, at: 'any', means: 'canting.the_islet', base: 'water', charge: 'trimount' },
  { re: /(berg|berger|bergh|barg|bjerg|bjoerg|bjerk?e?|berge|borg?h?)$/, at: 'end', means: 'canting.the_mountain', base: 'mount' },
  { re: /^(berg|bjerg)/, at: 'start', means: 'canting.the_mountain', base: 'mount' },
  { re: /(feld|felder|veld|velde|field|faelt|felt|fjeld)$/, at: 'end', means: 'canting.the_field', base: 'field' },
  { re: /(stroem|strom|stroom|stream|strand)$/, at: 'end', means: 'canting.the_stream', base: 'water' },
  { re: /(bach|beck|bek|baek|brook|broek|brok|bruch)$/, at: 'end', means: 'canting.the_brook', ordinary: { kind: 'bend', tincture: 'azure', line: 'wavy' } },
  { re: /(see|sjoe|sjo|zee|meer|mere|lake)$/, at: 'end', means: 'canting.the_lake', base: 'water' },
  { re: /^(sjoe|sjo|see|zee)/, at: 'start', means: 'canting.the_lake', base: 'water' },
  { re: /(qvist|kvist|quist|zweig)$/, at: 'end', means: 'canting.the_twig', charge: 'branch' },
  { re: /(stein|steen|sten|stone|stijn)/, at: 'any', means: 'canting.the_stone', charge: 'rock' },
  { re: /(wald|walde|wood|woude|wold|skog|skov|holz|hout|hurst)$/, at: 'end', means: 'canting.the_wood', charge: 'pine' },
  { re: /(burg|borg|bourg|burgh|bury|slot|schloss)$/, at: 'end', means: 'canting.the_castle', charge: 'castle' },
  { re: /(hof|hoff|hove|gaard|gard|gaarden|hoeve|hoef)$/, at: 'end', means: 'canting.the_farmstead', charge: 'barn' },
  { re: /(court|cort|curt)$/, at: 'end', means: 'canting.the_courts_gate', charge: 'gatehouse' },
  { re: /^(val|vaux|vall)/, at: 'start', means: 'canting.the_valley', base: 'field' },
  { re: /(haus|hausen|huis|huys|hus|house|heim|hem|hjem|ham|um)$/, at: 'end', means: 'canting.the_homestead', charge: 'house' },
  { re: /(bruck|brueck|bruegge|bridge|bro|brug|brugge)$/, at: 'end', means: 'canting.the_bridge', charge: 'bridge' },
  { re: /(kirch|kirk|kerk|kyrk|kirke|church)/, at: 'any', means: 'canting.the_church', charge: 'church' },
  { re: /(muehl|muhl|mill|moel|molen|mol|kvarn|kvern)/, at: 'any', means: 'canting.the_mill', charge: 'mill-wheel' },
  { re: /(brunn|brunnen|born|well|bron|brunn)/, at: 'any', means: 'canting.the_well', charge: 'well' },
  { re: /(thal|tal|dal|dale|dahl|daal)$/, at: 'end', means: 'canting.the_valley', base: 'field' },
  // Trees and plants.
  { re: /^(lind|linde|linden|lin|lint|lyn)/, at: 'start', means: 'canting.the_linden_tree', charge: 'linden' },
  { re: /(eich|eick|eik|ek|oak|eke|eiken)/, at: 'any', means: 'canting.the_oak', charge: 'oak' },
  { re: /(birk|bjoerk|bjork|berk|birch|bjerk)/, at: 'any', means: 'canting.the_birch', charge: 'birch' },
  { re: /(tann|tanne|gran|fichte|pine|fur|furu)/, at: 'any', means: 'canting.the_fir', charge: 'pine' },
  { re: /(asp|espe|ash|esch|ask)/, at: 'start', means: 'canting.the_ash_tree', charge: 'oak' },
  { re: /(ros|rose|roos|rosen|rozen)/, at: 'start', means: 'canting.the_rose', charge: 'rose' },
  { re: /(lilj|lilie|lily|lelie|lilien)/, at: 'any', means: 'canting.the_lily', charge: 'fleur' },
  { re: /(apfel|appel|apple|aeble)/, at: 'any', means: 'canting.the_apple', charge: 'apple' },
  { re: /(blum|blom|bloem|bloom|flower)/, at: 'any', means: 'canting.the_flower', charge: 'cinquefoil' },
  { re: /(korn|corn|koren)/, at: 'any', means: 'canting.the_corn', charge: 'garb' },
  // Beasts and birds.
  { re: /(wol[f]+|wulf|ulf|ulv|wolff|vulf)/, at: 'any', means: 'canting.the_wolf', charge: 'wolf' },
  { re: /(baer|bear|bjoern|bjorn|bjarne|beer|bern|bernd|behr)/, at: 'any', means: 'canting.the_bear', charge: 'bear-passant' },
  { re: /(adler|aar|arend|arnd|oern|orn|eagle|arn)/, at: 'start', means: 'canting.the_eagle', charge: 'eagle' },
  { re: /(fuchs|fox|vos|raev|rev)/, at: 'any', means: 'canting.the_fox', charge: 'fox' },
  { re: /(hirsch|hjort|hart|hert|hirz)/, at: 'any', means: 'canting.the_stag', charge: 'deer' },
  { re: /(loew|lowe|leeuw|lejon|loeve|lion|leo|leu)/, at: 'start', means: 'canting.the_lion', charge: 'lion' },
  { re: /(hahn|haan|hane|cock|hahne)/, at: 'any', means: 'canting.the_cock', charge: 'cock' },
  { re: /(schwan|swan|zwaan|svan|schwann)/, at: 'any', means: 'canting.the_swan', charge: 'swan' },
  { re: /(fisch|fish|vis|fisk)/, at: 'any', means: 'canting.the_fish', charge: 'fish' },
  { re: /(vogel|fogel|fugl|fagel|bird|vogl)/, at: 'any', means: 'canting.the_bird', charge: 'sparrow' },
  { re: /(falk|falck|valk|falcon)/, at: 'any', means: 'canting.the_falcon', charge: 'hawk' },
  { re: /(rabe|raben|raven|ravn|rave|rafn)/, at: 'any', means: 'canting.the_raven', charge: 'raven' },
  { re: /(hase|haas|hare|hasen)/, at: 'start', means: 'canting.the_hare', charge: 'hare' },
  { re: /(ochs|ox|okse|oxen)/, at: 'start', means: 'canting.the_ox', charge: 'bull' },
  { re: /(biene|bee|bij|bi)$/, at: 'end', means: 'canting.the_bee', charge: 'bee' },
  { re: /(storch|stork|ooievaar)/, at: 'any', means: 'canting.the_stork', charge: 'heron' },
  // Sky.
  { re: /(stern|star|ster|stjern|stjaern|stjarn)/, at: 'any', means: 'canting.the_star', charge: 'mullet' },
  { re: /(sonne|sonnen|sun|sol|zon)/, at: 'start', means: 'canting.the_sun', charge: 'sun' },
  { re: /(mond|moon|maan|maane|mane)/, at: 'start', means: 'canting.the_moon', charge: 'crescent' },
  // Things.
  { re: /(kron|krone|crown|kroon|kruna)/, at: 'any', means: 'canting.the_crown', charge: 'crown' },
  { re: /(schwert|sword|zwaard|svaerd|sverd)/, at: 'any', means: 'canting.the_sword', charge: 'sword' },
  { re: /(eisen|iron|jern|jaern|ijzer)/, at: 'any', means: 'canting.the_iron', charge: 'horseshoe' },
  { re: /(herz|hart|heart|hjert|hjaert)/, at: 'start', means: 'canting.the_heart', charge: 'heart' },
  { re: /(horn|hoorn)/, at: 'any', means: 'canting.the_horn', charge: 'hunting-horn' },
  { re: /(kreuz|kruis|kors|cross)/, at: 'any', means: 'canting.the_cross', ordinary: { kind: 'cross' } },
  // Colours: they set the field.
  { re: /^(gold|gull|guld|goud|golden)/, at: 'start', means: 'canting.gold', field: 'or' },
  { re: /^(silber|silver|zilver|silfver|soelv)/, at: 'start', means: 'canting.silver', field: 'argent' },
  { re: /^(roth|rot|red|rood|roed|rode|rodt)/, at: 'start', means: 'canting.red', field: 'gules' },
  { re: /^(blau|blue|blaa|blauw|bla)/, at: 'start', means: 'canting.blue', field: 'azure' },
  { re: /^(gruen|grun|green|groen|groen|groen|groen)/, at: 'start', means: 'canting.green', field: 'vert' },
  { re: /^(schwar[tz]+|black|zwart|svart|sort|swart)/, at: 'start', means: 'canting.black', field: 'sable' },
  { re: /^(weiss|weis|white|wit|hvid|vit|witt)/, at: 'start', means: 'canting.white', field: 'argent' },
];

/** Alliteration, when the table knows nothing: a charge whose name starts with the same sound. */
const INITIAL: Record<string, [string, string][]> = {
  a: [['anchor', 'an anchor'], ['eagle', 'an Adler (eagle)']], b: [['bear-passant', 'a bear'], ['bell', 'a bell']],
  c: [['castle', 'a castle'], ['crown', 'a crown']], d: [['dolphin', 'a dolphin'], ['dove', 'a dove']],
  e: [['eagle', 'an eagle'], ['escallop', 'an escallop']], f: [['fleur', 'a fleur-de-lis'], ['fox', 'a fox']],
  g: [['griffin', 'a griffin'], ['garb', 'a garb']], h: [['hound', 'a hound'], ['heart', 'a heart']],
  i: [['imperial-crown', 'an imperial crown'], ['ship', 'an Insel-ship']], j: [['jug', 'a jug'], ['sparrow', 'a jay']],
  k: [['key', 'a key'], ['crown', 'a Krone']], l: [['lily', 'a lily'], ['lion', 'a lion']],
  m: [['mullet', 'a mullet'], ['crescent', 'a moon']], n: [['sparrow', 'a nightingale'], ['oak', 'a nut tree']],
  o: [['oak', 'an oak'], ['owl', 'an owl']], p: [['pelican', 'a pelican'], ['pheon', 'a pheon']],
  q: [['quatrefoil', 'a quatrefoil'], ['crown', 'a queen’s crown']], r: [['rose', 'a rose'], ['raven', 'a raven']],
  s: [['swan', 'a swan'], ['sun', 'a sun']], t: [['tower', 'a tower'], ['trefoil', 'a trefoil']],
  u: [['unicorn', 'a unicorn'], ['oak', 'an Ulme (elm)']], v: [['vine-leaf', 'a vine leaf'], ['sparrow', 'a Vogel (a bird)']],
  w: [['wolf', 'a wolf'], ['wheel', 'a wheel']], x: [['swords-crossed', 'crossed swords']], y: [['pine', 'a yew']],
  z: [['tower', 'a Zinne (battlement)'], ['crown', 'a crown']],
};

// ---------- building arms ----------

const PREFIXES = /^(von der|von dem|von|van der|van den|van de|van|de la|de|der|den|zu|zur|af|av|ter|ten|op de|mac|mc|o')\s+/i;

/** Lower case, accents folded the German way (ü → ue), particles ("von", "van der") removed. */
/** The normalised name plus, for each of its letters, where it came from in the original. */
function normaliseWithMap(s: string): { norm: string; from: number[] } {
  let norm = '';
  const from: number[] = [];
  [...s].forEach((ch, i) => {
    const n = normaliseSurname(ch);
    for (const c of n) { norm += c; from.push(i); }
  });
  return { norm, from };
}

export function normaliseSurname(s: string): string {
  return s.toLowerCase().trim()
    .replace(PREFIXES, '')
    .replace(/ä|æ/g, 'ae').replace(/ö|ø/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

const SHIELD_BY_COUNTRY: Record<string, ShieldShape> = { ch: 'swiss', es: 'iberian', pt: 'iberian', fr: 'french', be: 'french', lu: 'french' };

/** A tiny deterministic hash, so the same name always gets the same suggestions. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const FIELD_ROTATION: TinctureV2[] = ['azure', 'gules', 'vert', 'or', 'argent', 'sable', 'purpure'];

/** Turns an idea into arms that keep the rule of tincture. Unknown charges are dropped. */
export function ideaToArms(idea: CantingIdea, opts: { country?: string; seed?: number } = {}): ArmsV2 {
  const shield = SHIELD_BY_COUNTRY[opts.country ?? ''] ?? 'heater';
  const seed = opts.seed ?? 0;
  const division = idea.division ?? 'plain';
  let tinctures = (idea.field?.length ? idea.field : [FIELD_ROTATION[seed % FIELD_ROTATION.length]]).slice(0, division === 'plain' ? 1 : 3);
  if (division !== 'plain' && tinctures.length < 2) tinctures = [tinctures[0], contrastFor([tinctures[0]])];
  const layers: ArmsLayer[] = [];
  const field = tinctures;
  // The landscape at the foot of the shield.
  let baseT: TinctureV2 | undefined;
  if (idea.base === 'water') {
    baseT = kindOf(field[0]) === 'metal' ? 'azure' : 'argent';
    layers.push({ type: 'ordinary', kind: 'base', tincture: baseT, line: 'wavy' });
  } else if (idea.base === 'field') {
    baseT = kindOf(field[0]) === 'colour' ? 'or' : 'vert';
    layers.push({ type: 'ordinary', kind: 'base', tincture: baseT, line: 'straight' });
  }
  const mixedField = new Set(field.map(kindOf).filter((k) => k === 'metal' || k === 'colour')).size > 1;
  let ord: { kind: OrdinaryKind; tincture: TinctureV2 } | undefined;
  if (idea.ordinary && (CHARGEABLE_KINDS as readonly string[]).includes(idea.ordinary.kind)) {
    const tincture = idea.ordinary.tincture && !clash(idea.ordinary.tincture, field) ? idea.ordinary.tincture : contrastFor(field, idea.ordinary.tincture);
    ord = { kind: idea.ordinary.kind, tincture };
    layers.push({ type: 'ordinary', kind: idea.ordinary.kind, tincture, line: idea.ordinary.line ?? 'straight' });
  }
  const charges = (idea.charges ?? []).filter((c) => chargeDef(c.charge)).slice(0, 3);
  if (idea.base === 'mount' && !charges.some((c) => c.charge === 'trimount')) {
    const mount: TinctureV2 = field[0] === 'vert' ? 'or' : kindOf(field[0]) === 'metal' ? 'vert' : 'argent';
    layers.push({ type: 'charge', charge: 'trimount', tincture: mount, count: 1, arrangement: 'auto', on: 'base' });
  }
  const hasMain = charges.some((c) => (c.on ?? 'field') === 'field' && c.charge !== 'trimount');
  charges.forEach((c, i) => {
    // A mount stands in base: an islet in water, a hill under the field.
    const on = c.on === 'ordinary' && ord ? 'ordinary' : c.on === 'chief' ? 'chief' : c.charge === 'trimount' ? 'base' : 'field';
    let under: TinctureV2[] = on === 'ordinary' && ord ? [ord.tincture] : on === 'base' && baseT ? [baseT] : field;
    if (on === 'chief') {
      // Charges in chief stand on a chief of their own, so they never crowd the main charge. Over a field of
      // metal and colour together only a fur contrasts with both.
      const chiefT = mixedField ? 'ermine' : contrastFor(field, kindOf(field[0]) === 'metal' ? 'azure' : 'or');
      layers.splice(ord ? 1 : 0, 0, { type: 'ordinary', kind: 'chief', tincture: chiefT, line: 'straight' });
      under = [chiefT];
    }
    const tincture = c.tincture === 'proper' || (c.tincture && !clash(c.tincture, under)) ? c.tincture! : contrastFor(under, c.charge === 'trimount' ? 'vert' : c.tincture);
    const count = c.count ?? 1;
    const layer: ChargeLayer = { type: 'charge', charge: c.charge, tincture, count, arrangement: 'auto', on };
    // A charge standing on a mount or on water sits a little higher and smaller.
    if (idea.base && on === 'field' && count === 1) layer.scale = 0.78;
    if (on === 'base' && idea.base === 'water') layer.scale = 0.8;
    if (on === 'chief') layer.count = Math.min(count, 3);
    // A second field charge would overlap the first: put it in chief instead.
    if (on === 'field' && hasMain && i > 0 && charges.slice(0, i).some((x) => (x.on ?? 'field') === 'field')) layer.on = 'chief';
    layers.push(layer);
  });
  // The landscape first, then the ordinaries, then the charges.
  layers.sort((a, b) => order(a) - order(b));
  const arms: ArmsV2 = { shield, field: { division, tinctures, line: 'straight' }, layers };
  // Last, whatever the idea asked for: bottom layer first, because repairing a layer changes what lies under the next.
  // On a divided field one part may be metal and the other colour, so a layer has to contrast with every part it covers.
  layers.forEach((l, i) => {
    if (l.tincture === 'proper') return;
    const under = underOf(arms, i);
    if (!clash(l.tincture, under)) return;
    if (new Set(under.map(kindOf).filter((k) => k === 'metal' || k === 'colour')).size < 2) {
      l.tincture = contrastFor(under, l.tincture);
    } else if (under.length === field.length && under.every((u, k) => u === field[k])) {
      // Across metal and colour no single tincture contrasts: the classic answer is to counterchange it.
      l.counterchanged = true;
    } else {
      l.tincture = 'ermine'; // over the field and an ordinary at once: furs are free of the rule
    }
  });
  return arms;
}
const CHARGEABLE_KINDS = ['chief', 'base', 'fess', 'pale', 'bend', 'bend-sinister', 'chevron', 'cross', 'saltire', 'pall', 'bordure', 'orle', 'canton', 'pile', 'quarter'] as const;
const clash = (t: TinctureV2, under: TinctureV2[]) => under.some((u) => kindOf(u) === kindOf(t) && (kindOf(t) === 'metal' || kindOf(t) === 'colour'));
const order = (l: ArmsLayer) => (l.type === 'ordinary' ? (l.kind === 'base' ? 0 : 1) : l.on === 'base' ? 0.5 : 2);

/** Turns ideas (from the table or an AI provider) into suggestions. Invalid AI output yields an empty list. */
export function cantingFromIdeas(input: CantingResponse | unknown, req: CantingRequest): CantingSuggestion[] {
  const parsed = cantingResponseSchema.safeParse(input);
  if (!parsed.success) return [];
  return parsed.data.suggestions.map((idea, i) => ({
    arms: ideaToArms(idea as CantingIdea, { country: req.country, seed: hash(req.surname) + i }),
    explanation: idea.explanation,
    element: idea.element,
    meaningId: idea.meaningId,
    symbolism: idea.symbolism,
  }));
}

/** The ideas the offline table has for a surname, best first. */
export function cantingIdeas(surname: string, country?: string, tr: Tr = english): CantingIdea[] {
  const display = surname.trim().replace(PREFIXES, '');
  const name = normaliseSurname(surname);
  if (!name) return [];
  const label = display.charAt(0).toUpperCase() + display.slice(1);
  const ideas: CantingIdea[] = [];
  const seed = hash(name);

  let occupation = false;
  for (const occ of OCCUPATIONS) {
    if (occ.only && country && !occ.only.includes(country)) continue;
    if (!occ.re.test(name)) continue;
    for (const idea of occ.ideas) {
      if (!idea.charges?.length && !idea.ordinary && !idea.base) continue;
      ideas.push({ ...idea, explanation: `${label}: ${tr(occ.means)}`, element: label });
    }
    occupation = true;
    break;
  }

  // Parts: a prefix and a suffix can combine ("Lindberg": a linden on a mountain).
  // A known occupation already says what the name means; its parts would only repeat it.
  const hits = occupation ? [] : PARTS.filter((p) => (!p.only || !country || p.only.includes(country)) && p.re.test(name));
  const charged = hits.filter((p) => p.charge);
  // Water and a mountain together make an island: a mount standing in the waves.
  const water = hits.find((p) => p.base === 'water');
  const mountain = hits.find((p) => p.base === 'mount');
  const based = water ?? hits.find((p) => p.base);
  if (water && mountain && !charged.includes(mountain)) charged.push({ ...mountain, charge: 'trimount' });
  const coloured = hits.find((p) => p.field);
  const ordinary = hits.find((p) => p.ordinary);
  // Quote the name as written: "sjö", not "sjoe".
  const mapped = normaliseWithMap(display);
  const matchOf = (p: Part) => {
    const m = mapped.norm.match(p.re);
    if (!m || m.index === undefined) return '';
    const chars = [...display];
    return chars.slice(mapped.from[m.index], mapped.from[m.index + m[0].length - 1] + 1).join('').toLowerCase();
  };
  /** "the linden tree (lind)", or just "the wolf" when the part is the whole name. */
  const say = (p: Part) => (matchOf(p) === display.toLowerCase() ? tr(p.means) : `${tr(p.means)} (${matchOf(p)})`);
  const fieldFor = (t?: TinctureV2): TinctureV2[] | undefined => (t ? [t] : coloured?.field ? [coloured.field] : undefined);

  if (charged.length || based || ordinary) {
    const main = charged.find((p) => p.charge !== 'trimount');
    const parts = [main, based && based !== main ? based : undefined, water && mountain ? mountain : undefined, ordinary, coloured].filter(Boolean) as Part[];
    const words = parts.map(say).join(` ${tr('canting.and')} `);
    ideas.push({
      explanation: `${label}: ${words}`,
      element: parts.map(matchOf).join(' + '),
      field: fieldFor(),
      base: based?.base,
      ordinary: ordinary?.ordinary,
      charges: [
        ...(main ? [{ charge: main.charge!, count: 1 }] : based?.charge ? [{ charge: based.charge, count: 1 }] : []),
        ...(water && mountain ? [{ charge: 'trimount', count: 1 }] : []),
      ],
    });
    // Variants: three of the main charge, and the charge on a chief over the landscape.
    if (main) {
      ideas.push({ explanation: `${label}: ${say(main)}, ${tr('canting.three_times')}`, element: matchOf(main), field: fieldFor(FIELD_ROTATION[(seed + 1) % FIELD_ROTATION.length]), charges: [{ charge: main.charge!, count: 3 }] });
      if (based || charged[1]) {
        const second = charged.find((p) => p !== main && p.charge !== 'trimount');
        ideas.push({
          explanation: `${label}: ${say(main)}${second ? ` ${tr('canting.and')} ${say(second)}` : `, ${tr('canting.above', { what: say(based!) })}`}`,
          element: [main, second ?? based].map((p) => matchOf(p!)).join(' + '),
          field: fieldFor(FIELD_ROTATION[(seed + 2) % FIELD_ROTATION.length]),
          base: second ? undefined : based?.base,
          charges: second ? [{ charge: second.charge!, count: 1 }, { charge: main.charge!, count: 2, on: 'chief' }] : [{ charge: main.charge!, count: 1 }],
          ...(second ? {} : { ordinary: { kind: 'bordure' as const, line: 'engrailed' as const } }),
        });
      }
    } else if (based) {
      ideas.push({ explanation: `${label}: ${say(based)}, ${tr('canting.under_star')}`, element: matchOf(based), field: ['azure'], base: based.base, charges: [...(based.charge ? [{ charge: based.charge, count: 1 }] : []), { charge: 'mullet', tincture: 'or', count: 1, on: 'chief' as const }] });
    }
  }

  // The sound of the initial, always offered last, so there is something even for an unknown name.
  const initial = INITIAL[name[0]] ?? INITIAL.s;
  const [charge, words] = initial[seed % initial.length];
  ideas.push({ explanation: `${label}: ${words}, ${tr('canting.sound_of', { letter: label.charAt(0) })}`, element: label.charAt(0), field: [FIELD_ROTATION[(seed + 3) % FIELD_ROTATION.length]], charges: [{ charge, count: 1 }] });
  if (ideas.length < 3) {
    const [c2, w2] = initial[(seed + 1) % initial.length];
    ideas.push({ explanation: `${label}: ${w2}, ${tr('canting.sound_of', { letter: label.charAt(0) })}`, element: label.charAt(0), field: [FIELD_ROTATION[(seed + 4) % FIELD_ROTATION.length]], ordinary: { kind: 'chevron' }, charges: [{ charge: c2, count: 3 }] });
  }
  if (ideas.length < 3) ideas.push({ explanation: `${label}: ${words}, ${tr('canting.three_times')}, ${tr('canting.under_chief_stars')}`, element: label.charAt(0), field: [FIELD_ROTATION[(seed + 5) % FIELD_ROTATION.length]], charges: [{ charge, count: 3 }, { charge: 'mullet', count: 3, on: 'chief' }] });
  return ideas.slice(0, 6);
}

/**
 * Canting arms for a surname: 3–6 designs, each with a one-line explanation. Offline and deterministic.
 * `country` (ISO 3166, lower case) picks the shield shape and filters language-specific elements.
 */
export function cantingArms(surname: string, country?: string, tr: Tr = english): CantingSuggestion[] {
  const seed = hash(normaliseSurname(surname));
  const out = cantingIdeas(surname, country, tr).map((idea, i) => ({ arms: ideaToArms(idea, { country, seed: seed + i }), explanation: idea.explanation, element: idea.element }));
  // Drop designs that came out the same.
  const seen = new Set<string>();
  return out.filter((s) => { const k = JSON.stringify(s.arms); if (seen.has(k)) return false; seen.add(k); return true; });
}
