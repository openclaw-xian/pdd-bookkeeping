// batch-run.mjs — 多店并发账单导出调度器（普通 Node 进程，不依赖 ego 运行时）
// 用法：node batch-run.mjs <config.json>
// config 例（除 period/from/to 外都可选）：
// {
//   "period": "2026-08", "from": "2026-08-01", "to": "2026-08-31",
//   "concurrency": 3, "maxWaitSec": 45, "mode": "auto", "force": false,
//   "root": "D:/对账账单",
//   "only": ["店铺A"]
// }
// 可选覆盖项：root / storesConfig / runRoot / ego / worker / runtimeDir / allowC
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

const CFG_PATH = process.argv[2];
if (!CFG_PATH) {
  console.error("用法: node batch-run.mjs <config.json>");
  process.exit(2);
}
const CFG = JSON.parse(await fs.readFile(CFG_PATH, "utf8"));

const HOME = os.homedir();
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF_WORKER = path.join(SELF_DIR, "worker-export.mjs").replace(/\\/g, "/");

// ego-browser：配置 > 环境变量 > 自动探测（~/.local/share/ego、~/.local/bin、PATH）
function findEgo() {
  const cands = [
    path.join(HOME, ".local", "share", "ego", "active_version_dir", "ego-browser.exe"),
    path.join(HOME, ".local", "bin", "ego-browser.exe"),
  ];
  for (const c of cands) if (existsSync(c)) return c;
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, "ego-browser" + e);
      if (existsSync(p)) return p;
    }
  }
  return "ego-browser"; // 交给 PATH 解析；找不到时 spawn 会报错并写进 run report
}

const ROOT = String(CFG.root || process.env.PDD_BILLS_ROOT || "D:/对账账单").replace(/\\/g, "/").replace(/\/$/, "");
const EGO = String(CFG.ego || process.env.PDD_EGO_BROWSER || findEgo()).replace(/\\/g, "/");
const WORKER = String(CFG.worker || SELF_WORKER).replace(/\\/g, "/");
const STORES_CFG = String(CFG.storesConfig || path.join(ROOT, "_stores.json")).replace(/\\/g, "/");
const RUN_ROOT = String(CFG.runRoot || path.join(ROOT, "_runs")).replace(/\\/g, "/").replace(/\/$/, "");
const RUNTIME = String(CFG.runtimeDir || path.join(os.tmpdir(), "pdd-bills-runtime")).replace(/\\/g, "/").replace(/\/$/, "");
const CONCURRENCY = Math.max(1, Number(CFG.concurrency || 3));
const MODE = CFG.mode || "auto";
const DOCTOR = !!CFG.doctor || MODE === "doctor";
const MAX_WAIT = Number(CFG.maxWaitSec || 45);
const JOB_TIMEOUT_SEC = Number(CFG.jobTimeoutSec || 300);
const cutoffIso = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
})();

// 自动发现：扫描 ego 所有 profiles 识别店铺，写入 _stores.json（不需要用户填映射）
async function runDiscovery() {
  const dir = RUNTIME + "/" + RUN_ID + "-discover";
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const wrapper = dir + "/discover.mjs";
  const resultPath = path.join(os.tmpdir(), "pdd-bills-discover-" + RUN_ID + ".json");
  const job = { mode: "discover", root: ROOT, storesConfig: STORES_CFG, resultPath };
  const code = "globalThis.__JOB = " + JSON.stringify(job) + ";\nawait import('file:///" + WORKER + "');\n";
  await fs.writeFile(wrapper, code, "utf8");
  const child = spawn(EGO, ["nodejs", "-e", "await import('file:///" + wrapper + "')"], { stdio: "ignore", windowsHide: true });
  await new Promise((res) => child.on("exit", res));
  try {
    return JSON.parse(await fs.readFile(resultPath, "utf8"));
  } catch (e) {
    return null;
  }
}

const from = String(CFG.from || "");
const to = String(CFG.to || "");
let period = String(CFG.period || "");
if (!period && /^20\d\d-\d\d-\d\d$/.test(from) && /^20\d\d-\d\d-\d\d$/.test(to)) {
  period = from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : from + "_" + to;
}
const RUN_ID = CFG.runId || (period || "run") + "-" + stamp;
const RUN_DIR = RUN_ROOT + "/" + RUN_ID;
const RESULT_DIR = RUN_DIR + "/results";
const LOG_DIR = RUN_DIR + "/logs";

