import { forwardRef, lazy, Suspense } from 'react';
import type { CodeEditorHandle, CodeEditorProps } from './types';

// CodeMirror (~300 kB) is only fetched when the first editor is rendered.
const Inner = lazy(() => import('./CodeEditor'));

/** Lazy-loaded `CodeEditor`: same props and imperative handle, CodeMirror loads on first use. */
export const LazyCodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function LazyCodeEditor(props, ref) {
    const h = props.height;
    return (
      <Suspense
        fallback={
          <div
            className="codeeditor codeeditor-loading"
            style={h === undefined ? undefined : { height: typeof h === 'number' ? `${h}px` : h }}
            role="status"
            aria-label={props.ariaLabel ?? 'Softcode editor'}
          >
            Loading editor...
          </div>
        }
      >
        <Inner {...props} ref={ref} />
      </Suspense>
    );
  },
);
