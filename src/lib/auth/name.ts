// The setup asks for the steward's name on one line. The first person of the new family takes it apart at its
// last space (given name, then surname), and the setup's second step shows the two parts for the steward to fix.
export function splitName(full: string): { given: string; surname: string } {
  const name = full.replace(/\s+/g, ' ').trim();
  const at = name.lastIndexOf(' ');
  return at < 0 ? { given: name, surname: '' } : { given: name.slice(0, at), surname: name.slice(at + 1) };
}