// ── 预检：缺东西就停下，让 agent 去问用户（不悄悄创建/不硬跑） ──
const issues = [];
const warnings = [];
const todayIso = new Date().toISOString().slice(0, 10);
const addIssue = (code, question, extra = {}) => issues.push({ code, question, ...extra });

if (/^[A-Za-z]:/.test(ROOT) && ROOT.slice(0, 1).toUpperCase() === "C" && !CFG.allowC) {
  addIssue("root_on_c_drive", "账单根目录在 C 盘：" + ROOT + "。是否换到非系统盘？或确认允许写 C 盘（配置 allowC:true）。", { root: ROOT });
}
if (!existsSync(ROOT)) {
  if (CFG.autoCreateRoot && !(/^[A-Za-z]:/.test(ROOT) && ROOT.slice(0, 1).toUpperCase() === "C" && !CFG.allowC)) {
    await fs.mkdir(ROOT, { recursive: true }).catch(() => {});
  }
  if (!existsSync(ROOT)) {
    addIssue("root_missing", "账单根目录不存在：" + ROOT + "。是否需要创建？还是换一个目录（配置 root）？确认创建后可加 autoCreateRoot:true 再跑。", { root: ROOT, action: "create_root" });
  }
}
if (!(/^20\d\d-\d\d$/.test(period) || /^20\d\d-\d\d-\d\d_20\d\d-\d\d-\d\d$/.test(period))) {
  addIssue("period_invalid", "period 必须是 YYYY-MM（整月）或 YYYY-MM-DD_YYYY-MM-DD（区间），当前为：" + JSON.stringify(period), { period });
}
if (!/^20\d\d-\d\d-\d\d$/.test(from) || !/^20\d\d-\d\d-\d\d$/.test(to)) {
  addIssue("range_invalid", "from/to 必须是 YYYY-MM-DD，当前为 from=" + from + " to=" + to, { from, to });
} else {
  if (from > to) addIssue("range_reversed", "起始日 " + from + " 晚于结束日 " + to + "，请确认区间。", { from, to });
  if (to > todayIso) addIssue("range_in_future", "结束日 " + to + " 在未来（今天 " + todayIso + "），请确认是否要查未来日期。", { to, today: todayIso });
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  if (from <= cutoff.toISOString().slice(0, 10)) {
    warnings.push({ code: "old_period", note: "起始日超过最近 12 个月，平台走慢队列，可能返回 pending（需要下一次 collect）。" });
  }
}
if (EGO !== "ego-browser" && !existsSync(EGO)) {
  addIssue("ego_not_found", "ego-browser 不可用：" + EGO + "。请安装/启动 ego，或配置 ego 路径（也可设环境变量 PDD_EGO_BROWSER）。", { ego: EGO });
}

let STORES = null;
if (!existsSync(STORES_CFG)) {
  // 店铺清单缺省时：agent 自己扫描 ego profiles 建清单（不需要用户填映射）
  if (CFG.discover !== false && existsSync(ROOT) && (EGO === "ego-browser" || existsSync(EGO))) {
    console.log("DISCOVER=auto（店铺清单缺失，先扫描 ego profiles 识别店铺）");
    const disc = await runDiscovery();
    if (disc && disc.shops && disc.shops.length) console.log("DISCOVER=found " + disc.shops.map((s) => s.shop).join(" / "));
  }
}
if (!existsSync(STORES_CFG)) {
  addIssue("stores_config_missing", "店铺清单不存在且自动发现没有结果：" + STORES_CFG + "。请确认 ego 里至少登录一家店，或提供店铺名清单。", {
    path: STORES_CFG,
    template: { version: 1, root: ROOT, stores: [{ shop: "<店铺名>", profile: "<ego profileName>", enabled: true }] },
  });
} else {
  try {
    STORES = JSON.parse(await fs.readFile(STORES_CFG, "utf8"));
  } catch (e) {
    addIssue("stores_config_invalid", "店铺清单不是合法 JSON：" + STORES_CFG, { path: STORES_CFG, error: String(e && e.message || e) });
  }
}

let stores = [];
if (STORES) {
  const all = (STORES.stores || []).filter((s) => s.enabled !== false && s.shop);
  const only = CFG.shops || (CFG.only && CFG.only.length ? CFG.only : null);
  stores = only ? all.filter((s) => only.includes(s.shop)) : all;
  if (!stores.length) {
    const available = (STORES.stores || []).map((s) => s.shop).filter(Boolean);
    addIssue("no_store_selected", "没有可跑的店（only 可能写错，或都 disabled）。可选：" + (available.join(" / ") || "（清单为空）"), { available });
  }
}

