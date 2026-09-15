/* Roofing estimator mockup.
   Rules come from data/rules.js (generated from the spec extract). Nothing in
   this file hardcodes a quantity formula, a price, or a labor rate. */

(function () {
"use strict";

const R = window.RULES;

/* =========================================================================
   1. Expression engine. Restricted grammar, no eval, no arbitrary code.
   ========================================================================= */

const FUNCS = {
  ROUNDUP:  (n, d) => Math.ceil(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0),
  ROUNDDOWN:(n, d) => Math.floor(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0),
  ROUND:    (n, d) => Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0),
  MIN: (...a) => Math.min(...a),
  MAX: (...a) => Math.max(...a),
  SUM: (...a) => a.reduce((x, y) => x + y, 0),
  IF:  (c, a, b) => (c ? a : b),
};

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Error("unclosed [ in rule");
      out.push({ t: "var", v: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "name", v: src.slice(i, j).toUpperCase() });
      i = j; continue;
    }
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if ("+-*/(),=<>".indexOf(c) >= 0) {
      if ((c === "<" || c === ">") && src[i + 1] === "=") { out.push({ t: "op", v: c + "=" }); i += 2; continue; }
      if (c === "<" && src[i + 1] === ">") { out.push({ t: "op", v: "<>" }); i += 2; continue; }
      out.push({ t: "op", v: c }); i++; continue;
    }
    throw new Error("unexpected character " + c + " in rule");
  }
  return out;
}

function parse(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (v) => { if (tk[p] && tk[p].v === v) { p++; return true; } return false; };

  function expr() {
    let l = additive();
    const t = peek();
    if (t && t.t === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes(t.v)) {
      p++;
      const r = additive();
      return { k: "cmp", op: t.v, l, r };
    }
    return l;
  }
  function additive() {
    let l = multiplicative();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = tk[p++].v;
      l = { k: "bin", op, l, r: multiplicative() };
    }
    return l;
  }
  function multiplicative() {
    let l = unary();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = tk[p++].v;
      l = { k: "bin", op, l, r: unary() };
    }
    return l;
  }
  function unary() {
    if (peek() && peek().v === "-") { p++; return { k: "neg", e: unary() }; }
    return primary();
  }
  function primary() {
    const t = tk[p];
    if (!t) throw new Error("rule ended early");
    if (t.t === "num") { p++; return { k: "num", v: t.v }; }
    if (t.t === "str") { p++; return { k: "str", v: t.v }; }
    if (t.t === "var") { p++; return { k: "var", v: t.v }; }
    if (t.t === "name") {
      p++;
      if (!FUNCS[t.v]) throw new Error("unknown function " + t.v);
      if (!eat("(")) throw new Error(t.v + " needs parentheses");
      const args = [];
      if (!eat(")")) {
        do { args.push(expr()); } while (eat(","));
        if (!eat(")")) throw new Error("missing ) after " + t.v);
      }
      return { k: "call", f: t.v, args };
    }
    if (t.v === "(") { p++; const e = expr(); if (!eat(")")) throw new Error("missing )"); return e; }
    throw new Error("cannot read rule near " + JSON.stringify(t.v));
  }

  const ast = expr();
  if (p !== tk.length) throw new Error("extra text at end of rule");
  return ast;
}

const astCache = new Map();
function compile(src) {
  if (!astCache.has(src)) {
    try { astCache.set(src, { ast: parse(src) }); }
    catch (e) { astCache.set(src, { err: e.message }); }
  }
  return astCache.get(src);
}

function evaluate(node, resolve) {
  switch (node.k) {
    case "num": return node.v;
    case "str": return node.v;
    case "var": return resolve(node.v);
    case "neg": return -evaluate(node.e, resolve);
    case "bin": {
      const a = evaluate(node.l, resolve), b = evaluate(node.r, resolve);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (node.op === "/") return b === 0 ? 0 : a / b;
      break;
    }
    case "cmp": {
      const a = evaluate(node.l, resolve), b = evaluate(node.r, resolve);
      if (node.op === "=") return a === b;
      if (node.op === "<>") return a !== b;
      if (node.op === "<") return a < b;
      if (node.op === ">") return a > b;
      if (node.op === "<=") return a <= b;
      if (node.op === ">=") return a >= b;
      break;
    }
    case "call": {
      const args = node.args.map((x) => evaluate(x, resolve));
      return FUNCS[node.f](...args);
    }
  }
  throw new Error("bad node");
}

/* Every rule is parsed once at load so a broken rule shows up in the rule
   book, not in the middle of a quote. */
function validateAllRules() {
  const bad = [];
  Object.keys(R.rules).forEach((jt) => {
    R.rules[jt].forEach((r) => {
      if (r.manual || !r.expr) return;
      const c = compile(r.expr);
      if (c.err) bad.push({ jobType: jt, material: r.material, expr: r.expr, err: c.err });
      const known = new Set(R.jobInputs[jt]);
      let toks = [];
      try { toks = tokenize(r.expr); } catch (e) { return; }
      toks.filter((t) => t.t === "var").forEach((t) => {
        if (t.v.indexOf(".") >= 0) return;
        if (!known.has(t.v)) bad.push({ jobType: jt, material: r.material, expr: r.expr,
          err: "references an input this job type does not collect: " + t.v });
      });
    });
  });
  return bad;
}

/* =========================================================================
   2. State
   ========================================================================= */

const settings = {
  taxRate: R.meta.taxRate,
  detailLaborRate: R.meta.detailLaborRate,
  pricingMode: "list",        // list | workbook
  ruleMode: "workbook",       // workbook | corrected
};

const prices = {};            // material -> unit price (the single price list)
R.materials.forEach((m) => { prices[m.name] = m.listPrice; });

let quote = blankQuote();
let saved = [];

