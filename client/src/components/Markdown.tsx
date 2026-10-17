import { marked } from 'marked';
import { useMemo } from 'react';

marked.setOptions({ gfm: true, breaks: false });

// Escapa HTML crudo: los enunciados son texto + markdown, nunca HTML ejecutable.
const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => marked.parse(text, { renderer, async: false }) as string, [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
