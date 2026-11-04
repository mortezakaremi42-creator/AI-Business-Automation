import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium as playwright } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { createBit24ProAppServer } from "../src/server/index.js";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bit24-browser-"));
const base = "http://127.0.0.1:4387";
const server = createBit24ProAppServer({
  stateFile: path.join(temp, "state.json"),
  token: "",
  autoCycle: false,
  allowedOrigins: [base],
});
const report = {
  browser: "Headless Chromium / Android mobile emulation; not physical Android",
  checks: [] as string[],
  consoleErrors: [] as string[],
  pageErrors: [] as string[],
  externalRequests: [] as string[],
};
let browser: Awaited<ReturnType<typeof playwright.launch>> | undefined;
const check = (name: string) => {
  report.checks.push(name);
  console.log("PASS", name);
};
const snapshot = async () => fetch(base + "/api/status").then((r) => r.json());
try {
  await new Promise<void>((r) =>
    server.httpServer.listen(4387, "127.0.0.1", r),
  );
  const libs = path.join(temp, "browser-libs");
  fs.mkdirSync(libs);
  const archive = path.join(temp, "libs.tar");
  fs.writeFileSync(
    archive,
    brotliDecompressSync(
      fs.readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br"),
    ),
  );
  execFileSync("tar", ["xf", archive, "-C", libs]);
  browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
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
        path.join(libs, "lib") + ":" + (process.env.LD_LIBRARY_PATH ?? ""),
    },
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  let expectedNetworkFailure = false;
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !expectedNetworkFailure)
      report.consoleErrors.push(m.text());
  });
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("data:"))
      report.externalRequests.push(r.url());
  });
  await page.goto(base);
  try {
    await page
      .getByRole("heading", { name: "کیف پول آزمایشی — بدون پول واقعی" })
      .waitFor({ timeout: 7000 });
  } catch (e) {
    console.error(JSON.stringify(report));
    console.error(await page.locator("body").innerText());
    throw e;
  }
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  check("Persian RTL mobile loads and syncs");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  check("393px mobile has no page-level horizontal overflow");
  const buy = () =>
    page
      .locator(".opp-card")
      .filter({ has: page.getByText("BTC/IRT", { exact: true }) })
      .getByRole("button");
  page.once("dialog", (d) => d.dismiss());
  await buy().click();
  assert.equal((await snapshot()).demo.paperOrders.length, 0);
  check("Cancel warning sends no trade");
  page.once("dialog", (d) => d.accept());
  await buy().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pro-table tbody tr").length > 0,
  );
  await page.getByRole("button", { name: "بستن Demo", exact: true }).waitFor();
  assert.equal((await snapshot()).demo.paperOrders.length, 1);
  check("Confirmed mobile buy records one order");
  await page.reload();
  await page.getByRole("button", { name: "بستن Demo", exact: true }).waitFor();
  assert.equal((await snapshot()).demo.paperOrders.length, 1);
  check("Refresh retains position and cash without duplicating buy");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "بستن Demo", exact: true }).click();
  await page
    .getByRole("button", { name: "بستن Demo", exact: true })
    .waitFor({ state: "detached" });
  assert.equal((await snapshot()).demo.paperOrders.length, 2);
  check("Mobile manual sell closes one position");
  expectedNetworkFailure = true;
  await page.route("**/api/buy", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  page.once("dialog", (d) => d.accept());
  await buy().click();
  await page
    .getByRole("button", { name: "بررسی نتیجهٔ درخواست بدون تکرار معامله" })
    .waitFor();
  await page.unroute("**/api/buy");
  assert.equal((await snapshot()).demo.paperOrders.length, 3);
  await page
    .getByRole("button", { name: "بررسی نتیجهٔ درخواست بدون تکرار معامله" })
    .click();
  await page
    .getByRole("button", { name: "بررسی نتیجهٔ درخواست بدون تکرار معامله" })
    .waitFor({ state: "detached" });
  assert.equal((await snapshot()).demo.paperOrders.length, 3);
  expectedNetworkFailure = false;
  check("Lost response reconciles durable receipt without a second buy");
  const before = (await snapshot()).demoAvailableCashIrt;
  await page.getByLabel("اصلاح موجودی کاغذی", { exact: true }).fill("1000000");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "ثبت اصلاح موجودی", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("موجودی کاغذی اصلاح شد"),
  );
  assert.equal((await snapshot()).demoAvailableCashIrt, before + 1000000);
  check("Mobile cash adjustment and confirmation work");
  fs.mkdirSync("reports", { recursive: true });
  await page.screenshot({ path: "reports/demo-mobile.png", fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "reports/demo-mobile-top.png" });
  // Verify service worker on localhost secure context; offline is a disconnected panel, never a simulator.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page
    .getByRole("heading", { name: "کیف پول آزمایشی — بدون پول واقعی" })
    .waitFor();
  check("PWA service worker installs with same-origin assets");
  expectedNetworkFailure = true;
  await context.setOffline(true);
  await page.reload();
  await page
    .getByText("پنل کنترل سرور — بدون شبیه‌سازی محلی", { exact: true })
    .waitFor();
  assert.equal((await snapshot()).demo.paperOrders.length, 3);
  check("Offline PWA shell has no local trading fallback");
  await context.setOffline(false);
  expectedNetworkFailure = false;
  await page.reload();
  await page
    .getByRole("heading", { name: "کیف پول آزمایشی — بدون پول واقعی" })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  check("320px narrow mobile has no page-level horizontal overflow");
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const dp = await desktop.newPage();
  dp.on("pageerror", (e) => report.pageErrors.push(e.message));
  await dp.goto(base);
  await dp
    .getByRole("heading", { name: "کیف پول آزمایشی — بدون پول واقعی" })
    .waitFor();
  assert(
    await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await dp.screenshot({ path: "reports/demo-desktop.png", fullPage: true });
  check("Desktop layout loads without horizontal overflow");
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.externalRequests, []);
  check("No unexpected console errors, JS exceptions, or external requests");
  fs.writeFileSync(
    "reports/mobile-browser-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await browser?.close();
  server.stop();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
  fs.rmSync(temp, { recursive: true, force: true });
}