function blankQuote() {
  return {
    id: null,
    number: "",
    customer: "",
    site: "",
    estimator: "",
    date: new Date().toISOString().slice(0, 10),
    answers: { tearOff: "", layOver: "", membrane: "", attachment: "", ballastRoof: "", keepBallast: "", concreteDeck: "", reskin: "" },
    jobType: "",
    inputs: {},
    manualQty: {},
    overrides: {},
    supplementals: {},
    margin: 0.40,
    status: "Draft",
    demo: false,
  };
}

/* =========================================================================
   3. Job type router. The seven constraints, as data, checked every keystroke.
   ========================================================================= */

function routeJobType(a) {
  const errs = [];
  const yes = (v) => v === "Yes";
  if (yes(a.tearOff) && yes(a.layOver)) errs.push("C-1 Tear off and lay over are both selected");
  if (a.tearOff === "No" && a.layOver === "No") errs.push("C-2 Select either tear off or lay over");
  if (yes(a.concreteDeck) && yes(a.reskin)) errs.push("C-3 Concrete deck and reskin are both selected");
  if (yes(a.concreteDeck) && (yes(a.ballastRoof) || yes(a.keepBallast))) errs.push("C-4 A concrete deck job cannot be ballasted");
  if (yes(a.concreteDeck) && a.attachment === "MF") errs.push("C-5 A concrete deck job must be fully adhered");
  if (a.membrane === "TPO" && yes(a.keepBallast)) errs.push("C-6 TPO cannot be ballasted");
  if (yes(a.concreteDeck) && yes(a.tearOff) && a.membrane === "EPDM") errs.push("C-7 Concrete deck with tear off and EPDM is not an allowed system");
  if (errs.length) return { errs };

  if (a.membrane === "Coating") return { code: "Restoration", errs: [] };

  const need = ["tearOff", "layOver", "membrane", "attachment", "concreteDeck", "reskin"];
  if (need.some((k) => !a[k])) return { errs: [], incomplete: true };

  const removal = yes(a.tearOff) ? "TO" : "LO";
  let code;
  if (yes(a.keepBallast) && a.membrane === "EPDM") code = "LO-EPDM-BAL";
  else code = removal + "-" + a.membrane + "-" + a.attachment;
  if (yes(a.concreteDeck)) code = "CON-" + code;
  if (yes(a.reskin)) code = "RES-" + code;

  if (!R.rules[code]) return { errs: ["No estimating sheet exists for " + code + ". Confirm the system with the estimators before quoting it."] };
  return { code, errs: [] };
}

/* =========================================================================
   4. Calculation
   ========================================================================= */

function unitPrice(materialName, jobType) {
  if (settings.pricingMode === "workbook") {
    const m = R.materials.find((x) => x.name === materialName);
    /* A blank price cell on a tab is itself the workbook's behavior (D-05),
       so in parity mode a blank stays blank rather than borrowing the list. */
    if (m && m.priceTabs && m.priceTabs.indexOf(jobType) >= 0) {
      const p = m.pricesByJobType[jobType];
      return p === undefined ? null : p;
    }
  }
  const v = prices[materialName];
  return v === null || v === undefined ? null : v;
}

function ruleExpr(r) {
  if (settings.ruleMode === "corrected" && r.correctedExpr) return r.correctedExpr;
  return r.expr;
}

function compute(q) {
  const jt = q.jobType;
  const out = { lines: [], labor: [], supps: [], totals: {}, problems: [] };
  if (!jt || !R.rules[jt]) return out;

  const rules = R.rules[jt];
  const memo = new Map();
  const visiting = new Set();

  function resolve(name) {
    const dot = name.lastIndexOf(".");
    if (dot > 0 && /^(QtyNeeded|QtyWithWaste|Waste)$/i.test(name.slice(dot + 1))) {
      const mat = name.slice(0, dot), field = name.slice(dot + 1);
      const line = lineFor(mat);
      if (!line) return 0;
      if (/waste/i.test(field)) return line.waste;
      return /withwaste/i.test(field) ? line.qtyWithWaste : line.qtyNeeded;
    }
    const v = q.inputs[name];
    return v === "" || v === undefined || v === null ? 0 : Number(v) || 0;
  }

  function lineFor(mat) {
    if (memo.has(mat)) return memo.get(mat);
    const r = rules.find((x) => x.material === mat);
    if (!r) return null;
    if (visiting.has(mat)) { out.problems.push("Circular rule on " + mat); return { qtyNeeded: 0, qtyWithWaste: 0, waste: 0 }; }
    visiting.add(mat);

    let qtyNeeded = 0, err = null;
    if (r.manual) {
      qtyNeeded = Number(q.manualQty[mat] || 0);
    } else {
      const c = compile(ruleExpr(r));
      if (c.err) { err = c.err; }
      else {
        try { qtyNeeded = Number(evaluate(c.ast, resolve)) || 0; }
        catch (e) { err = e.message; }
      }
    }
    if (qtyNeeded < 0) qtyNeeded = 0;
    const withWaste = qtyNeeded * (1 + r.waste);
    let qtyWithWaste = r.rounding === "DOWN" ? Math.floor(withWaste)
                     : r.rounding === "NEAREST" ? Math.round(withWaste)
                     : Math.ceil(withWaste);
    if (qtyWithWaste < r.minQty) qtyWithWaste = r.minQty;

    const price = q.overrides[mat] !== undefined && q.overrides[mat] !== ""
      ? Number(q.overrides[mat]) : unitPrice(mat, jt);
    const line = {
      material: mat, rule: r, qtyNeeded, qtyWithWaste, waste: r.waste,
      unitPrice: price, overridden: q.overrides[mat] !== undefined && q.overrides[mat] !== "",
      missingPrice: price === null || price === undefined,
      amountPreTax: (price || 0) * qtyWithWaste,
      subtotal: (price || 0) * qtyWithWaste * (1 + settings.taxRate),
      err, flags: r.flags,
    };
    memo.set(mat, line);
    visiting.delete(mat);
    return line;
  }

  rules.forEach((r) => lineFor(r.material));
  out.lines = rules.map((r) => memo.get(r.material)).filter(Boolean);

  /* Labor. Every line counts toward the total, which the workbook does not do
     on LO-EPDM-BAL or RES-LO-TPO-MF. */
  (R.labor[jt] || []).forEach((l) => {
    const c = compile(l.driver);
    let driver = 0;
    if (!c.err) { try { driver = Number(evaluate(c.ast, resolve)) || 0; } catch (e) { driver = 0; } }
    const rate = l.basis === "per detail" ? settings.detailLaborRate : l.rate;
    out.labor.push({ line: l.line, basis: l.basis, rate, driver, amount: driver * rate, note: l.note });
  });

  (R.supplementals[jt] || []).forEach((s) => {
    const v = q.supplementals[s.line];
    out.supps.push({ line: s.line, amount: Number(v === undefined || v === "" ? s.default : v) || 0, note: s.note });
  });

  const materialPreTax = out.lines.reduce((a, l) => a + l.amountPreTax, 0);
  const materialTotal = out.lines.reduce((a, l) => a + l.subtotal, 0);
  const laborTotal = out.labor.reduce((a, l) => a + l.amount, 0);
  const suppTotal = out.supps.reduce((a, s) => a + s.amount, 0);
  const cost = materialTotal + laborTotal + suppTotal;
  const squares = Number(q.inputs["Membrane Squares"] || 0)
    || (Number(q.inputs["Square Footage of Membrane"] || 0) / 100) || 0;

  out.totals = {
    materialPreTax, salesTax: materialTotal - materialPreTax, materialTotal,
    laborTotal, suppTotal, cost, squares,
    materialPerSquare: squares ? materialTotal / squares : null,
    laborPerSquare: squares ? laborTotal / squares : null,
    costPerSquare: squares ? cost / squares : null,
    sell: cost / (1 - q.margin),
    profit: cost / (1 - q.margin) - cost,
  };
  out.missingPrices = out.lines.filter((l) => l.missingPrice && l.qtyWithWaste > 0);
  return out;
}

