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
  showDetails: false,         // tax and percent columns in the material table
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

const money = (v, d) => v === null || v === undefined || !isFinite(v) ? "\u2013"
  : (v < 0 ? "(" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 0 : d, maximumFractionDigits: d === undefined ? 0 : d }) + (v < 0 ? ")" : "");
const num = (v, d) => v === null || v === undefined || !isFinite(v) ? "\u2013"
  : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 2 : d });
const pct = (v, d) => v === null || v === undefined || !isFinite(v) ? "\u2013" : (v * 100).toFixed(d === undefined ? 1 : d) + "%";
const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (id) => document.getElementById(id);

function hasTakeoff(q) {
  return Object.keys(q.inputs).some((k) => q.inputs[k] !== "" && q.inputs[k] !== undefined && q.inputs[k] !== null);
}

function lockCard(id, locked, msg) {
  const card = el(id);
  if (!card) return;
  card.classList.toggle("locked", locked);
  let note = card.querySelector(".callout");
  if (locked) {
    if (!note) {
      note = document.createElement("div");
      note.className = "callout";
      card.insertBefore(note, card.querySelector(".body"));
    }
    note.textContent = msg;
  } else if (note) {
    note.remove();
  }
}

/* =========================================================================
   6. Render: quote workspace
   ========================================================================= */

function renderSelector() {
  const a = quote.answers;
  const rows = R.selector.questions.map((q) => {
    const opts = q.type === "yn" ? ["", "Yes", "No"] : [""].concat(q.options);
    return `<div class="qrow"><label for="sel-${q.key}">${esc(q.label)}</label>
      <select id="sel-${q.key}" data-sel="${q.key}">${opts.map((o) =>
        `<option value="${esc(o)}"${a[q.key] === o ? " selected" : ""}>${o === "" ? "\u2013" : esc(o)}</option>`).join("")}</select></div>`;
  }).join("");

  const routed = routeJobType(a);
  let box;
  if (routed.errs && routed.errs.length) {
    box = `<div class="jobcode bad">${routed.errs.map(esc).join("<br>")}</div>`;
  } else if (routed.code) {
    const jt = R.jobTypes.find((j) => j.code === routed.code);
    box = `<div class="jobcode">${esc(routed.code)}<span class="label">${esc(jt ? jt.label : "")}</span></div>`;
  } else {
    box = `<div class="jobcode wait">Answer the eight questions and the job type routes itself. Illegal combinations are called out here.</div>`;
  }
  el("selector").innerHTML = rows + box;

  if (routed.code && routed.code !== quote.jobType) { quote.jobType = routed.code; }
  if (!routed.code) quote.jobType = "";
}

function renderInputs() {
  const jt = quote.jobType;
  const wrap = el("inputs");
  lockCard("card-inputs", !jt, "Route a job type above to unlock the takeoff for that system.");
  if (!jt) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = R.jobInputs[jt].map((k) => {
    const f = R.inputs.find((i) => i.key === k);
    const v = quote.inputs[k];
    return `<div class="field"><label for="in-${esc(k)}">${esc(k)}${f && f.help ? `<span class="hint">${esc(f.help)}</span>` : ""}</label>
      <input id="in-${esc(k)}" data-input="${esc(k)}" type="number" step="any" inputmode="decimal"
        value="${v === undefined ? "" : esc(v)}" class="${v ? "dirty" : ""}"></div>`;
  }).join("") + `<div class="note" style="margin-top:8px">An empty box counts as zero. Everything on the right recalculates as you type.</div>`;
}

