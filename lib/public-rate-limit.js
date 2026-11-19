import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {getDatabasePool} from './db';

function requestIp(req){
 const raw=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-real-ip')||'';
 let candidate=raw.split(',')[0]?.trim()||'';
 if(candidate.startsWith('[')&&candidate.endsWith(']'))candidate=candidate.slice(1,-1);
 return isIP(candidate)?candidate:'unknown';
}
function digest(value){
 const secret=process.env.ADMIN_SECRET||process.env.DATABASE_URL;
 if(!secret)throw new Error('Rate limiting secret is not configured.');
 return createHmac('sha256',secret).update(value).digest('hex');
}
export async function enforcePublicRateLimit(req,{scope,limit,windowMinutes=15,identity}){
 const pool=getDatabasePool();
 await pool.query("CREATE TABLE IF NOT EXISTS public.public_api_rate_limits(scope varchar(60) NOT NULL,key_hash char(64) NOT NULL,window_started_at timestamptz NOT NULL,request_count integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key_hash))");
 const keys=[digest(scope+':ip:'+requestIp(req))];
 if(identity)keys.push(digest(scope+':identity:'+String(identity).trim().toLowerCase()));
 for(const key of keys){
  const q=await pool.query("INSERT INTO public.public_api_rate_limits(scope,key_hash,window_started_at,request_count,blocked_until,updated_at) VALUES($1,$2,now(),1,NULL,now()) ON CONFLICT(scope,key_hash) DO UPDATE SET request_count=CASE WHEN public.public_api_rate_limits.window_started_at<now()-($3 * interval '1 minute') THEN 1 ELSE public.public_api_rate_limits.request_count+1 END,window_started_at=CASE WHEN public.public_api_rate_limits.window_started_at<now()-($3 * interval '1 minute') THEN now() ELSE public.public_api_rate_limits.window_started_at END,blocked_until=CASE WHEN (CASE WHEN public.public_api_rate_limits.window_started_at<now()-($3 * interval '1 minute') THEN 1 ELSE public.public_api_rate_limits.request_count+1 END)>$4 THEN now()+($3 * interval '1 minute') ELSE public.public_api_rate_limits.blocked_until END,updated_at=now() RETURNING request_count,blocked_until",[scope,key,windowMinutes,limit]);
  if(q.rows[0]?.blocked_until&&new Date(q.rows[0].blocked_until).getTime()>Date.now())return {allowed:false};
 }
 return {allowed:true};
}