/* =========================================================================
   5. Formatting helpers
   ========================================================================= */

const money = (v, d) => v === null || v === undefined || !isFinite(v) ? "-"
  : (v < 0 ? "(" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 0 : d, maximumFractionDigits: d === undefined ? 0 : d }) + (v < 0 ? ")" : "");
const num = (v, d) => v === null || v === undefined || !isFinite(v) ? "-"
  : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 2 : d });
const pct = (v, d) => v === null || v === undefined || !isFinite(v) ? "-" : (v * 100).toFixed(d === undefined ? 1 : d) + "%";
const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (id) => document.getElementById(id);

/* =========================================================================
   6. Render: quote panel
   ========================================================================= */

function renderSelector() {
  const a = quote.answers;
  const rows = R.selector.questions.map((q) => {
    const opts = q.type === "yn" ? ["", "Yes", "No"] : [""].concat(q.options);
    return `<div class="qrow"><label for="sel-${q.key}">${esc(q.label)}</label>
      <select id="sel-${q.key}" data-sel="${q.key}">${opts.map((o) =>
        `<option value="${esc(o)}"${a[q.key] === o ? " selected" : ""}>${o === "" ? "-" : esc(o)}</option>`).join("")}</select></div>`;
  }).join("");

  const routed = routeJobType(a);
  let box;
  if (routed.errs && routed.errs.length) {
    box = `<div class="jobcode bad">${routed.errs.map(esc).join("<br>")}</div>`;
  } else if (routed.code) {
    const jt = R.jobTypes.find((j) => j.code === routed.code);
    box = `<div class="jobcode">${esc(routed.code)}<span class="label">${esc(jt ? jt.label : "")}</span></div>`;
  } else {
    box = `<div class="jobcode bad">Answer the questions above to route the job.</div>`;
  }
  el("selector").innerHTML = rows + box;

  if (routed.code && routed.code !== quote.jobType) { quote.jobType = routed.code; }
  if (!routed.code) quote.jobType = "";
}

function renderInputs() {
  const jt = quote.jobType;
  const wrap = el("inputs");
  if (!jt) { wrap.innerHTML = `<div class="empty">Route a job type to open the takeoff.</div>`; return; }
  wrap.innerHTML = R.jobInputs[jt].map((k) => {
    const f = R.inputs.find((i) => i.key === k);
    const v = quote.inputs[k];
    return `<div class="field"><label for="in-${esc(k)}">${esc(k)}${f && f.help ? `<span class="hint">${esc(f.help)}</span>` : ""}</label>
      <input id="in-${esc(k)}" data-input="${esc(k)}" type="number" step="any" inputmode="decimal"
        value="${v === undefined ? "" : esc(v)}" class="${v ? "dirty" : ""}"></div>`;
  }).join("");
}

