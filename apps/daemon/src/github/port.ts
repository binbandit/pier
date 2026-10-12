import type { DiffFile } from "@pier/core/wire";

import type { RateWindow } from "./client";
import type { PrDoc, PrState, PrViewer, VolatileState } from "./pr-doc";

// The only way the rest of the daemon talks to GitHub, one instance per account.
// `LiveGitHub` implements it over HTTP; the stateful fake implements it in memory for tests.

export type SearchHit = { id: string; updatedAt: string; headRefOid: string; state: PrState };

export type NotificationThread = {
  id: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
  repo: string;
  /** The PR or issue number, when the subject has one. */
  number: number | null;
  type: string;
};

export type NotificationPoll =
  | { changed: false; pollIntervalSec: number }
  | { changed: true; pollIntervalSec: number; threads: NotificationThread[] };

export type ReviewSummary = {
  id: string;
  state: string;
  commitOid: string | null;
  submittedAt: string | null;
};

export interface GitHubPort {
  readonly login: string;
  viewer(): Promise<{ login: string; avatarUrl: string }>;
  /** Every PR matching the query, splitting by creation date past GitHub's 1,000-result cap. */
  search(query: string): Promise<SearchHit[]>;
  sweep(ids: string[]): Promise<VolatileState[]>;
  hydrate(ids: string[]): Promise<{ doc: PrDoc; viewer: PrViewer }[]>;
  files(repo: string, number: number): Promise<DiffFile[]>;
  notifications(): Promise<NotificationPoll>;
  markNotificationDone(threadId: string): Promise<void>;
  approve(prId: string, commitOid: string, body?: string): Promise<ReviewSummary>;
  comment(subjectId: string, body: string): Promise<{ id: string }>;
  reviewsBy(prId: string, author: string): Promise<ReviewSummary[]>;
  /** When a GitHub release was published, or null if the tag has no release. */
  releaseDate(repo: string, tag: string): Promise<string | null>;
  rates(): { graphql: RateWindow | null; core: RateWindow | null };
}
