// 店铺级账本：物流/账单/订单/客服等非商品操作。
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export function resolveLedgerRoot(cfg = {}) {
  return String(cfg.ledgerRoot || process.env.PDD_LEDGER_ROOT || path.join(process.env.USERPROFILE || os.homedir(), "店铺运营日志")).replace(/\\/g, "/").replace(/\/$/, "");
}
function safeName(s) { return String(s || "unknown").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_"); }
function pad(n) { return String(n).padStart(2, "0"); }
function localTime(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

export async function recordShopOperation({ root, shop, module, action, period, status, outputs, runId, evidence, before, after }) {
  const now = new Date();
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dir = path.join(root, "店铺", safeName(shop), safeName(module), month);
  await fs.mkdir(dir, { recursive: true });
  const record = {
    schemaVersion: 1,
    time: now.toISOString(),
    timeLocal: localTime(now),
    shop,
    module,
    action: action || "bookkeeping-export",
    period: period || "",
    status: status || "unknown",
    outputs: outputs || [],
    runId: runId || "",
    evidence: evidence || "",
    before: before ?? null,
    after: after ?? null,
  };
  await fs.appendFile(path.join(dir, "操作记录.jsonl"), JSON.stringify(record) + "\n", "utf8");
  const profile = path.join(root, "店铺", safeName(shop), "店铺档案.json");
  let state = {};
  try { state = JSON.parse(await fs.readFile(profile, "utf8")); } catch {}
  state.shop = shop;
  state.lastModule = module;
  state.lastStatus = record.status;
  state.lastTime = record.timeLocal;
  state.lastRunId = record.runId;
  await fs.writeFile(profile, JSON.stringify(state, null, 1), "utf8");
  return record;
}
