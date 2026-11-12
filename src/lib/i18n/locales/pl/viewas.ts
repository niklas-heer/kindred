// Polish (ty): the words of src/lib/i18n/areas/viewas.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/viewas.ts";

export default {
  // What a change gets during a preview (the server's sentences; every one ends the same way).
  "viewas.err_viewer": "Trwa podgląd w roli czytelnika. Zakończ podgląd, aby coś zmienić.",
  "viewas.err_contributor": "Trwa podgląd w roli współtwórcy. Zakończ podgląd, aby coś zmienić.",
  "viewas.err_editor": "Trwa podgląd w roli redaktora. Zakończ podgląd, aby coś zmienić.",
  "viewas.err_guest": "Trwa podgląd w roli gościa. Zakończ podgląd, aby coś zmienić.",
  "viewas.err_member": "Trwa podgląd w roli: {name}. Zakończ podgląd, aby coś zmienić.",
  "viewas.err_not_steward": "Tylko opiekun tej rodziny może zobaczyć ją oczami kogoś innego.",
  "viewas.err_no_member": "Ta osoba nie jest już członkiem tej rodziny.",
  "viewas.err_self": "Już widzisz rodzinę jako Ty.",
  "viewas.err_demo": "Wersja demo nie ma podglądów: wszyscy widzą ją jako czytelnicy.",
  "viewas.err_failed": "Nie udało się rozpocząć podglądu. Spróbuj ponownie.",
  "viewas.err_stop_failed": "Nie udało się zakończyć podglądu. Spróbuj ponownie.",
  "viewas.notice_title": "Nie zapisano: to tylko podgląd",

  // The bar on every page while a preview is on.
  "viewas.bar_label": "Podgląd",
  "viewas.as_viewer": "Podgląd w roli czytelnika",
  "viewas.as_contributor": "Podgląd w roli współtwórcy",
  "viewas.as_editor": "Podgląd w roli redaktora",
  "viewas.as_member": "Podgląd w roli: {name}",
  "viewas.as_guest": "Podgląd w roli gościa z linku do udostępnienia",
  "viewas.as_plain_guest": "Podgląd w roli gościa",
  "viewas.bar_role": "Rola: {role}",
  "viewas.bar_guest_role": "Gość, czyta jak czytelnik",
  "viewas.bar_protected": "Żyjący są chronieni",
  "viewas.bar_unprotected": "Żyjący widoczni w całości",
  "viewas.bar_family": "W rodzinie: {family}",
  "viewas.bar_saved": "Nic, co tu zrobisz, nie zostanie zapisane.",
  "viewas.switch": "Zmień…",
  "viewas.stop": "Zakończ",
  "viewas.stop_aria": "Zakończ podgląd i zobacz rodzinę jako Ty",
  "viewas.started": "Podgląd włączony. {who}. Nic, co tu zrobisz, nie zostanie zapisane.",
  "viewas.stopped": "Podgląd zakończony. Znowu widzisz rodzinę jako Ty.",

  // The chooser.
  "viewas.menu": "Zobacz jako…",
  "viewas.title": "Zobacz rodzinę oczami kogoś innego",
  "viewas.intro": "Zobacz rodzinę {family} dokładnie tak, jak widzi ją inny czytelnik. Twoje konto pozostaje zalogowane, a nic, co zrobisz podczas podglądu, nie zostanie zapisane.",
  "viewas.role_heading": "Rola",
  "viewas.role_hint": "Członek z tą rolą, niepowiązany z nikim w drzewie.",
  "viewas.member_heading": "Członek",
  "viewas.member_hint": "Jego rola i to, kim jest w drzewie. To, co należy tylko do niego (odpowiedzi, reakcje, prywatne notatki, rozmowy), nie jest pokazywane.",
  "viewas.no_members": "Nikt inny nie jest jeszcze członkiem.",
  "viewas.member_unlinked": "Niepowiązany z nikim w drzewie",
  "viewas.member_linked": "Powiązany z osobą: {name}",
  "viewas.guest_heading": "Gość",
  "viewas.guest_link": "Gość z linku do udostępnienia",
  "viewas.guest_link_protected": "Z ustawieniami linku: żyjący są chronieni.",
  "viewas.guest_link_open": "Z ustawieniami linku: żyjący są widoczni w całości.",
  "viewas.guest_plain": "Gość, dla którego żyjący są chronieni",
  "viewas.guest_plain_hint": "Rodzina nie ma otwartego linku do udostępnienia, więc to gość z najbezpieczniejszym ustawieniem.",
  "viewas.current": "Teraz",
  "viewas.loading": "Wczytywanie członków rodziny…",
  "viewas.load_failed": "Nie udało się wczytać członków.",

  // The Access page.
  "viewas.access_heading": "Zobacz oczami kogoś innego",
  "viewas.access_text": "Sprawdź, co widzi dana rola, członek albo gość z linku do udostępnienia, bez pożyczania jego telefonu.",
  "viewas.access_member": "Zobacz jako",
  "viewas.access_member_aria": "Zobacz jako: {name}",
  "viewas.access_guest": "Zobacz jako gość z tego linku",

  // "Ask to join" during a guest's preview.
  "viewas.join_preview": "To podgląd: gość z tego linku zostałby tutaj zapytany, czy chce założyć własne konto. Z podglądu nic nie jest wysyłane.",
} satisfies Strings<typeof en, "pl">;