function renderMaterials(c) {
  const wrap = el("materials");
  if (!quote.jobType) { wrap.innerHTML = `<div class="empty">No job type selected.</div>`; return; }
  const matTotal = c.totals.materialTotal;
  const rows = c.lines.map((l) => {
    const m = R.materials.find((x) => x.name === l.material) || {};
    const share = matTotal ? l.subtotal / matTotal : 0;
    const target = m.targetPct;
    const shareClass = target && share > target * 1.25 ? "overpct" : (target && share < target * 0.75 ? "underpct" : "");
    const flags = (l.flags || []).map((f) => `<span class="flag" title="${esc(f)}">!</span>`).join("");
    const missing = l.missingPrice ? `<span class="pill red" title="No price in the list. This line is quietly worth zero, which is defect D-05.">no price</span>` : "";
    const over = l.overridden ? `<span class="pill amber" title="Unit price overridden on this quote">override</span>` : "";
    const errp = l.err ? `<span class="pill red" title="${esc(l.err)}">rule error</span>` : "";
    return `<tr class="${l.qtyWithWaste ? "" : "zero"}${l.rule.manual ? " manual" : ""}">
      <td title="${esc(m.pack || "")}">${esc(l.material)} ${flags}${missing}${over}${errp}</td>
      <td><input data-price="${esc(l.material)}" type="number" step="0.01" placeholder="${l.missingPrice ? "" : num(l.unitPrice, 2)}" value="${quote.overrides[l.material] !== undefined ? esc(quote.overrides[l.material]) : ""}"></td>
      <td>${money(l.unitPrice === null ? null : l.unitPrice * (1 + settings.taxRate), 2)}</td>
      <td>${l.rule.manual ? `<input data-manual="${esc(l.material)}" type="number" step="any" value="${esc(quote.manualQty[l.material] === undefined ? "" : quote.manualQty[l.material])}">` : num(l.qtyNeeded, 2)}</td>
      <td>${pct(l.waste, 0)}</td>
      <td>${num(l.qtyWithWaste, 0)}</td>
      <td>${money(l.amountPreTax, 2)}</td>
      <td>${money(l.subtotal, 2)}</td>
      <td class="${shareClass}">${pct(share)}</td>
      <td>${target ? pct(target) : "-"}</td></tr>`;
  }).join("");

  wrap.innerHTML = `<table><thead><tr>
      <th>Material</th><th>Unit price</th><th>After tax</th><th>Qty needed</th><th>Waste</th>
      <th>Qty w/ waste</th><th>Amount pre-tax</th><th>Subtotal</th><th>% of material</th><th>Target %</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Material total</td><td colspan="5"></td>
      <td>${money(c.totals.materialPreTax, 2)}</td><td>${money(c.totals.materialTotal, 2)}</td><td colspan="2"></td></tr></tfoot></table>`;
}

function renderLabor(c) {
  const rows = c.labor.map((l) => `<tr><td title="${esc(l.note)}">${esc(l.line)}</td>
    <td>${esc(l.basis)}</td><td>${money(l.rate, 2)}</td><td>${num(l.driver, 2)}</td><td>${money(l.amount, 2)}</td></tr>`).join("");
  const supps = c.supps.map((s) => `<tr><td title="${esc(s.note)}">${esc(s.line)}</td><td colspan="3"></td>
    <td><input data-supp="${esc(s.line)}" type="number" step="0.01" value="${esc(quote.supplementals[s.line] === undefined ? (s.amount || "") : quote.supplementals[s.line])}"></td></tr>`).join("");
  el("labor").innerHTML = `<table><thead><tr><th>Labor</th><th>Basis</th><th>Rate</th><th>Driver</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Labor total</td><td colspan="3"></td><td>${money(c.totals.laborTotal, 2)}</td></tr></tfoot></table>
    <table style="margin-top:10px"><thead><tr><th>Supplementals</th><th></th><th></th><th></th><th>Amount</th></tr></thead>
    <tbody>${supps}</tbody>
    <tfoot><tr><td>Supplementals total</td><td colspan="3"></td><td>${money(c.totals.suppTotal, 2)}</td></tr></tfoot></table>
    <div class="assume">Supplementals are added to the grand total here. In the workbook the supplemental total cell is empty on all 16 job-type tabs, so dump fees, travel, lodging and rental equipment are typed in and then dropped from the cost. Labor totals here include every labor line, which the workbook does not do on LO-EPDM-BAL or RES-LO-TPO-MF.</div>`;
}

function renderTotals(c) {
  const t = c.totals;
  el("totals").innerHTML = `<table>
    <tbody>
      <tr><td>Material before tax</td><td>${money(t.materialPreTax, 2)}</td></tr>
      <tr><td>Sales tax at ${pct(settings.taxRate, 2)}</td><td>${money(t.salesTax, 2)}</td></tr>
      <tr><td>Material total</td><td>${money(t.materialTotal, 2)}</td></tr>
      <tr><td>Material per square</td><td>${money(t.materialPerSquare, 2)}</td></tr>
      <tr><td>Labor total</td><td>${money(t.laborTotal, 2)}</td></tr>
      <tr><td>Labor per square</td><td>${money(t.laborPerSquare, 2)}</td></tr>
      <tr><td>Supplementals</td><td>${money(t.suppTotal, 2)}</td></tr>
    </tbody>
    <tfoot><tr><td>Cost</td><td>${money(t.cost, 2)}</td></tr>
      <tr><td>Cost per square</td><td>${money(t.costPerSquare, 2)}</td></tr></tfoot></table>
    <table style="margin-top:10px"><thead><tr><th>Margin</th><th>Sell price</th><th>Profit</th><th>Per square</th><th></th></tr></thead><tbody>
      ${R.margins.map((m) => {
        const sell = t.cost / (1 - m);
        return `<tr${m === quote.margin ? ' style="background:var(--green-lt);font-weight:600"' : ""}>
          <td>${pct(m, 0)}</td><td>${money(sell, 0)}</td><td>${money(sell - t.cost, 0)}</td>
          <td>${money(t.squares ? sell / t.squares : null, 0)}</td>
          <td><button class="btn ghost" data-margin="${m}">Use</button></td></tr>`;
      }).join("")}
    </tbody></table>`;
}

