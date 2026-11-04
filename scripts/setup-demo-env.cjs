const fs=require('node:fs');
const crypto=require('node:crypto');
if(!fs.existsSync('.env')){
  fs.writeFileSync('.env',fs.readFileSync('.env.example','utf8').replace(/^DASHBOARD_API_TOKEN=$/m,'DASHBOARD_API_TOKEN='+crypto.randomBytes(32).toString('hex')),{flag:'wx',mode:0o600});
  console.log('Created .env. Read DASHBOARD_API_TOKEN locally; never share it.');
}else console.log('.env already exists; no settings were overwritten. Set DASHBOARD_API_TOKEN locally if needed.');
