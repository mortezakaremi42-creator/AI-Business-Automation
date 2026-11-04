import React, { useState } from "react";
export function BackendConnectionPanel(props: {
  base: string;
  connected: boolean;
  error: string;
  uncertain: string | null;
  onSave: (base: string, token: string) => void;
  onReconcile: () => void;
}) {
  const [base, setBase] = useState(props.base),
    [token, setToken] = useState("");
  return (
    <section className="section-card" aria-label="اتصال به سرور">
      <details open={!props.connected}>
        <summary className="section-title">
          {props.connected
            ? "🟢 متصل به سرور آزمایشی — تنظیم اتصال"
            : "🔴 اتصال به بک‌اند لازم است"}
        </summary>
        <p>
          {props.error ||
            "قیمت‌ها و معاملات از سرور می‌آیند؛ موتور روی گوشی اجرا نمی‌شود."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave(base, token);
            setToken("");
          }}
          style={{ display: "grid", gap: 12 }}
        >
          <label>
            آدرس بک‌اند (بدون /api)
            <input
              aria-label="Backend URL"
              dir="ltr"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="http://192.168.1.20:3000"
            />
          </label>
          <label>
            توکن دسترسی پنل، نه کلید صرافی
            <input
              aria-label="Dashboard token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button className="cmd-btn" type="submit">
            ذخیره و اتصال مجدد
          </button>
        </form>
        <p style={{ fontSize: 12, marginTop: 12 }}>
          کامپیوتر و گوشی روی یک شبکه باشند. localhost در گوشی، خود گوشی است؛
          مگر بک‌اند در Termux همان گوشی فعال باشد. برای اینترنت عمومی فقط
          HTTPS. توکن را پس از تغییر آدرس دوباره وارد کنید.
        </p>
      </details>
      {props.uncertain && (
        <p role="alert" className="text-neg">
          نتیجهٔ درخواست {props.uncertain} نامعلوم است؛ خرید و فروش جدید مسدود
          است. بستن صفحه این وضعیت را تطبیق نمی‌دهد؛ بررسی رسید ذخیره‌شدهٔ سرور
          لازم است.{" "}
          <button type="button" className="cmd-btn" onClick={props.onReconcile}>
            بررسی نتیجهٔ درخواست بدون تکرار معامله
          </button>
        </p>
      )}
    </section>
  );
}
