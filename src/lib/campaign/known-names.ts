// Names the campaign's generator must stay clear of: well-known invented worlds, common given names, and the countries
// and regions of Europe. Only the tests read this file (./names.test.ts): they compare everything ./names.ts can make
// with it, so the list costs the browser nothing. It is hand-made and will never be complete: add to it freely, and run
// the names test after changing a syllable in names.ts.
//
// One word each, lower case, no accents (the test folds a name the same way). A name of two words is listed by the word
// that would be recognised.

/** Middle-earth. */
const TOLKIEN = `
arda aman valinor valar valmar vala maiar maia eldar eldamar tirion numenor numenore andor elenna armenelos beleriand
doriath gondolin nargothrond hithlum dorthonion ossiriand thangorodrim angband utumno menegroth nevrast falas brithombar
eglarest sirion narog gelion estolad thargelion himlad himring arvernien balar brethil nan elmoth dimbar eriador arnor
gondor rohan mordor rhun harad khand umbar rhovanion lindon forlindon harlindon mithlond eregion hollin dunland enedwaith
minhiriath cardolan rhudaur arthedain angmar carn dum fornost annuminas bree shire hobbiton bywater buckland rivendell
imladris moria khazad lorien lothlorien caras galadhon fangorn isengard orthanc edoras helm meduseld dunharrow aldburg
minas tirith ithil morgul anor osgiliath ithilien anorien lebennin lossarnach lamedon belfalas dol amroth pelargir
linhir erech pinnath gelin anfalas andrast druadan cair andros emyn muil nindalf dagorlad udun gorgoroth nurn barad
cirith ungol erebor esgaroth dale mirkwood dorwinion anduin celduin carnen bruinen mitheithel gwathlo isen entwash
limlight celebrant nimrodel baranduin lhun forochel eryn lasgalen gundabad methedras caradhras celebdil fanuidhol
zirakzigil amon hen lhaw sul weathertop erui gilrain ringlo morthond lefnui poros harnen tolfalas tol eressea avallone
alqualonde formenos ezellohar taniquetil oiolosse calacirya araman helcaraxe losgar mithrim nevrast vinyamar tumladen
aragorn arathorn arador argonui arahad arassuil arathorn elessar telcontar isildur anarion elendil elendur elros elrond
elladan elrohir arwen undomiel celebrian celeborn galadriel finarfin fingolfin feanor finwe fingon turgon aredhel idril
earendil elwing dior luthien tinuviel beren thingol melian turin tuor hurin huor morwen nienor rian haleth hador haldir
halbarad halmir handir barahir beleg mablung daeron maedhros maglor celegorm caranthir curufin amrod amras celebrimbor
gil galad cirdan glorfindel ecthelion erestor lindir legolas thranduil oropher amroth nimrodel gimli gloin oin balin
dwalin fili kili bifur bofur bombur dori nori ori thorin thrain thror dain durin nain fundin frerin gandalf mithrandir
olorin saruman curunir radagast alatar pallando sauron annatar gorthaur morgoth melkor bauglir gothmog ancalagon
glaurung smaug scatha carcharoth draugluin ungoliant shelob thuringwethil manwe varda elbereth ulmo aule yavanna namo
mandos irmo lorien nienna orome vana tulkas nessa este vaire ilmare eonwe osse uinen arien tilion salmar
frodo bilbo samwise meriadoc peregrin pippin gamgee baggins took brandybuck rosie elanor goldilocks faramir boromir
denethor ecthelion imrahil finduilas eowyn eomer eomund theoden theodred theodwyn hama grima erkenbrand elfhelm
gamling ceorl eorl helm frealaf brego aldor folcwine thengel beregond bergil hirgon forlong ingold damrod mablung
anborn ioreth barliman butterbur bombadil goldberry gollum smeagol deagol grishnakh ugluk shagrat gorbag azog bolg
beorn bard girion brand elendur valandil earnur earnil ondoher castamir eldacar romendacil hyarmendacil tarannon
telemnar minardil atanatar ciryandil meneldil cemendur anardil ostoher turambar mormegil niniel glaurung nellas
tarnost belegost quenya quendi sindar sindarin dunedain dunadan brandir gorlim haldad haldan haldar thalath dirnen
thalion argonath
`;

