// worker-export.mjs — 单店账单 worker（运行在 ego 进程内）
// 由 batch-run.mjs 生成的 wrapper 通过 globalThis.__JOB 传入任务后 import 本文件。
// 自包含：只用 node 内置模块 + ego 全局 API。
const fs = await import("node:fs/promises");
const zlib = await import("node:zlib");

const JOB = globalThis.__JOB || {};
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logLines = [];
async function log(...a) {
  const line = "[t=" + ((Date.now() - t0) / 1000).toFixed(1) + "s] " + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  logLines.push(line);
  console.log(line);
}

const ROOT = (JOB.root || "D:/对账账单").replace(/\\/g, "/").replace(/\/$/, "");
const SHOP_DIR = ROOT + "/" + JOB.shop;
const PERIOD_DIR = SHOP_DIR + "/" + JOB.period;
const TASKS_PATH = SHOP_DIR + "/.tasks.json";
const LOCK_PATH = SHOP_DIR + "/.lock";
const BILLS_URL = "https://mms.pinduoduo.com/cashier/finance/payment-bills";
const HIST_URL = "https://cashier.pinduoduo.com/main/bills/export-history?tab=4001&__app_code=113";
const MAX_WAIT_SEC = Number(JOB.maxWaitSec || 45);

const RESULT_PATH = JOB.resultPath || (PERIOD_DIR + "/worker-result.json");

async function writeResult(obj) {
  const out = { ...obj, shop: JOB.shop, period: JOB.period, elapsedSec: Number(((Date.now() - t0) / 1000).toFixed(1)) };
  if (JOB.period) await fs.mkdir(PERIOD_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(RESULT_PATH, JSON.stringify(out, null, 1), "utf8").catch(() => {});
  if (JOB.logPath) await fs.writeFile(JOB.logPath, logLines.join("\n"), "utf8").catch(() => {});
  return out;
}

// ── 店铺任务文件 ─────────────────────────────
async function readTasks() {
  try {
    return JSON.parse(await fs.readFile(TASKS_PATH, "utf8"));
  } catch {
    return { version: 1, shop: JOB.shop, tasks: [] };
  }
}
async function writeTasks(obj) {
  await fs.mkdir(SHOP_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(TASKS_PATH, JSON.stringify(obj, null, 2), "utf8");
}

// ── 锁 ───────────────────────────────────────
async function acquireLock() {
  await fs.mkdir(SHOP_DIR, { recursive: true }).catch(() => {});
  try {
    const st = await fs.stat(LOCK_PATH);
    if (Date.now() - st.mtimeMs < 30 * 60 * 1000) throw new Error("shop_locked_by_other_run");
  } catch (e) {
    if (String(e && e.message).includes("shop_locked")) throw e;
  }
  await fs.writeFile(LOCK_PATH, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), period: JOB.period }), "utf8");
}
async function releaseLock() {
  await fs.rm(LOCK_PATH, { force: true }).catch(() => {});
}

// ── 日历 ─────────────────────────────────────
const pickerOpen = (page) =>
  page.evaluate(() => {
    return !![...document.querySelectorAll("div[class*='outerPickerWrapper']")].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  });
