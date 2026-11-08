// First-time setup of a server and its first steward.
// Keys are unique across every area. Add a key to en, de and af here, and use it as t('<key>').
import type { Message } from "../types.ts";

export const en = {
  "setup.already_set_up": "Already set up",
  "setup.kindred_already_has_a_steward_sign_in_with_your_passkey_or_ask_a_steward_for_an_invitation": "Kindred already has a steward. Sign in with your passkey, or ask a steward for an invitation.",
  "setup.go_to_sign_in": "Go to sign in",
  "setup.setup_didn_t_work_please_try_again": "Setup didn’t work. Please try again.",
  "setup.first_time_setup": "First-time setup",
  "setup.become_the_first_steward": "Become the first steward",
  "setup.open_public_warning": "No setup code is set, and this address is not this computer. Whoever creates the first account here becomes the steward. To require a code, set KINDRED_SETUP_CODE on the server.",
  "setup.nobody_has_an_account_yet_you_ll_look_after_every_family_on_this_server_invite_relatives_and_choose_what_each_of_them_may_change": "Nobody has an account yet. You’ll look after every family on this server: invite relatives, and choose what each of them may change.",
  "setup.setup_code": "Setup code",
  "setup.the_server_printed_it_in_its_terminal_when_it_started_look_for_kindred_setup": "The server printed it in its terminal when it started (look for “Kindred setup”).",
  "setup.print_it_again": "Print it again",
  "setup.your_name": "Your name",
  "setup.as_the_family_calls_you": "As the family calls you",
  "setup.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox": "This browser can’t use passkeys. Try the newest Safari, Chrome, Edge or Firefox.",
  "setup.waiting_for_your_device": "Waiting for your device…",
  "setup.create_your_passkey": "Create your passkey",
  "setup.save_your_passkey_in_1password_icloud_keychain_google_password_manager_or_a_security_key": "Save your passkey in 1Password, iCloud Keychain, Google Password Manager or a security key.",
};

export const de: Record<keyof typeof en, Message> = {
  "setup.already_set_up": "Bereits eingerichtet",
  "setup.kindred_already_has_a_steward_sign_in_with_your_passkey_or_ask_a_steward_for_an_invitation": "Kindred wird bereits verwaltet. Melde dich mit deinem Passkey an oder bitte die Familienverwaltung um eine Einladung.",
  "setup.go_to_sign_in": "Zur Anmeldung",
  "setup.setup_didn_t_work_please_try_again": "Die Einrichtung hat nicht geklappt. Versuch es bitte noch einmal.",
  "setup.first_time_setup": "Erste Einrichtung",
  "setup.become_the_first_steward": "Übernimm die Familienverwaltung",
  "setup.open_public_warning": "Es ist kein Einrichtungscode gesetzt, und diese Adresse ist nicht dieser Rechner. Wer hier das erste Konto anlegt, übernimmt die Familienverwaltung. Setze auf dem Server KINDRED_SETUP_CODE, um einen Code zu verlangen.",
  "setup.nobody_has_an_account_yet_you_ll_look_after_every_family_on_this_server_invite_relatives_and_choose_what_each_of_them_may_change": "Hier hat noch niemand ein Konto. Du verwaltest alle Familien auf diesem Server, lädst Verwandte ein und legst fest, was sie ändern dürfen.",
  "setup.setup_code": "Einrichtungscode",
  "setup.the_server_printed_it_in_its_terminal_when_it_started_look_for_kindred_setup": "Du findest ihn im Terminal des Servers beim Start unter „Kindred setup“.",
  "setup.print_it_again": "Erneut anzeigen",
  "setup.your_name": "Dein Name",
  "setup.as_the_family_calls_you": "Wie dich deine Familie nennt",
  "setup.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox": "Dieser Browser unterstützt keine Passkeys. Versuche es mit einem aktuellen Safari, Chrome, Edge oder Firefox.",
  "setup.waiting_for_your_device": "Warte auf dein Gerät…",
  "setup.create_your_passkey": "Deinen Passkey erstellen",
  "setup.save_your_passkey_in_1password_icloud_keychain_google_password_manager_or_a_security_key": "Speichere deinen Passkey in 1Password, im iCloud-Schlüsselbund, im Google Passwortmanager oder auf einem Sicherheitsschlüssel.",
};

/** Afrikaans. A missing entry falls back to English at runtime; the test reports them. */
export const af: Partial<Record<keyof typeof en, Message>> = {
  "setup.already_set_up": "Alreeds opgestel",
  "setup.kindred_already_has_a_steward_sign_in_with_your_passkey_or_ask_a_steward_for_an_invitation": "Kindred het reeds ’n rentmeester. Meld aan met jou passkey, of vra ’n rentmeester vir ’n uitnodiging.",
  "setup.go_to_sign_in": "Gaan na aanmelding",
  "setup.setup_didn_t_work_please_try_again": "Opstelling het nie gewerk nie. Probeer asseblief weer.",
  "setup.first_time_setup": "Eerste keer opstel",
  "setup.become_the_first_steward": "Word die eerste rentmeester",
  "setup.open_public_warning": "Geen opstellingskode is ingestel nie, en hierdie adres is nie hierdie rekenaar nie. Wie die eerste rekening hier ook al skep, word die rentmeester. Om ’n kode te vereis, stel KINDRED_SETUP_CODE op die bediener in.",
  "setup.nobody_has_an_account_yet_you_ll_look_after_every_family_on_this_server_invite_relatives_and_choose_what_each_of_them_may_change": "Niemand het nog ’n rekening nie. Jy sal na elke familie op hierdie bediener omsien: nooi familielede uit, en kies wat elkeen van hulle mag verander.",
  "setup.setup_code": "Opstellingskode",
  "setup.the_server_printed_it_in_its_terminal_when_it_started_look_for_kindred_setup": "Die bediener het dit in sy terminaal gedruk toe dit begin het (soek na “Kindred setup”).",
  "setup.print_it_again": "Druk dit weer uit",
  "setup.your_name": "Jou naam",
  "setup.as_the_family_calls_you": "Soos die familie jou noem",
  "setup.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox": "Hierdie blaaier kan nie passkeys gebruik nie. Probeer die nuutste Safari, Chrome, Edge of Firefox.",
  "setup.waiting_for_your_device": "Wag vir jou toestel…",
  "setup.create_your_passkey": "Skep jou passkey",
  "setup.save_your_passkey_in_1password_icloud_keychain_google_password_manager_or_a_security_key": "Stoor jou passkey in 1Password, iCloud Keychain, Google Password Manager of ’n sekuriteitsleutel.",
};
