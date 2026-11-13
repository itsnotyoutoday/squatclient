// CodeMirror-free entry point. Import `CodeEditor`, `expandSelection` and `collapseSelection`
// directly from './CodeEditor' / './commands' only inside code that is itself lazily loaded.
export { LazyCodeEditor } from './LazyCodeEditor';
export type { CodeEditorHandle, CodeEditorProps, CursorInfo } from './types';
