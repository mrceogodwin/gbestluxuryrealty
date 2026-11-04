import { getDatabasePool } from './db';
import { HOMEPAGE_DEFAULTS } from './homepage-content';

let homepageReady;

export async function ensureHomepageTables() {
  if (homepageReady) return homepageReady;

  homepageReady = (async () => {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE IF NOT EXISTS public.homepage_sections (section_key text PRIMARY KEY,label text NOT NULL,sort_order integer NOT NULL DEFAULT 0,draft_content jsonb NOT NULL DEFAULT \'{}\'::jsonb,published_content jsonb NOT NULL DEFAULT \'{}\'::jsonb,updated_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz)');
      await client.query('CREATE TABLE IF NOT EXISTS public.homepage_section_revisions (id bigserial PRIMARY KEY,section_key text NOT NULL,content jsonb NOT NULL,action text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())');
      const seed = HOMEPAGE_DEFAULTS.map(item => ({
        key: item.key,
        label: item.label,
        sort_order: item.sort,
        content: { ...item.content, visible: true }
      }));
      await client.query('INSERT INTO public.homepage_sections (section_key,label,sort_order,draft_content,published_content) SELECT x.key,x.label,x.sort_order,x.content,x.content FROM jsonb_to_recordset($1::jsonb) AS x(key text,label text,sort_order integer,content jsonb) ON CONFLICT(section_key) DO NOTHING', [JSON.stringify(seed)]);
      await client.query('COMMIT');
      return pool;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    return await homepageReady;
  } catch (error) {
    homepageReady = undefined;
    throw error;
  }
}