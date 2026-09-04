import { useCallback, useEffect, useState } from 'react';

/**
 * A grouped, collapsible list for the panel and register navigators.
 *
 * Both lists are long enough that finding an entry means scrolling past groups
 * you are not working on. Collapsed groups are remembered per list, so a console
 * left set up for one plane comes back that way.
 */

export interface ListGroup<T> {
  id: string;
  title: string;
  items: T[];
}

interface Props<T> {
  /** Distinguishes one list's collapsed state from another's in storage. */
  storageKey: string;
  groups: ListGroup<T>[];
  /** Identity of an item, used to keep its group open when it is selected. */
  itemId: (item: T) => string;
  selectedId?: string;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
}

function loadCollapsed(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function SectionList<T>({
  storageKey,
  groups,
  itemId,
  selectedId,
  renderItem,
  onSelect,
}: Props<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(storageKey));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...collapsed]));
    } catch {
      // A console in private browsing still works, it just will not remember.
    }
  }, [storageKey, collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allCollapsed = groups.every((g) => collapsed.has(g.id));
  const setAll = (collapse: boolean) =>
    setCollapsed(collapse ? new Set(groups.map((g) => g.id)) : new Set());

  return (
    <>
      <div className="list-actions">
        <button type="button" className="link" onClick={() => setAll(!allCollapsed)}>
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      {groups.map((group) => {
        // A group holding the current selection stays open, so choosing an entry
        // from search or a link never leaves it hidden.
        const holdsSelection = group.items.some((i) => itemId(i) === selectedId);
        const isOpen = !collapsed.has(group.id) || holdsSelection;

        return (
          <div key={group.id} className="list-group">
            <button
              type="button"
              className="list-group-head"
              aria-expanded={isOpen}
              onClick={() => toggle(group.id)}
            >
              <span className={`chev${isOpen ? ' open' : ''}`} aria-hidden="true" />
              <span className="list-group-title">{group.title}</span>
              <span className="list-group-count">{group.items.length}</span>
            </button>

            {isOpen &&
              group.items.map((item) => (
                <button
                  key={itemId(item)}
                  aria-selected={itemId(item) === selectedId}
                  onClick={() => onSelect(item)}
                >
                  {renderItem(item)}
                </button>
              ))}
          </div>
        );
      })}
    </>
  );
}