async function ensurePicker(page) {
  if (await pickerOpen(page)) return;
  await page.click('loc=css:input[placeholder*="开始日期"]', { label: "open date picker" });
  await page.waitForFunction(
    () => !![...document.querySelectorAll("div[class*='outerPickerWrapper']")].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
    undefined,
    { timeout: 6000 }
  ).catch(() => {});
  await sleep(120);
}
async function readCal(page) {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll("span[class*='RPR_dateText']")]
      .map((e) => ({ t: e.innerText.trim(), x: Math.round(e.getBoundingClientRect().x) }))
      .filter((h) => h.t)
      .sort((a, b) => a.x - b.x);
    const years = [...document.querySelectorAll("input")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && /^20\d\d年$/.test((e.value || "").trim());
      })
      .map((e) => ({ v: e.value.trim(), x: Math.round(e.getBoundingClientRect().x) }))
      .sort((a, b) => a.x - b.x);
    const inp = [...document.querySelectorAll("input")].find((e) => e.placeholder && /开始日期/.test(e.placeholder));
    return { heads, years, value: inp ? inp.value : null };
  });
}
async function openYear(page, yearText) {
  await page.evaluate(() => {
    const ys = [...document.querySelectorAll("input")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && /^20\d\d年$/.test((e.value || "").trim());
      })
      .map((e) => ({ e, x: e.getBoundingClientRect().x }))
      .sort((a, b) => a.x - b.x);
    if (ys.length) ys[0].e.setAttribute("data-ego-year", "left");
  });
  await page.click('css=[data-ego-year="left"]', { label: "left year dropdown" });
  await sleep(320);
  const ok = await page.evaluate((val) => {
    const lis = [...document.querySelectorAll("li[class*='cIL_item']")].filter((e) => (e.innerText || "").trim() === val);
    if (!lis.length) return false;
    lis[0].setAttribute("data-ego-year-pick", "1");
    return true;
  }, yearText);
  if (!ok) throw new Error("year_option_not_found:" + yearText);
  await page.click('css=[data-ego-year-pick="1"]', { label: "choose " + yearText });
  await sleep(320);
}
async function markArrow(page, side, dir) {
  return page.evaluate(({ side, dir }) => {
    for (const e of document.querySelectorAll("[data-ego-arrow]")) e.removeAttribute("data-ego-arrow");
    const svgs = [...document.querySelectorAll("svg[class*='RPR_iconPrevNext']")].filter((e) => e.getBoundingClientRect().width > 0);
    const X = (e) => e.getBoundingClientRect().x;
    let cands = [];
    if (side === "left" && dir === "prev") cands = svgs.filter((e) => !/RPR_right/.test(e.getAttribute("class") || "") && X(e) < 750);
    if (side === "left" && dir === "next") cands = svgs.filter((e) => /RPR_right/.test(e.getAttribute("class") || "") && X(e) < 750);
    if (side === "right" && dir === "prev") cands = svgs.filter((e) => !/RPR_right/.test(e.getAttribute("class") || "") && X(e) > 750);
    if (side === "right" && dir === "next") cands = svgs.filter((e) => /RPR_right/.test(e.getAttribute("class") || "") && X(e) > 900);
    if (!cands.length) return false;
    cands[0].setAttribute("data-ego-arrow", "1");
    return true;
  }, { side, dir });
}
async function clickArrow(page, side, dir) {
  if (!(await markArrow(page, side, dir))) return false;
  await page.click('css=[data-ego-arrow="1"]', { label: side + " " + dir });
  await sleep(180);
  return true;
}
async function setYearFor(page, side, yearText) {
  const marked = await page.evaluate((side) => {
    const ys = [...document.querySelectorAll("input")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && /^20\d\d年$/.test((e.value || "").trim());
      })
      .map((e) => ({ e, x: e.getBoundingClientRect().x }))
      .sort((a, b) => a.x - b.x);
    if (!ys.length) return false;
    const t = side === "left" ? ys[0] : ys[ys.length - 1];
    t.e.setAttribute("data-ego-year", side);
    return true;
  }, side);
  if (!marked) throw new Error("no_year_input");
  await page.click(`css=[data-ego-year="${side}"]`, { label: side + " year" });
  await sleep(320);
  const ok = await page.evaluate((val) => {
    const lis = [...document.querySelectorAll("li[class*='cIL_item']")].filter((e) => (e.innerText || "").trim() === val);
    if (!lis.length) return false;
    lis[0].setAttribute("data-ego-year-pick", "1");
    return true;
  }, yearText);
  if (!ok) throw new Error("year_option_not_found:" + yearText);
  await page.click('css=[data-ego-year-pick="1"]', { label: "choose " + yearText });
  await sleep(320);
}
async function oneStep(page, side, dir) {
  if (await clickArrow(page, side, dir)) return true;
  // 面板相邻时内箭头会隐藏：把另一个面板往外挪一步，制造非相邻
  if (side === "left" && dir === "next") return await clickArrow(page, "right", "next");
  if (side === "right" && dir === "prev") return await clickArrow(page, "left", "prev");
  return false;
}
async function alignPanel(page, side, targetMonth) {
  for (let i = 0; i < 18; i++) {
    const cal = await readCal(page);
    if (!cal.heads.length) throw new Error("calendar_not_open");
    const heads = cal.heads;
    const cur = parseInt(side === "left" ? heads[0].t : heads[heads.length - 1].t, 10);
    if (cur === targetMonth) return true;
    const dir = cur > targetMonth ? "prev" : "next";
    if (!(await oneStep(page, side, dir))) return false;
  }
  return false;
}