function renderOrdering(c) {
  const rows = c.lines.filter((l) => l.qtyWithWaste > 0).map((l) => {
    const m = R.materials.find((x) => x.name === l.material) || {};
    return `<tr><td>${esc(l.material)}</td><td style="text-align:left;font-family:var(--ui)">${esc(m.pack || "")}</td>
      <td>${num(l.qtyWithWaste, 0)}</td><td>${money(l.unitPrice, 2)}</td><td>${money(l.amountPreTax, 2)}</td></tr>`;
  }).join("");
  el("ordering").innerHTML = `<table><thead><tr><th>Material</th><th>Pack</th><th>Order qty</th><th>Unit price</th><th>Extended</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="empty">Nothing to order yet.</td></tr>`}</tbody></table>`;
}

function renderBar(c) {
  const t = c.totals;
  const problems = [];
  if (c.missingPrices && c.missingPrices.length) problems.push(c.missingPrices.length + " line" + (c.missingPrices.length > 1 ? "s" : "") + " with no price");
  el("bar").innerHTML = `
    <div class="item"><span class="k">Cost</span><span class="v">${money(t.cost || 0)}</span></div>
    <div class="item"><span class="k">Per square</span><span class="v">${money(t.costPerSquare, 0)}</span></div>
    <div class="item"><span class="k">Margin</span>
      <select id="marginPick">${R.margins.map((m) => `<option value="${m}"${m === quote.margin ? " selected" : ""}>${pct(m, 0)}</option>`).join("")}</select></div>
    <div class="item"><span class="k">Sell</span><span class="v sell">${money(t.sell || 0)}</span></div>
    <div class="item"><span class="k">Profit</span><span class="v">${money(t.profit || 0)}</span></div>
    <div class="spacer"></div>
    ${problems.length ? `<div class="item"><span class="pill red">${esc(problems.join(", "))}</span></div>` : ""}
    <div class="item"><button class="btn" id="saveQuote">Save quote</button></div>`;
}

function renderQuoteHeader() {
  el("qhead").innerHTML = `
    <div class="field"><label for="h-num">Quote number</label><input id="h-num" data-head="number" type="text" style="text-align:left;font-family:var(--ui)" value="${esc(quote.number)}"></div>
    <div class="field"><label for="h-cust">Customer</label><input id="h-cust" data-head="customer" type="text" style="text-align:left;font-family:var(--ui)" value="${esc(quote.customer)}"></div>
    <div class="field"><label for="h-site">Building or site</label><input id="h-site" data-head="site" type="text" style="text-align:left;font-family:var(--ui)" value="${esc(quote.site)}"></div>
    <div class="field"><label for="h-est">Estimator</label><input id="h-est" data-head="estimator" type="text" style="text-align:left;font-family:var(--ui)" value="${esc(quote.estimator)}"></div>
    <div class="field"><label for="h-date">Date</label><input id="h-date" data-head="date" type="date" style="text-align:left;font-family:var(--ui)" value="${esc(quote.date)}"></div>`;
}

function renderQuote() {
  renderQuoteHeader();
  renderSelector();
  renderInputs();
  const c = compute(quote);
  renderMaterials(c);
  renderLabor(c);
  renderTotals(c);
  renderOrdering(c);
  renderBar(c);
  el("jobtypeStamp").textContent = quote.jobType || "no job type";
  return c;
}

/* =========================================================================
   7. Saved quotes
   ========================================================================= */

function saveCurrent() {
  if (!quote.jobType) { alert("Route a job type before saving."); return; }
  const c = compute(quote);
  const snap = JSON.parse(JSON.stringify(quote));
  snap.id = quote.id || ("Q" + (Date.now() % 1000000));
  snap.number = snap.number || snap.id;
  snap.cost = c.totals.cost;
  snap.sell = c.totals.sell;
  snap.squares = c.totals.squares;
  snap.issued = new Date().toISOString().slice(0, 10);
  /* The snapshot is the point: prices, waste and rules travel with the quote,
     so a quote never gets repriced by a later price change. */
  snap.snapshot = {
    taxRate: settings.taxRate, pricingMode: settings.pricingMode, ruleMode: settings.ruleMode,
    lines: c.lines.map((l) => ({ material: l.material, qtyNeeded: l.qtyNeeded, waste: l.waste,
      qtyWithWaste: l.qtyWithWaste, unitPrice: l.unitPrice, expr: ruleExpr(l.rule), subtotal: l.subtotal })),
    labor: c.labor, supps: c.supps, totals: c.totals,
  };
  const i = saved.findIndex((s) => s.id === snap.id);
  if (i >= 0) saved[i] = snap; else saved.unshift(snap);
  quote.id = snap.id;
  renderSaved(); renderDashboard(); refreshCounts();
  flash("Quote " + snap.number + " saved to this session");
}

function renderSaved() {
  const rows = saved.map((s) => `<tr>
    <td>${esc(s.number)}${s.demo ? ' <span class="pill amber">demo</span>' : ""}</td>
    <td style="text-align:left;font-family:var(--ui)">${esc(s.customer || "-")}</td>
    <td style="text-align:left;font-family:var(--ui)">${esc(s.site || "-")}</td>
    <td style="text-align:left;font-family:var(--ui)">${esc(s.jobType)}</td>
    <td>${esc(s.issued || s.date)}</td>
    <td>${num(s.squares, 0)}</td>
    <td>${money(s.cost)}</td><td>${pct(s.margin, 0)}</td><td>${money(s.sell)}</td>
    <td style="text-align:left;font-family:var(--ui)">${esc(s.status)}</td>
    <td><button class="btn ghost" data-open="${esc(s.id)}">Open</button>
        <button class="btn ghost" data-won="${esc(s.id)}">Won</button>
        <button class="btn ghost" data-lost="${esc(s.id)}">Lost</button></td></tr>`).join("");
  el("savedTable").innerHTML = saved.length ? `<table><thead><tr>
      <th>Quote</th><th>Customer</th><th>Site</th><th>Job type</th><th>Issued</th><th>Squares</th>
      <th>Cost</th><th>Margin</th><th>Sell</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">No quotes yet. Build one on the Quote tab, or load the demo pipeline to see the dashboard with data in it.</div>`;
}

