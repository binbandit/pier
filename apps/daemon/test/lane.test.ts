import { describe, expect, test } from "bun:test";

import { Lane } from "@/github/lane";

describe("lane", () => {
  test("interactive work runs while background work holds every slot it may use", async () => {
    const lane = new Lane(2, 1);
    const slow = Promise.withResolvers<void>();
    const order: string[] = [];
    const background = [
      lane.run("background", async () => {
        await slow.promise;
        order.push("bg1");
      }),
      lane.run("background", async () => void order.push("bg2")),
    ];
    await lane.run("interactive", async () => void order.push("click"));
    expect(order).toEqual(["click"]);
    slow.resolve();
    await Promise.all(background);
    expect(order).toEqual(["click", "bg1", "bg2"]);
  });

  test("a freed slot goes to waiting interactive work before older background work", async () => {
    const lane = new Lane(1, 0);
    const first = Promise.withResolvers<void>();
    const order: string[] = [];
    const running = lane.run("background", () => first.promise);
    const queued = [
      lane.run("background", async () => void order.push("bg")),
      lane.run("interactive", async () => void order.push("click")),
    ];
    first.resolve();
    await Promise.all([running, ...queued]);
    expect(order).toEqual(["click", "bg"]);
  });
});
