const CACHE='meme-web-v2';
const BASE=new URL('./',self.location.href);
const ASSETS=['./','index.html','style.css','app.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','icon-maskable.png'].map(file=>new URL(file,BASE).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('meme-web-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE.pathname))return;if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('index.html',BASE).href)));return;}if(ASSETS.includes(url.href))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
