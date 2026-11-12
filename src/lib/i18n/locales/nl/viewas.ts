// Dutch (je/jij): the words of src/lib/i18n/areas/viewas.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/viewas.ts";

export default {
  // What a change gets during a preview (the server's sentences; every one ends the same way).
  "viewas.err_viewer": "Je bekijkt de familie als lezer. Stop de voorvertoning om iets te wijzigen.",
  "viewas.err_contributor": "Je bekijkt de familie als bijdrager. Stop de voorvertoning om iets te wijzigen.",
  "viewas.err_editor": "Je bekijkt de familie als bewerker. Stop de voorvertoning om iets te wijzigen.",
  "viewas.err_guest": "Je bekijkt de familie als gast. Stop de voorvertoning om iets te wijzigen.",
  "viewas.err_member": "Je bekijkt de familie als {name}. Stop de voorvertoning om iets te wijzigen.",
  "viewas.err_not_steward": "Alleen een beheerder van deze familie kan haar als iemand anders bekijken.",
  "viewas.err_no_member": "Deze persoon is geen lid meer van deze familie.",
  "viewas.err_self": "Je ziet de familie al als jezelf.",
  "viewas.err_demo": "Een demo heeft geen voorvertoningen: iedereen ziet haar als lezer.",
  "viewas.err_failed": "De voorvertoning kon niet starten. Probeer het opnieuw.",
  "viewas.err_stop_failed": "De voorvertoning kon niet worden gestopt. Probeer het opnieuw.",
  "viewas.notice_title": "Niet opgeslagen: dit is een voorvertoning",

  // The bar on every page while a preview is on.
  "viewas.bar_label": "Voorvertoning",
  "viewas.as_viewer": "Bekijken als lezer",
  "viewas.as_contributor": "Bekijken als bijdrager",
  "viewas.as_editor": "Bekijken als bewerker",
  "viewas.as_member": "Bekijken als {name}",
  "viewas.as_guest": "Bekijken als gast van de deellink",
  "viewas.as_plain_guest": "Bekijken als gast",
  "viewas.bar_role": "Rol: {role}",
  "viewas.bar_guest_role": "Gast, leest als een lezer",
  "viewas.bar_protected": "Levende mensen beschermd",
  "viewas.bar_unprotected": "Levende mensen volledig zichtbaar",
  "viewas.bar_family": "In {family}",
  "viewas.bar_saved": "Niets wat je hier doet, wordt opgeslagen.",
  "viewas.switch": "Wisselen…",
  "viewas.stop": "Stop",
  "viewas.stop_aria": "Stop de voorvertoning en zie de familie weer als jezelf",
  "viewas.started": "Voorvertoning aan. {who}. Niets wat je hier doet, wordt opgeslagen.",
  "viewas.stopped": "Voorvertoning gestopt. Je ziet de familie weer als jezelf.",

  // The chooser.
  "viewas.menu": "Bekijken als…",
  "viewas.title": "Bekijk de familie als iemand anders",
  "viewas.intro": "Zie {family} precies zoals een andere lezer haar krijgt. Je blijft als jezelf ingelogd en niets wat je tijdens de voorvertoning doet, wordt opgeslagen.",
  "viewas.role_heading": "Een rol",
  "viewas.role_hint": "Een lid met die rol dat aan niemand in de stamboom is gekoppeld.",
  "viewas.member_heading": "Een lid",
  "viewas.member_hint": "Zijn of haar rol en wie diegene in de stamboom is. Wat alleen van het lid zelf is (antwoorden, reacties, privénotities, gesprekken) wordt niet getoond.",
  "viewas.no_members": "Er is nog niemand anders lid.",
  "viewas.member_unlinked": "Aan niemand in de stamboom gekoppeld",
  "viewas.member_linked": "Gekoppeld aan {name}",
  "viewas.guest_heading": "Een gast",
  "viewas.guest_link": "Een gast van de deellink",
  "viewas.guest_link_protected": "Met de instellingen van de link: levende mensen zijn beschermd.",
  "viewas.guest_link_open": "Met de instellingen van de link: levende mensen zijn volledig zichtbaar.",
  "viewas.guest_plain": "Een gast met beschermde levende mensen",
  "viewas.guest_plain_hint": "De familie heeft geen open deellink, dus dit is een gast met de veiligste instelling.",
  "viewas.current": "Nu",
  "viewas.loading": "De leden van de familie laden…",
  "viewas.load_failed": "De leden konden niet worden geladen.",

  // The Access page.
  "viewas.access_heading": "Zie het als iemand anders",
  "viewas.access_text": "Controleer wat een rol, een lid of een gast van de deellink te zien krijgt, zonder hun telefoon te lenen.",
  "viewas.access_member": "Bekijken als",
  "viewas.access_member_aria": "Bekijken als {name}",
  "viewas.access_guest": "Bekijken als gast van deze link",

  // "Ask to join" during a guest's preview.
  "viewas.join_preview": "Dit is een voorvertoning: een gast van deze link zou hier worden gevraagd of die een eigen account wil. Vanuit een voorvertoning wordt niets verstuurd.",
} satisfies Strings<typeof en, "nl">;
