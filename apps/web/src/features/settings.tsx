import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type ReactNode, useState } from "react";

import { errorText } from "@/features/actions";
import { enableNotifications } from "@/features/turn-signals";
import { useCommands } from "@/keys/registry";
import { q, rpc } from "@/lib/rpc";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";
import { AccountAvatar } from "@/ui/avatar";
import { Dot } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import { scopeFix } from "@pier/core/accounts";
import { type DepsPolicy, PERSONAL_QUERY, type Scope, botsQuery } from "@pier/core/settings";
import type { AccountStatus, SettingsView } from "@pier/core/wire";

// Everything about pier you can change: which accounts it acts as and what they're missing,
// which searches find your PRs, what makes a dependency bump Clear, and how it looks.

const INPUT =
  "h-8 rounded-sm border border-line-strong bg-canvas px-2 text-ui text-strong outline-none focus:border-line-max";

export function Settings() {
  const { data: settings } = useQuery(q("settings", {}));
  const { data: status } = useQuery(q("status", {}));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-24">
      <h1 className="text-title font-semibold text-strong">Settings</h1>
      <div className="mt-8 max-w-[1100px] space-y-12">
        <Accounts accounts={status?.accounts ?? []} />
        {settings && <Watching settings={settings} accounts={status?.accounts ?? []} />}
        {settings && <Policy saved={settings.policy} />}
        <Display />
      </div>
    </div>
  );
}

function Section({
  title,
  about,
  children,
}: {
  title: string;
  about: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-section font-semibold text-strong">{title}</h2>
      <p className="mt-1 mb-4 max-w-[72ch] text-meta text-faint">{about}</p>
      {children}
    </section>
  );
}

