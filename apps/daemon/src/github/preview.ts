import { TypedDocumentString } from "./gql/graphql";

// Operations on GitHub features newer than the published schema pier generates its types from
// (public previews). Typed by hand here; codegen will take them over once the schema has them.

/** Closes a PR and marks it archived. */
export const ArchivePrMutation = new TypedDocumentString<
  { archivePullRequest: { clientMutationId: string | null } | null },
  { id: string }
>(`
  mutation ArchivePr($id: ID!) {
    archivePullRequest(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);

/** Takes the archived mark off a PR (it stays closed). */
export const UnarchivePrMutation = new TypedDocumentString<
  { unarchivePullRequest: { clientMutationId: string | null } | null },
  { id: string }
>(`
  mutation UnarchivePr($id: ID!) {
    unarchivePullRequest(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);
