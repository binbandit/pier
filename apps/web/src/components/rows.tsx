import type { Virtualizer } from "@tanstack/react-virtual";
import { clsx } from "clsx";
import type { CSSProperties, ReactNode, RefObject } from "react";

// Rows are buttons: a click moves the cursor there, a double click opens it. Keyboard focus stays
// with pier's own key handling (tabIndex -1), which is how every list moves.

type RowProps = {
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen?: (() => void) | undefined;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function Row({ active, selected, onSelect, onOpen, className, style, children }: RowProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={style}
      className={clsx(
        "relative flex w-full cursor-default items-center text-left",
        active ? "bg-cursor" : selected ? "bg-selected" : "hover:bg-hover",
        className,
      )}
    >
      {active && (
        <span aria-hidden className="absolute top-2 bottom-2 left-3 w-0.5 rounded-full bg-accent" />
      )}
      {children}
    </button>
  );
}

type VirtualRowsProps<T> = {
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  items: T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  label: string;
  cursor: number;
  selectedKeys: string[];
  onSelect: (index: number) => void;
  onOpen?: ((item: T) => void) | undefined;
  render: (item: T) => ReactNode;
};

/** A virtualised list of rows: thousands of items scroll like ten. */
export function VirtualRows<T>(props: VirtualRowsProps<T>) {
  const {
    scrollRef,
    virtualizer,
    items,
    keyOf,
    rowHeight,
    label,
    cursor,
    selectedKeys,
    onSelect,
    onOpen,
    render,
  } = props;
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-8">
      <ul aria-label={label} className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          const key = keyOf(item);
          return (
            <li
              key={key}
              className="absolute inset-x-0"
              style={{ top: row.start, height: rowHeight }}
            >
              <Row
                active={row.index === cursor}
                selected={selectedKeys.includes(key)}
                onSelect={() => onSelect(row.index)}
                onOpen={onOpen ? () => onOpen(item) : undefined}
                className="h-full px-8"
              >
                {render(item)}
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
