// Which pictures on the clipboard should be attached. Screenshot tools such as CleanShot put the file's path on the
// clipboard as text beside the image, so text only keeps the paste as text when it is real writing.
const PATH_LIKE = /^(?:file:\/\/\S+|[/~]\S*|[A-Za-z]:\\\S*|\S+\.(?:png|jpe?g|gif|webp|heic|tiff?))$/i;

export interface ClipboardLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
  getData(type: string): string;
}

export function pastedImages(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];
  const text = data.getData('text/plain').trim();
  if (text && !PATH_LIKE.test(text)) return [];
  const files = Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}
