import { config } from '@/config';

export function DemoFooter() {
  return (
    <footer className="px-4 py-4 text-center text-xs text-muted">
      Demo project / Демо-проект · FlowDesk is a fictional brand, all data is generated
      {config.apiMode === 'demo' ? ' and stored only in your browser' : ''}. ·{' '}
      <a
        className="underline-offset-2 hover:underline"
        href="https://github.com/sinnercode228"
        target="_blank"
        rel="noreferrer"
      >
        github.com/sinnercode228
      </a>
    </footer>
  );
}
