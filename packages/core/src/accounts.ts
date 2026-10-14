/**
 * The gh commands that add `scopes` to one account's token. `gh auth refresh` only works on the
 * active account (it has no --user), so the account is switched to first.
 */
export function scopeFix(login: string, scopes: string[]): string {
  return `gh auth switch -h github.com -u ${login} && gh auth refresh -h github.com -s ${scopes.join(",")}`;
}