if (issues.length) {
  const preflight = { status: "needs_user_input", runId: RUN_ID, period, root: ROOT, issues, warnings };
  const pfPath = path.join(os.tmpdir(), "pdd-bills-preflight.json");
  await fs.writeFile(pfPath, JSON.stringify(preflight, null, 1), "utf8").catch(() => {});
  console.log("PREFLIGHT=needs_user_input");
  console.log(JSON.stringify(preflight, null, 1));
  console.log("PREFLIGHT_FILE=" + pfPath.replace(/\\/g, "/"));
  console.log("→ 请先向用户确认以上问题（创建目录 / 提供店铺清单 / 改路径 / 修正日期），处理完再重跑。");
  process.exit(3);
}

const yearText = from.slice(0, 4) + "年";
const monthText = String(parseInt(from.slice(5, 7), 10)) + "月";
const fromDay = parseInt(from.slice(8, 10), 10);
const toDay = parseInt(to.slice(8, 10), 10);
const fromPrefix = from;
const expectValue = from + " 00:00:00 ~ " + to + " 23:59:59";

if (!DOCTOR) {
  await fs.mkdir(RESULT_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}
await fs.mkdir(RUNTIME + "/" + RUN_ID, { recursive: true });

console.log("RUN_ID=" + RUN_ID);
console.log("period=" + period + " stores=" + stores.length + " concurrency=" + CONCURRENCY + " mode=" + MODE);

function mkJob(store) {
  const oldRange = from <= cutoffIso;
  const wait = CFG.maxWaitSec != null ? MAX_WAIT : oldRange ? 12 : MAX_WAIT;
  return {
    shop: store.shop,
    profile: store.profile,
    period,
    from,
    to,
    fromPrefix,
    yearText,
    monthText,
    fromDay,
    toDay,
    expectValue,
    root: STORES.root || ROOT,
    storesConfig: STORES_CFG,
    mode: CFG.force ? "force" : MODE,
    force: !!CFG.force,
    maxWaitSec: wait,
  };
}

async function runJob(store, i, jitterMs) {
  const job = mkJob(store);
  const name = String(i);
  const wrapper = RUNTIME + "/" + RUN_ID + "/job-" + name + ".mjs";
  job.resultPath = RESULT_DIR + "/" + store.shop + ".json";
  job.logPath = LOG_DIR + "/" + store.shop + ".log";
  const code =
    "globalThis.__JOB = " + JSON.stringify(job) + ";\n" +
    "await import('file:///" + WORKER.replace(/\\/g, "/") + "');\n";
  await fs.writeFile(wrapper, code, "utf8");
  await sleep(jitterMs);

  const started = Date.now();
  const child = spawn(EGO, ["nodejs", "-e", "await import('file:///" + wrapper.replace(/\\/g, "/") + "')"], {
    stdio: "ignore",
    windowsHide: true,
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { child.kill(); } catch (e) {}
  }, JOB_TIMEOUT_SEC * 1000);
  await new Promise((resolve) => child.on("exit", resolve));
  clearTimeout(timeout);

  let result = null;
  for (let k = 0; k < 10 && !result; k++) {
    try {
      result = JSON.parse(await fs.readFile(job.resultPath, "utf8"));
    } catch (e) {
      await sleep(300);
    }
  }
  if (!result) result = { ok: false, status: "failed", error: timedOut ? "job_timeout" : "no_result_file" };
  return { shop: store.shop, profile: store.profile, result, wallSec: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

// 只读自检：不导出、不写账单目录、不改 .tasks.json
async function runDoctorJob(store, i) {
  const job = mkJob(store);
  job.mode = "doctor";
  delete job.period;
  delete job.logPath;
  job.resultPath = path.join(os.tmpdir(), "pdd-bills-doctor-" + RUN_ID + "-" + i + ".json");
  const dir = RUNTIME + "/" + RUN_ID + "-doctor";
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const wrapper = dir + "/job-" + i + ".mjs";
  const code = "globalThis.__JOB = " + JSON.stringify(job) + ";\nawait import('file:///" + WORKER + "');\n";
  await fs.writeFile(wrapper, code, "utf8");
  const started = Date.now();
  const child = spawn(EGO, ["nodejs", "-e", "await import('file:///" + wrapper + "')"], { stdio: "ignore", windowsHide: true });
  const timeout = setTimeout(() => { try { child.kill(); } catch (e) {} }, JOB_TIMEOUT_SEC * 1000);
  await new Promise((resolve) => child.on("exit", resolve));
  clearTimeout(timeout);
  let result = null;
  for (let k = 0; k < 10 && !result; k++) {
    try {
      result = JSON.parse(await fs.readFile(job.resultPath, "utf8"));
    } catch (e) {
      await sleep(300);
    }
  }
  if (!result) result = { ok: false, status: "doctor_failed", error: "no_result_file" };
  return { shop: store.shop, result, wallSec: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

if (DOCTOR) {
  const docResults = [];
  for (let i = 0; i < stores.length; i++) {
    const r = await runDoctorJob(stores[i], i);
    docResults.push(r);
    const s = r.result || {};
    console.log("DOCTOR " + r.shop + " status=" + (s.status || "?") + " wall=" + r.wallSec + "s" + (s.error ? " err=" + s.error : ""));
  }
  const ok = docResults.every((r) => r.result && r.result.ok);
  const out = { doctor: true, period, from, to, ok, stores: docResults };
  const reportPath = path.join(os.tmpdir(), "pdd-bills-doctor-" + RUN_ID + ".json");
  await fs.writeFile(reportPath, JSON.stringify(out, null, 1), "utf8").catch(() => {});
  console.log("\nDOCTOR_RESULT=" + JSON.stringify(out, null, 1));
  console.log("DOCTOR_REPORT=" + reportPath.replace(/\\/g, "/"));
  process.exit(ok ? 0 : 1);
}

// 并发池 + 错峰
const completed = [];
let next = 0;
async function workerLoop() {
  while (true) {
    const idx = next++;
    if (idx >= stores.length) return;
    const jitter = Math.floor(Math.random() * 350);
    const r = await runJob(stores[idx], idx, jitter).catch((e) => ({
      shop: stores[idx].shop, profile: stores[idx].profile, result: { ok: false, status: "failed", error: String(e && e.message || e) }, wallSec: 0,
    }));
    completed.push(r);
    const s = r.result || {};
    console.log("DONE " + r.shop + " status=" + (s.status || "?") + " wall=" + r.wallSec + "s" + (s.error ? " err=" + s.error : ""));
  }
}
const loops = [];
for (let k = 0; k < Math.min(CONCURRENCY, stores.length); k++) loops.push(workerLoop());
await Promise.all(loops);

completed.sort((a, b) => a.shop.localeCompare(b.shop));
const needsUser = completed
  .filter((c) => c.result && c.result.needs)
  .map((c) => ({ shop: c.shop, ...c.result.needs }));
const report = {
  runId: RUN_ID,
  period,
  from,
  to,
  concurrency: CONCURRENCY,
  mode: MODE,
  createdAt: new Date().toISOString(),
  warnings,
  needsUser,
  stores: completed.map((c) => ({
    shop: c.shop,
    profile: c.profile,
    status: (c.result && c.result.status) || "failed",
    ok: !!(c.result && c.result.ok),
    income: c.result && c.result.income,
    expense: c.result && c.result.expense,
    rows: c.result && c.result.rows,
    matched: c.result && c.result.matched,
    zip: c.result && c.result.zip,
    error: c.result && c.result.error,
    needs: (c.result && c.result.needs) || null,
    wallSec: c.wallSec,
  })),
};

await fs.writeFile(RUN_DIR + "/report.json", JSON.stringify(report, null, 1), "utf8");
const lines = [];
lines.push("run=" + RUN_ID + " period=" + period + " stores=" + completed.length);
for (const s of report.stores) {
  lines.push(
    [s.shop.padEnd(10), s.status.padEnd(9),
     "in=" + (s.income === undefined ? "-" : s.income), "out=" + (s.expense === undefined ? "-" : s.expense),
     "rows=" + (s.rows === undefined ? "-" : s.rows), "match=" + (s.matched === null || s.matched === undefined ? "-" : s.matched),
     "wall=" + s.wallSec + "s", s.error || ""].join(" ")
  );
}
if (warnings.length) lines.push("WARN: " + warnings.map((w) => w.code).join(", "));
if (needsUser.length) {
  lines.push("");
  lines.push("需要用户确认（needsUser）：");
  for (const n of needsUser) lines.push("- [" + n.shop + "] " + n.question);
}
await fs.writeFile(RUN_DIR + "/summary.txt", lines.join("\n"), "utf8");
console.log("\n" + lines.join("\n"));
console.log("REPORT=" + RUN_DIR + "/report.json");
if (needsUser.length) console.log("NEEDS_USER=" + JSON.stringify(needsUser));
