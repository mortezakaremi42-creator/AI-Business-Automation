import React from "react";
import type { AppLanguage } from "../../shared/contracts.js";
/** Requested mode is never optimistically treated as exchange authorization. */
export function ExecutionModePanel({
  lang,
  busy,
  connected,
  onModeRequest,
}: {
  lang: AppLanguage;
  busy: boolean;
  connected: boolean;
  onModeRequest: (mode: "DEMO" | "LIVE") => unknown;
}) {
  const isFa = lang === "fa";
  return (
    <section className="section-card">
      <h2>
        {isFa
          ? "حالت اجرا و اتصال صرافی"
          : "Execution mode & exchange connection"}
      </h2>
      <label className="mode-switch">
        <input
          type="checkbox"
          role="switch"
          checked={false}
          aria-label={isFa ? "درخواست حالت واقعی" : "Request live mode"}
          disabled={!!busy || !connected}
          onChange={() => {
            if (
              window.confirm(
                isFa
                  ? "معاملهٔ واقعی ممکن است موجب زیان سرمایه شود. درخواست بررسی پیش‌نیازهای حالت واقعی ارسال شود؟ تا تأیید رسمی قفل باقی می‌ماند."
                  : "Request live readiness checks? Live remains locked until official integration is verified.",
              )
            )
              void onModeRequest("LIVE");
          }}
        />
        {isFa
          ? "DEMO / REAL — واقعی تا تأیید قرارداد API قفل است"
          : "DEMO / REAL — live locked pending verified API contract"}
      </label>
      <button
        type="button"
        className="cmd-btn"
        disabled={!!busy}
        onClick={() => void onModeRequest("DEMO")}
      >
        {isFa ? "انتخاب حالت دمو و توقف موتور" : "Select Demo & stop engine"}
      </button>
      <p>
        {isFa
          ? "API_KEY و SECRET_KEY فقط در secret manager یا vault رمزگذاری‌شدهٔ سرور تنظیم می‌شوند؛ هرگز در مرورگر، localStorage یا چت وارد نکنید. نبود مجوز برداشت باید از گزارش معتبر صرافی تأیید شود؛ مسدودبودن مسیر برداشت در برنامه به‌تنهایی کافی نیست."
          : "API_KEY and SECRET_KEY belong only in the server secret manager/encrypted vault. Exchange permission verification is mandatory; blocking a withdrawal endpoint is not proof of a safe API key."}
      </p>
      <div className="demo-warning">
        {isFa
          ? "اتصال واقعی هنوز تأیید نشده؛ درخواست REAL سفارش ارسال نمی‌کند و دمو را به معاملهٔ واقعی تبدیل نمی‌کند. سقف ۰٫۳٪، journal و reconciliation در هستهٔ مستقل اجرای Spot با adapter آزمون‌شده پیاده شده‌اند؛ adapter واقعی Bit24 هنوز لازم است."
          : "Actual exchange integration is not verified. REAL requests do not submit orders. A reviewed Bit24 adapter is still required."}
      </div>
    </section>
  );
}
