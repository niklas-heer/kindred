// Main: the page's one `<main>` landmark. The family shell wraps its pages in one (the skip link points at it) and
// says so through MainContext; a page root rendered inside it becomes a plain `div`, and one rendered alone (a
// not-found page, a route error) becomes the `<main>` itself, so a page never has two.
import { createContext, useContext, type ComponentPropsWithoutRef } from 'react';

export const MainContext = createContext(false);

export function Main(props: ComponentPropsWithoutRef<'main'>) {
  const inside = useContext(MainContext);
  return inside ? <div {...props} /> : <main {...props} />;
}
