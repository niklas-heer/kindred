import '@fontsource-variable/cinzel';
import '@fontsource-variable/eb-garamond';
import '@fontsource-variable/inter';
import '@fontsource/im-fell-english';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import appCss from '~/styles/app.css?url';
import '~/components/art.css';

// Apply the saved theme before first paint, so codex never flashes as paper, and keep the browser's
// theme-color (address bar, task switcher) in step with whatever theme is applied later.
const themeScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('kindred:theme');if(t)d.dataset.theme=t}catch(e){}
var c={codex:'#171d28',modern:'#ffffff',night:'#181b23'},m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m);
var u=function(){m.content=c[d.dataset.theme]||c.codex};u();new MutationObserver(u).observe(d,{attributes:true,attributeFilter:['data-theme']})})()`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Kindred' },
      { name: 'description', content: 'A family tree you can live in.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: Shell,
  component: Outlet,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="codex" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div id="app">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
