// run.mjs — 记账四件套总控（普通 Node，不直接操作浏览器）
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_PATH = process.argv[2];
if (!CFG_PATH) { console.error("用法: node run.mjs <suite-config.json>"); process.exit(2); }
const CFG = JSON.parse(await fs.readFile(CFG_PATH, "utf8"));

const HOME = os.homedir();
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = String(CFG.modulesRoot || path.join(SELF_DIR, "modules")).replace(/\\/g, "/").replace(/\/$/, "");
const ROOT = String(CFG.root || process.env.PDD_BILLS_ROOT || "D:/pdd-bills").replace(/\\/g, "/").replace(/\/$/, "");
const from = String(CFG.from || "");
const to = String(CFG.to || "");
let modules = Array.isArray(CFG.modules) ? CFG.modules.slice() : [];
if (modules.includes("all")) modules = ["bills", "promo", "orders", "kefu"];
const shops = (CFG.shops || []).map((s) => (typeof s === "string" ? { shop: s } : s)).filter((s) => s && s.shop);
const only = CFG.only && CFG.only.length ? CFG.only : null;
const todayIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const label = String(CFG.label || "");
const periodDirOverride = String(CFG.periodDir || "");

const CHILD = {
  bills: { file: "batch-run.mjs", cwd: path.join(MODULES_ROOT, "bills") },
  promo: { file: "run.mjs", cwd: path.join(MODULES_ROOT, "promo") },
  orders: { file: "run.mjs", cwd: path.join(MODULES_ROOT, "orders") },
  kefu: { file: "run.mjs", cwd: path.join(MODULES_ROOT, "kefu") },
};

function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function ymd(s) { return /^20\d\d-\d\d-\d\d$/.test(s || ""); }
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const RUN_DIR = path.join(ROOT, "_runs", "bookkeeping-" + stamp);
const CFG_DIR = path.join(RUN_DIR, "configs");
const LOG_DIR = path.join(RUN_DIR, "logs");
const issues = [];
const addIssue = (code, question, extra = {}) => issues.push({ code, question, ...extra });

// 统一期间：整月 YYYY-MM；跨月 from_to；可用 periodDir/label 覆盖
const f = from.split("-").map(Number);
const t = to.split("-").map(Number);
const monthEnd = new Date(t[0], t[1], 0).getDate();
const isWholeMonth = ymd(from) && ymd(to) && f[1] === t[1] && f[2] === 1 && t[2] === monthEnd;
const periodDir = periodDirOverride || (isWholeMonth ? from.slice(0, 7) : from + "_" + to);
const runLabel = label || (isWholeMonth ? String(t[1]) + "月" : f[1] + "月" + f[2] + "日-" + t[1] + "月" + t[2] + "日");

if (!ymd(from) || !ymd(to)) addIssue("range_invalid", "from/to 必须是 YYYY-MM-DD", { from, to });
else if (from > to) addIssue("range_reversed", "起始日晚于结束日");
else if (to > todayIso) addIssue("range_in_future", "结束日在未来（今天 " + todayIso + "）", { to });
if (!shops.length) addIssue("shops_missing", "config 需要 shops（总控不替你猜店铺）");
if (!modules.length) addIssue("modules_missing", "这次要导出什么：bills（账单）/ orders（订单）/ promo（推广费用）/ kefu（客服绩效）/ all（全部）");
if (CFG.root == null) addIssue("root_missing_config", "请显式配置 root（记账根目录）");
for (const m of modules) if (!CHILD[m]) addIssue("module_unknown", "未知模块：" + m, { module: m });
if (modules.includes("kefu") && ymd(from) && from < addDays(todayIso, -62)) {
  // 不阻塞其他模块；最后 kefu 标 skipped
}

if (issues.length) {
  console.log("PREFLIGHT=needs_user_input");
  console.log(JSON.stringify({ status: "needs_user_input", root: ROOT, from, to, issues }, null, 1));
  process.exit(3);
}
await fs.mkdir(CFG_DIR, { recursive: true });
await fs.mkdir(LOG_DIR, { recursive: true });

const useShops = only ? shops.filter((s) => only.includes(s.shop)) : shops;
const shopNames = useShops.map((s) => s.shop);
if (!useShops.length) {
  console.log(JSON.stringify({ status: "needs_user_input", issues: [{ code: "no_store_selected", question: "only 过滤后没有店铺" }] }, null, 1));
  process.exit(3);
}

function moduleConcurrency(m) { return Number((CFG[m] && CFG[m].concurrency) || CFG.concurrency || 3); }
function childConfig(m) {
  const common = { root: ROOT, from, to, shops: useShops };
  if (m === "bills") {
    return {
      period: periodDir, from, to, root: ROOT,
      concurrency: moduleConcurrency("bills"),
      mode: "auto", maxWaitSec: Number((CFG.bills && CFG.bills.maxWaitSec) || 45),
      autoCreateRoot: true,
      shops: shopNames, // pdd-bills 这里只接受店铺名字符串
      allowC: !!CFG.allowC,
    };
  }
  if (m === "promo") {
    return { ...common, concurrency: moduleConcurrency("promo"), allowC: !!CFG.allowC };
  }
  if (m === "orders") {
    return { ...common, concurrency: moduleConcurrency("orders"), retries: Number((CFG.orders && CFG.orders.retries) ?? 1), reuseExisting: !!(CFG.orders && CFG.orders.reuseExisting), allowC: !!CFG.allowC };
  }
  if (m === "kefu") {
    return { ...common, concurrency: moduleConcurrency("kefu"), retentionDays: Number((CFG.kefu && CFG.kefu.retentionDays) || 62), periodDir, label: runLabel, allowC: !!CFG.allowC };
  }
  return common;
}

