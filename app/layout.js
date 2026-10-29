import './globals.css';
export const metadata={
 metadataBase:new URL(process.env.SITE_URL||'https://gbestluxuryrealty.vercel.app'),
 title:{default:'G-BEST Luxury Realty | Nigerian Property, Made Clear',template:'%s | G-BEST Luxury Realty'},
 description:'Discover homes, luxury properties and investment opportunities across Nigeria. Explore Lagos, Abuja, Benin City and more, then request a physical property inspection with G-BEST Luxury Realty.',
 applicationName:'G-BEST Luxury Realty',
 keywords:['Nigerian real estate','property in Nigeria','Lagos homes','Abuja property','Benin City real estate','property inspection Nigeria','G-BEST Luxury Realty'],
 openGraph:{type:'website',locale:'en_NG',siteName:'G-BEST Luxury Realty',title:'G-BEST Luxury Realty | Nigerian Property, Made Clear',description:'Explore Nigerian homes and property opportunities. Find a place, understand the details and request an inspection.'},
 twitter:{card:'summary_large_image',title:'G-BEST Luxury Realty | Nigerian Property, Made Clear',description:'Explore Nigerian homes and property opportunities with G-BEST Luxury Realty.'},
 robots:{index:true,follow:true}
};
export default function RootLayout({children}){return <html lang="en-NG"><body>{children}</body></html>}
