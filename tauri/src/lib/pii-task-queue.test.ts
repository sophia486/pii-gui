import { describe, expect, it } from "vitest";

import {
  activeTaskCount,
  completePiiTask,
  createPiiTask,
  failPiiTask,
  paginateTaskHistory,
  startNextQueuedTask,
} from "./pii-task-queue";

function task(id: string, queuedAt: number) {
  return createPiiTask({
    id,
    tabId: `tab-${id}`,
    tabTitle: `Tab ${id}`,
    backend: "regex",
    input: `Contact person-${id}@example.com at +1 (123) 456-78${id.padStart(
      2,
      "0",
    )}.`,
    now: queuedAt,
  });
}

describe("pii task queue", () => {
  it("starts only the oldest queued task when no task is running", () => {
    const tasks = [task("1", 100), task("2", 200)];
    const started = startNextQueuedTask(tasks, 250);

    expect(started[0].status).toBe("running");
    expect(started[0].startedAt).toBe(250);
    expect(started[1].status).toBe("queued");
  });

  it("does not start another task while one is running", () => {
    const [first, second] = startNextQueuedTask(
      [task("1", 100), task("2", 200)],
      250,
    );
    const next = startNextQueuedTask([first, second], 300);

    expect(next.filter((item) => item.status === "running")).toHaveLength(1);
    expect(next[1].status).toBe("queued");
  });

  it("records completion metadata and active count", () => {
    const started = startNextQueuedTask([task("1", 100), task("2", 200)], 250);
    const completed = completePiiTask({
      tasks: started,
      taskId: "1",
      matchCount: 2,
      categorySummary: [
        { kind: "private_email", count: 1 },
        { kind: "private_phone", count: 1 },
      ],
      resultPath: "tabs/tab-1/results/2026-01-01T00-00-00-000Z.json",
      now: 400,
    });

    expect(completed[0].status).toBe("completed");
    expect(completed[0].matchCount).toBe(2);
    expect(completed[0].categorySummary).toEqual([
      { kind: "private_email", count: 1 },
      { kind: "private_phone", count: 1 },
    ]);
    expect(completed[0].resultPath).toBe(
      "tabs/tab-1/results/2026-01-01T00-00-00-000Z.json",
    );
    expect(completed[0].durationMs).toBe(150);
    expect(activeTaskCount(completed)).toBe(1);
  });

  it("preserves chunk scheduling metadata", () => {
    const queued = createPiiTask({
      id: "chunk-1",
      tabId: "tab-1",
      tabTitle: "Long document",
      backend: "onnx",
      input: "chunk text",
      chunk: {
        start: 1000,
        end: 2000,
        index: 1,
        total: 4,
      },
      now: 100,
    });

    expect(queued.input).toBe("chunk text");
    expect(queued.inputLength).toBe(10);
    expect(queued.chunk).toEqual({
      start: 1000,
      end: 2000,
      index: 1,
      total: 4,
    });
  });

  it("records failure metadata", () => {
    const started = startNextQueuedTask([task("1", 100)], 250);
    const failed = failPiiTask({
      tasks: started,
      taskId: "1",
      error: "model unavailable",
      now: 275,
    });

    expect(failed[0].status).toBe("failed");
    expect(failed[0].error).toBe("model unavailable");
    expect(failed[0].durationMs).toBe(25);
  });

  it("paginates history in reverse queue order", () => {
    const page = paginateTaskHistory(
      [task("1", 100), task("2", 200), task("3", 300)],
      1,
      2,
    );
    const secondPage = paginateTaskHistory(
      [task("1", 100), task("2", 200), task("3", 300)],
      2,
      2,
    );

    expect(page.items.map((item) => item.id)).toEqual(["3", "2"]);
    expect(page.totalPages).toBe(2);
    expect(secondPage.items.map((item) => item.id)).toEqual(["1"]);
  });
});