/** Other well-known invented worlds: Narnia, Westeros, Hyrule, the Witcher, Tamriel, Final Fantasy, and more. */
const FICTION = `
narnia archenland calormen telmar tashbaan ettinsmoor cair paravel aslan caspian miraz rilian tirian shasta corin cor
aravis bree hwin lasaraleen rabadash tumnus reepicheep trumpkin puddleglum jadis digory polly eustace edmund lucy susan
peter pevensie charn bism
westeros essos sothoryos ulthos valyria valyrian braavos pentos volantis lys myr tyrosh lorath norvos qohor meereen
yunkai astapor qarth asshai dorne winterfell dreadfort harrenhal riverrun eyrie casterly lannisport highgarden oldtown
sunspear storm dragonstone pyke harlaw karhold barrowton moat cailin torrhen stark lannister targaryen baratheon tyrell
martell greyjoy arryn tully bolton frey mormont tarly tarth daenerys viserys rhaegar rhaenyra rhaena rhaenys aegon aemon
aerys visenya daemon maegor jaehaerys alysanne baelor daeron aemond helaena alicent corlys laenor laena valaena eddard
catelyn robb sansa arya bran brandon rickon benjen lyanna jon tyrion cersei jaime tywin joffrey myrcella tommen renly
stannis robert selyse shireen melisandre davos varys petyr baelish sandor gregor clegane brienne podrick samwell gilly
ygritte tormund mance rayder theon asha yara euron balon victarion oberyn doran arianne trystane ellaria margaery
loras mace olenna walder roose ramsay jorah barristan drogo viserion rhaegal drogon balerion vhagar meraxes caraxes
syrax vermithor hodor osha bronn lancel kevan qyburn pycelle
hyrule lorule termina holodrum labrynna koholint hytopia zelda ganon ganondorf impa darunia ruto saria nabooru rauru
navi tingle midna zant ghirahim demise vaati agahnim onox veran majora malon talon epona kafei anju tatl tael mipha
daruk revali urbosa sidon riju teba yunobo tulin purah robin prunia sheik linkle kakariko gerudo zora goron rito kokiri
korok sheikah deku hylia farore nayru din lanayru eldin faron akkala necluda hebra tabantha
temeria redania kaedwen aedirn lyria rivia cintra nilfgaard skellige novigrad oxenfurt vizima toussaint zerrikania
kovir poviss brokilon mahakam velen sodden brugge verden cidaris nazair ebbing metinna maecht geralt yennefer triss
ciri cirilla jaskier dandelion vesemir eskel lambert zoltan regis emhyr foltest radovid calanthe pavetta duny eist
crach mousesack ermion vilgefortz cahir fringilla tissaia philippa keira margarita sabrina francesca filavandrel
eredin avallach iorveth vernon roche saskia letho dijkstra
tamriel nirn skyrim cyrodiil morrowind vvardenfell hammerfell valenwood elsweyr summerset alinor black marsh argonia
solstheim akavir atmora yokuda aldmeris oblivion aetherius sovngarde whiterun riften windhelm solitude markarth
falkreath morthal dawnstar winterhold riverwood ivarstead helgen rorikstead balmora vivec ald ruhn sadrith mora
seyda neen caldera pelagiad suran gnisis khuul dagon fel tel anvil bravil bruma cheydinhal chorrol kvatch leyawiin
skingrad daggerfall wayrest sentinel orsinium alik stros evermore camlorn shornhelm rihad taneth elinhir alduin
paarthurnax ulfric tullius balgruuf lydia serana harkon miraak vivec almalexia sotha sil nerevar dagoth azura
mephala boethiah molag bal sheogorath hircine malacath meridia nocturnal namira peryite sanguine vaermina hermaeus
mehrunes clavicus jyggalag akatosh arkay dibella julianos kynareth mara stendarr talos zenithar auriel tiber septim
uriel martin jauffre
ivalice spira gaia eorzea vanadiel midgar nibelheim junon kalm wutai gongaga corel mideel balamb galbadia esthar
trabia dollet timber deling winhill alexandria lindblum burmecia cleyra treno dali oeilvert esto terra zanarkand
besaid kilika luca bevelle macalania guadosalam djose dalmasca archadia rozarria rabanastre nabradia nalbina bhujerba
bancour lucis insomnia niflheim tenebrae altissia accordo lestallum valisthea rosaria sanbreque waloed dhalmekia
kanver ishgard limsa lominsa gridania uldah ala mhigo doma garlemald sharlayan thavnair radz mor dhona coerthas
la noscea thanalan norvrandt lakeland amh araeng kholusia rak tika il mheg cloud tifa aerith aeris sephiroth barret
yuffie vincent cid cait sith zack rufus tseng reno rude squall rinoa selphie quistis zell irvine seifer edea ultimecia
laguna kiros zidane garnet vivi steiner freya eiko quina amarant kuja beatrix tidus yuna auron lulu wakka rikku kimahri
seymour jecht braska paine vaan balthier fran basch ashe penelo vayne larsa gabranth lightning serah vanille sazh
noctis prompto gladiolus ignis lunafreya ardyn clive jill torgal cecil kain rydia rosa edge golbez bartz lenna faris
galuf krile exdeath terra locke celes edgar sabin cyan shadow setzer strago relm mog umaro gogo kefka ramza delita
agrias ovelia ramuh ifrit shiva bahamut odin leviathan titan garuda phoenix carbuncle alexander diabolos fenrir
ragnarok excalibur masamune chocobo moogle tonberry cactuar malboro
azeroth kalimdor lordaeron northrend pandaria draenor outland argus stormwind ironforge darnassus orgrimmar
undercity thunder silvermoon dalaran gilneas kul tiras zandalar quelthalas stratholme andorhal tirisfal arathi alterac
hillsbrad elwynn westfall redridge duskwood stranglethorn durotar mulgore barrens ashenvale teldrassil feralas tanaris
ungoro silithus winterspring azshara felwood desolace darkshore nagrand zangarmarsh terokkar netherstorm shadowmoon
icecrown sholazar dragonblight thrall jaina sylvanas arthas uther illidan malfurion tyrande varian anduin llane
medivh khadgar guldan nerzhul kiljaeden archimonde sargeras kelthuzad anubarak garrosh grommash durotan orgrim voljin
cairne baine velen malygos alexstrasza ysera nozdormu neltharion deathwing onyxia nefarian ragnaros alakir therazane
neptulon cthun yoggsaron nzoth yshaarj azshara kaelthas lorthemar rommath liadrin magni muradin brann falstad gelbin
tatooine alderaan coruscant naboo hoth endor dagobah bespin kashyyyk mustafar kamino geonosis utapau mandalore jakku
corellia yavin dantooine ryloth kessel anakin luke leia padme obiwan kenobi yoda vader palpatine sidious maul dooku
windu ahsoka rey kylo finn poe lando chewbacca boba jango din grogu thrawn revan malak bastila
hogwarts hogsmeade azkaban gringotts durmstrang beauxbatons ilvermorny gryffindor slytherin ravenclaw hufflepuff
hermione dumbledore voldemort snape hagrid sirius remus draco lucius narcissa bellatrix minerva severus albus rubeus
arrakis caladan giedi kaitain salusa ix tleilax atreides harkonnen corrino leto paul jessica alia chani stilgar duncan
gurney thufir feyd rabban irulan shaddam ghanima
andor cairhien illian tear altara amadicia arad doman arafel ghealdan kandor malkier murandy saldaea shienar tarabon
tar valon caemlyn tanchico ebou dar falme shayol ghul rand perrin mat egwene nynaeve elayne aviendha min moiraine lan
siuan thom loial faile padan fain ishamael lanfear moridin rahvin sammael asmodean demandred graendal semirhage
moghedien mesaana aginor balthamel belal
earthsea gont roke havnor atuan ged ogion tenar arren lebannen kalessin
aloria algaria arendia asturia cherek drasnia mallorea maragor mimbre nyissa riva sendaria tolnedra ulgoland garion
belgarion belgarath polgara belgariad silk barak durnik cenedra mandorallen hettar relg torak zedar ctuchik
belar aldur issa nedra chaldan mara
prydain taran eilonwy gurgi fflewddur dallben gwydion arawn annuvin achren
faerun toril waterdeep neverwinter baldur calimshan amn tethyr cormyr sembia thay rashemen icewind luskan silverymoon
menzoberranzan underdark evermeet halruaa mulhorand chult drizzt elminster bruenor wulfgar cattibrie regis artemis
entreri jarlaxle zaknafein krynn ansalon solamnia qualinesti silvanesti raistlin caramon tanis sturm tasslehoff
goldmoon riverwind laurana kitiara takhisis paladine ravenloft barovia strahd greyhawk oerth eberron khorvaire
athas golarion varisia cheliax andoran absalom
lordran drangleic lothric anor londo izalith oolacile boletaria yharnam limgrave caelid liurnia leyndell altus
farum azula marika radagon godrick rennala radahn malenia miquella mohg morgott godfrey ranni melina gwyn gwyndolin
artorias ornstein smough solaire siegmeyer
ankh morpork lancre klatch uberwald quirm sto lat rincewind vimes vetinari weatherwax nanny ogg tiffany
alagaesia eragon saphira arya murtagh galbatorix brom roran nasuada oromis glaedr ellesmera carvahall urubaen
thedas ferelden orlais tevinter antiva rivain nevarra anderfels kirkwall denerim orzammar redcliffe lothering
alistair morrigan leliana zevran oghren wynne sten loghain anora cailan duncan flemeth varric cassandra solas
cullen josephine dorian sera vivienne corypheus
kanto johto hoenn sinnoh unova kalos alola galar paldea hisui pikachu
avalon camelot lyonesse albion logres tintagel caerleon astolat corbenic broceliande arthur merlin guinevere
lancelot gawain galahad percival tristan isolde morgana mordred uther igraine kay bedivere gareth gaheris agravain
lamorak bors ector pellinor pelleas elaine nimue vivien
asgard midgard jotunheim vanaheim alfheim niflheim muspelheim svartalfheim helheim valhalla yggdrasil bifrost odin
thor loki freya freyr frigg baldur tyr heimdall njord skadi idunn bragi sif hel fenrir jormungandr sleipnir
olympus elysium arcadia atlantis lemuria hyperborea thule ultima shangri utopia eldorado xanadu oz narnia neverland
wonderland lilliput brobdingnag laputa ruritania zenda genovia latveria wakanda krypton gotham metropolis
zeus hera athena apollo artemis ares hermes hades poseidon demeter hestia aphrodite dionysus persephone hephaestus
achilles hector paris helen priam odysseus ulysses penelope telemachus circe calypso aeneas dido remus romulus
elantris sel roshar alethkar jah keved kharbranth azir shinovar scadrial luthadel elendel nalthis kaladin dalinar
shallan adolin renarin navani jasnah szeth vin kelsier elend sazed marsh spook vasher vivenna siri
gorlois thalmor selkath manaan nymeria nymeros jorvik skaro beskar bolvar
`;

