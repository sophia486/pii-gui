import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

import type { PiiTaskRecord } from "./pii-task-queue";
import type { PdfDocumentData } from "./pdf-document";
import type {
  PiiCustomRule,
  PiiIndexFormat,
  PiiWorkflowMode,
  PiiMatch,
  PiiMatchSelection,
} from "./redaction-policy";

export type PersistedTab = {
  id: string;
  title: string;
  documentKind: "text" | "markdown" | "pdf";
  input: string;
  output: string;
  matches: PiiMatch[];
  matchSelection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
  mode: PiiWorkflowMode;
  restoreInput: string;
  restoreOutput: string;
  pdfDocument?: PdfDocumentData;
};

export type AppPersistenceSnapshot = {
  tabs: PersistedTab[];
  closedTabs: PersistedTab[];
  customRules: PiiCustomRule[];
  piiTasks: PiiTaskRecord[];
};

export type PiiFilterResultPayload = {
  schemaVersion: 1;
  task: {
    id: string;
    tabId: string;
    tabTitle: string;
    backend: string;
    indexFormat: PiiIndexFormat;
    queuedAt: number;
    startedAt?: number;
    completedAt: number;
    durationMs?: number;
    inputLength: number;
    inputPreview: string;
    matchCount: number;
  };
  filteredTexts: Array<{
    id: string;
    kind: string;
    value: string;
    start: number;
    end: number;
    selected: boolean;
    replacement?: string;
  }>;
  redactedText: string;
};

type DatabaseConnection = Awaited<ReturnType<typeof Database.load>>;

type TabRow = {
  id: string;
  title: string;
  document_kind?: string;
  input: string;
  output: string;
  matches_json: string;
  selection_json: string;
  index_format: string;
  mode?: string;
  restore_input?: string;
  restore_output?: string;
  pdf_document_json?: string;
};

type CustomRuleRow = {
  id: string;
  name: string;
  mode: string;
  pattern: string;
};

type PiiResultRow = {
  id: string;
  task_id: string;
  tab_id: string;
  tab_title: string;
  backend: string;
  index_format: string;
  input_length: number;
  input_preview: string;
  status: string;
  queued_at: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
  match_count: number | null;
  category_summary_json?: string | null;
  result_path: string | null;
  error: string | null;
};

type PiiResultFile = {
  relativePath: string;
  targetPath: string;
  bytesWritten: number;
};

const databasePath = "sqlite:pii-gui.db";

let dbPromise: Promise<DatabaseConnection> | undefined;

