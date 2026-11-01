import { Card } from '@shinsa/ui/components/card';
import { cn } from '@shinsa/ui/lib/utils';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeading, SECTION_LABEL } from '@/components/layout/page/heading.tsx';

interface SandboxLink {
  label: string;
  url: string;
}

export interface SandboxSection {
  title: string;
  links: SandboxLink[];
}

const THEME_SCRIPT =
  "document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')";

const LINK_ROW =
  'corner-superellipse/1.125 flex min-h-10 flex-col justify-center gap-px rounded-lg px-2 py-1 hover:bg-bg-a2 active:bg-bg-a2';

function SandboxGroup({ section }: { section: SandboxSection }) {
  return (
    <section className='flex flex-col gap-1'>
      <h2 className={cn(SECTION_LABEL, 'h-6 px-1')}>{section.title}</h2>
      <Card className='gap-0 p-1.5'>
        {section.links.map((link) => (
          <a key={link.url} href={link.url} className={LINK_ROW}>
            <span className='truncate text-fg-4 text-xs'>{link.label}</span>
            <code className='truncate font-mono text-2xs text-fg-2'>{link.url}</code>
          </a>
        ))}
      </Card>
    </section>
  );
}

function SandboxPage({ sections }: { sections: SandboxSection[] }) {
  return (
    <main className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10'>
      <PageHeading
        title='Shinsa sandbox'
        description='Two seeded machines, Studio and Laptop, behind a local stand-in for app.shinsa.dev. Commands work and no agent runs; each start seeds them again.'
      />
      {sections
        .filter((section) => section.links.length > 0)
        .map((section) => (
          <SandboxGroup key={section.title} section={section} />
        ))}
    </main>
  );
}

export function serializeSandboxPage(sections: SandboxSection[], stylesheet: string) {
  const page = renderToStaticMarkup(
    <html lang='en' className='font-sans antialiased'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <meta name='color-scheme' content='light dark' />
        <title>Shinsa sandbox</title>
        <script>{THEME_SCRIPT}</script>
        <link rel='stylesheet' href={stylesheet} />
      </head>
      <body className='bg-background'>
        <SandboxPage sections={sections} />
      </body>
    </html>
  );
  return `<!doctype html>${page}`;
}
