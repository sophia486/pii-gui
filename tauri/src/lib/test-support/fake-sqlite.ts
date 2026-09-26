/**
 * Minimal in-memory stand-in for the SQLite handle used by app persistence, so
 * save and restore can be tested without a Tauri runtime.
 */
type Row = Record<string, unknown>;

export type FakeDatabase = ReturnType<typeof createFakeDatabase>;

export function createFakeDatabase() {
  const tables = new Map<string, Row[]>();
  const statements: string[] = [];

  function rows(table: string) {
    const existing = tables.get(table);
    if (existing) return existing;

    const created: Row[] = [];
    tables.set(table, created);
    return created;
  }

  function insert(table: string, columns: string[], params: unknown[]) {
    const row: Row = {};
    columns.forEach((column, index) => {
      row[column] = params[index];
    });

    const target = rows(table);
    const at = target.findIndex((candidate) => candidate.id === row.id);
    if (at === -1) target.push(row);
    else target[at] = row;
  }

  async function execute(sql: string, params: unknown[] = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    statements.push(statement);

    const inserted = statement.match(
      /^INSERT(?: OR REPLACE)? INTO (\w+) \(([^)]+)\) VALUES/i,
    );
    if (inserted) {
      insert(
        inserted[1],
        inserted[2].split(",").map((column) => column.trim()),
        params,
      );
      return;
    }

    const deleted = statement.match(/^DELETE FROM (\w+)(?: WHERE id NOT IN)?/i);
    if (deleted) {
      const keep = statement.includes("WHERE id NOT IN")
        ? new Set(params.map(String))
        : undefined;
      tables.set(
        deleted[1],
        rows(deleted[1]).filter((row) => !keep || keep.has(String(row.id))),
      );
    }
  }

  async function select<T>(sql: string): Promise<T> {
    const statement = sql.replace(/\s+/g, " ").trim();
    statements.push(statement);

    const from = statement.match(/FROM (\w+)/i);
    if (!from) return [] as unknown as T;

    let result = [...rows(from[1])];
    const closed = statement.match(/is_closed = (\d+)/i);
    if (closed) {
      result = result.filter(
        (row) => Number(row.is_closed) === Number(closed[1]),
      );
    }
    if (/ORDER BY sort_order ASC/i.test(statement)) {
      result.sort(
        (left, right) =>
          Number(left.sort_order) - Number(right.sort_order) ||
          Number(left.updated_at) - Number(right.updated_at),
      );
    }
    if (/ORDER BY queued_at DESC/i.test(statement)) {
      result.sort(
        (left, right) => Number(right.queued_at) - Number(left.queued_at),
      );
    }
    if (/LIMIT 200/i.test(statement)) result = result.slice(0, 200);

    return result as unknown as T;
  }

  return { execute, select, statements, tables };
}