/** Given names heard in English, German, Dutch and Afrikaans, and the more widely known ones from elsewhere. */
const GIVEN = `
aaron abel abigail adam adele adrian agnes aidan alan alain allan allen alana alanna alaric albert alec alex alexa
alexander alexis alfred alice alicia alina aline alison allison alma alun alwin alwyn alyn alyssa amanda amber amelia
amos amy anders andre andrea andreas andrew angela angus anika anita anja anke ann anna anne annika anselm anton
antonia april arden aren arend ari ariel arin arjan arjen arlen arlo armin arne arno arnold aron arran art arthur arun
arvid aryan asher ashton astrid aubrey audrey august aurel aurora austin ava avery axel
baldwin barend barry bart basil bea beate beatrice becky bela belen belinda bella ben benedict benjamin bennet benno
bernard bernd bert bertha beryl beth betty bianca bill bjorn blake bob bonnie boris brad bram brand branden brandon
brant brenda brendan brenna brent brett brian brianna bridget brigitte britta brody brooke bruce bruno bryan bryce
bryn brynn burt
caden caelan caitlin caleb callum calvin cameron camilla candice cara caren carin carina carl carla carlin carlos
carmen carol carola caroline carsten carter cas casey caspar casper cassandra catherine cecil cecilia cedric celeste
celia celine chad charles charlie charlotte chase chloe chris christa christian christina christine christoph
christopher cian ciara cindy claire clara clarence clarissa claude claudia claus clemens clement cliff clint clive
cody colin colleen conan connor conrad constance cora coral corbin cordelia coren corey corin corina corinna cornel
cornelia cornelis cory craig crispin curt cynthia cyril cyrus
dale dalen dalton damian damon dan dana dane daniel daniela danielle dara darby darcy daren daria darian darin dario
darius darla darlene daron darrel darren darryl darwin daryl daryn dave david dawn dean deanna debbie deborah declan
dee deirdre delia dennis derek dermot desmond detlef devin devon diana diane dick diederik dieter dietrich dina dirk
dolores dominic don donald donna donovan dora doreen dorian doris dorothy doug douglas drew duane dudley duncan
dustin dwayne dwight dylan
eamon earl eben ebony ed eddie edgar edith edmund edna eduard edward edwin efren egon eileen einar elaine elan eleanor
elena eleni elenor eli elia elian elias elin elina elinor elisa elisabeth elise eliza elizabeth elke ella ellen ellie
elliot ellis elma elmar elmer eloise elsa else elsie elton elvin elvira elvis elwin elwyn elyn emanuel emil emilia
emily emma emmett enid enrico eric erica erich erik erika erin erna ernest ernst errol erwin esme esther ethan ethel
etienne eugene eunice eva evan eve evelyn everett ewald ezra
fabian faith falk fanny farrah fay faye felicia felicity felix ferdinand fergus fern finlay finn fiona fleur flora
florence florian floyd francis francois frank franz franziska fred freda frederick frederik freya frida frieda
friedrich fritz
gabriel gabriela gabriele gail galen gareth garen garin garret garrett garth gary gavin gemma gene genevieve geoff
geoffrey georg george georgia gerald geraldine gerard gerd gerda gerhard gerrit gert gertrud gideon gilbert giles
gillian gina gisela giselle gladys glen glenda glenn gloria godfrey gordon grace graham grant greg gregor gregory
greta gretchen gretel griet gunnar gunther gus gustav guy gwen gwendolyn gwyn gwyneth
hagen hal haley halen hallie hamish hank hanna hannah hannes hanno hans harald harlan harley harold harriet harry
hartmut harvey hattie hazel heath heather hector hedwig heidi heike heiko heinrich heinz helen helena helene helga
helge helmut hendrik henk hennie henning henri henrietta henrik henry herbert herman hermann hester hilda hilde
holger holly homer hope horst howard hubert hugh hugo humphrey hunter
ian ida ignatius igor ilana ilona ilse imke imogen ina ines inga inge ingo ingrid irene iris irma irvin irwin isaac
isabel isabella isadora isak isidor isla isolde ivan ivar ivo ivor ivy
jack jackie jackson jaco jacob jacobus jacques jade jake james jamie jan jana jane janet janice janine jannie jared
jarrod jasmine jason jasper jay jean jeanette jeanne jeff jeffrey jelle jen jenna jennifer jenny jens jeremy jerome
jerry jesse jessica jill jim joan joanna joanne jochen jodie joe joel johan johann johanna johannes john jon jonas
jonathan jordan jorg jorn jose josef joseph josephine josh joshua joyce juan judith judy jules julia julian juliana
julie juliet julius june jurgen justin justine jutta
kai kara karen kari karin karina karl karla karsten kasper kate katharina katherine kathleen kathrin kathy katja
katrin katrina kay kayla keith kelan kellan kellen kelly kelsey kelvin ken kendall kendra kenneth kent kerry kerstin
kevin kieran kim kirk kirsten kit klaas klara klaus knut kobus koen konrad koos korin kris krista kristen kristian
kristin kristina kurt kyle kylie
lachlan lana lance landon lara larissa lars laura lauren laurence laurens laurie lea leah leander lee leif leigh
leila lena lennard lennart leo leon leona leonard leonie leopold leroy lesley leslie lester levi lewis lex liam
liesel liesl lila lilian lillian lily lina linda lindsay linus lionel lisa lisbeth liv liz liza lizzie lloyd logan
lois lola lore loren lorena lorenz loretta lori lorin lorna lorraine lothar lotte lottie lou louis louisa louise
lowell luca lucas lucia lucian lucille lucinda lucy ludwig luise luke lukas luna luther lydia lyle lynn lynne
mabel mack maddox madeleine madison mae maeve magda magdalena maggie magnus maja malcolm malin mandy manfred manuel
mara marc marcel marcia marco marcus mareike maren margaret margarete margot maria marian marianne marie marietjie
marika marilyn marina mario marion marius marjorie mark markus marla marlene marlon marta martha martin martina
marvin mary mason mathias mathilda matilda matt matthew matthias maud maura maureen maurice max maxim maximilian
maxine may maya megan meike meinhard mel melanie melinda melissa melvin mercedes meredith merle merlin merrill
mervyn meryl mia micah michael michaela michelle mick miguel mike mila mildred miles milo milton mina minna mira
miranda miriam mitchell moira molly mona monica monika morag moran morgan moritz morris morten morton moses muriel
murray myra myron
nadia nadine nancy naomi naresh natalia natalie natasha nathan nathaniel neal ned neil nel nell nelson nena nero
nerina nessa nestor neville niall nic nicholas nick nico nicola nicolas nicole niels nigel nikita niklas nikolai
nikolaus nils nina noah noel nolan nora norah norbert noreen norma norman
odette olaf oleg olga olive oliver olivia ollie omar oona opal ophelia oran oren orin orion orla orlando orrin orson
orville osborn oscar oskar osmond oswald otis ottilie otto owen
pablo paige pam pamela pascal pat patricia patrick paul paula pauline pearl pedro peggy penelope penny percy perry
pete peter petra phil philip philippa phillip phoebe phyllis pierce pierre pieter piet pippa polly preston
quentin quincy quinn
rachel rafael ralf ralph ramon ramona randal randall randolph randy raoul raphael raquel raven ravi ray raymond
rebecca regan regina reid reiner reinhard reinhold rena renata renate rene renee reuben rex rhea rhett rhoda rhona
rhys ria rian ricardo richard rick ricky riley rina rita rob robert roberta robin robyn rocco rod roderick rodney
roger roland rolf roman romy ron ronald ronan ronel ronja rory rosa rosalie rosalind rosamund rose rosemary rosie
ross rowan rowena roxanne roy ruben ruby rudi rudolf rudolph rufus rupert russell ruth ryan
sabine sabrina sadie sally sam samantha samuel sander sandra sandy sara sarah sarel sascha saskia saul scott sean
sebastian selena selene selin selina selma senta serena serge sergio seth severin shane shannon sharon shaun shawn
sheila shelby sheldon shelley sheryl shirley sibyl sidney siegfried siegmund sienna sigrid silas silke silvia simon
simone sina sinead siobhan sofia sofie solveig sonia sonja sonya sophia sophie soren spencer stacey stan stanley
stefan stefanie steffen stella sten stephan stephanie stephen steve steven stewart stina stuart sue summer sunniva
susan susanna susanne suzanne sven svenja sybil sylvia
tabitha talen talia talin talon tamara tammy tania tanja tanya tara taran taren tarin tarun taryn tate tatiana taylor
ted teresa terence terrence terry tess tessa thea thelma theo theodor theodore theresa therese thom thomas thor
thorsten tiaan tia tian tiffany till tilly tim timo timothy tina tinus tobias toby todd tom tomas tommy toni tony
tor toran toren tori torin torsten tracy travis trent trevor tricia trina tristan troy trudy tyler tyrone tyson
udo ulf uli ulla ulric ulrich ulrike ulysses una uri ursula uwe
val valda valen valentin valentina valentine valeria valerie valery van vance vanessa vaughn vera verena vern verna
vernon veronica veronika vic vicky victor victoria vida viktor vince vincent viola violet virgil virginia vivian
vivien volker
wade wallace wally walt walter wanda ward warren wayne wendel wendell wendelin wendy werner wesley wes wiebke wilbur
wilfred wilhelm wilhelmina will willa willem william willie willis willow willy wilma wilson winfried winifred
winston wolf wolfgang wolfram wouter wyatt wynn
xander xavier yael yan yann yara yasmin yolanda yusuf yuri yves yvette yvonne zach zachary zack zander zane zara zelda
zeno zoe zora
arvald jarlath halvard halvor
`;

