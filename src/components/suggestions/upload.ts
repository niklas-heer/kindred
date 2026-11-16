// Sending a file of a suggestion to the upload route (src/routes/api/suggestion-upload.$tree.$id.ts): the bytes as the body,
// the type as Content-Type and the name as X-File-Name. XMLHttpRequest rather than fetch, because only it reports how much
// of the body has gone. A refusal comes back as `{ error }`, a translation key or an auth error's text, thrown as the
// error's message for errorText; a lost connection throws the TypeError errorText reads as "no connection".
import { FILE_TYPES, MAX_FILE_BYTES, MAX_FILES } from '~/lib/suggestions/types';

export function uploadSuggestionFile(tree: string, id: string, file: File, onProgress: (share: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/suggestion-upload/${encodeURIComponent(tree)}/${encodeURIComponent(id)}`);
    x.setRequestHeader('Content-Type', file.type);
    x.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let error = '';
      try { error = (JSON.parse(x.responseText) as { error?: string }).error ?? ''; } catch {}
      reject(new Error(error || 'common.err_unexpected'));
    };
    x.onerror = () => reject(new TypeError('Failed to fetch'));
    x.send(file);
  });
}

/** Why a chosen file cannot be sent, before it is: its type, that it is empty, or its size; null when it can. */
export function fileProblem(file: File): 'type' | 'empty' | 'size' | null {
  if (!(FILE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

export const FILE_ACCEPT = FILE_TYPES.join(',');
export const MAX_MB = MAX_FILE_BYTES / (1024 * 1024);
export { MAX_FILES };
