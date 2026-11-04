"""Reproducible allowlist packaging: no credentials, runtime accounts, or dependencies."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
name = 'BIT24-DEMO-RELIABLE-v2'
out = root / (name + '.zip')
files = [
    'README.md', 'ANDROID-BACKEND-FA.md', 'DEMO-ARCHITECTURE.md',
    'DEMO-TEST-REPORT-FA.md', 'package.json', 'package-lock.json',
    'index.html', 'capacitor.config.json', 'vite.config.ts', 'vitest.config.ts',
    'tsconfig.json', 'tsconfig.server.json', 'postcss.config.js',
    'tailwind.config.js', '.env.example', '.gitignore',
]
paths = [root / f for f in files]
blocked = {'node_modules', '.git', '.gradle', '.idea', 'build', 'data',
           'capacitor-cordova-android-plugins', '__pycache__'}
for folder in ['src', 'public', 'scripts', 'tests', 'android', 'dist', 'reports']:
    for p in (root / folder).rglob('*'):
        if not p.is_file() or blocked.intersection(p.relative_to(root).parts):
            continue
        if p.name == 'local.properties' or p.suffix in {'.enc', '.apk', '.jks', '.keystore', '.log', '.tmp'}:
            continue
        if p.name.startswith('.env') and p.name != '.env.example':
            continue
        paths.append(p)
manifest = [{'path':str(p.relative_to(root)), 'bytes':p.stat().st_size,
             'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(set(paths))]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(name + '/PACKAGE-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    z.writestr(name + '/START-HERE-FA.txt', '''نسخهٔ کامل آزمایشگاه معاملات کاغذی — فقط Demo

فایل README.md و ANDROID-BACKEND-FA.md را بخوانید.
اجرای خروجی آماده: npm ci --omit=dev سپس node scripts/setup-demo-env.cjs سپس npm start
توکن پنل از فایل خصوصی .env خوانده می‌شود؛ آن را منتشر نکنید.
راهنمای اجرا فقط با گوشی/Termux نیز داخل فایل راهنماست.
تمام قیمت‌ها و تحلیل‌ها اطلاعات فرضی‌اند. هیچ اتصال صرافی یا معاملهٔ واقعی وجود ندارد.
خرید فقط دستی با هشدار است؛ خروج‌های حفاظتی خودکارند.
حساب در data/demo-state-v2.json سرور ذخیره می‌شود و با رفرش از بین نمی‌رود.
اطلاعات حساب کاربران، کلیدها و node_modules در بسته نیستند.
پروژه Android موجود است؛ APK آمادهٔ نصب در این بسته نیست.
گزارش تست و تصاویر در reports و DEMO-TEST-REPORT-FA.md است.
''')
    for p in sorted(set(paths)):
        z.write(p, name + '/' + str(p.relative_to(root)))
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    names = z.namelist()
    assert not any('/node_modules/' in n or '/data/' in n or n.endswith('/.env') for n in names)
    for needed in ['dist/server/server/index.js', 'dist/client/index.html',
                   'android/gradlew', 'android/gradle/wrapper/gradle-wrapper.jar',
                   'src/server/demoStore.ts', 'reports/unit-tests.json']:
        assert name + '/' + needed in names, needed
print(f'{out.name}: {out.stat().st_size} bytes, {len(names)} entries, integrity PASS')
print('SHA256:', hashlib.sha256(out.read_bytes()).hexdigest())
