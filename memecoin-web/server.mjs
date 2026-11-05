import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['index.html','style.css','app.js','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','icon-maskable.png']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://server').pathname;const file=pathname==='/'?'index.html':pathname.slice(1);if(!['GET','HEAD'].includes(req.method)||!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}const content=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",...(file==='sw.js'?{'Service-Worker-Allowed':'/'}:{})});res.end(req.method==='HEAD'?undefined:content);}catch{res.writeHead(500);res.end('Unavailable');}}).listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('Memecoin web app ready on port '+(process.env.PORT||4173)));
