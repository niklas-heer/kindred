// The character editor and drawn portraits.
// Keys are unique across every area. Add a key to en, de and af here, and use it as t('<key>').
import type { Message } from "../types.ts";

export const en = {
  "character.make_from_photo": "Make from photo",
  "character.photo_pick": "Pick one of their photos. The result loads into the editor; nothing is saved until you save.",
  "character.no_photos": "Add a photo of this person to the gallery first.",
  "character.photo_loading": "Looking at the photo…",
  "character.photo_failed": "A portrait couldn’t be made from that photo. Try another.",
  "character.photo_loaded": "Made from the photo. Check it, then save.",
};

export const de: Record<keyof typeof en, Message> = {
  "character.make_from_photo": "Aus einem Foto machen",
  "character.photo_pick": "Wähl eines der Fotos dieser Person. Das Ergebnis lädt in den Editor; gespeichert wird erst, wenn du speicherst.",
  "character.no_photos": "Füg zuerst ein Foto dieser Person in die Galerie ein.",
  "character.photo_loading": "Das Foto wird angesehen…",
  "character.photo_failed": "Aus diesem Foto ließ sich kein Porträt machen. Probier ein anderes.",
  "character.photo_loaded": "Aus dem Foto gemacht. Prüf es und speicher dann.",
};

/** Afrikaans. A missing entry falls back to English at runtime; the test reports them. */
export const af: Partial<Record<keyof typeof en, Message>> = {
  "character.make_from_photo": "Maak uit foto",
  "character.photo_pick": "Kies een van hul foto’s. Die resultaat laai in die redigeerder; niks word gestoor voordat jy stoor nie.",
  "character.no_photos": "Voeg eers ’n foto van hierdie persoon by die galery.",
  "character.photo_loading": "Kyk na die foto…",
  "character.photo_failed": "’n Portret kon nie uit daardie foto gemaak word nie. Probeer ’n ander een.",
  "character.photo_loaded": "Gemaak uit die foto. Kyk dit na, en stoor dan.",
};