async function setMonthRange(page, label) {
  await ensurePicker(page);
  const startMonth = parseInt(JOB.from.slice(5, 7), 10);
  const endMonth = parseInt(JOB.to.slice(5, 7), 10);
  const startYear = JOB.from.slice(0, 4) + "年";
  const endYear = JOB.to.slice(0, 4) + "年";
  const sameMonth = startMonth === endMonth && startYear === endYear;

  if (sameMonth) {
    for (let i = 0; i < 5; i++) {
      const cal = await readCal(page);
      if (cal.heads[0] && parseInt(cal.heads[0].t, 10) === startMonth && cal.years[0] && cal.years[0].v === startYear) break;
      await alignPanel(page, "left", startMonth);
      await setYearFor(page, "left", startYear);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const cal = await readCal(page);
      const L = cal.heads[0] ? parseInt(cal.heads[0].t, 10) : -1;
      const R = cal.heads[cal.heads.length - 1] ? parseInt(cal.heads[cal.heads.length - 1].t, 10) : -1;
      const ly = cal.years[0] ? cal.years[0].v : "";
      const ry = cal.years[cal.years.length - 1] ? cal.years[cal.years.length - 1].v : "";
      if (L === startMonth && R === endMonth && ly === startYear && ry === endYear) break;
      await alignPanel(page, "right", endMonth);
      await alignPanel(page, "left", startMonth);
      await setYearFor(page, "left", startYear);
      await setYearFor(page, "right", endYear);
    }
  }

  const fin = await readCal(page);
  const headsFin = fin.heads.map((h) => h.t);
  const yearsFin = fin.years.map((y) => y.v);
  const ok = sameMonth
    ? parseInt(headsFin[0], 10) === startMonth && yearsFin[0] === startYear
    : parseInt(headsFin[0], 10) === startMonth && parseInt(headsFin[headsFin.length - 1], 10) === endMonth && yearsFin[0] === startYear && yearsFin[yearsFin.length - 1] === endYear;
  if (!ok) throw new Error(label + "_panel_align_failed:" + JSON.stringify({ heads: headsFin, years: yearsFin }));

  if (sameMonth) {
    await clickCell(page, 0, JOB.fromDay);
    await clickCell(page, 0, JOB.toDay);
  } else {
    await clickCell(page, 0, JOB.fromDay);
    await clickCell(page, 1, JOB.toDay);
  }

  await page.waitForFunction((want) => {
    const inp = [...document.querySelectorAll("input")].find((e) => e.placeholder && /开始日期/.test(e.placeholder));
    return !!inp && inp.value === want;
  }, JOB.expectValue, { timeout: 6000 }).catch(() => {});
  const after = await readCal(page);
  if (after.value !== JOB.expectValue) throw new Error(label + "_date_value:" + after.value);

  const confirmEnabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "确认");
    return b ? !(b.disabled || /disabled/i.test(b.className)) : false;
  });
  if (!confirmEnabled) throw new Error(label + "_confirm_disabled");
  await page.click("loc=role:button[name='确认']", { label: label + " confirm" });
  await sleep(250);

  // 超过最近 12 个月：确认后会弹「仅支持查询最近12个月 / 去导出 / 取消」气泡
  const popup = await page.evaluate(() => {
    return [...document.querySelectorAll("div")].some((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && /仅支持查询最近12个月/.test(e.innerText || "") && (e.innerText || "").length < 500;
    });
  });
  if (popup) {
    log("12mo_popup", label);
    const hit = await page.evaluate(() => {
      for (const b of document.querySelectorAll("button, a")) {
        if ((b.innerText || "").trim() === "去导出") { b.setAttribute("data-ego-goexport", "1"); return true; }
      }
      return false;
    }).catch(() => false);
    if (hit) {
      await page.click('css=[data-ego-goexport="1"]', { label: "go export tab" });
      await sleep(500);
    }
    return "old_range";
  }
  return "ok";
}
async function clickCell(page, tableIdx, day) {
  const res = await page.evaluate(({ tableIdx, day }) => {
    for (const e of document.querySelectorAll("[data-ego-cell]")) e.removeAttribute("data-ego-cell");
    const tables = [...document.querySelectorAll("section[class*='contentPickerWrapper'] table")];
    const t = tables[tableIdx];
    if (!t) return { ok: false, why: "no_table" };
    const hits = [];
    for (const r of [...t.rows].slice(1)) {
      for (const c of [...r.cells]) {
        const d = c.querySelector('div[class*="RPR_cell"]');
        if (!d) continue;
        if (/outOfMonth|disabled/i.test(d.className)) continue;
        if ((c.innerText || "").trim() === String(day)) hits.push(c);
      }
    }
    if (hits.length !== 1) return { ok: false, why: "hits=" + hits.length };
    hits[0].setAttribute("data-ego-cell", "1");
    return { ok: true };
  }, { tableIdx, day });
  if (!res.ok) throw new Error(`cell_${tableIdx}_${day}:${res.why}`);
  await page.click('css=[data-ego-cell="1"]', { label: "pick " + day });
  await sleep(160);
}


// ── 页面数据 ─────────────────────────────────
async function readSummary(page) {
  return page.evaluate(() => {
    const txt = (e) => (e ? (e.innerText || "").replace(/\s+/g, " ").trim() : "");
    const stats = [];
    for (const el of document.querySelectorAll("div")) {
      if (!el.offsetParent) continue;
      const t = txt(el);
      if (/收入金额.*收入笔数.*支出金额.*支出笔数/.test(t) && t.length < 160) stats.push(t);
    }
    return { stats: stats[0] || "" };
  });
}
function parseSummary(text) {
  const num = (s) => Number(String(s).replace(/[,+]/g, ""));
  const m = text.match(/收入金额（元）\s*\+?\s*([\d.]+).*?收入笔数（笔）\s*(\d+).*?支出金额（元）\s*-?\s*([\d.]+).*?支出笔数（笔）\s*(\d+)/);
  if (!m) return null;
  return { income: num(m[1]), incomeN: Number(m[2]), expense: -num(m[3]), expenseN: Number(m[4]) };
}

async function waitQueryDone(page) {
  const monthPrefix = JOB.to.slice(0, 7); // 倒序表首行在结束月
  await page.waitForFunction((prefix) => {
    const rows = [...document.querySelectorAll("table tr")];
    for (const r of rows) {
      const c = r.cells && r.cells[0] ? (r.cells[0].innerText || "").trim() : "";
      if (/20\d\d-\d\d-\d\d/.test(c) && c.startsWith(prefix)) return true;
    }
    return false;
  }, monthPrefix, { timeout: 12000 }).catch(() => {});
  await sleep(250);
}

