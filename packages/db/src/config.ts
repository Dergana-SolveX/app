export type DatabaseConfig = {
  /** Direct connection (migrations). */
  DATABASE_URL: string;
  /** Pooled connection (runtime queries). Falls back to DATABASE_URL. */
  DATABASE_URL_POOLED?: string;
};
