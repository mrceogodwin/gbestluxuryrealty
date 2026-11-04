import { Pool } from 'pg';

const globalForDatabase = globalThis;

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (!globalForDatabase.__gbestPool) {
    globalForDatabase.__gbestPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: true }
    });
  }

  return globalForDatabase.__gbestPool;
}
