'use client';
import {useState} from 'react';
export default function SharePropertyButton({title,url,location}) {
 const [message,setMessage]=useState('');
 async function share(){
  const data={title:title+' | G-BEST Luxury Realty',text:'Explore '+title+(location?' in '+location:'')+' with G-BEST Luxury Realty.',url};
  try{
   if(navigator.share){await navigator.share(data);setMessage('Ready to share.');}
   else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);setMessage('Link copied.');}
   else{window.prompt('Copy this property link',url);}
  }catch(error){if(error?.name!=='AbortError')setMessage('Sharing is unavailable. Please copy the page address.');}
 }
 return <div className="share-wrap"><button type="button" onClick={share} aria-label="Share this property">↗ SHARE PROPERTY</button>{message&&<small role="status">{message}</small>}</div>;
}