async function verifyOutputs(m, shop) {
  const dir = path.join(ROOT, shop, periodDir);
  const out = [];
  try { out.push(...(await fs.readdir(dir))); } catch (e) { return { dir, ok: false, files: [], missing: [dir] }; }
  const checks = {
    bills: ["账单信息.md", /-对账中心/],
    promo: ["推广花费.md", /-推广/],
    orders: ["订单信息.md", /-订单/],
    kefu: ["客服绩效.md", /-客服绩效/],
  }[m];
  const missing = [];
  if (checks) {
    if (!out.includes(checks[0])) missing.push(checks[0]);
    if (!out.some((f) => checks[1].test(f))) missing.push(String(checks[1]));
  }
  return { dir, ok: missing.length === 0, files: out, missing };
}

async function runModule(m) {
  if (m === "kefu" && from < addDays(todayIso, -Number((CFG.kefu && CFG.kefu.retentionDays) || 62))) {
    console.log("SKIP kefu: 早于 62 天保留期");
    return { module: m, status: "skipped", exitCode: null, reason: "date_before_retention", stores: useShops.map((s) => ({ shop: s.shop, status: "skipped" })) };
  }
  const child = CHILD[m];
  const childFile = path.join(child.cwd, child.file);
  if (!existsSync(childFile)) {
    return { module: m, status: "failed", exitCode: null, error: "child_not_found:" + childFile, stores: useShops.map((s) => ({ shop: s.shop, status: "failed" })) };
  }
  const cfgPath = path.join(CFG_DIR, m + ".json");
  await fs.writeFile(cfgPath, JSON.stringify(childConfig(m), null, 1), "utf8");
  const logPath = path.join(LOG_DIR, m + ".log");
  const timeout = Number((CFG[m] && CFG[m].timeoutSec) || CFG.moduleTimeoutSec || (m === "bills" ? 1800 : m === "promo" ? 1200 : 600));
  console.log("\n===== MODULE " + m + " =====");
  const started = Date.now();
  const childProc = spawn(process.execPath, [childFile, cfgPath], { cwd: child.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "";
  childProc.stdout.on("data", (d) => { stdout += d.toString(); process.stdout.write(d); });
  childProc.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
  const timer = setTimeout(() => { try { childProc.kill(); } catch (e) {} }, timeout * 1000);
  const exitCode = await new Promise((res) => childProc.on("exit", (code) => res(code === null ? -1 : code)));
  clearTimeout(timer);
  await fs.writeFile(logPath, stdout + stderr, "utf8").catch(() => {});
  let childReport = null;
  const rm = stdout.match(/REPORT=(.+)/);
  if (rm) { try { childReport = JSON.parse(await fs.readFile(rm[1].trim(), "utf8")); } catch {} }
  const stores = [];
  for (const s of useShops) {
    const cs = childReport && Array.isArray(childReport.stores) ? childReport.stores.find((x) => x.shop === s.shop) : null;
    if (cs && cs.status === "no_data") { stores.push({ shop: s.shop, status: "no_data", exitCode, outputs: { ok: true, files: [], missing: [] } }); continue; }
    const v = await verifyOutputs(m, s.shop);
    let st = "done";
    if (exitCode === 4) st = "needs";
    else if (exitCode === 3) st = "preflight";
    else if (exitCode !== 0) st = "failed";
    else if (!v.ok) st = "missing";
    stores.push({ shop: s.shop, status: st, exitCode, outputs: v });
  }
  const status = stores.every((s) => ["done", "no_data"].includes(s.status)) ? "done" : (stores.some((s) => s.status === "needs") ? "needs" : (stores.some((s) => s.status === "preflight") ? "preflight" : "failed"));
  return { module: m, status, exitCode, wallSec: Number(((Date.now() - started) / 1000).toFixed(1)), config: cfgPath, log: logPath, stores };
}

const results = [];
for (const m of modules) results.push(await runModule(m));
const report = { runId: "bookkeeping-" + stamp, root: ROOT, from, to, periodDir, label: runLabel, modules: results, createdAt: new Date().toISOString() };
await fs.writeFile(path.join(RUN_DIR, "report.json"), JSON.stringify(report, null, 1), "utf8");
const lines = ["bookkeeping " + stamp + " " + from + "~" + to + " root=" + ROOT];
for (const r of results) {
  lines.push([String(r.module).padEnd(8), String(r.status).padEnd(10), "wall=" + (r.wallSec || "-") + "s", r.reason || r.error || ""].join(" "));
  for (const s of r.stores || []) lines.push("  - " + s.shop + " " + s.status + (s.outputs && s.outputs.missing && s.outputs.missing.length ? " missing=" + s.outputs.missing.join(",") : ""));
}
await fs.writeFile(path.join(RUN_DIR, "summary.txt"), lines.join("\n"), "utf8");
console.log("\n" + lines.join("\n"));
console.log("REPORT=" + path.join(RUN_DIR, "report.json"));
if (report.modules.some((m) => m.status === "needs")) process.exit(4);
if (report.modules.some((m) => m.status === "preflight")) process.exit(3);
if (report.modules.some((m) => m.status === "failed" || m.status === "missing")) process.exit(5);
