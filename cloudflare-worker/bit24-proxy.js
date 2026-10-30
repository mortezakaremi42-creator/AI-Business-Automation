/**
 * پروکسی امن و رایگان کلودفلر برای اتصال مستقیم ربات وب/اندروید به صرافی بیت‌۲۴ (بدون نیاز به سرور مجازی یا پیامک)
 * نحوه ساخت ۲ دقیقه‌ای:
 * 1. وارد سایت dash.cloudflare.com شوید (ثبت‌نام رایگان فقط با ایمیل، بدون نیاز به شماره موبایل).
 * 2. از منوی Workers & Pages روی Create Worker بزنید و این کد را جایگزین کد پیش‌فرض کرده و Deploy را بزنید.
 * 3. لینک ساخته‌شده (مثلاً https://bit24-proxy.yourname.workers.dev) را کپی کرده و در بخش «اتصال به بیت‌۲۴ -> آدرس پروکسی» اپ وارد کنید.
 */
export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, X-BIT24-APIKEY',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const incomingUrl = new URL(request.url);

    // قفل امنیتی سخت‌گیرانه: مسدودسازی کامل هرگونه درخواست برداشت وجه
    if (incomingUrl.pathname.toLowerCase().includes('withdraw')) {
      return new Response(
        JSON.stringify({
          success: false,
          status_code: 403,
          error: { message: 'Security Policy: Withdrawal via API is permanently blocked.' },
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetUrl = `https://rest.bit24.cash${incomingUrl.pathname}${incomingUrl.search}`;
    const forwardHeaders = new Headers();
    forwardHeaders.set('Accept', 'application/json');

    const apiKey = request.headers.get('X-BIT24-APIKEY');
    if (apiKey) {
      forwardHeaders.set('X-BIT24-APIKEY', apiKey);
    }
    const contentType = request.headers.get('Content-Type');
    if (contentType) {
      forwardHeaders.set('Content-Type', contentType);
    }

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    const bodyText = await upstreamRes.text();
    return new Response(bodyText, {
      status: upstreamRes.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  },
};