export function isAppPersistenceAvailable() {
  if (typeof window === "undefined") return false;

  return Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function initAppPersistence({
  seedTabs,
  seedCustomRules,
}: {
  seedTabs: PersistedTab[];
  seedCustomRules: PiiCustomRule[];
}): Promise<AppPersistenceSnapshot | undefined> {
  if (!isAppPersistenceAvailable()) return undefined;

  await ensureSchema();

  let tabs = await loadTabs(false);
  const closedTabs = await loadTabs(true);
  if (tabs.length === 0) {
    tabs = seedTabs;
    await persistTabs(tabs, closedTabs);
  }

  let customRules = await loadCustomRules();
  if (customRules.length === 0) {
    customRules = seedCustomRules;
    await persistCustomRules(customRules);
  }

  return {
    tabs,
    closedTabs,
    customRules,
    piiTasks: await loadPiiTaskHistory(),
  };
}

export async function persistTabs(tabs: PersistedTab[], closedTabs: PersistedTab[] = []) {
  if (!isAppPersistenceAvailable()) return;

  const db = await database();
  const now = Date.now();

  await db.execute("DELETE FROM tabs");

  const tabRows = [
    ...tabs.map((tab, index) => ({ tab, index, isClosed: false })),
    ...closedTabs.map((tab, index) => ({ tab, index, isClosed: true })),
  ];

  for (const { tab, index, isClosed } of tabRows) {
    await db.execute(
      `INSERT INTO tabs (
        id,
        title,
        document_kind,
        input,
        output,
        matches_json,
        selection_json,
        index_format,
        mode,
        restore_input,
        restore_output,
        pdf_document_json,
        is_closed,
        sort_order,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        tab.id,
        tab.title,
        tab.documentKind,
        tab.input,
        tab.output,
        JSON.stringify(tab.matches),
        JSON.stringify(tab.matchSelection),
        tab.indexFormat,
        tab.mode,
        tab.restoreInput,
        tab.restoreOutput,
        tab.pdfDocument ? JSON.stringify(tab.pdfDocument) : "",
        isClosed ? 1 : 0,
        index,
        now,
      ],
    );
  }
}

export async function persistCustomRules(rules: PiiCustomRule[]) {
  if (!isAppPersistenceAvailable()) return;

  const db = await database();
  const now = Date.now();

  await db.execute("DELETE FROM custom_rules");

  for (const rule of rules) {
    await db.execute(
      `INSERT INTO custom_rules (
        id,
        name,
        mode,
        pattern,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [rule.id, rule.name, rule.mode, rule.pattern, now],
    );
  }
}

export async function persistPiiTaskResult(task: PiiTaskRecord) {
  if (!isAppPersistenceAvailable()) return;

  const db = await database();

  await db.execute(
    `INSERT OR REPLACE INTO pii_filter_results (
      id,
      task_id,
      tab_id,
      tab_title,
      backend,
      index_format,
      input_length,
      input_preview,
      status,
      queued_at,
      started_at,
      completed_at,
      duration_ms,
      match_count,
      category_summary_json,
      result_path,
      error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      task.id,
      task.id,
      task.tabId,
      task.tabTitle,
      task.backend,
      task.indexFormat,
      task.inputLength,
      task.inputPreview,
      task.status,
      task.queuedAt,
      task.startedAt ?? null,
      task.completedAt ?? null,
      task.durationMs ?? null,
      task.matchCount ?? null,
      task.categorySummary ? JSON.stringify(task.categorySummary) : null,
      task.resultPath ?? null,
      task.error ?? null,
    ],
  );
}

export async function writePiiFilterResultFile({
  tabId,
  completedAt,
  payload,
}: {
  tabId: string;
  completedAt: number;
  payload: PiiFilterResultPayload;
}) {
  if (!isAppPersistenceAvailable()) return undefined;

  const result = await invoke<PiiResultFile>("write_pii_filter_result", {
    tabId,
    fileName: resultFileName(completedAt),
    contents: JSON.stringify(payload, null, 2),
  });

  return result.relativePath;
}

async function loadTabs(isClosed: boolean): Promise<PersistedTab[]> {
  const db = await database();
  const rows = await db.select<TabRow[]>(
    `SELECT
      id,
      title,
      document_kind,
      input,
      output,
      matches_json,
      selection_json,
      index_format,
      mode,
      restore_input,
      restore_output,
      pdf_document_json
    FROM tabs
    WHERE is_closed = ${isClosed ? 1 : 0}
    ORDER BY sort_order ASC, updated_at ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    documentKind: parseDocumentKind(row.document_kind),
    input: row.input,
    output: row.output,
    matches: parseJson<PiiMatch[]>(row.matches_json, []),
    matchSelection: parseJson<PiiMatchSelection>(row.selection_json, {}),
    indexFormat: parseIndexFormat(row.index_format),
    mode: parseWorkflowMode(row.mode),
    restoreInput: row.restore_input ?? "",
    restoreOutput: row.restore_output ?? "",
    pdfDocument: parseJson<PdfDocumentData | undefined>(
      row.pdf_document_json ?? "",
      undefined,
    ),
  }));
}