function badgesFor(l) {
  const out = [];
  (l.flags || []).forEach((f) => {
    if (/DEFECT/.test(f)) out.push(`<span class="badge red" title="${esc(f)}">check rule</span>`);
  });
  if (l.missingPrice) out.push(`<span class="badge red" title="No price in the list. This line is quietly worth zero dollars, which is defect D-05 in the workbook.">no price</span>`);
  if (l.overridden) out.push(`<span class="badge amber" title="Unit price overridden on this quote only">override</span>`);
  if (l.err) out.push(`<span class="badge red" title="${esc(l.err)}">rule error</span>`);
  if (l.rule.manual) out.push(`<span class="badge green" title="No formula in the workbook. Enter the quantity by hand, for example from an engineer quote.">manual</span>`);
  return out.join("");
}

function renderMaterials(c) {
  const wrap = el("materials");
  const jt = quote.jobType;
  lockCard("card-materials", !jt, "The material list comes from the job type. Route one to see it.");
  if (!jt) { wrap.innerHTML = ""; return; }

  const started = hasTakeoff(quote);
  const matTotal = c.totals.materialTotal;

  const head = `<thead><tr>
      <th style="min-width:230px">Material</th>
      <th>Unit price</th>
      <th class="colDetails">After tax</th>
      <th>Qty needed</th><th>Waste</th><th>Qty w/ waste</th>
      <th>Amount</th><th>Subtotal w/ tax</th>
      <th class="colDetails">% of material</th><th class="colDetails">Target</th>
    </tr></thead>`;

  const banner = started ? "" :
    `<tr class="emptyRow"><td colspan="10">These ${c.lines.length} materials belong to ${esc(jt)}. Enter takeoff values on the left and the quantities and dollars fill in live.</td></tr>`;

  const rows = c.lines.map((l) => {
    const m = R.materials.find((x) => x.name === l.material) || {};
    const share = matTotal ? l.subtotal / matTotal : 0;
    const target = m.targetPct;
    const shareClass = started && target && share > target * 1.25 ? "overpct" : (target && share < target * 0.75 ? "underpct" : "");
    const blank = !started;
    const cell = (v) => blank ? "" : v;
    return `<tr class="${started && !l.qtyWithWaste ? "zero" : ""}">
      <td title="${esc(m.pack || "")}"><span class="matname">${esc(l.material)}</span>${badgesFor(l)}</td>
      <td><input data-price="${esc(l.material)}" type="number" step="0.01" placeholder="${l.missingPrice ? "" : num(l.unitPrice, 2)}" value="${quote.overrides[l.material] !== undefined ? esc(quote.overrides[l.material]) : ""}" aria-label="Unit price for ${esc(l.material)}"></td>
      <td class="colDetails">${cell(money(l.unitPrice === null ? null : l.unitPrice * (1 + settings.taxRate), 2))}</td>
      <td>${l.rule.manual ? `<input data-manual="${esc(l.material)}" type="number" step="any" value="${esc(quote.manualQty[l.material] === undefined ? "" : quote.manualQty[l.material])}" aria-label="Quantity for ${esc(l.material)}">` : cell(num(l.qtyNeeded, 2))}</td>
      <td>${pct(l.waste, 0)}</td>
      <td>${cell(num(l.qtyWithWaste, 0))}</td>
      <td>${cell(money(l.amountPreTax, 2))}</td>
      <td>${cell(money(l.subtotal, 2))}</td>
      <td class="colDetails ${shareClass}">${cell(pct(share))}</td>
      <td class="colDetails">${target ? pct(target) : ""}</td></tr>`;
  }).join("");

  const foot = started ? `<tfoot><tr><td>Material total</td><td></td><td class="colDetails"></td><td colspan="3"></td>
      <td>${money(c.totals.materialPreTax, 2)}</td><td>${money(c.totals.materialTotal, 2)}</td><td class="colDetails" colspan="2"></td></tr></tfoot>` : "";

  wrap.innerHTML = `<div class="${settings.showDetails ? "showDetails" : ""}" style="overflow-x:auto">
    <table>${head}<tbody>${banner}${rows}</tbody>${foot}</table></div>`;
}

