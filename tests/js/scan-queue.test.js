import test from "node:test";
import assert from "node:assert/strict";

import { ScanQueue } from "../../public/js/scan-queue.js";

if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

test("queue is sequential and rejects a second concurrent batch", async () => {
  let active = 0;
  let maxActive = 0;
  const order = [];
  const queue = new ScanQueue({
    scan: async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, 8));
      order.push(`end-${id}`);
      active -= 1;
      return { member_id: id, status: "success" };
    },
  });
  const first = queue.run([{ id: "A", alias: "A" }, { id: "B", alias: "B" }], "batch_test1234");
  const duplicate = await queue.run([{ id: "C", alias: "C" }], "batch_test5678");
  const result = await first;
  assert.equal(duplicate.accepted, false);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["start-A", "end-A", "start-B", "end-B"]);
  assert.equal(result.results.length, 2);
});

test("stop prevents the next request but lets the in-flight request finish", async () => {
  let release;
  const called = [];
  const queue = new ScanQueue({
    scan: (id) => new Promise((resolve) => {
      called.push(id);
      release = () => resolve({ member_id: id, status: "success" });
    }),
  });
  const running = queue.run([{ id: "A", alias: "A" }, { id: "B", alias: "B" }], "batch_stop1234");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.requestStop(), true);
  release();
  const result = await running;
  assert.deepEqual(called, ["A"]);
  assert.equal(result.stopped, true);
  assert.equal(result.skipped, 1);
});

test("a failed request is recorded once and never retried", async () => {
  let calls = 0;
  const queue = new ScanQueue({
    scan: async () => {
      calls += 1;
      throw new Error("mocked timeout");
    },
  });
  const result = await queue.run([{ id: "A", alias: "A" }], "batch_timeout1234");
  assert.equal(calls, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, "unknown");
});

