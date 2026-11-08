import { I18nProvider, translate, type Locale } from '~/lib/i18n';
import { requestLocale } from '~/lib/i18n/request';
import { sessionQuery, setMyLocale } from '~/lib/auth/functions';
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
  beforeLoad: async ({context}) => { const [locale, session] = await Promise.all([requestLocale(), context.queryClient.ensureQueryData(sessionQuery)]); return {locale, localeAccount: session.user?.id}; },
  head: (ctx) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Kindred' },
      { name: 'description', content: translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'common.appDescription') },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
    // The theme script goes through the router's head, not a <script> in the React tree: React warns when it renders a
    // script element on the client, and the head renders it once, before first paint, on the server.
    scripts: [{ children: themeScript }],
  }),
  shellComponent: Shell,
  component: Outlet,
});

function Shell({ children }: { children: ReactNode }) {
  const {locale, localeAccount} = Route.useRouteContext();
  return (
    <html lang={locale} data-theme="codex" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider initialLocale={locale} account={localeAccount} saveRemote={localeAccount ? (next) => setMyLocale({ data: { locale: next } }) : undefined}><div id="app">{children}</div></I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}
