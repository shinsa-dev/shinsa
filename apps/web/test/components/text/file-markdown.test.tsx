import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
import { FileMarkdown, type FileMarkdownLinks } from '@/components/text/markdown.tsx';

const README = [
  '# Sample app',
  '',
  '<p align="center"><img src="assets/logo.png" alt="Logo" width="120"></p>',
  '',
  'Read the [guide](docs/guide.md), the [API](https://example.com/api) or jump to [Install](#install).',
  '',
  '<script>window.hacked = true</script>',
  '<a href="javascript:alert(1)" onclick="alert(2)">Click me</a>',
  '',
  '## Install',
  '',
  '- [x] Clone it',
  '',
  '```bash',
  'bun install',
  '```',
  '',
  '![Badge](https://example.com/badge.svg)',
].join('\n');

function renderReadme(text = README) {
  const links: FileMarkdownLinks = {
    resolveImage: mock((src: string | undefined) => (src?.startsWith('assets/') ? `/raw/${src}` : null)),
    openLink: mock((href: string | undefined) => href === 'docs/guide.md'),
  };
  const view = render(
    <TooltipProvider>
      <FileMarkdown text={text} links={links} />
    </TooltipProvider>
  );
  return { view, links };
}

describe('a Markdown file rendered as a preview', () => {
  it('renders headings, HTML blocks, task lists and code like GitHub', () => {
    const { view } = renderReadme();
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Sample app');
    expect(view.getByRole('heading', { level: 2 }).id).toBe('user-content-install');
    expect(view.container.querySelector('p[align="center"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Clone it');
    expect(view.container.textContent).toContain('bun install');
  });

  it('drops scripts, event handlers and unsafe links', () => {
    const { view } = renderReadme();
    expect(view.container.querySelector('script')).toBeNull();
    const unsafe = view.getByText('Click me');
    expect(unsafe.getAttribute('onclick')).toBeNull();
    expect(unsafe.getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('loads images in the project through the file reader and keeps images on the web', () => {
    const { view } = renderReadme();
    expect(view.getByAltText('Logo').getAttribute('src')).toBe('/raw/assets/logo.png');
    expect(view.getByAltText('Logo').getAttribute('width')).toBe('120');
    expect(view.getByAltText('Badge').getAttribute('src')).toBe('https://example.com/badge.svg');
  });

  it('opens a link to another file in place and a web link in a new tab', () => {
    const { view, links } = renderReadme();
    const guide = view.getByRole('link', { name: 'guide' });
    expect(fireEvent.click(guide)).toBe(false);
    expect(links.openLink).toHaveBeenCalledWith('docs/guide.md');
    const web = view.getByRole('link', { name: 'API' });
    expect(web.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(web)).toBe(true);
  });

  it('scrolls to a heading for an anchor link without leaving the page', () => {
    const { view } = renderReadme();
    const heading = view.getByRole('heading', { level: 2 });
    const scroll = mock(() => {});
    heading.scrollIntoView = scroll;
    expect(fireEvent.click(view.getByRole('link', { name: 'Install' }))).toBe(false);
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  });
});
