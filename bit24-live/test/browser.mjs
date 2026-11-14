// Development-only smoke test. Browser libraries come from the parent repo's dev dependencies.
import { chromium as playwright } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createLiveConsole } from "../server.mjs";
const temp = mkdtempSync(join(tmpdir(), "bit24-live-browser-"));
const origin = "http://localhost:3055";
const server = createLiveConsole({
  origin,
  ownerPassword: "browser-test-fixture-only-password-123456",
});
const errors = [],
  checks = [];
let browser;
try {
  await new Promise((r) => server.listen(3055, "0.0.0.0", r));
  const libs = join(temp, "libs");
  mkdirSync(libs);
  const archive = join(temp, "libs.tar");
  writeFileSync(
    archive,
    brotliDecompressSync(
      readFileSync(
        new URL(
          "../../node_modules/@sparticuz/chromium/bin/al2023.tar.br",
          import.meta.url,
        ),
      ),
    ),
  );
  execFileSync("tar", ["xf", archive, "-C", libs]);
  browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: chromium.args.filter(
      (a) =>
        ![
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--single-process",
        ].includes(a),
    ),
    env: {
      ...process.env,
      LD_LIBRARY_PATH:
        join(libs, "lib") + ":" + (process.env.LD_LIBRARY_PATH || ""),
    },
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin))
      errors.push("Unexpected external request: " + r.url());
  });
  const check = (name) => {
    checks.push(name);
    console.log("PASS " + name);
  };
  await page.goto(origin);
  await page.locator("#login").waitFor();
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  check("Persian RTL login; no public account data");
  await page
    .locator("#password")
    .fill("browser-test-fixture-only-password-123456");
  await page.locator("#login-form button").click();
  await page.getByText("کلید API روی سرور تنظیم نشده است.").waitFor();
  assert.equal(await page.locator("#balance").textContent(), "—");
  assert.equal(await page.locator("#available").textContent(), "—");
  assert.equal(await page.locator("#markets article").count(), 0);
  assert.equal(await page.locator("#orders article").count(), 0);
  check(
    "Missing API key displays no balance, price, order or manufactured P&L",
  );
  assert.equal(await page.locator(".locked").isDisabled(), true);
  check("No owner-login bypass of order execution lock");
  for (const width of [393, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  check("No horizontal overflow at 320px, 393px and desktop");
  await page.setViewportSize({ width: 393, height: 852 });
  mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("../reports/mobile-disconnected.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.locator("#language").click();
  assert.equal(await page.locator("html").getAttribute("dir"), "ltr");
  assert.equal(
    await page
      .getByText("API key is not configured on the server.")
      .isVisible(),
    true,
  );
  check("English language and LTR switch");
  await page.evaluate(() => navigator.serviceWorker.ready);
  check("Service worker and installable manifest assets load");
  const names = await page.evaluate(() => caches.keys());
  assert.ok(names.includes("bit24-real-console-shell-1"));
  const cached = await page.evaluate(async () => {
    const c = await caches.open("bit24-real-console-shell-1");
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  assert.ok(cached.every((p) => !p.startsWith("/api")));
  check("Service worker never caches account, sessions or API data");
  await page.locator("#logout").click();
  await page.locator("#login").waitFor();
  assert.equal(await page.locator("#balance").textContent(), "—");
  check("Logout invalidates session and clears financial DOM");
  await context.setOffline(true);
  await page.reload();
  await page.getByText("سرور در دسترس نیست؛ اعداد قبلی پاک شدند.").waitFor();
  assert.equal(await page.locator("#balance").textContent(), "—");
  check("Offline shell has no fallback simulation or stale balance");
  assert.deepEqual(errors, []);
  check("No JS exceptions or external browser requests");
  writeFileSync(
    new URL("../reports/browser.json", import.meta.url),
    JSON.stringify(
      {
        checks,
        errors,
        physicalAndroidTested: false,
        authenticatedExchangeTested: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