function renderLabor(c) {
  const jt = quote.jobType;
  lockCard("card-labor", !jt, "Labor rates come with the job type.");
  if (!jt) { el("labor").innerHTML = ""; return; }
  const started = hasTakeoff(quote);
  const cell = (v) => started ? v : "";
  const rows = c.labor.map((l) => `<tr><td title="${esc(l.note)}"><span class="matname">${esc(l.line)}</span></td>
    <td>${esc(l.basis)}</td><td>${money(l.rate, 2)}</td><td>${cell(num(l.driver, 2))}</td><td>${cell(money(l.amount, 2))}</td></tr>`).join("");
  const supps = c.supps.map((s) => `<tr><td title="${esc(s.note)}"><span class="matname">${esc(s.line)}</span><span class="badge green" title="${esc(s.note)}">manual</span></td><td colspan="3"></td>
    <td><input data-supp="${esc(s.line)}" type="number" step="0.01" value="${esc(quote.supplementals[s.line] === undefined ? (s.amount || "") : quote.supplementals[s.line])}" aria-label="${esc(s.line)}"></td></tr>`).join("");
  el("labor").innerHTML = `<table><thead><tr><th style="min-width:230px">Labor</th><th>Basis</th><th>Rate</th><th>Driver</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    ${started ? `<tfoot><tr><td>Labor total</td><td colspan="3"></td><td>${money(c.totals.laborTotal, 2)}</td></tr></tfoot>` : ""}</table>
    <table style="margin-top:2px"><thead><tr><th style="min-width:230px">Supplementals</th><th></th><th></th><th></th><th>Amount</th></tr></thead>
    <tbody>${supps}</tbody>
    <tfoot><tr><td>Supplementals total</td><td colspan="3"></td><td>${money(c.totals.suppTotal, 2)}</td></tr></tfoot></table>
    <div class="callout" style="margin:12px 16px">Supplementals count toward the cost here. The workbook drops them on all 16 job-type tabs, and drops the first labor line on LO-EPDM-BAL and RES-LO-TPO-MF. Both are new findings, filed as D-14 and D-15.</div>`;
}

function renderOrdering(c) {
  const jt = quote.jobType;
  lockCard("card-ordering", !jt, "The purchase list builds itself from the priced takeoff.");
  if (!jt) { el("ordering").innerHTML = ""; return; }
  const rows = c.lines.filter((l) => l.qtyWithWaste > 0 && hasTakeoff(quote)).map((l) => {
    const m = R.materials.find((x) => x.name === l.material) || {};
    return `<tr><td><span class="matname">${esc(l.material)}</span></td><td style="text-align:left;color:var(--muted)">${esc(m.pack || "")}</td>
      <td>${num(l.qtyWithWaste, 0)}</td><td>${money(l.unitPrice, 2)}</td><td>${money(l.amountPreTax, 2)}</td></tr>`;
  }).join("");
  el("ordering").innerHTML = `<table><thead><tr><th style="min-width:230px">Material</th><th style="text-align:left">Pack</th><th>Order qty</th><th>Unit price</th><th>Extended</th></tr></thead>
    <tbody>${rows || `<tr class="emptyRow"><td colspan="5">Once quantities exist, this becomes the order list for the supplier.</td></tr>`}</tbody></table>`;
}

