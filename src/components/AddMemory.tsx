// "Add a memory" from the Chronicle: the one composer (src/components/feed/Composer.tsx), opened on its memory side.
// First who it is about, then the same form the person panel uses (StoryForm), so there is one way to write a memory
// and one place that saves it. A message to the family is one press away in the same window.
import { Composer } from './feed/Composer';

export function AddMemory({ tree, onClose }: { tree: string; onClose: () => void }) {
  return <Composer tree={tree} onClose={onClose} start="memory" />;
}
