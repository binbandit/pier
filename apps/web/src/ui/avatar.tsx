import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";

import { q } from "@/lib/rpc";

/** GitHub avatar at a fixed size; falls back to the login's first letter while loading. */
export function Avatar({
  login,
  url,
  size = 18,
  className,
}: {
  login: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const src =
    url ??
    `https://avatars.githubusercontent.com/${encodeURIComponent(login.replace(/\[bot\]$/, ""))}?s=${size * 2}`;
  return (
    <img
      src={src}
      alt={login}
      title={login}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={clsx("shrink-0 rounded-full bg-press", className)}
    />
  );
}

/** One of your gh accounts, with the picture the daemon read for it. */
export function AccountAvatar({ login, size = 18 }: { login: string; size?: number }) {
  const { data: status } = useQuery(q("status", {}));
  const url = status?.accounts.find((account) => account.login === login)?.avatarUrl ?? null;
  return <Avatar login={login} url={url} size={size} />;
}