/* =========================================================================
   8. Dashboard
   ========================================================================= */

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function loadDemo() {
  const rnd = seededRandom(20260915);
  const codes = Object.keys(R.rules);
  const customers = ["Wexler Logistics", "Blue Heron Foods", "Third Street Storage", "Kerr Manufacturing",
    "Holloway Distribution", "Saint Ann Parish", "Tri County Plastics", "Ohio Valley Fastener",
    "Meadowbrook Apartments", "Delta Fabrication", "Riverbend Warehouse", "Piedmont Tool"];
  const ests = ["Dana", "Marcus", "Ray", "Tonya"];
  const out = [];
  for (let i = 0; i < 40; i++) {
    const code = codes[Math.floor(rnd() * codes.length)];
    const month = 3 + Math.floor(rnd() * 10);         // March through December
    const day = 1 + Math.floor(rnd() * 27);
    const squares = Math.round(20 + rnd() * 240);
    const costPerSq = 900 + rnd() * 700;
    const cost = Math.round(squares * costPerSq);
    const margin = R.margins[Math.floor(rnd() * 8)];
    const r = rnd();
    const status = r < 0.34 ? "Won" : r < 0.62 ? "Lost" : r < 0.85 ? "Issued" : "Draft";
    out.push({
      id: "D" + i, number: "2026-" + String(100 + i), demo: true,
      customer: customers[Math.floor(rnd() * customers.length)],
      site: "Building " + String.fromCharCode(65 + Math.floor(rnd() * 6)),
      estimator: ests[Math.floor(rnd() * ests.length)],
      jobType: code, date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      issued: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      squares, cost, margin, sell: cost / (1 - margin), status,
      inputs: {}, answers: {}, manualQty: {}, overrides: {}, supplementals: {},
    });
  }
  saved = out.concat(saved.filter((s) => !s.demo));
  renderSaved(); renderDashboard(); refreshCounts();
  flash("40 demo quotes loaded. These are invented numbers for the charts, not this company's data.");
}

