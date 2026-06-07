import type { PiiCustomRule, PiiIndexFormat } from "./redaction-policy";
import type { PiiTextChunk } from "./pii-text-chunks";

export type PiiBackend = "regex" | "onnx" | "bardsai";

export type PiiTaskStatus = "queued" | "running" | "completed" | "failed";

export type PiiTaskChunk = PiiTextChunk & {
  index: number;
  total: number;
};

export type PiiTaskCategorySummary = {
  kind: string;
  count: number;
};

export type PiiTaskRecord = {
  id: string;
  tabId: string;
  tabTitle: string;
  backend: PiiBackend;
  customRules: PiiCustomRule[];
  indexFormat: PiiIndexFormat;
  input: string;
  inputLength: number;
  inputPreview: string;
  chunk?: PiiTaskChunk;
  status: PiiTaskStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  matchCount?: number;
  categorySummary?: PiiTaskCategorySummary[];
  resultPath?: string;
  error?: string;
};

export type PiiTaskPage = {
  items: PiiTaskRecord[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
};

const previewLimit = 120;

export function createPiiTask({
  id,
  tabId,
  tabTitle,
  backend,
  customRules = [],
  indexFormat = "none",
  input,
  chunk,
  now = Date.now(),
}: {
  id: string;
  tabId: string;
  tabTitle: string;
  backend: PiiBackend;
  customRules?: PiiCustomRule[];
  indexFormat?: PiiIndexFormat;
  input: string;
  chunk?: PiiTaskChunk;
  now?: number;
}): PiiTaskRecord {
  return {
    id,
    tabId,
    tabTitle,
    backend,
    customRules,
    indexFormat,
    input,
    inputLength: input.length,
    inputPreview: previewInput(input),
    chunk,
    status: "queued",
    queuedAt: now,
  };
}

export function startNextQueuedTask(
  tasks: PiiTaskRecord[],
  now = Date.now(),
) {
  if (tasks.some((task) => task.status === "running")) return tasks;

  const nextTask = tasks.find((task) => task.status === "queued");
  if (!nextTask) return tasks;

  return tasks.map((task) =>
    task.id === nextTask.id
      ? {
          ...task,
          status: "running" as const,
          startedAt: now,
        }
      : task,
  );
}

export function completePiiTask({
  tasks,
  taskId,
  matchCount,
  categorySummary,
  resultPath,
  now = Date.now(),
}: {
  tasks: PiiTaskRecord[];
  taskId: string;
  matchCount: number;
  categorySummary?: PiiTaskCategorySummary[];
  resultPath?: string;
  now?: number;
}) {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;

    return {
      ...task,
      status: "completed" as const,
      completedAt: now,
      durationMs: durationMs(task.startedAt, now),
      matchCount,
      categorySummary,
      resultPath,
      error: undefined,
    };
  });
}

export function failPiiTask({
  tasks,
  taskId,
  error,
  now = Date.now(),
}: {
  tasks: PiiTaskRecord[];
  taskId: string;
  error: string;
  now?: number;
}) {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;

    return {
      ...task,
      status: "failed" as const,
      completedAt: now,
      durationMs: durationMs(task.startedAt, now),
      error,
    };
  });
}

export function activeTaskCount(tasks: PiiTaskRecord[]) {
  return tasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  ).length;
}

export function taskHistory(tasks: PiiTaskRecord[]) {
  return [...tasks].sort((a, b) => b.queuedAt - a.queuedAt);
}

export function paginateTaskHistory(
  tasks: PiiTaskRecord[],
  page: number,
  pageSize: number,
): PiiTaskPage {
  const history = taskHistory(tasks);
  const totalItems = history.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (clampedPage - 1) * pageSize;

  return {
    items: history.slice(startIndex, startIndex + pageSize),
    page: clampedPage,
    pageSize,
    totalPages,
    totalItems,
  };
}

function previewInput(input: string) {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= previewLimit) return normalized;

  return `${normalized.slice(0, previewLimit - 1)}...`;
}

function durationMs(startedAt: number | undefined, completedAt: number) {
  if (startedAt === undefined) return undefined;

  return Math.max(0, completedAt - startedAt);
}
