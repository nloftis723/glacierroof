/* Headless smoke test: load the page, drive the selector and the takeoff, and
   confirm the interface renders and recalculates without throwing.
   npm install jsdom, then: node tools/smoke.js   (run from the repo root) */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "file:///app/" });
const { window } = dom;
const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
window.alert = (m) => errors.push("alert: " + m);
window.CSS = window.CSS || { escape: (s) => s };
if (!window.CSS.escape) window.CSS.escape = (s) => s;

window.eval(fs.readFileSync("data/rules.js", "utf8"));
window.eval(fs.readFileSync("app.js", "utf8"));
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

const $ = (s) => window.document.querySelector(s);
const fire = (elm, type) => elm.dispatchEvent(new window.Event(type, { bubbles: true }));

function set(sel, value, type) {
  const e = $(sel);
  if (!e) throw new Error("missing element " + sel);
  e.value = value;
  fire(e, type || "change");
}

/* route a job type */
set('[data-sel="tearOff"]', "Yes");
set('[data-sel="layOver"]', "No");
set('[data-sel="membrane"]', "TPO");
set('[data-sel="attachment"]', "MF");
set('[data-sel="ballastRoof"]', "No");
set('[data-sel="keepBallast"]', "No");
set('[data-sel="concreteDeck"]', "No");
set('[data-sel="reskin"]', "No");
console.log("job type stamp:", $("#jobtypeStamp").textContent);

/* constraint check */
set('[data-sel="concreteDeck"]', "Yes");
console.log("constraint fires:", /must be fully adhered|cannot/.test($("#selector").textContent));
set('[data-sel="concreteDeck"]', "No");

/* takeoff */
const takeoff = {
  "Square Footage w/o Parapet Walls": 12000, "Square Footage w/ Parapet Walls": 13200,
  "Insulation Squares": 120, "Membrane Squares": 132, "Parapet Wall / Metal Cap L/F": 460,
  "Parapet Wall S/F": 1200, "Screw Length": 3, "Metal Dimensions": 14,
  "Required ISO Thickness": 5.2, "Gutter Line / Flat Termination L/F": 180,
  "Number of Penetrations": 14, "Scupper Boxes": 4, "Inside Corners": 6, "Outside Corners": 10,
  "Drains": 5, "Standard AC Units (5'x3')": 3, "Medium AC Units (7'x5')": 2, "Large AC Units (15'x10')": 1,
};
Object.keys(takeoff).forEach((k) => {
  const e = window.document.querySelector(`[data-input="${k.replace(/"/g, '\\"')}"]`);
  if (!e) { errors.push("no input box for " + k); return; }
  e.value = takeoff[k];
  fire(e, "input");
});

console.log("totals bar:", $("#bar").textContent.replace(/\s+/g, " ").trim().slice(0, 160));
console.log("material rows:", window.document.querySelectorAll("#materials tbody tr").length);
console.log("labor rows:", window.document.querySelectorAll("#labor tbody tr").length);

/* supplementals reach the total */
const before = $("#bar").textContent;
set('[data-supp="Dump Fees"]', "1200", "input");
console.log("supplementals move the cost:", before !== $("#bar").textContent);

/* save, demo pipeline, dashboard, rule book */
$("#saveQuote").click();
$("#loadDemo").click();
console.log("saved rows:", window.document.querySelectorAll("#savedTable tbody tr").length);
window.document.querySelector('[data-panel="dash"]').click();
console.log("charts:", window.document.querySelectorAll("#dash svg.chart").length);
console.log("kpis:", window.document.querySelectorAll("#dash .kpi").length);
window.document.querySelector('[data-panel="rules"]').click();
console.log("rule rows shown:", window.document.querySelectorAll("#ruleTable tbody tr").length);
console.log("integrity says:", $("#integrity .note").textContent.slice(0, 90));
set("#ruleJobType", "LO-TPO-MF");
console.log("drift flags on LO-TPO-MF:", window.document.querySelectorAll("#ruleTable .flag").length);
window.document.querySelector('[data-panel="quote"]').click();

console.log(errors.length ? "ERRORS: " + JSON.stringify(errors, null, 1) : "no errors");