function barChart(data, opts) {
  opts = opts || {};
  const W = 640, H = 260, padL = 54, padB = 46, padT = 14, padR = 10;
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = (W - padL - padR) / Math.max(1, data.length);
  const bars = data.map((d, i) => {
    const h = (d.v / max) * (H - padT - padB);
    const x = padL + i * bw + bw * 0.14, w = bw * 0.72, y = H - padB - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${d.c || "#1f6f43"}"></rect>
      <text class="val" x="${(x + w / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${esc(opts.fmt ? opts.fmt(d.v) : d.v)}</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - padB + 13}" text-anchor="${data.length > 8 ? "end" : "middle"}" ${data.length > 8 ? `transform="rotate(-38 ${(x + w / 2).toFixed(1)} ${H - padB + 13})"` : ""}>${esc(d.k)}</text>`;
  }).join("");
  const ticks = [0, 0.5, 1].map((f) => {
    const y = H - padB - f * (H - padT - padB);
    return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e3e1d9"></line>
      <text x="${padL - 6}" y="${y + 3}" text-anchor="end">${esc(opts.fmt ? opts.fmt(max * f) : Math.round(max * f))}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "chart")}">${ticks}${bars}</svg>`;
}

function renderDashboard() {
  const q = saved;
  const wrap = el("dash");
  if (!q.length) { wrap.innerHTML = `<div class="empty">No quotes to chart yet.</div>`; return; }

  const won = q.filter((s) => s.status === "Won");
  const decided = q.filter((s) => s.status === "Won" || s.status === "Lost");
  const open = q.filter((s) => s.status === "Issued" || s.status === "Draft");
  const sum = (a, f) => a.reduce((x, y) => x + (f(y) || 0), 0);

  const kpis = [
    ["Open pipeline", money(sum(open, (s) => s.sell))],
    ["Open quotes", open.length],
    ["Won this season", money(sum(won, (s) => s.sell))],
    ["Win rate by value", decided.length ? pct(sum(won, (s) => s.sell) / sum(decided, (s) => s.sell), 0) : "-"],
    ["Average margin, won", won.length ? pct(sum(won, (s) => s.margin) / won.length, 0) : "-"],
    ["Average cost per square", q.length ? money(sum(q, (s) => s.cost) / Math.max(1, sum(q, (s) => s.squares)), 0) : "-"],
  ];

  const byMonth = {};
  q.forEach((s) => { const m = (s.issued || s.date || "").slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + s.sell; });
  const monthData = Object.keys(byMonth).sort().map((k) => ({ k: k.slice(5), v: Math.round(byMonth[k]) }));

  const byType = {};
  q.forEach((s) => { byType[s.jobType] = byType[s.jobType] || { n: 0, won: 0, sell: 0 };
    byType[s.jobType].n++; byType[s.jobType].sell += s.sell;
    if (s.status === "Won") byType[s.jobType].won++; });
  const typeData = Object.keys(byType).sort((a, b) => byType[b].sell - byType[a].sell).slice(0, 10)
    .map((k) => ({ k, v: Math.round(byType[k].sell) }));
  const convData = Object.keys(byType).filter((k) => byType[k].n >= 2).sort()
    .map((k) => ({ k, v: Math.round((byType[k].won / byType[k].n) * 100), c: "#a8700f" }));

  const marginBuckets = {};
  R.margins.forEach((m) => { marginBuckets[pct(m, 0)] = 0; });
  won.forEach((s) => { const k = pct(s.margin, 0); marginBuckets[k] = (marginBuckets[k] || 0) + 1; });
  const marginData = Object.keys(marginBuckets).map((k) => ({ k, v: marginBuckets[k], c: "#14512f" }));

  const noPrice = R.materials.filter((m) => m.listPrice === null || m.listPrice === undefined || m.listPrice === 0);
  const varies = R.materials.filter((m) => m.priceVaries);

  wrap.innerHTML = `
    <div class="block"><h2>Pipeline<span class="right">${q.length} quotes in this session</span></h2>
      <div class="kpis">${kpis.map((k) => `<div class="kpi"><div class="v">${k[1]}</div><div class="k">${esc(k[0])}</div></div>`).join("")}</div></div>
    <div class="chartwrap">
      <div class="block"><h2>Quoted value by month</h2><div class="body">${barChart(monthData, { fmt: (v) => "$" + Math.round(v / 1000) + "k" })}
        <div class="note">Northeast Ohio and the Ohio Valley quote March through December. The shape of this chart should drive the price refresh calendar.</div></div></div>
      <div class="block"><h2>Quoted value by job type</h2><div class="body">${barChart(typeData, { fmt: (v) => "$" + Math.round(v / 1000) + "k" })}</div></div>
      <div class="block"><h2>Win rate by job type, percent</h2><div class="body">${barChart(convData, { fmt: (v) => Math.round(v) + "%" })}</div></div>
      <div class="block"><h2>Margin taken on won work</h2><div class="body">${barChart(marginData, { fmt: (v) => Math.round(v) })}
        <div class="note">The workbook offers twelve margin steps and records none of them. Here the choice is stored on the quote.</div></div></div>
    </div>
    <div class="block"><h2>Data quality</h2><div class="body">
      <div class="note">${noPrice.length} of ${R.materials.length} materials have no usable price in the list: ${esc(noPrice.map((m) => m.name).slice(0, 8).join(", "))}${noPrice.length > 8 ? ", and others" : ""}.</div>
      <div class="note">${varies.length} materials carry more than one price across the workbook tabs: ${esc(varies.map((m) => m.name).join(", "))}.</div>
      <div class="assume">Demo quotes are invented for the charts. Cost per square, win rates and margins here mean nothing until real historical quotes are loaded.</div>
    </div></div>`;
}

/* =========================================================================
   9. Rules and prices
   ========================================================================= */

function renderRules() {
  const jt = el("ruleJobType").value;
  const rules = R.rules[jt] || [];
  const rows = rules.map((r) => {
    const m = R.materials.find((x) => x.name === r.material) || {};
    const flags = (r.flags || []).map((f) => `<span class="flag" title="${esc(f)}">!</span>`).join("");
    const corrected = r.correctedExpr ? `<div class="rule" style="color:var(--green-dk)">corrected: ${esc(r.correctedExpr)}</div>` : "";
    return `<tr>
      <td>${esc(r.material)} ${flags}</td>
      <td style="text-align:left"><div class="rule">${r.manual ? "manual entry" : esc(ruleExpr(r))}</div>${corrected}</td>
      <td>${pct(r.waste, 0)}</td><td>${esc(r.rounding)}</td><td>${r.minQty}</td>
      <td><input data-listprice="${esc(r.material)}" type="number" step="0.01" value="${m.listPrice === null || m.listPrice === undefined ? "" : m.listPrice}"></td>
      <td>${m.priceVaries ? `<span class="pill amber" title="Workbook prices: ${esc(m.priceVariants || "")}">varies</span>` : ""}</td>
      <td style="text-align:left;font-family:var(--ui);font-size:11.5px">${esc(m.note || "")}</td></tr>`;
  }).join("");
  el("ruleTable").innerHTML = `<table><thead><tr><th>Material</th><th style="text-align:left">Quantity rule</th><th>Waste</th><th>Rounding</th><th>Min qty</th><th>List price</th><th></th><th style="text-align:left">Estimator note</th></tr></thead><tbody>${rows}</tbody></table>`;

  const lab = (R.labor[jt] || []).map((l) => `<tr><td>${esc(l.line)}</td><td>${esc(l.basis)}</td>
    <td>${money(l.basis === "per detail" ? settings.detailLaborRate : l.rate, 2)}</td>
    <td style="text-align:left;font-family:var(--ui)"><span class="rule">${esc(l.driver)}</span></td></tr>`).join("");
  el("laborTable").innerHTML = `<table><thead><tr><th>Labor line</th><th>Basis</th><th>Rate</th><th style="text-align:left">Driver</th></tr></thead><tbody>${lab}</tbody></table>`;
}

function renderIntegrity() {
  const bad = validateAllRules();
  const drift = [];
  Object.keys(R.rules).forEach((jt) => R.rules[jt].forEach((r) => {
    if (r.flags && r.flags.some((f) => /DEFECT/.test(f))) drift.push({ jt, r });
  }));
  el("integrity").innerHTML = `
    <div class="note">${bad.length === 0 ? "All " + Object.keys(R.rules).reduce((a, k) => a + R.rules[k].length, 0) + " quantity rules parse, and every rule references only inputs its job type collects." : bad.length + " rules failed validation."}</div>
    ${bad.length ? `<table><thead><tr><th>Job type</th><th>Material</th><th style="text-align:left">Problem</th></tr></thead><tbody>${bad.map((b) => `<tr><td>${esc(b.jobType)}</td><td>${esc(b.material)}</td><td style="text-align:left;font-family:var(--ui)">${esc(b.err)}</td></tr>`).join("")}</tbody></table>` : ""}
    <h3 style="font-size:13px;margin:12px 0 4px">Suspected copy-paste defects, for the estimators to rule on</h3>
    <table><thead><tr><th>Job type</th><th>Material</th><th style="text-align:left">Workbook rule</th><th style="text-align:left">Proposed correction</th></tr></thead><tbody>
      ${drift.map((d) => `<tr><td>${esc(d.jt)}</td><td>${esc(d.r.material)}</td>
        <td style="text-align:left"><span class="rule">${esc(d.r.expr)}</span></td>
        <td style="text-align:left"><span class="rule">${esc(d.r.correctedExpr || "")}</span></td></tr>`).join("")}
    </tbody></table>`;
}

/* =========================================================================
   10. Wiring
   ========================================================================= */

function flash(msg) {
  const n = el("flash");
  n.textContent = msg;
  n.style.display = "block";
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { n.style.display = "none"; }, 4000);
}

function refreshCounts() { el("savedCount").textContent = saved.length ? "(" + saved.length + ")" : ""; }

function showPanel(name) {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.panel === name)));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.id === "panel-" + name));
  el("bar").style.display = name === "quote" ? "flex" : "none";
  if (name === "dash") renderDashboard();
  if (name === "rules") { renderRules(); renderIntegrity(); }
}

