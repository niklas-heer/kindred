import { I18nProvider, loadLocale, translate, type Locale } from '~/lib/i18n';
import { AnnouncementBanner } from '~/components/operator/AnnouncementBanner';
import { ResetNotice } from '~/components/signin/ResetNotice';
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
import { DemoBanner } from '~/components/families/DemoBanner';
import { ProofHost } from '~/components/signin/ProofHost';
import '~/components/art.css';

// Apply the saved theme before first paint, so codex never flashes as paper, and keep the browser's
// theme-color (address bar, task switcher) in step with whatever theme is applied later. Under a Content-Security-Policy
// the router cannot recognise this script after hydration (browsers hide its nonce) and adds it again, so it runs once.
const themeScript = `(function(){if(window.__kindredTheme)return;window.__kindredTheme=1;var d=document.documentElement;try{var t=localStorage.getItem('kindred:theme');if(t)d.dataset.theme=t}catch(e){}
var c={codex:'#171d28',modern:'#ffffff',night:'#181b23'},m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m);
var u=function(){m.content=c[d.dataset.theme]||c.codex};u();new MutationObserver(u).observe(d,{attributes:true,attributeFilter:['data-theme']})})()`;

// Before any bundle loads: Zod would otherwise try `new Function` to compile its validators, and the policy reports that
// even though the failure is caught. Validators are nowhere near hot enough to need it.
const zodConfigScript = 'globalThis.__zod_globalConfig={jitless:true}';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The browser has only English until it fetches another language (catalog.client.ts), so a navigation that finds the
  // reader's language changed (another tab) waits for its words. On the server, and for a language already here, at once.
  beforeLoad: async ({context}) => { const [{locale, offered}, session] = await Promise.all([requestLocale(), context.queryClient.ensureQueryData(sessionQuery)]); await loadLocale(locale); return {locale, offered, localeAccount: session.demo ? undefined : session.user?.id, demo: !!session.demo}; },
  head: (ctx) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Kindred' },
      { name: 'description', content: translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'common.appDescription') },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
    // The theme script goes through the router's head, not a <script> in the React tree: React warns when it renders a
    // script element on the client, and the head renders it once, before first paint, on the server.
    scripts: [{ children: zodConfigScript }, { children: themeScript }],
  }),
  shellComponent: Shell,
  component: Root,
});

/** Every page, and the operator's announcements over it for a signed-in reader (and the notice of a reset password). */
function Root() {
  return <><Outlet /><AnnouncementBanner /><ResetNotice /></>;
}

function Shell({ children }: { children: ReactNode }) {
  const {locale, offered, localeAccount, demo} = Route.useRouteContext();
  return (
    <html lang={locale} data-theme="codex" data-demo={demo ? '' : undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider initialLocale={locale ?? 'en'} offered={offered} account={localeAccount} saveRemote={localeAccount ? (next) => setMyLocale({ data: { locale: next } }) : undefined}>{demo && <DemoBanner />}<div id="app">{children}</div><ProofHost /></I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}
