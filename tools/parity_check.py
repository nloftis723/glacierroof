"""
Parity harness.

Enters the same takeoff into the original workbook and into the mockup's rule
engine, then compares every material line, every labor line, and the material
total. This is the test the go-live gate is built on, run here against invented
takeoff numbers instead of real historical quotes.

Excel side: the workbook copy is recalculated by Excel through COM on Windows
(pip install pywin32), or by any recalculation script named in RECALC.
Engine side: node runs app.js with a stub DOM and the same inputs.

Run from the repo root:  python tools\\parity_check.py --refill
"""

import openpyxl, json, subprocess, shutil, sys, os

MASTER = os.environ.get("MASTER_WORKBOOK", "source/Master_Copy_Commercial_Roofing_Quote_Template_20260630.xlsx")
WORK = os.environ.get("PARITY_COPY", "parity.xlsx")
RECALC = os.environ.get("RECALC", "")

# Invented takeoff. Every input gets a value so the workbook's dash defect
# (D-01) does not fire and Excel can compute a comparable number.
TAKEOFF = {
    "Square Footage w/o Parapet Walls": 12000,
    "Square Footage w/ Parapet Walls": 13200,
    "Insulation Squares": 120,
    "Membrane Squares": 132,
    "Parapet Wall / Metal Cap L/F": 460,
    "Parapet Wall S/F": 1200,
    "Screw Length": 3,
    "Metal Dimensions": 14,
    "Required ISO Thickness": 5.2,
    "Gutter Line / Flat Termination L/F": 180,
    "Gutter Line L/F": 180,
    "Number of Penetrations": 14,
    "Scupper Boxes": 4,
    "Inside Corners": 6,
    "Outside Corners": 10,
    "Drains": 5,
    "Standard AC Units (5'x3')": 3,
    "Medium AC Units (7'x5')": 2,
    "Large AC Units (15'x10')": 1,
    # restoration only
    "Square Footage of Membrane": 12000,
    "Parapet Metal Dimensions": 14,
    "Number of Roof Penetrations": 14,
    "Pipe Boots to Replace": 9,
    "Number of breaches": 7,
    "Square footage of ponding water": 900,
}

TABS = ["Restoration", "TO-TPO-MF", "TO-TPO-FA", "TO-EPDM-MF", "TO-EPDM-FA",
        "LO-TPO-MF", "LO-TPO-FA", "LO-EPDM-MF", "LO-EPDM-FA", "LO-EPDM-BAL",
        "CON-TO-TPO-FA", "CON-TO-EPDM-FA", "CON-LO-TPO-FA", "CON-LO-EPDM-FA",
        "RES-LO-TPO-MF", "RES-LO-EPDM-MF"]


def recalculate(path):
    """Excel through COM, or a recalculation script named in RECALC."""
    if RECALC:
        out = subprocess.run([sys.executable, RECALC, path, "180"], capture_output=True, text=True)
        print(out.stdout.strip()[:600])
        return
    import win32com.client
    xl = win32com.client.Dispatch("Excel.Application")
    xl.Visible = False
    xl.DisplayAlerts = False
    wb = xl.Workbooks.Open(os.path.abspath(path))
    xl.CalculateFullRebuild()
    wb.Save()
    wb.Close(False)
    xl.Quit()
    print("recalculated in Excel")


def fill():
    shutil.copy(MASTER, WORK)
    wb = openpyxl.load_workbook(WORK)
    for tab in TABS:
        ws = wb[tab]
        for r in range(7, 30):
            label = ws.cell(r, 1).value
            if label and " ".join(str(label).split()) in TAKEOFF:
                ws.cell(r, 2).value = TAKEOFF[" ".join(str(label).split())]
    wb.save(WORK)
    recalculate(WORK)


def read_excel():
    wb = openpyxl.load_workbook(WORK, data_only=True)
    res = {}
    for tab in TABS:
        ws = wb[tab]
        start = None
        for r in range(1, 80):
            if str(ws.cell(r, 1).value).strip() == "Material":
                start = r + 1
                break
        lines, labor = {}, {}
        r = start
        while r < 120:
            name = ws.cell(r, 1).value
            if name is None or str(name).startswith("Section"):
                break
            lines[" ".join(str(name).split())] = dict(
                qtyWithWaste=ws.cell(r, 6).value,
                subtotal=ws.cell(r, 8).value,
                unitPrice=ws.cell(r, 2).value,
            )
            r += 1
        for rr in range(r, r + 30):
            a = ws.cell(rr, 1).value
            if a and str(a).startswith("Section 4"):
                break
            if a and str(a).strip() not in ("Section 3 - Labor",) and ws.cell(rr, 2).value is not None:
                labor[str(a).strip()] = ws.cell(rr, 2).value
        totals = {}
        for rr in range(r, 130):
            a = ws.cell(rr, 1).value
            if a and str(a).strip() in ("Material Total", "Labor Total", "Grand Total - Cost", "Material Total Before Tax"):
                totals[str(a).strip()] = ws.cell(rr, 2).value
        res[tab] = dict(lines=lines, labor=labor, totals=totals)
    return res