function wire() {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel)));

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "marginPick") { quote.margin = Number(t.value); renderQuote(); }
    else if (t.dataset.sel !== undefined) { quote.answers[t.dataset.sel] = t.value; renderQuote(); }
    else if (t.dataset.head !== undefined) { quote[t.dataset.head] = t.value; }
    else if (t.id === "ruleJobType") { renderRules(); }
    else if (t.id === "taxRate") { settings.taxRate = (Number(t.value) || 0) / 100; renderQuote(); }
    else if (t.id === "detailRate") { settings.detailLaborRate = Number(t.value) || 0; renderQuote(); renderRules(); }
    else if (t.id === "pricingMode") { settings.pricingMode = t.value; renderQuote(); }
    else if (t.id === "ruleMode") { settings.ruleMode = t.value; renderQuote(); renderRules(); }
    else if (t.dataset.listprice !== undefined) { prices[t.dataset.listprice] = t.value === "" ? null : Number(t.value);
      const m = R.materials.find((x) => x.name === t.dataset.listprice); if (m) m.listPrice = prices[t.dataset.listprice]; renderRules(); }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    let live = false;
    if (t.dataset.input !== undefined) { quote.inputs[t.dataset.input] = t.value; live = true; }
    else if (t.dataset.price !== undefined) { if (t.value === "") delete quote.overrides[t.dataset.price]; else quote.overrides[t.dataset.price] = t.value; live = true; }
    else if (t.dataset.manual !== undefined) { quote.manualQty[t.dataset.manual] = t.value; live = true; }
    else if (t.dataset.supp !== undefined) { quote.supplementals[t.dataset.supp] = t.value; live = true; }
    if (live) {
      /* The tables are rebuilt on every keystroke, so hold the caret. */
      const sel = t.dataset.input !== undefined ? `[data-input="${CSS.escape(t.dataset.input)}"]`
        : t.dataset.price !== undefined ? `[data-price="${CSS.escape(t.dataset.price)}"]`
        : t.dataset.manual !== undefined ? `[data-manual="${CSS.escape(t.dataset.manual)}"]`
        : `[data-supp="${CSS.escape(t.dataset.supp)}"]`;
      const hadFocus = document.activeElement === t;
      const c = compute(quote);
      renderMaterials(c); renderLabor(c); renderTotals(c); renderOrdering(c); renderBar(c);
      if (t.dataset.input !== undefined) {
        t.classList.toggle("dirty", !!t.value);   // left column is not rebuilt
        return;
      }
      const again = document.querySelector(sel);
      if (hadFocus && again && again !== t) {
        again.focus();
        try { again.setSelectionRange(again.value.length, again.value.length); } catch (err) {}
      }
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.id === "saveQuote") saveCurrent();
    else if (t.dataset.margin) { quote.margin = Number(t.dataset.margin); renderQuote(); }
    else if (t.id === "newQuote") { quote = blankQuote(); renderQuote(); showPanel("quote"); }
    else if (t.id === "loadDemo") loadDemo();
    else if (t.id === "clearDemo") { saved = saved.filter((s) => !s.demo); renderSaved(); renderDashboard(); refreshCounts(); }
    else if (t.id === "exportQuotes") exportJSON();
    else if (t.dataset.open) { const s = saved.find((x) => x.id === t.dataset.open); if (s) { quote = JSON.parse(JSON.stringify(s)); showPanel("quote"); renderQuote(); } }
    else if (t.dataset.won) { const s = saved.find((x) => x.id === t.dataset.won); if (s) { s.status = "Won"; renderSaved(); renderDashboard(); } }
    else if (t.dataset.lost) { const s = saved.find((x) => x.id === t.dataset.lost); if (s) { s.status = "Lost"; renderSaved(); renderDashboard(); } }
  });

  el("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const list = Array.isArray(data) ? data : (data.quotes || []);
        saved = list.concat(saved);
        renderSaved(); renderDashboard(); refreshCounts();
        flash(list.length + " quotes loaded from file");
      } catch (err) { alert("That file is not a quote export: " + err.message); }
    };
    rd.readAsText(f);
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), settings, quotes: saved }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "roofing-quotes-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function boot() {
  el("ruleJobType").innerHTML = R.jobTypes.map((j) => `<option value="${esc(j.code)}">${esc(j.code)} - ${esc(j.label)}</option>`).join("");
  el("taxRate").value = (settings.taxRate * 100).toFixed(2);
  el("detailRate").value = settings.detailLaborRate;
  el("buildStamp").textContent = R.meta.built;
  el("counts").textContent = `${R.jobTypes.length} job types, ${R.materials.length} materials, ${Object.keys(R.rules).reduce((a, k) => a + R.rules[k].length, 0)} quantity rules`;
  wire();
  renderQuote();
  renderSaved();
  refreshCounts();
  showPanel("quote");
}

/* Exposed so the parity harness can drive the engine without a browser.
   Nothing in the interface reads this. */
window.__engine = { compile, evaluate, tokenize, compute, routeJobType, validateAllRules, settings, prices, blankQuote };

document.addEventListener("DOMContentLoaded", boot);
})();
