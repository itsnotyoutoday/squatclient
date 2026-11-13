import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TOPICS, ancestorsOf } from '../../help/data';
import type { HelpTopic } from '../../help/types';

interface Node {
  topic: HelpTopic;
  children: Node[];
}

function buildTree(): Node[] {
  const nodes = new Map<string, Node>(TOPICS.map((t) => [t.id, { topic: t, children: [] }]));
  const roots: Node[] = [];
  for (const t of TOPICS) {
    const n = nodes.get(t.id) as Node;
    const p = t.parent ? nodes.get(t.parent) : undefined;
    (p ? p.children : roots).push(n);
  }
  const sort = (xs: Node[]): void => {
    xs.sort((a, b) => a.topic.order - b.topic.order);
    xs.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}

export interface TopicTreeProps {
  currentId: string;
  onOpen(id: string): void;
}

/** WAI-ARIA tree of help topics: Up/Down move, Right/Left expand/collapse, Enter opens, Home/End jump. */
export function TopicTree({ currentId, onOpen }: TopicTreeProps) {
  const roots = useMemo(buildTree, []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState(currentId);
  const treeRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestorsOf(currentId)) next.add(a.id);
      return next.size === prev.size ? prev : next;
    });
    setFocusId(currentId);
  }, [currentId]);

  const items = (): HTMLElement[] => [
    ...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []),
  ];
  const focusItem = (id: string): void => {
    setFocusId(id);
    items()
      .find((el) => el.dataset.id === id)
      ?.focus();
  };
  const toggle = (id: string, open?: boolean): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!li || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = li.dataset.id as string;
    const all = items();
    const i = all.indexOf(li);
    const hasKids = li.getAttribute('aria-expanded') !== null;
    const open = li.getAttribute('aria-expanded') === 'true';
    const go = (el?: HTMLElement): void => {
      if (el) focusItem(el.dataset.id as string);
    };
    switch (e.key) {
      case 'ArrowDown':
        go(all[i + 1]);
        break;
      case 'ArrowUp':
        go(all[i - 1]);
        break;
      case 'Home':
        go(all[0]);
        break;
      case 'End':
        go(all[all.length - 1]);
        break;
      case 'ArrowRight':
        if (hasKids && !open) toggle(id, true);
        else if (open) go(all[i + 1]);
        break;
      case 'ArrowLeft':
        if (open) toggle(id, false);
        else go(all.find((el) => el.dataset.id === li.dataset.parent));
        break;
      case 'Enter':
      case ' ':
        onOpen(id);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const render = (n: Node, level: number, parent: string): JSX.Element => {
    const id = n.topic.id;
    const kids = n.children.length > 0;
    const open = expanded.has(id);
    return (
      <li
        key={id}
        role="treeitem"
        data-id={id}
        data-parent={parent}
        aria-level={level}
        aria-selected={id === currentId}
        aria-expanded={kids ? open : undefined}
        tabIndex={id === focusId ? 0 : -1}
        className="treeitem"
        onFocus={(e) => e.target === e.currentTarget && setFocusId(id)}
      >
        <div
          className={`treerow${id === currentId ? ' current' : ''}`}
          onClick={() => {
            onOpen(id);
            if (kids) toggle(id, true);
          }}
        >
          <span
            className="twisty"
            aria-hidden="true"
            onClick={(e) => {
              if (!kids) return;
              e.stopPropagation();
              toggle(id);
            }}
          >
            {kids ? (open ? '▾' : '▸') : ''}
          </span>
          <span className="label">{n.topic.title}</span>
        </div>
        {kids && open && <ul role="group">{n.children.map((c) => render(c, level + 1, id))}</ul>}
      </li>
    );
  };

  return (
    <ul ref={treeRef} role="tree" aria-label="Help topics" className="helptree" onKeyDown={onKeyDown}>
      {roots.map((r) => render(r, 1, ''))}
    </ul>
  );
}