function renderSummary(c) {
  const wrap = el("summary");
  const t = c.totals;
  if (!quote.jobType) {
    wrap.innerHTML = `
      <div class="sellblock"><div class="k">SELL PRICE</div><div class="v">\u2013</div>
        <div class="minor">appears when a job is routed and measured</div></div>
      <div class="costlines">
        <div class="line"><span>1. Answer the job criteria</span><b>\u2190</b></div>
        <div class="line"><span>2. Enter the takeoff</span></div>
        <div class="line"><span>3. Pick a margin</span></div>
        <div class="line"><span>4. Save the quote</span></div>
      </div>
      <div class="callout" style="margin:6px 18px 18px">Start with the eight questions at the left. Everything else follows from the job type.</div>`;
    return;
  }

  const started = hasTakeoff(quote);
  const warn = c.missingPrices && c.missingPrices.length
    ? `<div class="warnrow"><span class="badge red" title="${esc(c.missingPrices.map((l) => l.material).join(", "))}">${c.missingPrices.length} line${c.missingPrices.length > 1 ? "s" : ""} priced at nothing</span></div>` : "";

  wrap.innerHTML = `
    <div class="sellblock">
      <div class="row"><div>
        <div class="k">SELL PRICE AT ${pct(quote.margin, 0)} MARGIN</div>
        <div class="v">${started ? money(t.sell) : "\u2013"}</div>
      </div></div>
      <div class="row minor"><span>Profit <b>${started ? money(t.profit) : "\u2013"}</b></span>
        <span>Per square <b>${started && t.squares ? money(t.sell / t.squares, 0) : "\u2013"}</b></span></div>
    </div>
    <div class="costlines">
      <div class="line"><span>Material, incl. ${pct(settings.taxRate, 1)} tax</span><b>${started ? money(t.materialTotal) : "\u2013"}</b></div>
      <div class="line"><span>Labor</span><b>${started ? money(t.laborTotal) : "\u2013"}</b></div>
      <div class="line"><span>Supplementals</span><b>${money(t.suppTotal)}</b></div>
      <div class="line total"><span>Cost</span><b>${started ? money(t.cost) : "\u2013"}</b></div>
      <div class="line"><span>Cost per square</span><b>${started ? money(t.costPerSquare, 0) : "\u2013"}</b></div>
    </div>
    ${warn}
    <div class="marginhead">Margin, pick one</div>
    <div class="marginList">
      ${R.margins.map((m) => {
        const sell = t.cost / (1 - m);
        return `<button type="button" class="marginOption${m === quote.margin ? " isSelected" : ""}" data-margin="${m}">
          <span class="pct">${pct(m, 0)}</span>
          <span class="price">${started ? money(sell) : "\u2013"}</span>
          <span class="meta">${started && t.squares ? money(sell / t.squares, 0) + " / sq" : ""}</span></button>`;
      }).join("")}
    </div>
    <div class="actions"><button class="btn big" id="saveQuote">Save quote</button></div>`;
}

function renderQuoteHeader() {
  const f = (id, key, type, val) => `<div class="field"><label for="${id}">${id === "h-num" ? "Quote number" : id === "h-cust" ? "Customer" : id === "h-site" ? "Building or site" : id === "h-est" ? "Estimator" : "Date"}</label><input id="${id}" data-head="${key}" type="${type}" style="text-align:left" value="${esc(val)}"></div>`;
  el("qhead").innerHTML =
    f("h-num", "number", "text", quote.number) +
    f("h-cust", "customer", "text", quote.customer) +
    f("h-site", "site", "text", quote.site) +
    f("h-est", "estimator", "text", quote.estimator) +
    f("h-date", "date", "date", quote.date);
}

function renderQuote() {
  renderQuoteHeader();
  renderSelector();
  renderInputs();
  const c = compute(quote);
  renderMaterials(c);
  renderLabor(c);
  renderOrdering(c);
  renderSummary(c);
  el("jobtypeStamp").textContent = quote.jobType || "no job type yet";
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
    <td><span class="matname">${esc(s.number)}</span>${s.demo ? ' <span class="badge amber">demo</span>' : ""}</td>
    <td style="text-align:left">${esc(s.customer || "\u2013")}</td>
    <td style="text-align:left">${esc(s.site || "\u2013")}</td>
    <td style="text-align:left">${esc(s.jobType)}</td>
    <td>${esc(s.issued || s.date)}</td>
    <td>${num(s.squares, 0)}</td>
    <td>${money(s.cost)}</td><td>${pct(s.margin, 0)}</td><td>${money(s.sell)}</td>
    <td style="text-align:left">${esc(s.status)}</td>
    <td style="white-space:nowrap"><button class="btn ghost" style="height:28px;padding:0 10px" data-open="${esc(s.id)}">Open</button>
        <button class="btn ghost" style="height:28px;padding:0 10px" data-won="${esc(s.id)}">Won</button>
        <button class="btn ghost" style="height:28px;padding:0 10px" data-lost="${esc(s.id)}">Lost</button></td></tr>`).join("");
  el("savedTable").innerHTML = saved.length ? `<table><thead><tr>
      <th style="text-align:left">Quote</th><th style="text-align:left">Customer</th><th style="text-align:left">Site</th><th style="text-align:left">Job type</th><th>Issued</th><th>Squares</th>
      <th>Cost</th><th>Margin</th><th>Sell</th><th style="text-align:left">Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
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
  flash("40 demo quotes loaded. Invented numbers for the charts, not this company's data.");
}

