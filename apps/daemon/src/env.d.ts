declare module "*.sql" {
  const sql: string;
  export default sql;
}

declare module "*.png" {
  /** A path to the file (embedded in the compiled binary), from `with { type: "file" }`. */
  const path: string;
  export default path;
}
