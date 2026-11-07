import {createHmac,createHash,randomUUID} from 'node:crypto';
const endpoint=()=>{const value=process.env.NEON_STORAGE_ENDPOINT;if(!value)throw new Error('Neon storage endpoint is not configured.');return new URL(value);};
const enc=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const hex=value=>createHash('sha256').update(value).digest('hex');
function signingKey(secret,date,region){const day=createHmac('sha256','AWS4'+secret).update(date).digest();const d=createHmac('sha256',day).update(region).digest();const s=createHmac('sha256',d).update('s3').digest();return createHmac('sha256',s).update('aws4_request').digest();}
export function objectKey(name){const ext=(name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';return 'uploads/'+new Date().toISOString().slice(0,10)+'/'+randomUUID()+'.'+ext;}
export function publicObjectUrl(key){const base=endpoint();return base.origin+'/'+(process.env.NEON_STORAGE_BUCKET||'property-media')+'/'+key.split('/').map(enc).join('/');}
export async function storageRequest(method,key='',{contentType='',query={}}={}){
 const base=endpoint(),bucket=process.env.NEON_STORAGE_BUCKET||'property-media',access=process.env.NEON_STORAGE_ACCESS_KEY_ID,secret=process.env.NEON_STORAGE_SECRET_ACCESS_KEY,region=process.env.NEON_STORAGE_REGION||'eu-central-1';
 if(!access||!secret)throw new Error('Neon storage credentials are not configured for this deployment.');
 const path='/'+bucket+(key?'/'+key.split('/').map(enc).join('/'):'');
 const url=new URL(path,base.origin);
 const pairs=Object.entries(query).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[enc(k),enc(String(v))]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
 const canonicalQuery=pairs.map(([k,v])=>k+'='+v).join('&');
 const now=new Date(),amz=now.toISOString().replace(/[:-]|\.\d{3}/g,'');const date=amz.slice(0,8),stamp=amz;
 const headers={'host':url.host};if(contentType)headers['content-type']=contentType;
 const names=Object.keys(headers).sort(),canonicalHeaders=names.map(n=>n+':'+headers[n].trim()+'\n').join(''),signed=names.join(';');
 const canonical=[method,url.pathname,canonicalQuery,canonicalHeaders,signed,'UNSIGNED-PAYLOAD'].join('\n');
 const scope=date+'/'+region+'/s3/aws4_request',toSign=['AWS4-HMAC-SHA256',stamp,scope,hex(canonical)].join('\n');
 const signature=createHmac('sha256',signingKey(secret,date,region)).update(toSign).digest('hex');
 const signedUrl=url.toString()+(canonicalQuery?'?'+canonicalQuery+'&':'?')+'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential='+enc(access+'/'+scope)+'&X-Amz-Date='+stamp+'&X-Amz-Expires=120&X-Amz-SignedHeaders='+enc(signed)+'&X-Amz-Signature='+signature;
 return signedUrl;
}
