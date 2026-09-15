# Roofing estimator, local mockup

A working estimator that runs from this folder. No server, no database, no
Azure. The point is to let the estimators argue with the rules before anything
gets built.

Nick
September 15, 2026

## Run it

Open `index.html` in a browser. That is the whole install.

For GitHub Pages, serve from the root of the default branch. Everything is
static and loads `data/rules.js` with a plain script tag, so it runs from
`file://` just as well as from a web server.

## What it does

- Routes a job type from the eight criteria questions, with all seven
  constraints checked on every change.
- Collects the Section 1 takeoff for whichever job type routed.
- Prices all 46 materials from the rule table, with waste, rounding and minimum
  quantity applied per rule.
- Computes labor, supplementals, cost, cost per square, and the twelve step
  margin ladder, live from the first keystroke.
- Produces the materials ordering list.
- Saves quotes in the browser tab with a price and rule snapshot, and exports
  or loads them as a JSON file.
- Charts pipeline, seasonality, win rate, and margin taken.
- Shows the rule book: every quantity rule, its waste, its rounding, its price,
  and any flag on it.

## What it deliberately does not do

No database, no accounts, no PDF, no attachments, no audit trail, no MCP
server. Quotes live in the browser tab until exported. All of that belongs to
the Azure build, and none of it should be designed until the rules are ruled on.

## Rules are data

`data/rules.json` is the seed for the real database. It carries:

| Key | Contents |
|---|---|
| `jobTypes` | the 16 codes, decomposed into removal method, membrane, attachment, deck type, reskin, restoration |
| `inputs`, `jobInputs` | the 25 Section 1 fields and which job types collect which |
| `materials` | 46 SKUs with list price, per tab prices, target percent, pack, estimator note |
| `rules` | 383 quantity rules: expression, waste, rounding, minimum quantity, flags |
| `labor` | 71 labor lines: basis, rate, driver expression |
| `supplementals`, `margins`, `selector` | supplemental lines, the margin ladder, the questions and the seven constraints |

`app.js` contains no formula, no price, and no rate. It parses the expression
in the rule to a small syntax tree and evaluates it. Supported functions are
ROUNDUP, ROUNDDOWN, ROUND, MIN, MAX, SUM and IF. There is no `eval` and no way
for a rule to run arbitrary code.

Change a rule in `data/rules.json`, reload, and the estimate changes. That is
the behavior the Azure build has to keep.

Both `data/rules.json` and `data/rules.js` are generated. To rebuild them, put
the two source workbooks in `source/` (gitignored, since they hold the client's
prices) and run:

```
python tools\extract_rules.py
```

## Parity

`tools\parity_check.py` enters the same takeoff into a copy of the original
workbook and into the rule engine, recalculates the workbook in Excel through
COM, and compares every material line, every labor line, and the material total.

Current result: 442 values compared across all 16 tabs, 442 matched.

```
python -m pip install pywin32
python tools\parity_check.py --refill
```

This is a synthetic takeoff, not a historical quote. It proves the engine
reproduces the workbook's arithmetic. It does not prove the workbook is right,
which is what Phase 0 is for.

`tools\smoke.js` drives the interface headlessly:

```
npm install jsdom
node tools\smoke.js
```

Note for PowerShell: npm ships as a .ps1 script and the execution policy on
this machine blocks it. Run npm from cmd, or call `npm.cmd`.

## Settings that matter for parity testing

On the Rules and prices tab:

- **Pricing**: one price list, or the workbook's per tab prices. Use the
  workbook prices when reconciling historical quotes, since that is how they
  were priced.
- **Quantity rules**: as the workbook has them, or with the two copy-paste
  defects corrected. Historical quotes were produced with the defects in place.

## Defects the mockup already handles

D-01, D-02, D-04, D-05, D-06, D-07, D-10, D-13 from the defect register, plus
D-03 flagged rather than silently fixed. Two further defects were found while
building this:

- **D-14.** The supplemental total cell is empty on all 16 job type tabs.
  Dump fees, travel, lodging and rental equipment are typed in and then dropped
  from the grand total. Only the Restoration tab sums them.
- **D-15.** On `LO-EPDM-BAL` the labor total is `SUM(B57:B60)`, which starts one
  row below Ballast Move/Replace. On `RES-LO-TPO-MF` it is `SUM(B56:B59)`, one
  row below Membrane Removal. On both tabs the first labor line is dropped from
  the total. At $50 per square, a 150 square ballast job is short $7,500 of
  labor before margin.

One gap in the extract was also found and closed: the EPDM Quickseam Flashing
price on the Restoration tab is a formula, `=275.01/120`, so the extract
recorded it as blank. It is carried in `data/rules.json` as a derived price with
a note.

## Layout

```
index.html          the page
app.js              rule engine and interface
styles.css          styling
data/rules.json     rule seed, database shaped (generated)
data/rules.js       the same payload for file:// loading (generated)
tools/extract_rules.py   rebuilds both from the spec extract workbook
tools/parity_check.py    workbook versus engine comparison
tools/smoke.js           headless interface test
docs/parity-report.md    the parity run, tab by tab
source/             the two client workbooks, gitignored
```

## Next

1. Walk the rule book with the lead estimator, job type by job type, and rule
   each flagged case intentional or defective.
2. Confirm every price with the vendor. 7 of the 46 materials carry no usable
   price anywhere in the workbook: soft and firm fabric, tapered insulation,
   drip edge, SS clamp kit, coil and sheet metal, and lap sealant. Inside
   Corners carries a price on one tab out of fifteen.
3. Load 10 to 15 historical quotes with known outcomes, enter each takeoff, and
   reconcile to the dollar. That set is the go-live gate for the real build.