function barChart(data, opts) {
  opts = opts || {};
  const W = 640, H = 270, padL = 56, padB = 50, padT = 16, padR = 10;
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = (W - padL - padR) / Math.max(1, data.length);
  const bars = data.map((d, i) => {
    const h = (d.v / max) * (H - padT - padB);
    const x = padL + i * bw + bw * 0.16, w = bw * 0.68, y = H - padB - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${d.c || "#1c6497"}"></rect>
      <text class="val" x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${esc(opts.fmt ? opts.fmt(d.v) : d.v)}</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - padB + 14}" text-anchor="${data.length > 8 ? "end" : "middle"}" ${data.length > 8 ? `transform="rotate(-38 ${(x + w / 2).toFixed(1)} ${H - padB + 14})"` : ""}>${esc(d.k)}</text>`;
  }).join("");
  const ticks = [0, 0.5, 1].map((f) => {
    const y = H - padB - f * (H - padT - padB);
    return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e9edf1"></line>
      <text x="${padL - 6}" y="${y + 3}" text-anchor="end">${esc(opts.fmt ? opts.fmt(max * f) : Math.round(max * f))}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "chart")}">${ticks}${bars}</svg>`;
}

function renderDashboard() {
  const q = saved;
  const wrap = el("dash");
  if (!q.length) { wrap.innerHTML = `<div class="card"><div class="empty">No quotes to chart yet. Save a quote, or load the demo pipeline from the Saved quotes tab.</div></div>`; return; }

  const won = q.filter((s) => s.status === "Won");
  const decided = q.filter((s) => s.status === "Won" || s.status === "Lost");
  const open = q.filter((s) => s.status === "Issued" || s.status === "Draft");
  const sum = (a, f) => a.reduce((x, y) => x + (f(y) || 0), 0);

  const kpis = [
    ["Open pipeline", money(sum(open, (s) => s.sell))],
    ["Open quotes", open.length],
    ["Won this season", money(sum(won, (s) => s.sell))],
    ["Win rate by value", decided.length ? pct(sum(won, (s) => s.sell) / sum(decided, (s) => s.sell), 0) : "\u2013"],
    ["Average margin, won", won.length ? pct(sum(won, (s) => s.margin) / won.length, 0) : "\u2013"],
    ["Average cost per square", q.length ? money(sum(q, (s) => s.cost) / Math.max(1, sum(q, (s) => s.squares)), 0) : "\u2013"],
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
    .map((k) => ({ k, v: Math.round((byType[k].won / byType[k].n) * 100), c: "#29abe2" }));

  const marginBuckets = {};
  R.margins.forEach((m) => { marginBuckets[pct(m, 0)] = 0; });
  won.forEach((s) => { const k = pct(s.margin, 0); marginBuckets[k] = (marginBuckets[k] || 0) + 1; });
  const marginData = Object.keys(marginBuckets).map((k) => ({ k, v: marginBuckets[k], c: "#002642" }));

  const noPrice = R.materials.filter((m) => m.listPrice === null || m.listPrice === undefined || m.listPrice === 0);
  const varies = R.materials.filter((m) => m.priceVaries);

  wrap.innerHTML = `
    <div class="card"><h2>Pipeline<span class="right">${q.length} quotes in this session</span></h2>
      <div class="kpis">${kpis.map((k) => `<div class="kpi"><div class="v">${k[1]}</div><div class="k">${esc(k[0])}</div></div>`).join("")}</div></div>
    <div class="chartwrap">
      <div class="card"><h2>Quoted value by month</h2><div class="body">${barChart(monthData, { fmt: (v) => "$" + Math.round(v / 1000) + "k" })}
        <div class="note">Northeast Ohio and the Ohio Valley quote March through December. The shape of this chart should drive the price refresh calendar.</div></div></div>
      <div class="card"><h2>Quoted value by job type</h2><div class="body">${barChart(typeData, { fmt: (v) => "$" + Math.round(v / 1000) + "k" })}</div></div>
      <div class="card"><h2>Win rate by job type, percent</h2><div class="body">${barChart(convData, { fmt: (v) => Math.round(v) + "%" })}</div></div>
      <div class="card"><h2>Margin taken on won work</h2><div class="body">${barChart(marginData, { fmt: (v) => Math.round(v) })}
        <div class="note">The workbook offers twelve margin steps and records none of them. Here the choice is stored on the quote.</div></div></div>
    </div>
    <div class="card"><h2>Data quality</h2><div class="body">
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
    const flags = (r.flags || []).filter((f) => /DEFECT/.test(f)).map((f) => `<span class="badge red" title="${esc(f)}">suspected defect</span>`).join("");
    const corrected = r.correctedExpr ? `<div class="rule" style="color:var(--pine)">corrected: ${esc(r.correctedExpr)}</div>` : "";
    return `<tr>
      <td><span class="matname">${esc(r.material)}</span>${flags}${m.priceVaries ? `<span class="badge amber" title="Workbook prices: ${esc(m.priceVariants || "")}">price varies</span>` : ""}</td>
      <td style="text-align:left"><div class="rule">${r.manual ? "manual entry" : esc(ruleExpr(r))}</div>${corrected}</td>
      <td>${pct(r.waste, 0)}</td><td>${esc(r.rounding)}</td><td>${r.minQty}</td>
      <td><input data-listprice="${esc(r.material)}" type="number" step="0.01" value="${m.listPrice === null || m.listPrice === undefined ? "" : m.listPrice}" aria-label="List price for ${esc(r.material)}"></td>
      <td style="text-align:left;color:var(--muted);font-size:12.5px;white-space:normal;min-width:260px">${esc(m.note || "")}</td></tr>`;
  }).join("");
  el("ruleTable").innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th style="min-width:240px">Material</th><th style="text-align:left;min-width:320px">Quantity rule</th><th>Waste</th><th>Rounding</th><th>Min qty</th><th>List price</th><th style="text-align:left">Estimator note</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  const lab = (R.labor[jt] || []).map((l) => `<tr><td><span class="matname">${esc(l.line)}</span></td><td>${esc(l.basis)}</td>
    <td>${money(l.basis === "per detail" ? settings.detailLaborRate : l.rate, 2)}</td>
    <td style="text-align:left"><span class="rule">${esc(l.driver)}</span></td></tr>`).join("");
  el("laborTable").innerHTML = `<table><thead><tr><th style="min-width:240px">Labor line</th><th>Basis</th><th>Rate</th><th style="text-align:left">Driver</th></tr></thead><tbody>${lab}</tbody></table>`;
}

function renderIntegrity() {
  const bad = validateAllRules();
  const drift = [];
  Object.keys(R.rules).forEach((jt) => R.rules[jt].forEach((r) => {
    if (r.flags && r.flags.some((f) => /DEFECT/.test(f))) drift.push({ jt, r });
  }));
  el("integrity").innerHTML = `
    <div class="note">${bad.length === 0 ? "All " + Object.keys(R.rules).reduce((a, k) => a + R.rules[k].length, 0) + " quantity rules parse, and every rule references only inputs its job type collects." : bad.length + " rules failed validation."}</div>
    ${bad.length ? `<table><thead><tr><th>Job type</th><th>Material</th><th style="text-align:left">Problem</th></tr></thead><tbody>${bad.map((b) => `<tr><td>${esc(b.jobType)}</td><td>${esc(b.material)}</td><td style="text-align:left">${esc(b.err)}</td></tr>`).join("")}</tbody></table>` : ""}
    <h3 style="font-size:14px;margin:16px 0 6px">Suspected copy-paste defects, for the estimators to rule on</h3>
    <table><thead><tr><th style="text-align:left">Job type</th><th style="text-align:left">Material</th><th style="text-align:left">Workbook rule</th><th style="text-align:left">Proposed correction</th></tr></thead><tbody>
      ${drift.map((d) => `<tr><td style="text-align:left">${esc(d.jt)}</td><td style="text-align:left">${esc(d.r.material)}</td>
        <td style="text-align:left;white-space:normal"><span class="rule">${esc(d.r.expr)}</span></td>
        <td style="text-align:left;white-space:normal"><span class="rule">${esc(d.r.correctedExpr || "")}</span></td></tr>`).join("")}
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
  if (name === "dash") renderDashboard();
  if (name === "rules") { renderRules(); renderIntegrity(); }
}

function wire() {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel)));

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.sel !== undefined) { quote.answers[t.dataset.sel] = t.value; renderQuote(); }
    else if (t.dataset.head !== undefined) { quote[t.dataset.head] = t.value; }
    else if (t.id === "ruleJobType") { renderRules(); }
    else if (t.id === "detailsToggle") { settings.showDetails = t.checked; const c = compute(quote); renderMaterials(c); }
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
      renderMaterials(c); renderLabor(c); renderOrdering(c); renderSummary(c);
      if (t.dataset.input !== undefined) {
        t.classList.toggle("dirty", !!t.value);   // the rail is not rebuilt
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
    const t = e.target.closest ? (e.target.closest("[data-margin]") || e.target) : e.target;
    if (t.id === "saveQuote") saveCurrent();
    else if (t.dataset && t.dataset.margin) { quote.margin = Number(t.dataset.margin); const c = compute(quote); renderSummary(c); }
    else if (t.id === "newQuote") { quote = blankQuote(); renderQuote(); showPanel("quote"); }
    else if (t.id === "loadDemo") loadDemo();
    else if (t.id === "clearDemo") { saved = saved.filter((s) => !s.demo); renderSaved(); renderDashboard(); refreshCounts(); }
    else if (t.id === "exportQuotes") exportJSON();
    else if (t.dataset && t.dataset.open) { const s = saved.find((x) => x.id === t.dataset.open); if (s) { quote = JSON.parse(JSON.stringify(s)); showPanel("quote"); renderQuote(); } }
    else if (t.dataset && t.dataset.won) { const s = saved.find((x) => x.id === t.dataset.won); if (s) { s.status = "Won"; renderSaved(); renderDashboard(); } }
    else if (t.dataset && t.dataset.lost) { const s = saved.find((x) => x.id === t.dataset.lost); if (s) { s.status = "Lost"; renderSaved(); renderDashboard(); } }
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
  el("ruleJobType").innerHTML = R.jobTypes.map((j) => `<option value="${esc(j.code)}">${esc(j.code)} \u2013 ${esc(j.label)}</option>`).join("");
  el("taxRate").value = (settings.taxRate * 100).toFixed(2);
  el("detailRate").value = settings.detailLaborRate;
  el("counts").textContent = `${R.jobTypes.length} job types \u00b7 ${R.materials.length} materials \u00b7 ${Object.keys(R.rules).reduce((a, k) => a + R.rules[k].length, 0)} rules`;
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