async function loadCustomRules() {
  const db = await database();
  const rows = await db.select<CustomRuleRow[]>(
    `SELECT id, name, mode, pattern
    FROM custom_rules
    ORDER BY updated_at ASC, id ASC`,
  );

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      mode: row.mode === "regex" ? ("regex" as const) : ("exact" as const),
      pattern: row.pattern,
    }))
    .filter((rule) => rule.pattern.length > 0);
}

async function loadPiiTaskHistory() {
  const db = await database();
  const rows = await db.select<PiiResultRow[]>(
    `SELECT
      id,
      task_id,
      tab_id,
      tab_title,
      backend,
      index_format,
      input_length,
      input_preview,
      status,
      queued_at,
      started_at,
      completed_at,
      duration_ms,
      match_count,
      category_summary_json,
      result_path,
      error
    FROM pii_filter_results
    ORDER BY queued_at DESC
    LIMIT 200`,
  );

  return rows.map<PiiTaskRecord>((row) => ({
    id: row.task_id || row.id,
    tabId: row.tab_id,
    tabTitle: row.tab_title,
    backend:
      row.backend === "onnx"
        ? "onnx"
        : row.backend === "bardsai"
          ? "bardsai"
          : "regex",
    customRules: [],
    indexFormat: parseIndexFormat(row.index_format),
    input: "",
    inputLength: row.input_length,
    inputPreview: row.input_preview,
    status: row.status === "failed" ? "failed" : "completed",
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    matchCount: row.match_count ?? undefined,
    categorySummary: parseJson(row.category_summary_json ?? "", undefined),
    resultPath: row.result_path ?? undefined,
    error: row.error ?? undefined,
  }));
}

async function ensureSchema() {
  const db = await database();

  await db.execute(
    `CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      document_kind TEXT NOT NULL DEFAULT 'text',
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      matches_json TEXT NOT NULL,
      selection_json TEXT NOT NULL,
      index_format TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'text-to-pii',
      restore_input TEXT NOT NULL DEFAULT '',
      restore_output TEXT NOT NULL DEFAULT '',
      pdf_document_json TEXT NOT NULL DEFAULT '',
      is_closed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  );
  await ensureColumn("tabs", "document_kind", "TEXT NOT NULL DEFAULT 'text'");
  await ensureColumn("tabs", "mode", "TEXT NOT NULL DEFAULT 'text-to-pii'");
  await ensureColumn("tabs", "restore_input", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("tabs", "restore_output", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("tabs", "pdf_document_json", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("tabs", "is_closed", "INTEGER NOT NULL DEFAULT 0");
  await db.execute(
    `CREATE TABLE IF NOT EXISTS custom_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      pattern TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS pii_filter_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      tab_id TEXT NOT NULL,
      tab_title TEXT NOT NULL,
      backend TEXT NOT NULL,
      index_format TEXT NOT NULL,
      input_length INTEGER NOT NULL,
      input_preview TEXT NOT NULL,
      status TEXT NOT NULL,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      duration_ms INTEGER,
      match_count INTEGER,
      category_summary_json TEXT,
      result_path TEXT,
      error TEXT
    )`,
  );
  await ensureColumn("pii_filter_results", "category_summary_json", "TEXT");
}

async function database() {
  dbPromise ??= Database.load(databasePath);
  return dbPromise;
}

async function ensureColumn(table: string, column: string, definition: string) {
  const db = await database();
  const rows = await db.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);

  if (rows.some((row) => row.name === column)) return;

  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function resultFileName(completedAt: number) {
  return `${new Date(completedAt).toISOString().replace(/[:.]/g, "-")}.json`;
}

function parseIndexFormat(value: string): PiiIndexFormat {
  if (value === "number" || value === "id") return value;

  return "none";
}

function parseWorkflowMode(value: string | undefined): PiiWorkflowMode {
  if (value === "pii-to-text") return value;

  return "text-to-pii";
}

function parseDocumentKind(value: string | undefined): PersistedTab["documentKind"] {
  if (value === "markdown" || value === "pdf") return value;

  return "text";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