// ── 导出历史 ─────────────────────────────────
function parseApplyTime(text) {
  const m = text.match(/账单申请时间\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return { text: m[1], ms: Date.parse(m[1].replace(" ", "T") + "+08:00") };
}
async function findCard(page, minApplyMs) {
  return page.evaluate(({ fromPrefix, minApplyMs }) => {
    const txt = (e) => (e ? (e.innerText || "").replace(/\s+/g, " ").trim() : "");
    const cards = [...document.querySelectorAll("div")].filter((e) => {
      const r = e.getBoundingClientRect();
      const t = txt(e);
      return r.width > 200 && r.height > 50 && t.includes("账单申请时间") && t.includes(fromPrefix) && t.length < 500;
    });
    cards.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    for (const card of cards) {
      for (const e of card.querySelectorAll("[data-ego-dl]")) e.removeAttribute("data-ego-dl");
      const text = txt(card).slice(0, 240);
      const m = text.match(/账单申请时间\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (minApplyMs && m) {
        const ms = Date.parse(m[1].replace(" ", "T") + "+08:00");
        if (ms < minApplyMs) continue;
      }
      const btn = [...card.querySelectorAll("button")].find((b) => txt(b) === "下载账单");
      if (btn) btn.setAttribute("data-ego-dl", "1");
      return { found: true, hasDownload: !!btn, text, applyTime: m ? m[1] : null };
    }
    return { found: false, cards: cards.length };
  }, { fromPrefix: JOB.fromPrefix, minApplyMs: minApplyMs || 0 });
}

// ── 下载 & 校验 ──────────────────────────────
function unzipCsv(zipBuf) {
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 22 - 65536); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip_no_eocd");
  const cdOffset = zipBuf.readUInt32LE(eocd + 16);
  const cdCount = zipBuf.readUInt16LE(eocd + 10);
  let off = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (zipBuf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip_bad_cd");
    const method = zipBuf.readUInt16LE(off + 10);
    const compSize = zipBuf.readUInt32LE(off + 20);
    const nameLen = zipBuf.readUInt16LE(off + 28);
    const extraLen = zipBuf.readUInt16LE(off + 30);
    const commentLen = zipBuf.readUInt16LE(off + 32);
    const localOffset = zipBuf.readUInt32LE(off + 42);
    const name = zipBuf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (/\.csv$/i.test(name)) {
      const lo = localOffset;
      if (zipBuf.readUInt32LE(lo) !== 0x04034b50) throw new Error("zip_bad_local");
      const lNameLen = zipBuf.readUInt16LE(lo + 26);
      const lExtraLen = zipBuf.readUInt16LE(lo + 28);
      const dataStart = lo + 30 + lNameLen + lExtraLen;
      const data = zipBuf.subarray(dataStart, dataStart + compSize);
      const raw = method === 8 ? zlib.inflateRawSync(data) : data;
      return { name, bytes: raw };
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("zip_no_csv");
}
function parseCsv(buff) {
  const text = new TextDecoder("gbk").decode(buff);
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => l.startsWith("商户订单号"));
  if (hi < 0) throw new Error("csv_no_header");
  const body = lines.slice(hi + 1);
  let income = 0.0;
  let expense = 0.0;
  const dates = [];
  let bad = 0;
  for (const ln of body) {
    const p = ln.split(",");
    if (p.length < 4) { bad++; continue; }
    const inc = parseFloat(p[2] || "0");
    const exp = parseFloat(p[3] || "0");
    if (Number.isNaN(inc) || Number.isNaN(exp)) { bad++; continue; }
    income += inc;
    expense += exp;
    if (p[1] && p[1].length >= 10) dates.push(p[1].slice(0, 10));
  }
  return {
    rows: body.length,
    bad,
    income: Number(income.toFixed(2)),
    expense: Number(expense.toFixed(2)),
    dateMin: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    dateMax: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
    header: lines[hi] || "",
  };
}
async function downloadBill(page) {
  await fs.mkdir(PERIOD_DIR, { recursive: true }).catch(() => {});
  const tmp = PERIOD_DIR + "/download-tmp.bin";
  await page.evaluate(() => {
    window.__egoOpenUrls = [];
    const orig = window.open;
    window.open = function (url) {
      try { window.__egoOpenUrls.push(String(url || "")); } catch (e) {}
      return orig.apply(window, arguments);
    };
  });
  await page.click('css=[data-ego-dl="1"]', { label: "download bill" });
  await sleep(800);
  const urls = await page.evaluate(() => (window.__egoOpenUrls || []).slice());
  const dlUrl = urls.find((u) => /downloadFile/i.test(u));
  if (!dlUrl) throw new Error("download_url_not_captured");
  const res = await page.fetch(dlUrl, { saveAs: tmp });
  const disp = (res && res.headers && res.headers["content-disposition"]) || "";
  const m = disp.match(/filename=([^;]+)/);
  const serverFile = m ? decodeURIComponent(m[1].trim().replace(/"/g, "")) : "";
  return { tmp, serverFile, bytes: (await fs.stat(tmp)).size };
}

function friendlyCsvName() {
  const from = JOB.from.split("-").map(Number);
  const to = JOB.to.split("-").map(Number);
  const monthEnd = new Date(to[0], to[1], 0).getDate();
  if (from[1] === to[1] && from[2] === 1 && to[2] === monthEnd) {
    return JOB.shop + "-对账中心-" + to[1] + "月.csv";
  }
  const label = (mm, dd) => mm + "月" + dd + "日";
  return JOB.shop + "-对账中心-" + label(from[1], from[2]) + "-" + label(to[1], to[2]) + ".csv";
}

function buildManifest(r) {
  const lines = [
    "# 账单信息 · " + JOB.shop + " · " + JOB.period,
    "",
    "| 项 | 值 |",
    "|---|---|",
    "| 店铺 | " + JOB.shop + " |",
    "| 平台 | 拼多多（对账中心 / 货款账户） |",
    "| 期间 | " + JOB.expectValue.replace(" ~ ", " ~ ") + " |",
    "| 账单申请时间（页面显示） | " + (r.applyTime || "未取到") + " |",
    "| 原始导出包 | `" + r.zipName + "` |",
    "| 解压后数据 | `" + r.csvName + "`（GBK） |",
    ...(r.originalCsvName ? ["| 平台原始文件名 | `" + r.originalCsvName + "` |"] : []),
    "| CSV 总行数 | " + r.rows + " 行（含 " + r.bad + " 行非数据行） |",
    "| 收入合计 | " + r.income.toFixed(2) + " 元" + (r.pageSummary ? "（页面 " + r.pageSummary.incomeN + " 笔）" : "") + " |",
    "| 支出合计 | " + r.expense.toFixed(2) + " 元" + (r.pageSummary ? "（页面 " + r.pageSummary.expenseN + " 笔）" : "") + " |",
    "| 日期范围核对 | " + r.dateMin + " ~ " + r.dateMax + (r.dateOk ? " ✅" : " ❌") + " |",
    "| 与页面查询汇总 | " + (r.matched === null ? "未比对（无页面参考值）" : r.matched ? "一致 ✅" : "不一致 ❌") + " |",
    "",
    "## CSV 结构备注",
    "",
    "- GBK 编码；前 4 行是说明（第 2 行含起止时间）",
    "- 第 5 行才是列名：`商户订单号,入账时间,收入金额(+元),支出金额(-元),账务类型,备注,业务描述`",
    "",
    "## 执行",
    "",
    "- worker-export.mjs（" + new Date().toISOString() + "）",
  ];
  return lines.join("\n");
}

// 重写 账单信息.md 时保留 pdd-promo-cost 注入的推广花费块
async function withPromoBlock(manifest) {
  try {
    const existing = await fs.readFile(PERIOD_DIR + "/账单信息.md", "utf8");
    const m = existing.match(/<!-- promo:start -->[\s\S]*?<!-- promo:end -->/);
    if (m && !manifest.includes("<!-- promo:start -->")) {
      return manifest.replace(/\s*$/,"") + "\n\n" + m[0];
    }
  } catch (e) {}
  return manifest;
}

// ── 主流程 ───────────────────────────────────
let task = null;
let page = null;

let availableProfiles = [];
let actualShop = null;

async function resolveSpace() {
  const spaces = await listTaskSpaces();
  availableProfiles = spaces.map((s) => ({ id: s.id, name: s.name || "", profile: s.profileName || "" }));
  const byProfile = spaces.find((s) => String(s.profileName || "") === String(JOB.profile || ""));
  const byName = spaces.find((s) => String(s.name || "") === JOB.shop);
  const entry = byProfile || byName;
  if (!entry) throw new Error("space_not_found_for:" + (JOB.profile || JOB.shop));
  task =
    entry.ownership === "user"
      ? await claimTaskSpace(entry.id)
      : entry.ownership === "agentDelegatedToUser"
        ? await takeOverTaskSpace(entry.id)
        : await taskSpace(entry.id);
  return entry.id;
}

async function ensureBillsPage() {
  let found = null;
  for (const p of await task.pages()) {
    const u = String(await p.url().catch(() => ""));
    if (/\/main\/bills(\?|#|$)/.test(u) && !u.includes("export-history")) { found = p; break; }
  }
  page = found || (await task.newPage());
  const cur = String(await page.url().catch(() => ""));
  if (cur.includes("export-history") || !/\/main\/bills(\?|#|$)/.test(cur)) await page.goto(BILLS_URL, { timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    const u = String(await page.url().catch(() => ""));
    if (!/\/main\/auth/.test(u)) break;
    await sleep(400);
  }
  await page.waitForFunction(() => (document.body.innerText || "").includes("对账中心"), undefined, { timeout: 15000 }).catch(() => {});
  await sleep(200);
}

async function readShopName() {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const m = t.match(/返回商家后台\s*(.+?)\s*退出/);
    if (m) return m[1].trim();
    const el = [...document.querySelectorAll("[class*='Header_header_name']")].find((e) => e.getBoundingClientRect().width > 0);
    return el ? (el.innerText || "").trim() : "";
  });
}

async function runExportFlow(tasks, rec) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const oldRange = JOB.from <= cutoff.toISOString().slice(0, 10);

  let pageSummary = null;
  let sumText = "";
  if (!oldRange) {
    // 1) 查询页设日期 + 查询，拿页面汇总（作为 CSV 校验基准）
    await setMonthRange(page, "query");
    await page.click("loc=role:button[name='查询']", { label: "query" });
    await waitQueryDone(page);
    sumText = (await readSummary(page)).stats;
    pageSummary = parseSummary(sumText);
    log("page summary", pageSummary || sumText);
  } else {
    // 超过 12 个月：查询会弹限制气泡，直接去导出页
    log("old_range_skip_query", JOB.from + " ~ " + JOB.to);
  }

  // 2) 导出页签独立设日期
  await page.click("text=\"货款明细导出\"", { label: "switch export tab" });
  await sleep(300);
  const expInit = await page.evaluate(() => {
    const inp = [...document.querySelectorAll("input")].find((e) => e.placeholder && /开始日期/.test(e.placeholder));
    return inp ? inp.value : null;
  });
  if (expInit !== JOB.expectValue) await setMonthRange(page, "export");

  // 3) 点导出，记时间
  const clickedAt = Date.now();
  await page.click("loc=role:button[name='导出']", { label: "click export" });
  log("export clicked");

  // 4) 打开导出历史（新页）
  await page.evaluate(() => {
    for (const a of document.querySelectorAll("a")) {
      const r = a.getBoundingClientRect();
      if (r.width > 0 && (a.innerText || "").trim() === "导出历史") a.setAttribute("data-ego-hist", "1");
    }
  });
  const popPromise = page.waitForEvent("popup", { timeout: 6000 }).catch(() => null);
  await page.click('css=[data-ego-hist="1"]', { label: "open export history" });
  const pop = await popPromise;
  let hist = pop && pop.label ? pop : null;
  if (!hist) {
    const tabs = await task.tabs();
    const cand = tabs.filter((t) => t.label && String(t.url || "").includes("export-history")).slice(-1)[0];
    if (cand) hist = task.page(cand.label);
  }
  if (!hist) throw new Error("history_page_not_found");
  await hist.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
  log("history opened");

  // 5) 轮询记录（只认点击之后生成的记录）
  const deadline = Date.now() + MAX_WAIT_SEC * 1000;
  let card = null;
  while (Date.now() < deadline) {
    card = await findCard(hist, clickedAt - 120000);
    if (card && card.found && card.hasDownload) break;
    await sleep(1200);
  }
  const applyTime = card && card.applyTime ? parseApplyTime(card.text) : null;

  if (!card || !card.found) {
    // 记录还没出现：记 pending
    await upsertTask(tasks, rec, { status: "pending", applyTime: null, pageSummary });
    return { status: "pending", note: "record_not_visible", pageSummary, sumText };
  }
  if (!card.hasDownload) {
    await upsertTask(tasks, rec, { status: /已过期/.test(card.text) ? "expired" : "pending", applyTime: applyTime && applyTime.text, pageSummary });
    return { status: /已过期/.test(card.text) ? "expired" : "pending", note: "generating", applyTime: applyTime && applyTime.text, pageSummary };
  }

  // 6) 下载 + 校验 + 归档
  const dl = await downloadBill(hist);
  const ts = (dl.serverFile.match(/_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_/) || [])[1];
  const zipName = "货款明细_" + JOB.period + "_" + (ts || "export") + ".zip";
  const zipPath = PERIOD_DIR + "/" + zipName;
  await fs.rename(dl.tmp, zipPath);
  const zipBuf = await fs.readFile(zipPath);
  const { name: originalCsvName, bytes: csvBytes } = unzipCsv(zipBuf);
  const csvName = friendlyCsvName();
  await fs.writeFile(PERIOD_DIR + "/" + csvName, csvBytes);
  const stats = parseCsv(csvBytes);
  const dateOk = stats.dateMin === JOB.from && stats.dateMax === JOB.to;
  const matched = pageSummary ? Math.abs(stats.income - pageSummary.income) < 0.005 && Math.abs(stats.expense - pageSummary.expense) < 0.005 : null;
  const applyTimeText = (applyTime && applyTime.text) || (ts ? ts.replace(/-(\d{2})-(\d{2})/g, " $1:$2").replace(/-/g, "-") : null);
  const manifest = buildManifest({
    zipName, csvName, originalCsvName, rows: stats.rows, bad: stats.bad, income: stats.income, expense: stats.expense,
    dateMin: stats.dateMin, dateMax: stats.dateMax, dateOk, matched, pageSummary: pageSummary || null,
    applyTime: applyTimeText,
  });
  await fs.writeFile(PERIOD_DIR + "/账单信息.md", await withPromoBlock(manifest), "utf8");
  await upsertTask(tasks, rec, {
    status: "done", applyTime: applyTimeText, file: zipName, csvName, sourceCsv: originalCsvName, rows: stats.rows,
    income: stats.income, expense: stats.expense, matched, size: dl.bytes, pageSummary,
  });
  return {
    status: matched === false ? "mismatch" : "done",
    zip: zipPath, size: dl.bytes, rows: stats.rows,
    income: stats.income, expense: stats.expense, matched, dateMin: stats.dateMin, dateMax: stats.dateMax,
    pageSummary,
  };
}

async function runCollectFlow(tasks, rec) {
  // 直接打开导出历史
  if (!String(await page.url().catch(() => "")).includes("export-history")) {
    await page.goto(HIST_URL, { timeout: 60000 });
  }
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => (document.body.innerText || "").includes("账单申请时间")).catch(() => false);
    if (ok) break;
    await sleep(400);
  }
  const card = await findCard(page, 0);
  log("collect card", card.found ? card.text.slice(0, 120) : "not_found");
  if (!card || !card.found) return { status: "missing" };
  const applyTime = card.applyTime ? parseApplyTime(card.text) : null;
  if (!card.hasDownload) {
    await upsertTask(tasks, rec, { status: /已过期/.test(card.text) ? "expired" : "pending", applyTime: applyTime && applyTime.text });
    return { status: /已过期/.test(card.text) ? "expired" : "pending", applyTime: applyTime && applyTime.text };
  }
  const dl = await downloadBill(page);
  const ts = (dl.serverFile.match(/_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_/) || [])[1];
  const zipName = "货款明细_" + JOB.period + "_" + (ts || "export") + ".zip";
  const zipPath = PERIOD_DIR + "/" + zipName;
  await fs.rename(dl.tmp, zipPath);
  const zipBuf = await fs.readFile(zipPath);
  const { name: originalCsvName, bytes: csvBytes } = unzipCsv(zipBuf);
  const csvName = friendlyCsvName();
  await fs.writeFile(PERIOD_DIR + "/" + csvName, csvBytes);
  const stats = parseCsv(csvBytes);
  const dateOk = stats.dateMin === JOB.from && stats.dateMax === JOB.to;
  const pageSummary = (rec && rec.pageSummary) || null;
  const matched = pageSummary ? Math.abs(stats.income - pageSummary.income) < 0.005 && Math.abs(stats.expense - pageSummary.expense) < 0.005 : null;
  await fs.writeFile(PERIOD_DIR + "/账单信息.md", await withPromoBlock(buildManifest({
    zipName, csvName, originalCsvName, rows: stats.rows, bad: stats.bad, income: stats.income, expense: stats.expense,
    dateMin: stats.dateMin, dateMax: stats.dateMax, dateOk, matched, pageSummary,
    applyTime: (applyTime && applyTime.text) || null,
  })), "utf8");
  await upsertTask(tasks, rec, {
    status: "done", applyTime: applyTime && applyTime.text, file: zipName, csvName, sourceCsv: originalCsvName, rows: stats.rows,
    income: stats.income, expense: stats.expense, matched, size: dl.bytes, pageSummary,
  });
  return {
    status: matched === false ? "mismatch" : "done",
    zip: zipPath, size: dl.bytes, rows: stats.rows,
    income: stats.income, expense: stats.expense, matched, dateMin: stats.dateMin, dateMax: stats.dateMax,
  };
}

async function upsertTask(tasks, rec, patch) {
  const idx = tasks.tasks.findIndex((t) => t.period === JOB.period && (t.from === undefined || t.from === JOB.from));
  const base = {
    period: JOB.period, from: JOB.from, to: JOB.to, profile: JOB.profile, shop: JOB.shop,
    attempts: (rec && rec.attempts) || 0,
  };
  const merged = { ...(rec || {}), ...base, ...patch, lastChecked: new Date().toISOString() };
  if (idx >= 0) tasks.tasks[idx] = merged;
  else tasks.tasks.push(merged);
  await writeTasks(tasks);
}

async function readShopNameFromPage(pg) {
  return pg.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const el = [...document.querySelectorAll("[class*='Header_header_name']")].find(vis);
    if (el) return (el.innerText || "").trim();
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const m = t.match(/返回商家后台\s*(.+?)\s*退出/);
    if (m) return m[1].trim();
    const m2 = t.match(/([^\s]{2,20})\s*主账号/);
    return m2 ? m2[1].trim() : "";
  }).catch(() => "");
}