function Accounts({ accounts }: { accounts: AccountStatus[] }) {
  const toast = useUi((s) => s.toast);
  const copy = (fix: string) =>
    void navigator.clipboard.writeText(fix).then(() => toast({ text: "Copied", tone: "ok" }));
  return (
    <Section
      title="Accounts"
      about="Every account gh is logged into. pier acts as the account that can see each PR."
    >
      <ul className="space-y-3">
        {accounts.map((account) => (
          <li key={account.login} className="grid grid-cols-[200px_1fr] items-start gap-4">
            <span className="flex items-center gap-2 text-ui text-strong">
              <AccountAvatar login={account.login} size={18} />
              {account.login}
            </span>
            {account.missingScopes.length === 0 ? (
              <span className="flex items-center gap-2 text-meta text-muted">
                <Dot tone="ok" /> Has every scope pier uses
              </span>
            ) : (
              <span className="min-w-0 text-meta">
                <span className="flex items-center gap-2 text-muted">
                  <Dot tone={account.ok ? "warn" : "bad"} />
                  {account.ok
                    ? `Projects, saved replies and watching PRs need ${account.missingScopes.join(", ")}`
                    : `Missing ${account.missingScopes.join(", ")}, which pier needs`}
                </span>
                <button
                  type="button"
                  onClick={() => copy(scopeFix(account.login, account.missingScopes))}
                  title="Copy"
                  className="mt-1 block max-w-full truncate rounded-sm font-code text-[12px] leading-5 text-fg hover:text-strong"
                >
                  {scopeFix(account.login, account.missingScopes)}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Watching({ settings, accounts }: { settings: SettingsView; accounts: AccountStatus[] }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [owner, setOwner] = useState("");
  const [account, setAccount] = useState(accounts[0]?.login ?? "");
  const scopes: Scope[] = settings.scopes.map(({ found: _found, ...scope }) => scope);

  const save = async (next: Scope[], done: string) => {
    try {
      await rpc("saveScopes", { scopes: next });
      void client.invalidateQueries();
      toast({ text: done, tone: "ok" });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };
  const watch = (name: string, as: string) => {
    const cleaned = name.trim().replace(/^@/, "");
    if (!cleaned || !as) return;
    void save(
      [...scopes, botScope(cleaned, as)],
      `Watching bot PRs in ${cleaned}; they arrive over the next minutes`,
    );
    setOwner("");
  };

  return (
    <Section
      title="What pier watches"
      about="The searches that find your PRs. Bot PRs are found per owner: add an organisation to sweep its Dependabot and Renovate PRs. Exclude a repo by adding -repo:owner/name to its search."
    >
      {(["personal", "bots"] as const).map((kind) => (
        <div key={kind} className="mb-6">
          <h3 className="mb-2 text-ui text-muted">
            {kind === "personal" ? "Your PRs and reviews" : "Bot PRs"}
          </h3>
          <ul
            aria-label={kind === "personal" ? "Your PRs and reviews" : "Bot PRs"}
            className="space-y-1"
          >
            {settings.scopes
              .filter((scope) => scope.kind === kind)
              .map((scope) => (
                <ScopeRow
                  key={`${scope.account}:${scope.id}`}
                  scope={scope}
                  onSave={(query) =>
                    void save(
                      scopes.map((s) =>
                        s.id === scope.id && s.account === scope.account ? { ...s, query } : s,
                      ),
                      "Search saved",
                    )
                  }
                  onRemove={() =>
                    void save(
                      scopes.filter((s) => !(s.id === scope.id && s.account === scope.account)),
                      "Search removed",
                    )
                  }
                />
              ))}
          </ul>
        </div>
      ))}

      <form
        className="flex items-center gap-3 text-meta"
        onSubmit={(e) => {
          e.preventDefault();
          watch(owner, account);
        }}
      >
        <span className="text-muted">Watch bot PRs in</span>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="Owner or organisation"
          placeholder="organisation or user"
          className={clsx(INPUT, "w-[220px]")}
        />
        <span className="text-muted">as</span>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          aria-label="Account"
          className={clsx(INPUT, "pr-1")}
        >
          {accounts.map((a) => (
            <option key={a.login} value={a.login}>
              {a.login}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!owner.trim()}
          className="text-fg hover:text-strong disabled:text-off"
        >
          Watch
        </button>
      </form>

      {settings.suggestions.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-meta text-faint">Owners you work in, without their bot PRs</h3>
          <ul aria-label="Suggested owners" className="space-y-1">
            {settings.suggestions.map((s) => (
              <li key={s.owner} className="flex items-center gap-4 text-meta">
                <span className="w-[200px] truncate font-code text-fg">{s.owner}</span>
                <span className="w-[200px] text-faint">
                  {s.repos === 1 ? "1 repo" : `${s.repos} repos`} you're involved in
                </span>
                <button
                  type="button"
                  onClick={() => watch(s.owner, s.account)}
                  className="text-fg hover:text-strong"
                >
                  Watch bot PRs as {s.account}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function ScopeRow({
  scope,
  onSave,
  onRemove,
}: {
  scope: SettingsView["scopes"][number];
  onSave: (query: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <li className="grid grid-cols-[160px_minmax(0,1fr)_100px_auto] items-center gap-4 text-meta">
      <span className="flex items-center gap-2 text-muted">
        <AccountAvatar login={scope.account} size={16} />
        {scope.account}
      </span>
      {editing === null ? (
        <span className="truncate text-fg" title={scope.query}>
          <ScopeLabel query={scope.query} />
        </span>
      ) : (
        <input
          // Opened by Edit, so it takes the keys straight away.
          ref={(el) => el?.focus()}
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && editing.trim()) {
              onSave(editing.trim());
              setEditing(null);
            }
            if (e.key === "Escape") setEditing(null);
          }}
          aria-label="Search"
          spellCheck={false}
          className={clsx(INPUT, "w-full font-code text-[12px]")}
        />
      )}
      <span className="text-right text-faint">
        {scope.found === null ? "searching" : `${scope.found} open`}
      </span>
      <span className="flex gap-4">
        {editing === null ? (
          <button
            type="button"
            onClick={() => setEditing(scope.query)}
            className="text-muted hover:text-fg"
          >
            Edit
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-faint">
            <Keys sequence="enter" /> save
          </span>
        )}
        <button type="button" onClick={onRemove} className="text-muted hover:text-fg">
          Remove
        </button>
      </span>
    </li>
  );
}

const BOTS =
  /^is:pr is:open archived:false \(author:app\/dependabot OR author:app\/renovate\) user:(\S+)(.*)$/;

/** pier's own searches in words (anything added to them shown as written); others as written. */
function ScopeLabel({ query }: { query: string }) {
  if (query === PERSONAL_QUERY)
    return <>PRs you're involved in, asked to review, or have reviewed</>;
  const bots = BOTS.exec(query);
  if (!bots) return <span className="font-code text-[12px]">{query}</span>;
  return (
    <>
      Dependabot and Renovate PRs in <span className="font-code text-strong">{bots[1]}</span>
      {bots[2]?.trim() && (
        <span className="ml-2 font-code text-[12px] text-faint">{bots[2].trim()}</span>
      )}
    </>
  );
}

/** A search for one owner's bot PRs, run as `account`. */
function botScope(owner: string, account: string): Scope {
  return { id: `bots-${owner.toLowerCase()}`, account, kind: "bots", query: botsQuery(owner) };
}

function Policy({ saved }: { saved: DepsPolicy }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState<DepsPolicy | null>(null);
  const policy = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (next: Partial<DepsPolicy>) => setDraft({ ...policy, ...next });
  const changeBot = (
    bot: "dependabot" | "renovate",
    next: Partial<DepsPolicy["bots"]["dependabot"]>,
  ) => change({ bots: { ...policy.bots, [bot]: { ...policy.bots[bot], ...next } } });

  const save = async () => {
    if (!dirty) return;
    try {
      await rpc("savePolicy", { policy });
      setDraft(null);
      void client.invalidateQueries();
      toast({ text: "Saved; bump groups are sorted again", tone: "ok" });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  useCommands([
    {
      id: "settings.save",
      title: "Save the deps policy",
      keys: ["mod+s"],
      scope: "surface",
      group: "Settings",
      inInputs: true,
      run: () => void save(),
    },
  ]);

  return (
    <Section
      title="Dependency bumps"
      about="A bump is Clear, one key from approved, when it passes all of these. Anything else waits in Look with the reason."
    >
      <div className="grid max-w-[820px] grid-cols-[260px_1fr] items-center gap-x-6 gap-y-3 text-meta">
        <span className="text-muted">Released at least</span>
        <span className="flex items-center gap-2 text-faint">
          <NumberField
            label="Minimum release age in days"
            value={policy.minReleaseAgeDays}
            min={0}
            onChange={(v) => change({ minReleaseAgeDays: v })}
          />
          days ago
        </span>

        <span className="text-muted">Version changes that can be Clear</span>
        <span className="flex gap-5">
          {(["patch", "minor", "major"] as const).map((semver) => (
            <Check
              key={semver}
              label={semver}
              checked={policy.allowedSemver.includes(semver)}
              onChange={(on) =>
                change({
                  allowedSemver: on
                    ? [...policy.allowedSemver, semver]
                    : policy.allowedSemver.filter((s) => s !== semver),
                })
              }
            />
          ))}
        </span>

        <span className="text-muted">Approve where no review is required</span>
        <Check
          label="Yes, automation merges on approval"
          checked={policy.approveWhenNotRequired}
          onChange={(on) => change({ approveWhenNotRequired: on })}
        />

        <span className="text-muted">A decision on a version lasts</span>
        <span className="flex items-center gap-2 text-faint">
          <NumberField
            label="Days a decision lasts"
            value={policy.verdictTtlDays}
            min={1}
            onChange={(v) => change({ verdictTtlDays: v })}
          />
          days
        </span>

        <span className="text-muted">A bump is stale after</span>
        <span className="flex items-center gap-2 text-faint">
          <NumberField
            label="Days before a bump is stale"
            value={policy.staleAfterDays}
            min={1}
            onChange={(v) => change({ staleAfterDays: v })}
          />
          days
        </span>

        <span className="text-muted">npm scopes never looked up publicly</span>
        <ListField
          label="Private npm scopes"
          value={policy.privateScopes}
          placeholder="@acme, @internal"
          onChange={(privateScopes) => change({ privateScopes })}
        />

        {(["dependabot", "renovate"] as const).map((bot) => (
          <BotRow
            key={bot}
            bot={bot}
            policy={policy.bots[bot]}
            onChange={(next) => changeBot(bot, next)}
          />
        ))}
      </div>

      {dirty && (
        <p className="mt-5 flex items-center gap-5 text-meta">
          <span className="text-warn">Unsaved changes</span>
          <button
            type="button"
            onClick={() => void save()}
            className="flex items-center gap-1.5 text-fg hover:text-strong"
          >
            <Keys sequence="mod+s" /> Save
          </button>
          <button type="button" onClick={() => setDraft(null)} className="text-muted hover:text-fg">
            Discard
          </button>
        </p>
      )}
    </Section>
  );
}

function BotRow({
  bot,
  policy,
  onChange,
}: {
  bot: "dependabot" | "renovate";
  policy: DepsPolicy["bots"]["dependabot"];
  onChange: (next: Partial<DepsPolicy["bots"]["dependabot"]>) => void;
}) {
  return (
    <>
      <span className="text-muted">
        {bot === "dependabot" ? "Dependabot" : "Renovate"} commits by
      </span>
      <span className="flex flex-wrap items-center gap-5">
        <ListField
          label={`${bot === "dependabot" ? "Dependabot" : "Renovate"} commit authors`}
          value={policy.authors}
          placeholder="renovate[bot]"
          onChange={(authors) => onChange({ authors })}
        />
        <Check
          label="signed"
          checked={policy.requireSigned}
          onChange={(on) => onChange({ requireSigned: on })}
        />
        <Check
          label="base merges allowed"
          checked={policy.allowBaseMerges}
          onChange={(on) => onChange({ allowBaseMerges: on })}
        />
      </span>
    </>
  );
}

/** A whole number, kept as typed (so it can be cleared to retype) and passed on when valid. */
function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      value={text ?? value}
      onChange={(e) => {
        setText(e.target.value);
        const next = Number(e.target.value);
        if (e.target.value !== "" && Number.isInteger(next) && next >= min) onChange(next);
      }}
      onBlur={() => setText(null)}
      className={clsx(INPUT, "w-[72px] text-right")}
    />
  );
}

/** A comma-separated list, kept as typed and passed on with each change. */
function ListField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={label}
      value={text ?? value.join(", ")}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        );
      }}
      onBlur={() => setText(null)}
      spellCheck={false}
      className={clsx(INPUT, "w-[280px] font-code text-[12px]")}
    />
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}

function Display() {
  const contrast = usePrefs((s) => s.contrast);
  const setContrast = usePrefs((s) => s.setContrast);
  const notify = usePrefs((s) => s.notify);
  const setNotify = usePrefs((s) => s.setNotify);
  const toast = useUi((s) => s.toast);
  const choices = [
    ["auto", "Dim text from 20:00 to 07:00"],
    ["day", "Always day"],
    ["night", "Always night"],
  ] as const;
  return (
    <Section title="Display" about="Kept in this browser.">
      <div className="grid max-w-[820px] grid-cols-[260px_1fr] items-center gap-x-6 gap-y-3 text-meta">
        <span className="text-muted">Contrast</span>
        <span className="flex gap-5">
          {choices.map(([choice, label]) => (
            <label key={choice} className="flex cursor-pointer items-center gap-2 text-fg">
              <input
                type="radio"
                name="contrast"
                checked={contrast === choice}
                onChange={() => setContrast(choice)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              {label}
            </label>
          ))}
        </span>
        <span className="text-muted">When a PR becomes your turn</span>
        <Check
          label="Send a notification while pier is in the background"
          checked={notify}
          onChange={async (on) => {
            if (!on) {
              setNotify(false);
              return;
            }
            if (!(await enableNotifications()))
              toast({
                text: "Notifications are blocked for pier; allow them in Chrome's site settings",
                tone: "bad",
              });
          }}
        />
      </div>
    </Section>
  );
}
