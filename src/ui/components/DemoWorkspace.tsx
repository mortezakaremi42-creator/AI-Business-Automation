import React, { useState } from "react";
import type { AppStatusSnapshot } from "../../shared/contracts.js";
import { formatIrt } from "../i18n.js";
export function DemoWorkspace({
  snapshot: s,
  onAdjust,
  busy,
}: {
  snapshot: AppStatusSnapshot;
  onAdjust: (amount: number) => unknown;
  busy: boolean;
}) {
  const [symbol, setSymbol] = useState("BTC/IRT"),
    [amount, setAmount] = useState("1000000");
  const sig =
    s.topOpportunities.find((x) => x.symbol === symbol) ??
    s.topOpportunities[0];
  const bars = s.demo.chartSeries[sig?.symbol ?? ""] ?? [];
  const values = bars.map((b) => b.c),
    low = Math.min(...values),
    high = Math.max(...values);
  const points = values
    .map(
      (v, i) =>
        `${20 + (i * 600) / Math.max(1, values.length - 1)},${160 - ((v - low) * 130) / Math.max(high - low, high * 0.000001)}`,
    )
    .join(" ");
  return (
    <>
      <section className="section-card" aria-label="موجودی کاغذی">
        <h2 className="section-title">کیف پول آزمایشی — بدون پول واقعی</h2>
        <div className="mini-stats">
          <div>
            وجه نقد کریپتو
            <strong>{formatIrt(s.demoAvailableCashIrt, "fa")}</strong>
          </div>
          <div>
            ارزش خالص کریپتو پس از هزینهٔ خروج
            <strong>{formatIrt(s.demoBalanceIrt, "fa")}</strong>
          </div>
          <div>
            وجه نقد مجزای طلا
            <strong>{formatIrt(s.demo.goldCashIrt, "fa")}</strong>
          </div>
        </div>
        <form
          className="cash-form"
          onSubmit={(e) => {
            e.preventDefault();
            onAdjust(Number(amount));
          }}
        >
          <label>
            اصلاح موجودی کریپتو (تومان؛ منفی برای کاهش)
            <input
              aria-label="اصلاح موجودی کاغذی"
              dir="ltr"
              type="number"
              required
              step="1"
              min="-1000000000"
              max="1000000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button
            className="cmd-btn"
            disabled={
              busy ||
              !Number.isSafeInteger(Number(amount)) ||
              Number(amount) === 0
            }
          >
            ثبت اصلاح موجودی
          </button>
        </form>
        <p>
          اصلاح موجودی، سود و زیان نیست و توقف روزانه را رفع نمی‌کند. حساب و
          سفارش‌ها روی سرور ذخیره می‌شوند؛ پاک‌شدن حافظهٔ مرورگر، حساب سرور را
          حذف نمی‌کند.
        </p>
      </section>
      <section className="section-card" aria-label="نمودار و تحلیل فرضی">
        <h2 className="section-title">
          نمودار و تحلیل بازار{" "}
          <span className="badge badge-gold">اطلاعات فرضی</span>
        </h2>
        <label className="symbol-select">
          نماد نمایشی{" "}
          <select
            aria-label="نماد نمودار"
            value={sig?.symbol ?? symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {s.topOpportunities.map((x) => (
              <option key={x.symbol}>{x.symbol}</option>
            ))}
          </select>
        </label>
        {values.length > 1 && (
          <svg
            className="price-chart"
            viewBox="0 0 640 190"
            role="img"
            aria-label={"نمودار قیمت فرضی " + sig?.symbol}
          >
            <title>اطلاعات فرضی؛ قیمت زنده نیست</title>
            <path d="M20 170 H620" stroke="#37516b" />
            <polyline
              points={points}
              fill="none"
              stroke="#34d399"
              strokeWidth="3"
            />
            <text x="20" y="185" fill="#9db4c8" fontSize="11">
              DEMO / SIMULATED
            </text>
          </svg>
        )}
        {sig && (
          <>
            <div className="analysis-grid">
              <div>
                حمایت فرضی
                <strong>{formatIrt(sig.indicators.supportLevel, "fa")}</strong>
              </div>
              <div>
                مقاومت فرضی
                <strong>
                  {formatIrt(sig.indicators.resistanceLevel, "fa")}
                </strong>
              </div>
              <div>
                نقدینگی فرضی ۲۴ساعته
                <strong>{formatIrt(sig.volume24hIrt, "fa")}</strong>
              </div>
              <div>
                روند فرضی
                <strong>
                  {sig.indicators.ema20 >= sig.indicators.ema50
                    ? "صعودی"
                    : "نزولی"}
                </strong>
              </div>
              <div>
                نقطهٔ ورود فرضی<strong>{formatIrt(sig.priceIrt, "fa")}</strong>
              </div>
              <div>
                حد ضرر ورودی جدید
                <strong>
                  {formatIrt(
                    sig.priceIrt * (1 - s.exitConfig.initialStopLossPct / 100),
                    "fa",
                  )}
                </strong>
              </div>
              <div>
                حد سود اول ورودی جدید
                <strong>
                  {formatIrt(
                    sig.priceIrt * (1 + s.exitConfig.tpStage1ProfitPct / 100),
                    "fa",
                  )}
                </strong>
              </div>
            </div>
            <p>
              سناریوی خرید فرضی:{" "}
              {sig.entryStyle === "NO_ENTRY"
                ? "عدم ورود؛ شرط‌های تحلیل فرضی تکمیل نیست."
                : sig.entryStyle === "BREAKOUT"
                  ? "عبور فرضی از مقاومت؛ فقط پس از بررسی ریسک و تأیید دستی."
                  : "بازگشت فرضی به حمایت؛ فقط پس از بررسی ریسک و تأیید دستی."}
            </p>
            <p>
              سناریوی فروش فرضی: شکست حد ضرر، حد سود پله‌ای یا فروش دستی. اجرای
              کاغذی با کارمزد و لغزش؛ قیمت خروج تضمین‌شده نیست.
            </p>
            <ul className="reason-list">
              {sig.reasonsFa.map((r, i) => (
                <li key={i}>دلیل سیگنال فرضی: {r}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="section-card" aria-label="مدیریت ضرر روزانه">
        <h2 className="section-title">محافظ روزانهٔ مشترک کریپتو و طلا</h2>
        <p>
          روز حسابداری: <b dir="ltr">{s.demo.daily.day} UTC</b> • سود/زیان خالص
          روز:{" "}
          <b>
            {formatIrt(s.demo.daily.pnlIrt, "fa")} (
            {s.demo.daily.pnlPct.toFixed(2)}٪)
          </b>
        </p>
        <p>
          مبنای ابتدای روز: {formatIrt(s.demo.daily.baseline, "fa")} • سقف ضرر:{" "}
          {s.capitalConfig.maxDailyLossPct}٪ • وضعیت:{" "}
          <strong className={s.demo.daily.halted ? "text-neg" : "text-pos"}>
            {s.demo.daily.halted ? "متوقف تا روز UTC بعدی" : "فعال"}
          </strong>
        </p>
        <p>
          این محافظ هر دو حساب آزمایشی را پوشش می‌دهد؛ اصلاح موجودی سود محسوب
          نمی‌شود. سقف مشترک پوزیشن‌ها: {s.capitalSecurity.openTradesCount}/
          {s.capitalConfig.maxConcurrentTrades}. تنظیمات حد سود و ضرر جدید فقط
          برای ورودی‌های بعدی‌اند.
        </p>
      </section>
      <section className="section-card" aria-label="سفارش‌های کاغذی">
        <h2 className="section-title">
          دفتر سفارش‌های کاغذی{" "}
          <span className="badge">
            {s.demo.paperOrders.length} سفارش ذخیره‌شده
          </span>
        </h2>
        {!s.demo.paperOrders.length ? (
          <p>هنوز سفارشی ثبت نشده است.</p>
        ) : (
          <div className="table-scroll">
            <table className="pro-table">
              <thead>
                <tr>
                  <th>نماد</th>
                  <th>نوع</th>
                  <th>قیمت فرضی</th>
                  <th>حجم</th>
                  <th>کارمزد فرضی</th>
                  <th>زمان</th>
                </tr>
              </thead>
              <tbody>
                {s.demo.paperOrders
                  .slice(-100)
                  .reverse()
                  .map((o) => (
                    <tr key={o.id}>
                      <td>{o.symbol}</td>
                      <td>{o.side === "BUY" ? "خرید" : "فروش"}</td>
                      <td>{formatIrt(o.priceIrt, "fa")}</td>
                      <td>{o.quantity.toPrecision(7)}</td>
                      <td>{formatIrt(o.feeIrt, "fa")}</td>
                      <td>{new Date(o.at).toLocaleString("fa-IR")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          آخرین ۱۰۰ سفارش نمایش داده می‌شود؛ دفتر کامل روی دیسک سرور باقی
          می‌ماند.
        </p>
      </section>
    </>
  );
}
