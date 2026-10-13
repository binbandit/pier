// Dev helper: open a pier page in headless Chromium, run steps, save screenshots.
//   bun e2e/drive.ts <path> <out-dir> [step...]
// Steps: "key:j", "key:shift+a", "type:hello", "wait:500", "click:<css>", "shot:name", "eval:<js>"
import { chromium } from "@playwright/test";

const [path = "/", outDir = ".", ...steps] = Bun.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "dark",
});
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning")
    console.log(`[console.${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));

const base = `http://127.0.0.1:${Number(process.env.PIER_PORT ?? 4477) + 1}`;
await page.goto(`${process.env.PIER_URL ?? base}${path}`, {
  waitUntil: "networkidle",
});
await page.waitForTimeout(800);

for (const step of steps) {
  const [kind, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (kind === "key") {
    const key = arg
      .split("+")
      .map(
        (part) =>
          ({
            mod: "Meta",
            shift: "Shift",
            ctrl: "Control",
            alt: "Alt",
            enter: "Enter",
            escape: "Escape",
            tab: "Tab",
          })[part] ?? part,
      )
      .join("+");
    await page.keyboard.press(key);
  } else if (kind === "type") await page.keyboard.type(arg);
  else if (kind === "wait") await page.waitForTimeout(Number(arg));
  else if (kind === "click") await page.click(arg);
  else if (kind === "shot") await page.screenshot({ path: `${outDir}/${arg}.png` });
  else if (kind === "eval") console.log(JSON.stringify(await page.evaluate(arg)));
  await page.waitForTimeout(250);
}
await browser.close();
