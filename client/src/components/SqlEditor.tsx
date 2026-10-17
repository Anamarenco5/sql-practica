// Editor SQL con resaltado de sintaxis MySQL y autocompletado de tablas/columnas.
import { MySQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';
import type { TableInfo } from '../api';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onCheck: () => void;
  schema: TableInfo[];
}

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-ink)', height: '100%' },
    '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '14.5px', padding: '14px 0', caretColor: '#fff' },
    '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: '#5d6b80', border: 'none', paddingLeft: '6px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6d0de' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#fff' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(110,140,255,0.35) !important' },
    '.cm-tooltip-autocomplete': { fontFamily: 'var(--font-mono)', fontSize: '13px' },
  },
  { dark: true },
);

export function SqlEditor({ value, onChange, onRun, onCheck, schema }: Props) {
  // Las teclas llaman siempre a la última versión de los callbacks.
  const handlers = useRef({ onRun, onCheck });
  handlers.current = { onRun, onCheck };

  const extensions = useMemo(() => {
    const tables = Object.fromEntries(schema.map((t) => [t.name, t.columns.map((c) => c.name)]));
    return [
      sql({ dialect: MySQL, schema: tables, upperCaseKeywords: true }),
      theme,
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: () => (handlers.current.onRun(), true) },
          { key: 'Mod-Shift-Enter', run: () => (handlers.current.onCheck(), true) },
        ]),
      ),
    ];
  }, [schema]);

  return (
    <CodeMirror
      className="editor"
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="dark"
      height="100%"
      basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: true, bracketMatching: true }}
      aria-label="Editor SQL"
    />
  );
}
