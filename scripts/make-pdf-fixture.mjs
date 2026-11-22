import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const b = await chromium.launch({ channel: "chrome" });
try {
  const p = await b.newPage();
  const png = await readFile("docs/validation/input.png");
  await p.setContent(
    `<style>@page{size:A4;margin:15mm}img{width:180mm}section{break-after:page}section:last-child{break-after:auto}</style><section><img src="data:image/png;base64,${png.toString("base64")}"></section><section><img src="data:image/png;base64,${png.toString("base64")}"></section>`,
  );
  await p.locator("img").first().waitFor();
  await mkdir("tests/fixtures", { recursive: true });
  await p.pdf({
    path: "tests/fixtures/study-two-pages.pdf",
    format: "A4",
    printBackground: true,
  });
} finally {
  await b.close();
}
