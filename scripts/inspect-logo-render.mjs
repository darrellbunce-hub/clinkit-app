import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

function reportElement(label, handle) {
  return handle.evaluate((el, lbl) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const img =
      el.tagName === "IMG"
        ? el
        : el.querySelector("img");

    const natural = img
      ? {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          currentSrc: img.currentSrc,
        }
      : null;

    return {
      label: lbl,
      tag: el.tagName.toLowerCase(),
      rendered: {
        width: rect.width,
        height: rect.height,
      },
      css: {
        width: cs.width,
        height: cs.height,
        maxWidth: cs.maxWidth,
        maxHeight: cs.maxHeight,
        minWidth: cs.minWidth,
        minHeight: cs.minHeight,
        display: cs.display,
        objectFit: cs.objectFit,
      },
      natural,
      className: el.className,
    };
  }, label);
}

async function inspectPage(page, path, variantLabel) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "networkidle",
  });

  const logoLink = page.locator('a[aria-label="Keynetic"]').first();
  await logoLink.waitFor({ state: "visible", timeout: 15000 });

  const imgs = logoLink.locator("img");
  const count = await imgs.count();

  const parentBox = await logoLink.boundingBox();
  const parentReport = await reportElement(
    `${variantLabel} parent link`,
    logoLink
  );

  const imageReports = [];

  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i);
    const src = await img.getAttribute("src");
    const kind = src?.includes("wordmark") ? "wordmark" : "icon";
    imageReports.push(
      await reportElement(`${variantLabel} ${kind}`, img)
    );
  }

  return {
    viewport: "desktop 1280px",
    path,
    parent: { ...parentReport, boundingBox: parentBox },
    images: imageReports,
  };
}

async function inspectMobile(page, path, variantLabel) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "networkidle",
  });

  const logoLink = page.locator('a[aria-label="Keynetic"]').first();
  await logoLink.waitFor({ state: "visible", timeout: 15000 });

  const imgs = logoLink.locator("img");
  const count = await imgs.count();
  const parentBox = await logoLink.boundingBox();
  const imageReports = [];

  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i);
    const src = await img.getAttribute("src");
    const kind = src?.includes("wordmark") ? "wordmark" : "icon";
    imageReports.push(
      await reportElement(`${variantLabel} ${kind}`, img)
    );
  }

  return {
    viewport: "mobile 390px",
    path,
    parent: { boundingBox: parentBox },
    images: imageReports,
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const results = [];

  results.push(await inspectPage(page, "/agent", "light"));
  results.push(await inspectMobile(page, "/agent", "light"));
  results.push(await inspectPage(page, "/", "dark"));
  results.push(await inspectMobile(page, "/", "dark"));

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error("INSPECTION_FAILED", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
