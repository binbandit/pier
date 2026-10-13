import { clsx } from "clsx";
import { type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * A panel raised from the status line (review, merge, confirm writes). It publishes its height as
 * `--dock` so toasts can sit on top of it instead of covering it.
 */
export function Dock({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() =>
      root.setProperty("--dock", `${element?.offsetHeight ?? 0}px`),
    );
    if (element) observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty("--dock");
    };
  }, []);

  return (
    <section
      ref={ref}
      aria-label={label}
      className={clsx(
        "border-t border-line-strong bg-raise px-8 py-4 motion-safe:animate-[rise_120ms_var(--ease-out)]",
        className,
      )}
    >
      {children}
    </section>
  );
}
