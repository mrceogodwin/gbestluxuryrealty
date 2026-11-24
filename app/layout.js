import './globals.css';
import AgentChatWidget from '../components/agent-chat-widget';
import {headers} from 'next/headers';
import {connection} from 'next/server';
import {getDatabasePool} from '../lib/db';
import {resolveSiteTenant} from '../lib/site-tenants';

const FALLBACK={
 siteName:'G-BEST Luxury Realty',
 seoTitle:'G-BEST Luxury Realty | Nigerian Property, Made Clear',
 seoDescription:'Discover homes, luxury properties and investment opportunities across Nigeria. Explore Lagos, Abuja, Benin City and more, then request a physical property inspection.',
 seoImage:''
};
export async function generateMetadata(){
 // Tenant-specific metadata depends on the incoming host. Opt into request-time
 // rendering before reading headers so Next.js does not attempt static metadata
 // generation and swallow its dynamic-server bailout inside the fallback catch.
 await connection();
 let brand={...FALLBACK};
 let base=process.env.SITE_URL||'https://gbestluxuryrealty.vercel.app';
 try{
  const h=await headers();
  const host=h.get('x-forwarded-host')||h.get('host')||'';
  const protocol=(h.get('x-forwarded-proto')||'https').split(',')[0].trim();
  if(host)base=protocol+'://'+host;
  if(process.env.DATABASE_URL){
   const tenant=await resolveSiteTenant(getDatabasePool(),host);
   if(tenant){
    brand={...brand,...(tenant.brand_config||{})};
    const result=await getDatabasePool().query('SELECT published_content FROM public.homepage_tenant_sections WHERE tenant_id=$1 AND section_key=$2 LIMIT 1',[tenant.id,'site_settings']);
    brand={...brand,...(result.rows[0]?.published_content||{})};
    brand.siteName=brand.siteName||tenant.display_name;
   }
  }
 }catch(e){console.error('Tenant metadata lookup failed',e.code||e.message)}
 const name=brand.siteName||FALLBACK.siteName;
 const title=brand.seoTitle||name+' | Nigerian Property, Made Clear';
 const description=brand.seoDescription||FALLBACK.seoDescription;
 const image=brand.seoImage||brand.logoUrl||'';
 const metadataBase=new URL(base);
 return {
  metadataBase,
  title:{default:title,template:'%s | '+name},
  description,
  applicationName:name,
  keywords:['Nigerian real estate','property in Nigeria','homes','property investment',name],
  ...(brand.faviconUrl?{icons:{icon:brand.faviconUrl}}:{}),
  openGraph:{type:'website',locale:'en_NG',siteName:name,title,description,...(image?{images:[image]}:{})},
  twitter:{card:'summary_large_image',title,description,...(image?{images:[image]}:{})},
  robots:{index:true,follow:true}
 };
}
export const viewport={width:'device-width',initialScale:1};
export default function RootLayout({children}){return <html lang="en-NG"><body>{children}<AgentChatWidget/></body></html>}
