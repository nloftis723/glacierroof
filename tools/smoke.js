/* Headless smoke test for the redesigned interface. Run from the repo root:
   npm install jsdom (from cmd), then: node tools\smoke.js */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "file:///app/" });
const { window } = dom;
const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
window.alert = (m) => errors.push("alert: " + m);
if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) window.CSS.escape = (s) => s;

window.eval(fs.readFileSync("data/rules.js", "utf8"));
window.eval(fs.readFileSync("app.js", "utf8"));
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => window.document.querySelectorAll(s);
const fire = (elm, type) => elm.dispatchEvent(new window.Event(type, { bubbles: true }));
const click = (elm) => elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
function set(sel, value, type) {
  const e = $(sel);
  if (!e) throw new Error("missing element " + sel);
  e.value = value;
  fire(e, type || "change");
}

/* first load: locked cards, no dash wall */
console.log("locked cards on first load:", $$(".card.locked").length);
console.log("summary shows start steps:", /Answer the job criteria/.test($("#summary").textContent));

/* route a job type */
["tearOff|Yes", "layOver|No", "membrane|TPO", "attachment|MF", "ballastRoof|No", "keepBallast|No", "concreteDeck|No", "reskin|No"]
  .forEach((s) => { const [k, v] = s.split("|"); set(`[data-sel="${k}"]`, v); });
console.log("job type stamp:", $("#jobtypeStamp").textContent);
console.log("locked cards after routing:", $$(".card.locked").length);
console.log("skeleton banner shows:", /fill in live/.test($("#materials").textContent));

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

const summaryText = $("#summary").textContent.replace(/\s+/g, " ");
console.log("summary:", summaryText.slice(0, 150));
console.log("sell price present:", /SELL PRICE AT 40% MARGIN/.test(summaryText));
console.log("material rows:", $$("#materials tbody tr").length);
console.log("margin options:", $$(".marginOption").length);

/* details toggle */
$("#detailsToggle").checked = true; fire($("#detailsToggle"), "change");
console.log("details columns toggled:", $("#materials .showDetails") !== null);
$("#detailsToggle").checked = false; fire($("#detailsToggle"), "change");

/* margin pick */
click($$(".marginOption")[6]);
console.log("margin picked 55%:", /SELL PRICE AT 55% MARGIN/.test($("#summary").textContent));

/* supplementals reach the total */
const before = $("#summary").textContent;
set('[data-supp="Dump Fees"]', "1200", "input");
console.log("supplementals move the cost:", before !== $("#summary").textContent);

/* save, demo pipeline, dashboard, rule book */
click($("#saveQuote"));
click($("#loadDemo"));
console.log("saved rows:", $$("#savedTable tbody tr").length);
click(window.document.querySelector('[data-panel="dash"]'));
console.log("charts:", $$("#dash svg.chart").length, "kpis:", $$("#dash .kpi").length);
click(window.document.querySelector('[data-panel="rules"]'));
set("#ruleJobType", "LO-TPO-MF");
console.log("defect badges on LO-TPO-MF:", $$("#ruleTable .badge.red").length);
console.log("integrity says:", $("#integrity .note").textContent.slice(0, 90));

console.log(errors.length ? "ERRORS: " + JSON.stringify(errors, null, 1) : "no errors");