/** The countries of Europe and its better-known regions, historic lands and islands, in their English or local spelling. */
const REGIONS = `
albania andorra armenia austria azerbaijan belarus belgium bosnia herzegovina bulgaria croatia cyprus czechia
bohemia moravia silesia denmark estonia finland france georgia germany greece hungary iceland ireland italy kosovo
latvia liechtenstein lithuania luxembourg malta moldova monaco montenegro netherlands holland macedonia norway
poland portugal romania russia serbia slovakia slovenia spain sweden switzerland turkey ukraine britain england
scotland wales cornwall ulster munster leinster connacht alba eire cymru albion
aland alandia alsace alsatia lorraine burgundy brittany normandy picardy champagne provence gascony aquitaine
occitania languedoc savoy auvergne anjou poitou touraine limousin artois flanders wallonia brabant limburg zeeland
selandia sjaelland friesland frisia groningen drenthe gelderland utrecht overijssel hainaut liege namur
bavaria bayern saxony sachsen swabia franconia thuringia hesse hessen westphalia rhineland palatinate pomerania
prussia brandenburg mecklenburg holstein schleswig saarland baden wurttemberg lusatia tyrol tirol styria carinthia
salzburg vorarlberg burgenland carniola istria dalmatia slavonia pannonia transylvania wallachia moldavia bukovina
bessarabia dobruja banat galicia volhynia podolia masovia mazovia masuria kashubia livonia courland curonia
samogitia karelia lapland ingria scania skane gotland oland jutland zealand funen lolland bornholm faroe svalbard
andalusia aragon asturias cantabria castile castilla catalonia catalunya extremadura leon murcia navarre navarra
rioja valencia basque euskadi balearic majorca mallorca menorca ibiza canary alentejo algarve minho beira madeira
azores lusitania lombardy lombardia piedmont piemonte liguria veneto venetia friuli emilia romagna tuscany toscana
umbria marche lazio latium abruzzo molise campania apulia puglia basilicata lucania calabria sicily sicilia sardinia
sardegna corsica etruria epirus thessaly thrace macedonia attica boeotia peloponnese laconia arcadia achaea
messenia elis aetolia acarnania phocis euboea crete rhodes ionia aeolia caria lycia lydia phrygia bithynia galatia
cappadocia cilicia pontus anatolia rumelia illyria dacia moesia noricum raetia rhaetia gaul gallia hispania
iberia italia germania britannia caledonia hibernia helvetia belgica batavia scandia scandinavia fennoscandia
baltia ruthenia sarmatia scythia tauria crimea kuban caucasus colchis abkhazia ossetia alania chechnya dagestan
kalmykia tatarstan bashkiria mordovia udmurtia chuvashia siberia ural volga
`;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Every known name, folded: lower case, one word each. */
export const KNOWN_NAMES: ReadonlySet<string> = new Set([TOLKIEN, FICTION, GIVEN, REGIONS].flatMap(words));
