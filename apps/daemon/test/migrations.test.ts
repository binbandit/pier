import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { Model } from "@/domain/model";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";

const cacheMigration = (name: string) =>
  Bun.file(new URL(`../src/store/migrations/cache/${name}`, import.meta.url)).text();

test("docs stored before assignees and milestone stay usable and get read again", async () => {
  const db = new Database(":memory:", { strict: true });
  for (const name of ["001-init.sql", "002-detail.sql", "003-notifications.sql"]) {
    db.exec(await cacheMigration(name));
  }
  // A real doc as an older build stored it: no assignees or milestone yet.
  const world = generateScenario({ preset: "sandbox" });
  const [pr] = world.prs.values();
  const [read] = await createFakePorts(world).get("binbandit")!.hydrate([pr!.id]);
  const { assignees: _a, milestone: _m, ...old } = read!.doc;
  db.query(
    "INSERT INTO pr_doc (id, reader, tier, fetched_at, json) VALUES (?, 'binbandit', 'bot', ?, ?)",
  ).run(old.id, "2026-10-01T00:00:00.000Z", JSON.stringify(old));

  db.exec(await cacheMigration("004-reread-docs.sql"));

  const record = new Model(db).get(old.id);
  expect(record?.doc.assignees).toEqual([]);
  expect(record?.doc.milestone).toBeNull();
  expect(record?.stale).toBe(true);
  // Retention still counts from when it was really read, not from the migration.
  expect(record?.fetchedAt).toBe("2026-10-01T00:00:00.000Z");
});
