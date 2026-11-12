import {notFound} from 'next/navigation';
import {getDatabasePool} from '../../../lib/db';
import SharePropertyButton from './SharePropertyButton';
import styles from './page.module.css';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function getProperty(slug){
 if(!process.env.DATABASE_URL)return null;
 try{
  const pool=getDatabasePool();
  const q=await pool.query("SELECT id::text AS id,slug,title,location,state,property_type,price,price_label,beds,bedrooms,baths,bathrooms,size,size_label,image_url,images,description,video_url,status FROM public.properties WHERE (slug=$1 OR id::text=$1) AND status IN ('published','available') LIMIT 1",[String(slug)]);
  return q.rows[0]||null;
 }catch(error){console.error('Public property detail failed',error.code||error.message);return null;}
}
export async function generateMetadata({params}){
 const {slug}=await params;const p=await getProperty(slug);
 if(!p)return {title:'Property unavailable | G-BEST Luxury Realty'};
 const location=[p.location,p.state].filter(Boolean).join(', ');
 return {title:(p.title||'Property listing')+' | G-BEST Luxury Realty',description:String(p.description||'Explore this property with G-BEST Luxury Realty.').slice(0,160),openGraph:{title:p.title,description:p.description||location,images:p.image_url?[p.image_url]:[]}};
}
export default async function PropertyDetailPage({params}){
 const {slug}=await params;const p=await getProperty(slug);if(!p)notFound();
 const images=[...new Set([p.image_url,...(Array.isArray(p.images)?p.images:[])].filter(x=>typeof x==='string'&&x.startsWith('https://')))];
 const location=[p.location,p.state].filter(Boolean).join(', ');
 const price=p.price&&p.price!=='Price on request'?p.price:p.price_label||'Price on request';
 const beds=Number(p.beds||p.bedrooms||0),baths=Number(p.baths||p.bathrooms||0),size=p.size||p.size_label||'To be confirmed';
 const propertyId=/^\d+$/.test(p.id)?'GB-'+p.id.padStart(8,'0'):'GB-'+p.id.replace(/[^a-z0-9]/gi,'').toUpperCase().slice(-8).padStart(8,'0');
 const shareUrl=(process.env.SITE_URL||'https://gbestluxuryrealty.vercel.app')+'/property/'+encodeURIComponent(p.slug||p.id);
 return <main className={styles.page}><header className={styles.header}><a href="/" className={styles.wordmark}>G-BEST <small>LUXURY REALTY · NIGERIA</small></a><a href="/#properties">← ALL PROPERTIES</a></header><div className={styles.content}><p className={styles.eyebrow}>G-BEST / PROPERTY DETAIL</p><div className={styles.heading}><div><span>{p.property_type||'PROPERTY'} · {location}</span><h1>{p.title}</h1></div><strong>{price}</strong></div>{p.video_url?<video className={styles.heroMedia} src={p.video_url} controls playsInline preload="metadata"/>:images.length?<img className={styles.heroMedia} src={images[0]} alt={p.title}/>:<div className={styles.placeholder}>G-BEST / PROPERTY</div>}{images.length>1&&<div className={styles.gallery}>{images.slice(1).map((src,i)=><img src={src} alt={p.title+' gallery '+(i+2)} key={src}/>)}</div>}<section className={styles.facts}><div><b>{size}</b><small>LAND / FLOOR AREA</small></div><div><b>{p.property_type==='Land'?'Land plot':beds+' bedrooms'}</b><small>PROPERTY TYPE / ROOMS</small></div><div><b>{p.property_type==='Land'?'Verify title':baths+' bathrooms'}</b><small>FACILITIES</small></div><div><b>{propertyId}</b><small>PROPERTY ID</small></div></section><section className={styles.description}><h2>ABOUT THIS PROPERTY</h2><p>{p.description||'Contact G-BEST Luxury Realty for further information about this property.'}</p><p>Arrange a physical inspection to verify the property, its condition, location, ownership and title documents before making any payment.</p></section><div className={styles.actions}><SharePropertyButton title={p.title||'Property'} url={shareUrl} location={location}/><a className={styles.inspect} href={'/?property='+encodeURIComponent(p.id)+'#inspection'}>REQUEST PHYSICAL INSPECTION ↗</a></div><p className={styles.disclaimer}>Confirm current availability, title, pricing and all property details with G-BEST before making a transaction.</p></div><footer className={styles.footer}><a href="/" className={styles.wordmark}>G-BEST <small>LUXURY REALTY · NIGERIA</small></a><span>YOUR INVESTMENT, OUR PRIORITY.</span></footer></main>;
}