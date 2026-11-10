import { z } from 'zod';

export type SqlValue =
  string | number | boolean | Date | null | readonly string[];
export type SqlRow = Record<string, unknown>;
export interface SqlExecutor {
  query(sql: string, values?: readonly SqlValue[]): Promise<SqlRow[]>;
}
export interface Database extends SqlExecutor {
  /** SQL work only: an acknowledged deadlock rollback may rerun this callback. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export const rowsSchema = z.array(z.record(z.string(), z.unknown()));
