import { getDatabasePool } from './db';
import { HOMEPAGE_DEFAULTS } from './homepage-content';
export async function ensureHomepageTables() {
 const pool=getDatabasePool();
 await pool.query('CREATE TABLE IF NOT EXISTS public.homepage_sections (section_key text PRIMARY KEY,label text NOT NULL,sort_order integer NOT NULL DEFAULT 0,draft_content jsonb NOT NULL DEFAULT \'{}\'::jsonb,published_content jsonb NOT NULL DEFAULT \'{}\'::jsonb,updated_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz)');
 await pool.query('CREATE TABLE IF NOT EXISTS public.homepage_section_revisions (id bigserial PRIMARY KEY,section_key text NOT NULL,content jsonb NOT NULL,action text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())');
 for(const item of HOMEPAGE_DEFAULTS) await pool.query('INSERT INTO public.homepage_sections(section_key,label,sort_order,draft_content,published_content) VALUES($1,$2,$3,$4::jsonb,$4::jsonb) ON CONFLICT(section_key) DO NOTHING',[item.key,item.label,item.sort,JSON.stringify({...item.content,visible:true})]);
 return pool;
}