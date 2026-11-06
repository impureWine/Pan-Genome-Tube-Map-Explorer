import { expect, test, type Page } from "@playwright/test";

async function region(page: Page, input: string) {
  await page.getByLabel("Genomic region", { exact: true }).fill(input);
  await page.getByLabel("Genomic region", { exact: true }).press("Enter");
}

test("real API, coordinate search, local filters and detail modes", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const meta = await request.get("/api/genome/meta");
  expect(meta.ok()).toBeTruthy();
  expect((await meta.json()).samples).toHaveLength(6);
  await page.goto("/");
  await expect(page.getByText("Subgraph connected")).toBeVisible();
  await expect(page.getByLabel("Show HG002", { exact: true })).toBeChecked();
  await region(page, "900-901");
  await expect(page.getByTestId("node-count")).toHaveText("4");
  await expect(page.getByTestId("edge-count")).toHaveText("4");
  await expect(page.getByTestId("viewport-range")).toHaveText("900 — 901 bp");
  await page.getByRole("switch", { name: "Show SNP", exact: true }).click();
  await expect(page.getByText("3 nodes · 2 edges · 6 samples")).toBeVisible();
  await page.getByLabel("Show HG002", { exact: true }).uncheck();
  await expect(page.getByText("5 of 6 visible")).toBeVisible();
  await page.getByRole("button", { name: "Macro", exact: true }).click();
  await expect.poll(async () => (await page.request.get("/api/subgraph?start=900&end=901&lod=macro")).status()).toBe(200);
  await expect(page.locator(".viewport-topline")).toContainText("Macro");
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await expect(page.locator(".viewport-topline")).toContainText("Base level");
  await region(page, "5000-1000");
  await expect(page.locator("#region-error")).toContainText("start < end");
  await expect(page.getByTestId("viewport-range")).toHaveText("900 — 901 bp");
  expect(errors).toEqual([]);
});

test("zoom, pointer coordinates, pan, minimap and reset", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Subgraph connected")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByTestId("viewport-range")).toHaveText("2,000 — 4,000 bp");
  const viewport = page.getByRole("group", { name: /^Interactive genome viewport/ });
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 90);
  await expect(page.getByTestId("cursor-coordinate")).toContainText("bp");
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + 90, { steps: 5 }); await page.mouse.up();
  await expect(page.getByTestId("viewport-range")).not.toHaveText("2,000 — 4,000 bp");
  const slider = page.getByRole("slider", { name: "Genome viewport start" });
  await slider.focus(); await page.keyboard.press("End");
  await expect(page.getByTestId("viewport-range")).toHaveText("3,901 — 5,901 bp");
  const bar = (await slider.boundingBox())!;
  await page.mouse.move(bar.x + bar.width * .8, bar.y + 16); await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * .3, bar.y + 16, { steps: 5 }); await page.mouse.up();
  await expect(page.getByTestId("viewport-range")).not.toHaveText("3,901 — 5,901 bp");
  await page.getByRole("button", { name: "Reset viewport" }).click();
  await expect(page.getByTestId("viewport-range")).toHaveText("0 — 5,901 bp");
  await expect(page.getByTestId("node-count")).toHaveText("62");
  await expect(page.getByTestId("edge-count")).toHaveText("66");
});

test("failed metadata and failed subgraph can be retried", async ({ page }) => {
  await page.route("**/api/genome/meta", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Genome database unavailable" }) }));
  await page.goto("/");
  await expect(page.getByText("Genome service unavailable")).toBeVisible();
  await expect(page.getByTestId("node-count")).toHaveText("—");
  await page.unroute("**/api/genome/meta");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByText("Subgraph connected")).toBeVisible();
  await page.route("**/api/subgraph?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Subgraph temporarily unavailable" }) }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Genome service unavailable")).toBeVisible();
  await page.unroute("**/api/subgraph?*");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByText("Subgraph connected")).toBeVisible();
});

test("mobile controls, keyboard close and no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Subgraph connected")).toBeVisible();
  await expect(page.getByLabel("Show HG002", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Open sample controls" }).click();
  await expect(page.getByLabel("Show HG002", { exact: true })).toBeVisible();
  await page.getByLabel("Show HG002", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Show HG002", { exact: true })).not.toBeVisible();
  await region(page, "900-901");
  await expect(page.getByTestId("node-count")).toHaveText("4");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("canvas tubes, semantic bases, wheel zoom and spotlight", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const canvas = page.getByTestId("tube-map-canvas");
  await expect.poll(() => canvas.getAttribute("data-tube-count").then(Number)).toBeGreaterThan(10);
  await region(page, "900-901");
  await expect.poll(() => canvas.getAttribute("data-base-count").then(Number)).toBeGreaterThan(0);
  const pixel = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d")!, dpr=el.width/el.clientWidth;
    const x=Math.round(el.width*.4), data=ctx.getImageData(x,Math.round(40*dpr),1,el.height-Math.round(40*dpr)).data;
    for(let i=0;i<data.length;i+=4) if(data[i+1]>150 && data[i+2]>150 && data[i]<190) return {x:x/dpr,y:40+i/4/dpr};
    return null;
  });
  expect(pixel).not.toBeNull();
  const box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+pixel!.x,box.y+pixel!.y);
  await expect(page.getByRole("tooltip")).toContainText("Node");
  await expect.poll(()=>canvas.getAttribute("data-hover-samples")).not.toBe("");
  await page.getByRole("button",{name:"Glow on",exact:true}).click();
  await expect(page.getByRole("button",{name:"Glow off",exact:true})).toHaveAttribute("aria-pressed","false");
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.wheel(0,120);
  await expect(page.getByTestId("viewport-range")).not.toHaveText("900 — 901 bp");
  expect(errors).toEqual([]);
});
