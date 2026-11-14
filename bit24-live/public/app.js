let language = "fa",
  installPrompt = null,
  loggedIn = false,
  active = false,
  view = null,
  freshnessTimer = null;
const el = (id) => document.getElementById(id);
const tr = (fa, en) => (language === "fa" ? fa : en);
function translate() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
  document.querySelectorAll("[data-fa]").forEach((n) => {
    n.textContent = n.dataset[language];
  });
  render(view);
  if (view?.error) el("message").textContent = explain(view.error);
}
// No HTML interpolation of exchange values. Credentials are never stored in browser storage.
function node(tag, text, className) {
  const n = document.createElement(tag);
  n.textContent = text;
  if (className) n.className = className;
  return n;
}
function amount(value) {
  if (value == null) return "—";
  const [whole, fraction] = value.split(".");
  const digits = new Intl.NumberFormat(
    language === "fa" ? "fa-IR" : "en-US",
  ).format(BigInt(whole));
  return (
    digits +
    (fraction && Number(fraction) > 0 ? "٫" + fraction.slice(0, 2) : "")
  );
}
const errors = {
  API_KEY_REQUIRED: [
    "کلید API روی سرور تنظیم نشده است.",
    "API key is not configured on the server.",
  ],
  EXCHANGE_AUTH_REJECTED: [
    "صرافی احراز هویت را رد کرد؛ کلید، IP مجاز و دسترسی شبکه را بررسی کنید.",
    "Exchange rejected authentication; check key, allowed IP and network access.",
  ],
  RATE_LIMITED: [
    "محدودیت درخواست صرافی؛ تا پایان مهلت صبر کنید.",
    "Exchange rate limit; wait before retrying.",
  ],
  EXCHANGE_TIMEOUT: [
    "پاسخ صرافی در مهلت مقرر دریافت نشد.",
    "Exchange response timed out.",
  ],
  EXCHANGE_SCHEMA_CHANGED: [
    "پاسخ با قرارداد بررسی‌شده مطابقت ندارد؛ اطلاعات نمایش داده نمی‌شود.",
    "Response schema changed; data withheld.",
  ],
  EXCHANGE_NETWORK_ERROR: [
    "ارتباط با صرافی برقرار نشد؛ هیچ سفارشی ارسال نشده است.",
    "Exchange connection failed; no order was submitted.",
  ],
};
function explain(code) {
  const pair = errors[code];
  return pair
    ? pair[language === "fa" ? 0 : 1]
    : tr(
        "دادهٔ معتبر دریافت نشد؛ وضعیت سرور را بررسی کنید.",
        "No valid data received; check the backend.",
      );
}
function render(state) {
  clearTimeout(freshnessTimer);
  const s = state?.snapshot;
  const fresh =
    state?.connection === "AUTHENTICATED_READ" &&
    s &&
    Number.isFinite(s.receivedAt) &&
    Date.now() - s.receivedAt <= 30000;
  el("connection").textContent = fresh
    ? tr("پاسخ احراز هویت‌شده دریافت شد", "Authenticated response received")
    : tr("متصل نیست", "Disconnected");
  el("connection").classList.toggle("online", !!fresh);
  el("balance").textContent = fresh ? amount(s.totals.totalIrt) : "—";
  el("available").textContent = fresh
    ? amount(s.totals.availableValuationIrt)
    : "—";
  el("last-sync").textContent = fresh
    ? tr("آخرین دریافت: ", "Last received: ") +
      new Date(s.receivedAt).toLocaleString(
        language === "fa" ? "fa-IR" : "en-US",
      )
    : tr(
        "همگام‌سازی معتبر در دسترس نیست",
        "No valid synchronization available",
      );
  el("markets").replaceChildren();
  el("orders").replaceChildren();
  el("market-empty").hidden = !!fresh && s.markets.length > 0;
  el("order-empty").hidden = !!fresh && s.orders.length > 0;
  if (fresh) {
    for (const m of s.markets) {
      const card = node("article", "", "market-card"),
        title = node("div", "", "market-title");
      title.append(
        node("strong", m.symbol),
        node("span", m.symbol.split("/")[0].slice(0, 3), "coin"),
      );
      card.append(
        title,
        node(
          "div",
          amount(m.priceIrt) + " " + tr("تومان", "TOMAN"),
          "market-price",
        ),
      );
      const meta = node("div", "", "market-meta");
      meta.append(
        node(
          "bdi",
          m.change24hPct + "%",
          m.change24hPct.startsWith("-") ? "negative" : "positive",
        ),
        node(
          "span",
          tr("حجم ۲۴ساعت: ", "24h volume: ") + amount(m.volume24hIrt),
        ),
      );
      card.append(meta);
      el("markets").append(card);
    }
    for (const o of s.orders) {
      const card = node("article", "", "order-card");
      const statuses =
        language === "fa"
          ? ["در حال انجام", "تکمیل شده", "لغو شده", "تکمیل جزئی"]
          : ["Pending", "Filled", "Cancelled", "Partial"];
      for (const [label, value] of [
        [tr("سفارش حساب", "Account order"), o.symbol + " · #" + o.id],
        [
          tr("سمت / وضعیت", "Side / status"),
          o.side + " · " + statuses[o.status],
        ],
        [tr("مقدار اجراشده", "Filled quantity"), o.filledQuantity],
        [tr("میانگین اجرا", "Average fill"), amount(o.averagePrice)],
      ]) {
        const cell = node("div", "");
        cell.append(node("small", label), node("b", value));
        card.append(cell);
      }
      el("orders").append(card);
    }
    if (!s.orders.length)
      el("order-empty").textContent = tr(
        "صرافی سفارشی در این محدوده برنگرداند.",
        "Exchange returned no orders for this scope.",
      );
    freshnessTimer = setTimeout(
      () => {
        view = null;
        render(null);
        el("message").textContent = tr(
          "داده قدیمی شد؛ همگام‌سازی لازم است.",
          "Data expired; synchronization required.",
        );
      },
      Math.max(1, 30001 - (Date.now() - s.receivedAt)),
    );
  }
}
async function request(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
    redirect: "error",
  });
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.error || "REQUEST_FAILED");
    error.status = r.status;
    throw error;
  }
  return data;
}
function setLogin(on) {
  loggedIn = on;
  el("login").hidden = on;
  el("account").hidden = !on;
}
async function sync() {
  if (active || !loggedIn || document.hidden) return;
  active = true;
  el("refresh").disabled = true;
  try {
    const state = await request("/api/state");
    if (!loggedIn) return;
    view = state;
    render(view);
    el("message").textContent = state.error ? explain(state.error) : "";
  } catch (e) {
    view = null;
    render(null);
    if (e.status === 401) {
      setLogin(false);
      el("message").textContent = tr(
        "ابتدا وارد پنل شوید.",
        "Sign in to continue.",
      );
    } else
      el("message").textContent = tr(
        "سرور در دسترس نیست؛ اعداد قبلی پاک شدند.",
        "Backend unavailable; previous values cleared.",
      );
  } finally {
    active = false;
    el("refresh").disabled = false;
  }
}
el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    await request("/api/login", { password: el("password").value });
    el("password").value = "";
    setLogin(true);
    await sync();
  } catch {
    el("message").textContent = tr(
      "ورود انجام نشد؛ رمز پنل، آدرس سرور یا مهلت محدودیت ورود را بررسی کنید.",
      "Sign-in failed; check password, server origin or login rate limit.",
    );
  } finally {
    el("password").value = "";
    button.disabled = false;
  }
});
el("logout").addEventListener("click", async () => {
  try {
    await request("/api/logout", {});
    setLogin(false);
    view = null;
    render(null);
    el("message").textContent = "";
  } catch {
    el("message").textContent = tr(
      "خروج از سرور تأیید نشد؛ دوباره تلاش کنید.",
      "Server logout not confirmed; retry.",
    );
  }
});
el("refresh").addEventListener("click", sync);
el("language").addEventListener("click", () => {
  language = language === "fa" ? "en" : "fa";
  translate();
});
el("install").addEventListener("click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
  } else
    el("message").textContent = tr(
      "در Chrome منوی سه‌نقطه ← نصب برنامه یا افزودن به صفحهٔ اصلی. روی HTTPS/localhost باز کنید.",
      "Chrome menu → Install app / Add to home screen. Open over HTTPS or localhost.",
    );
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener("offline", () => {
  view = null;
  render(null);
  el("message").textContent = tr(
    "اینترنت قطع است؛ دادهٔ حساب در حالت آفلاین نمایش داده نمی‌شود.",
    "Offline; account values are withheld.",
  );
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    render(view);
    void sync();
  }
});
translate();
setLogin(false);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
// Restore HttpOnly session; never synthesize account data on a disconnected backend.
setLogin(true);
void sync();
setInterval(() => void sync(), 20000);
