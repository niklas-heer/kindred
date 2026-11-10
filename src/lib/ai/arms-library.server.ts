// The server's view of the heraldry library: the names and words of every charge, so blazons, the offline ideas and the
// model's candidate charges know them. The client loads the same metadata on demand (heraldry/art.ts); the server has it
// from the start. Imported for its effect by the modules that name charges.
import { addLibraryCharges } from '../heraldry/registry';
import { LIBRARY_CHARGES } from '../../components/heraldry/library/charges.gen';

addLibraryCharges(LIBRARY_CHARGES);
