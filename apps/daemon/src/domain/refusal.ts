/**
 * A request pier won't carry out as asked (the PR moved on, you can't push there). It goes back
 * to the app as a 409 with its message, rather than as a failure of pier's.
 */
export class Refusal extends Error {}