// 扫描 ego 里所有 profile，读每家后台首页的店铺名，返回 [{shop, profile}]
async function discoverShops() {
  const spaces = await listTaskSpaces();
  const uniq = [];
  for (const s of spaces) {
    const pn = String(s.profileName || "");
    if (!pn) continue;
    if (uniq.some((u) => u.profileName === pn)) continue;
    uniq.push({ profileName: pn, id: s.id, profileId: s.profileId || "" });
  }
  const found = [];
  for (const u of uniq) {
    let t = null;
    try {
      const entry = (await listTaskSpaces()).find((s) => s.id === u.id);
      if (!entry) continue;
      t =
        entry.ownership === "user"
          ? await claimTaskSpace(entry.id)
          : entry.ownership === "agentDelegatedToUser"
            ? await takeOverTaskSpace(entry.id)
            : await taskSpace(entry.id);
      const pg = await t.newPage();
      await pg.goto("https://mms.pinduoduo.com/home", { timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(700);
      const shop = await readShopNameFromPage(pg);
      if (shop) found.push({ shop, profile: u.profileName, profileId: u.profileId });
      log("discover", u.profileName + " → " + (shop || "(未识别)"));
    } catch (e) {
      log("discover_err", u.profileName + ": " + String((e && e.message) || e));
    } finally {
      try { if (t) await t.finish({ keep: [] }); } catch (e) {}
    }
  }
  return found;
}

// 把发现结果并回 _stores.json（自动维护，不需要用户填映射）
async function updateRegistry(found) {
  const regPath = JOB.storesConfig || ROOT + "/_stores.json";
  let reg = { version: 1, root: ROOT, stores: [] };
  try { reg = JSON.parse(await fs.readFile(regPath, "utf8")); } catch (e) {}
  if (!reg.stores) reg.stores = [];
  if (!reg.root) reg.root = ROOT;
  for (const f of found) {
    let e = reg.stores.find((s) => s.shop === f.shop);
    if (!e) { e = { shop: f.shop, profile: f.profile, enabled: true }; reg.stores.push(e); }
    else { e.profile = f.profile; if (e.enabled === undefined) e.enabled = true; }
  }
  await fs.mkdir(ROOT, { recursive: true }).catch(() => {});
  await fs.writeFile(regPath, JSON.stringify(reg, null, 2), "utf8");
  return reg;
}

async function openShopSpace() {
  let shopName = "";
  if (JOB.profile) {
    try {
      await resolveSpace();
      await ensureBillsPage();
      shopName = await readShopName();
      actualShop = shopName;
      log("shop", actualShop);
    } catch (e) {
      log("profile_unusable", String((e && e.message) || e));
      shopName = "";
    }
  }

  // profile 缺失 / 对不上 / 店铺名不符 → agent 自己扫 profile 找到正确店铺
  if (!shopName || shopName !== JOB.shop) {
    if (task) {
      try { await task.finish({ keep: [] }); } catch (e) {}
      task = null;
    }
    log("discover_for", JOB.shop);
    const found = await discoverShops();
    const hit = found.find((f) => f.shop === JOB.shop);
    if (hit) {
      JOB.profile = hit.profile;
      await updateRegistry([hit]);
      await resolveSpace();
      await ensureBillsPage();
      shopName = await readShopName();
      actualShop = shopName;
      log("shop(discovered)", actualShop);
    }
    if (!hit || shopName !== JOB.shop) throw new Error("shop_not_logged_in:" + JOB.shop);
  }
  return shopName;
}

async function runDoctorMode() {
  const shopName = await openShopSpace();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const oldRange = JOB.from <= cutoff.toISOString().slice(0, 10);
  const out = { status: "doctor_ok", shop: shopName, from: JOB.from, to: JOB.to, oldRange };
  if (!oldRange) {
    await setMonthRange(page, "doctor");
    await page.click("loc=role:button[name='查询']", { label: "doctor query" });
    await waitQueryDone(page);
    out.dateValue = (await readCal(page)).value;
    const sumText = (await readSummary(page)).stats;
    out.summary = parseSummary(sumText);
    if (out.dateValue !== JOB.expectValue) throw new Error("doctor_date_mismatch:" + out.dateValue);
    if (!out.summary) out.status = "doctor_warn";
  } else {
    await page.click("text=\"货款明细导出\"", { label: "doctor export tab" });
    await sleep(300);
    const init = await page.evaluate(() => {
      const inp = [...document.querySelectorAll("input")].find((e) => e.placeholder && /开始日期/.test(e.placeholder));
      return inp ? inp.value : null;
    });
    if (init !== JOB.expectValue) await setMonthRange(page, "doctor");
    out.dateValue = (await readCal(page)).value;
    out.note = "老区间：只验证导出页能选日期，不提交导出";
  }
  out.profile = JOB.profile;
  return out;
}

async function main() {
  const shopName = await openShopSpace();
  const tasks = await readTasks();
  const rec = tasks.tasks.find((t) => t.period === JOB.period && (t.from === undefined || t.from === JOB.from));
  const doneFile = rec && rec.status === "done" && rec.file;
  if (doneFile) {
    const p = PERIOD_DIR + "/" + rec.file;
    const exists = await fs.stat(p).then(() => true).catch(() => false);
    if (exists && JOB.mode !== "force") return { status: "skipped", zip: p, note: "already_done" };
  }

  if (JOB.mode === "collect" || (rec && ["pending", "ready"].includes(rec.status))) {
    if (rec && rec.status === "pending") log("task pending → collect");
    return await runCollectFlow(tasks, rec);
  }
  return await runExportFlow(tasks, rec);
}

if (JOB.mode === "doctor") {
  let dres;
  try {
    dres = await runDoctorMode();
    dres.ok = true;
  } catch (e) {
    dres = { ok: false, status: "doctor_failed", error: String((e && e.message) || e) };
  }
  await writeResult(dres);
  try {
    if (task) await task.finish({ keep: [] });
  } catch (e) {}
  console.log("WORKER_RESULT=" + JSON.stringify({ mode: "doctor", status: dres.status, shop: dres.shop }));
} else if (JOB.mode === "discover") {
  let dres;
  try {
    const found = await discoverShops();
    await updateRegistry(found);
    dres = { ok: true, status: "discovered", shops: found, registry: JOB.storesConfig || ROOT + "/_stores.json" };
    await writeResult(dres);
  } catch (e) {
    dres = { ok: false, status: "failed", error: String((e && e.message) || e) };
    await writeResult(dres);
  }
  console.log("WORKER_RESULT=" + JSON.stringify({ mode: "discover", status: dres.status, shops: (dres.shops || []).length }));
} else {
  let result;
  try {
    await acquireLock();
    result = await main();
    await writeResult({ ok: result.status === "done" || result.status === "skipped", ...result });
  } catch (e) {
    const msg = String((e && e.message) || e);
    log("ERROR", msg);
    result = { status: "failed", error: msg };
    if (msg.includes("space_not_found_for") || msg.includes("shop_not_logged_in")) {
      result.needs = {
        code: "shop_not_logged_in",
        question: "在 ego 的各个 profile 里没找到店铺「" + JOB.shop + "」，可能还没登录。请用户登录该店（或把该店加进 ego）后重跑。",
        availableProfiles,
      };
    } else if (msg.includes("shop_mismatch")) {
      result.needs = {
        code: "shop_mismatch",
        question: "profile 打开的是「" + (actualShop || "?") + "」，与目标店铺「" + JOB.shop + "」不一致；可重跑一次让 agent 自动重新发现。",
        actualShop,
      };
    }
    await writeResult({ ok: false, ...result });
  } finally {
    await releaseLock();
    try {
      if (task) await task.finish({ keep: [] });
    } catch (e) {}
  }
  console.log("WORKER_RESULT=" + JSON.stringify({ shop: JOB.shop, period: JOB.period, status: result && result.status, elapsed: ((Date.now() - t0) / 1000).toFixed(1) }));
}