NODE = r"""
const fs = require('fs');
global.window = {};
global.document = { addEventListener: () => {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => ({ addEventListener: () => {} }) };
global.CSS = { escape: (s) => s };
eval(fs.readFileSync('data/rules.js', 'utf8'));
eval(fs.readFileSync('app.js', 'utf8'));
const E = window.__engine, R = window.RULES;
const takeoff = JSON.parse(fs.readFileSync('takeoff.json', 'utf8'));
E.settings.pricingMode = 'workbook';
E.settings.ruleMode = 'workbook';
const out = {};
Object.keys(R.rules).forEach((jt) => {
  const q = E.blankQuote();
  q.jobType = jt;
  R.jobInputs[jt].forEach((k) => { if (takeoff[k] !== undefined) q.inputs[k] = takeoff[k]; });
  const c = E.compute(q);
  out[jt] = {
    lines: c.lines.map((l) => ({ material: l.material, qtyWithWaste: l.qtyWithWaste,
      subtotal: l.subtotal, unitPrice: l.unitPrice, manual: l.rule.manual })),
    labor: c.labor.map((l) => ({ line: l.line, amount: l.amount })),
    totals: c.totals,
  };
});
out.__validation = E.validateAllRules();
fs.writeFileSync('engine_out.json', JSON.stringify(out));
"""


def read_engine():
    with open("takeoff.json", "w") as f:
        json.dump(TAKEOFF, f)
    with open("drive.js", "w") as f:
        f.write(NODE)
    r = subprocess.run(["node", "drive.js"], capture_output=True, text=True, shell=(os.name == "nt"))
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:]); sys.exit(1)
    return json.load(open("engine_out.json"))


def close(a, b, tol=0.02):
    if a is None and b is None:
        return True
    a = 0 if a in (None, "") else a
    b = 0 if b in (None, "") else b
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def main():
    if not os.path.exists(WORK) or "--refill" in sys.argv:
        fill()
    xl = read_excel()
    en = read_engine()

    bad = en.get("__validation") or []
    print("rule validation problems:", len(bad))
    for b in bad[:10]:
        print("   ", b)

    total_lines = matched = 0
    diffs = []
    for tab in TABS:
        e, x = en[tab], xl[tab]
        for l in e["lines"]:
            if l["manual"]:
                continue
            xr = x["lines"].get(" ".join(l["material"].split()))
            if xr is None:
                diffs.append((tab, l["material"], "not found in workbook", "", ""))
                continue
            total_lines += 1
            if close(l["qtyWithWaste"], xr["qtyWithWaste"], 0.001) and close(l["subtotal"], xr["subtotal"], 0.05):
                matched += 1
            else:
                diffs.append((tab, l["material"],
                              "qty %s vs %s" % (l["qtyWithWaste"], xr["qtyWithWaste"]),
                              "subtotal %.2f vs %s" % (l["subtotal"], xr["subtotal"]), ""))
        for l in e["labor"]:
            xv = x["labor"].get(l["line"])
            if xv is None:
                continue
            total_lines += 1
            if close(l["amount"], xv, 0.05):
                matched += 1
            else:
                diffs.append((tab, "LABOR " + l["line"], "%.2f vs %s" % (l["amount"], xv), "", ""))
        total_lines += 1
        if close(e["totals"]["materialTotal"], x["totals"].get("Material Total"), 0.10):
            matched += 1
        else:
            diffs.append((tab, "MATERIAL TOTAL",
                          "%.2f vs %s" % (e["totals"]["materialTotal"], x["totals"].get("Material Total")), "", ""))

    print("\ncompared %d values across %d tabs, matched %d (%.2f%%)"
          % (total_lines, len(TABS), matched, 100.0 * matched / total_lines))
    if diffs:
        print("\ndifferences:")
        for d in diffs:
            print("   ", " | ".join(str(x) for x in d if x != ""))
    else:
        print("no differences")


if __name__ == "__main__":
    main()
