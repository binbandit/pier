import { describe, expect, test } from "bun:test";

import { createFakePorts, generateScenario } from "@/github/fake/scenario";

/** Whether GitHub turned the request down. */
const refused = (attempt: Promise<unknown>) =>
  attempt.then(
    () => false,
    () => true,
  );

const setup = () => {
  const world = generateScenario({ preset: "sandbox" });
  const ports = createFakePorts(world);
  const pr = [...world.prs.values()].find((p) => p.author === "sage-smudge" && p.state === "OPEN")!;
  return { world, pr, owner: ports.get("WastedHippie")!, you: ports.get("binbandit")! };
};

describe("merging, past the basics", () => {
  test("auto-merge retains the chosen commit message and exposes cancellation separately", async () => {
    const { world, pr, you } = setup();
    const message = { headline: "Land the dependency update", body: "Reviewed and tested." };
    await you.setAutoMerge(pr.id, "SQUASH", world.head(pr), message);
    expect(await you.mergeInfo(pr.id)).toMatchObject({
      canEnableAutoMerge: false,
      canDisableAutoMerge: true,
      autoMerge: { method: "SQUASH", ...message },
    });
    await you.setAutoMerge(pr.id, null, world.head(pr));
    expect(await you.mergeInfo(pr.id)).toMatchObject({
      canEnableAutoMerge: true,
      canDisableAutoMerge: false,
      autoMerge: null,
    });
  });

  test("cancelling auto-merge prevents an already scheduled merge", async () => {
    const world = generateScenario({ preset: "sandbox", clock: "manual" });
    const you = createFakePorts(world).get("binbandit")!;
    const pr = world.prByNumber("WastedHippie/sandbox-api", 6)!;
    const head = world.head(pr);
    await you.setAutoMerge(pr.id, "SQUASH", head);
    await you.approve(pr.id, head);
    await you.setAutoMerge(pr.id, null, head);
    world.advance(world.options.automergeDelayMs);
    expect(pr.state).toBe("OPEN");
    expect(pr.autoMerge).toBeNull();
  });

  test("a queue takes PRs in turn, and jumping puts one at the front", async () => {
    const { world, pr, you } = setup();
    pr.repo.mergeQueue = true;
    const other = [...world.prs.values()].find(
      (p) => p !== pr && p.repo === pr.repo && p.state === "OPEN",
    )!;
    await you.enqueue(other.id, world.head(other), false);
    await you.enqueue(pr.id, world.head(pr), true);
    expect([pr.queuePosition, other.queuePosition]).toEqual([1, 2]);
    await you.dequeue(pr.id);
    expect([pr.queuePosition, other.queuePosition]).toEqual([null, 1]);
  });

  test("only an admin merging directly goes past the rules", async () => {
    const { world, pr, you, owner } = setup();
    const head = world.head(pr);
    // Nobody has approved it, so the rules block a normal merge.
    expect(
      await refused(you.merge(pr.repo.fullName, pr.number, { sha: head, method: "MERGE" })),
    ).toBe(true);
    expect(
      await refused(
        you.merge(pr.repo.fullName, pr.number, {
          sha: head,
          method: "MERGE",
          action: "direct_merge",
        }),
      ),
    ).toBe(true);
    const result = await owner.merge(pr.repo.fullName, pr.number, {
      sha: head,
      method: "MERGE",
      action: "direct_merge",
    });
    expect(result.status).toBe("pending");
  });

  test("a merged PR's branch can go and come back, and the PR can be reverted", async () => {
    const { world, pr, you } = setup();
    world.merge(pr.id, "binbandit");
    await you.deleteBranch(pr.repo.fullName, pr.headRefName);
    expect((await you.detail(pr.id))?.headBranch.exists).toBe(false);
    await you.restoreBranch(pr.repo.fullName, pr.headRefName, world.head(pr));
    expect((await you.detail(pr.id))?.headBranch.exists).toBe(true);

    const revert = await you.revert(pr.id);
    const opened = world.prByNumber(pr.repo.fullName, revert.number);
    expect(opened?.title).toBe(`Revert "${pr.title}"`);
    expect(opened?.author).toBe("binbandit");
  });
});

describe("stacks", () => {
  test("merging a stacked PR merges the ones below it, not the ones above", async () => {
    const world = generateScenario({ preset: "sandbox", clock: "manual" });
    const owner = createFakePorts(world).get("WastedHippie")!;
    const layer = (title: string) => [...world.prs.values()].find((p) => p.title === title)!;
    const [load, validate, reload] = [
      layer("Load config from TOML files"),
      layer("Validate config against the schema"),
      layer("Reload config when the file changes"),
    ];
    const stack = await owner.stackOf(validate.repo.fullName, validate.number);
    expect(stack?.prs.map((p) => p.number)).toEqual([load.number, validate.number, reload.number]);

    // Each layer needs its approval before the rules let it merge.
    for (const pr of [load, validate])
      world.review(pr.id, "binbandit", { event: "APPROVE", body: "" });
    await owner.merge(validate.repo.fullName, validate.number, {
      sha: world.head(validate),
      method: "MERGE",
    });
    world.advance(60_000);
    expect([load.state, validate.state, reload.state]).toEqual(["MERGED", "MERGED", "OPEN"]);
  });
});
