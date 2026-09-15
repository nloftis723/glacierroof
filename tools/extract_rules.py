"""
Build the rule seed data for the roofing estimator mockup.

Input:  Roofing_Estimator_Spec_Extract.xlsx  (the plain-language rule extract)
Output: rules.json  (database seed shape)
        rules.js    (same payload assigned to window.RULES, so the mockup runs
                     from file:// without a web server)

Every rule is carried over as data. Nothing is hardcoded into the app.
"""

import openpyxl, json, re, collections, sys, os

SRC = os.environ.get("SPEC_EXTRACT", "source/Roofing_Estimator_Spec_Extract.xlsx")
MASTER = os.environ.get("MASTER_WORKBOOK", "source/Master_Copy_Commercial_Roofing_Quote_Template_20260630.xlsx")
OUTDIR = os.environ.get("OUTDIR", "data")
wb = openpyxl.load_workbook(SRC, data_only=True)
mwb = openpyxl.load_workbook(MASTER, data_only=True)


def sheet(name):
    rows = list(wb[name].iter_rows(values_only=True))
    hdr = rows[0]
    return [dict(zip(hdr, r)) for r in rows[1:] if any(c is not None for c in r)]


# ---------------------------------------------------------------- job types
JOB_ORDER = [
    "Restoration", "TO-TPO-MF", "TO-TPO-FA", "TO-EPDM-MF", "TO-EPDM-FA",
    "LO-TPO-MF", "LO-TPO-FA", "LO-EPDM-MF", "LO-EPDM-FA", "LO-EPDM-BAL",
    "CON-TO-TPO-FA", "CON-TO-EPDM-FA", "CON-LO-TPO-FA", "CON-LO-EPDM-FA",
    "RES-LO-TPO-MF", "RES-LO-EPDM-MF",
]


def decompose(code):
    if code == "Restoration":
        return dict(removal=None, membrane="Coating", attachment=None,
                    deck="Standard", reskin=False, restoration=True,
                    label="Restoration / coating")
    parts = code.split("-")
    concrete = parts[0] == "CON"
    reskin = parts[0] == "RES"
    if concrete or reskin:
        parts = parts[1:]
    removal = {"TO": "Tear off", "LO": "Lay over"}[parts[0]]
    membrane = parts[1]
    attach = {"MF": "Mechanically fastened", "FA": "Fully adhered",
              "BAL": "Ballasted"}[parts[2]]
    bits = [removal, membrane, attach.lower()]
    if concrete:
        bits.insert(0, "Concrete deck")
    if reskin:
        bits.insert(0, "Reskin")
    return dict(removal=removal, membrane=membrane, attachment=attach,
                deck="Concrete" if concrete else "Standard", reskin=reskin,
                restoration=False, label=", ".join(bits))


job_types = [dict(code=c, **decompose(c)) for c in JOB_ORDER]

# ---------------------------------------------------------------- inputs
inputs = []
for r in sheet("Inputs Master"):
    label = r["Input field"]
    order = int(str(r["Source row(s)"]).split(",")[0].strip())
    inputs.append(dict(
        key=label,
        label=label,
        help=(r["Description / example from sheet"] or "").strip(),
        order=order,
        jobTypes=[j.strip() for j in str(r["Job types"]).split(",")],
    ))


def tab_input_order(code):
    """Display order and, more importantly, the row order the workbook's
    SUM(B18:B22) style rules depend on. The extract lists the rows a field
    occupies across tabs but not which row belongs to which tab, so this comes
    from the master workbook itself."""
    ws = mwb[code]
    order, started = [], False
    for r in range(1, 40):
        a = ws.cell(r, 1).value
        if a is None:
            continue
        a = " ".join(str(a).split())
        if a.startswith("Section 1"):
            started = True
            continue
        if started and a.startswith("Section 2"):
            break
        if started and a not in ("Input",):
            order.append(a)
    return order


known = {i["key"] for i in inputs}
job_inputs = {}
for c in JOB_ORDER:
    seq = [k for k in tab_input_order(c) if k in known]
    extra = [i["key"] for i in inputs if c in i["jobTypes"] and i["key"] not in seq]
    job_inputs[c] = seq + extra

# ---------------------------------------------------------------- materials
price_by_job = collections.defaultdict(dict)
for r in sheet("Price Variance"):
    price_by_job[r["Material"]][r["Job type"]] = r["Unit price"]

# The extract recorded this one price as blank because the workbook holds it as
# a formula (=275.01/120: a 5" x 100' roll cut into 10" patches). Carried over
# so the engine reproduces the Restoration tab.
DERIVED_PRICES = {
    "EPDM Quickseam Flashing  (priced per patch, not per roll - see note)":
        (275.01 / 120, "Derived from the workbook: $275.01 per 5 in x 100 ft roll, priced per 10 in patch"),
}

materials = []
for r in sheet("Materials Master"):
    name = r["Material"]
    prices = dict(price_by_job.get(name, {}))
    found = r["Unit prices found (if varies)"]
    single = r["Unit price (single value)"]
    real = [v for v in prices.values() if v is not None]
    if real:
        modal = collections.Counter(real).most_common(1)[0][0]
    else:
        modal = single
    derived = DERIVED_PRICES.get(name)
    if derived and modal is None:
        modal = derived[0]
    materials.append(dict(
        name=name,
        listPrice=(None if modal is None else float(modal)),
        priceNote=(derived[1] if derived else None),
        pricesByJobType={k: (None if v is None else float(v)) for k, v in prices.items()},
        priceTabs=sorted(prices.keys()),
        priceVaries=bool(found),
        priceVariants=(str(found) if found else None),
        blankOnSomeTab=(r["Blank price on >=1 tab"] == "YES"),
        targetPct=(float(r["Target % of material cost"])
                   if r["Target % of material cost"] is not None else None),
        pack=(r["Pack / product description"] or "").strip(),
        note=(r["Estimator note"] or "").strip(),
    ))

# ---------------------------------------------------------------- drift flags
drift = {}
for r in sheet("Rule Drift"):
    if r["Flag"]:
        for jt in [x.strip() for x in str(r["Job types sharing this rule"]).split(",")]:
            drift[(jt, r["Material"])] = r["Flag"]

# corrected rules for the two confirmed copy-paste defects (D-03).
# The workbook rule stays the default so the app can reproduce history.
CORRECTED = {
    ("LO-TPO-MF", "TPO Primer"):
        "([Parapet Wall / Metal Cap L/F]+[Number of Penetrations]+[Gutter Line / Flat Termination L/F])/200",
    ("LO-TPO-MF", "TPO Cut Edge Sealant"):
        "[Membrane Squares]/10",
}

# ---------------------------------------------------------------- qty rules
DASH = re.compile(r'^\s*if\(\s*\[(?P<v>[^\]]+)\]\s*=\s*""\s*,\s*"-"\s*,\s*\[(?P=v)\]\s*\)\s*$', re.I)


def parse_qty_with_waste(expr):
    """The workbook writes the same shape 380 times. Reduce it to a rounding
    rule and a minimum quantity, which is what the data model actually needs."""
    if expr is None or str(expr).strip().upper() == "N/A":
        return dict(rounding="UP", minQty=0)
    e = str(expr)
    min_qty = 1 if re.search(r"^\s*IF\(ROUNDUP\(.*\)=0,1,", e, re.I) else 0
    rounding = "UP" if "ROUNDUP" in e.upper() else (
        "DOWN" if "ROUNDDOWN" in e.upper() else "NEAREST")
    return dict(rounding=rounding, minQty=min_qty)


RANGE = re.compile(r'sum\(\s*\[([^\]]+)\]\s*:\s*\[([^\]]+)\]\s*\)', re.I)


def expand_ranges(expr, jt):
    """The workbook writes SUM(B18:B22), a range of input rows. Rewrite it as a
    named sum so the rule no longer depends on row position."""
    order = job_inputs[jt]

    def sub(m):
        a, b = m.group(1), m.group(2)
        if a not in order or b not in order:
            raise ValueError("range endpoint not an input of %s: %s..%s" % (jt, a, b))
        i, j = order.index(a), order.index(b)
        span = order[min(i, j):max(i, j) + 1]
        return "(" + "+".join("[%s]" % s for s in span) + ")"

    return RANGE.sub(sub, expr)


rules = collections.defaultdict(list)
for r in sheet("Qty Rules"):
    jt, mat = r["Job type"], r["Material"]
    raw = r["Quantity needed rule"]
    raw_s = "" if raw is None else str(raw).strip()
    manual = raw_s.upper() in ("N/A", "")
    flags = []
    expr = raw_s
    m = DASH.match(raw_s)
    if m:
        expr = "[%s]" % m.group("v")
        flags.append("D-01 normalized: empty count reads as zero, not a dash")
    if not manual and RANGE.search(expr):
        expanded = expand_ranges(expr, jt)
        flags.append("Workbook used a row range here. Rewritten as a named sum: " + expanded)
        expr = expanded
    if (jt, mat) in drift:
        flags.append(drift[(jt, mat)])
    waste = r["Waste %"]
    waste = 0.0 if (waste is None or str(waste).upper() == "N/A") else float(waste)
    rules[jt].append(dict(
        material=mat,
        order=int(r["Row"]),
        expr=("" if manual else expr),
        manual=manual,
        waste=waste,
        correctedExpr=CORRECTED.get((jt, mat)),
        flags=flags,
        **parse_qty_with_waste(r["Qty with waste rule"]),
    ))
for jt in rules:
    rules[jt].sort(key=lambda x: x["order"])

# ---------------------------------------------------------------- labor
DETAIL_INPUTS = ["Number of Penetrations", "Scupper Boxes", "Inside Corners",
                 "Outside Corners", "Drains", "Standard AC Units (5'x3')",
                 "Medium AC Units (7'x5')", "Large AC Units (15'x10')"]
DETAIL_EXPR = "+".join("[%s]" % i for i in DETAIL_INPUTS)

LABOR_SHAPE = {
    "Tear off labor":       ("per square", "[Membrane Squares]"),
    "Ballast Move/Replace": ("per square", "[Insulation Squares]"),
    "Membrane Removal":     ("per square", "[Membrane Squares]"),
    "Labor Field Estimate": ("per square", "[Membrane Squares]"),
    "Labor Estimate":       ("per square", "[Square Footage of Membrane]/100"),
    "Labor Detail Estimate": ("per detail", DETAIL_EXPR),
    "Metal Labor":          ("per L/F", "[Parapet Wall / Metal Cap L/F]"),
    "Paint Labor":          ("per L/F", "[Parapet Wall / Metal Cap L/F]"),
}
DETAIL_RATE = 25.0  # D-07: was buried inside the formula, now a rate

labor = collections.defaultdict(list)
supplementals = collections.defaultdict(list)
for r in sheet("Labor and Supplementals"):
    jt, line = r["Job type"], r["Line"]
    if r["Section"] == "Labor":
        if line == "Labor Total":
            continue
        basis, driver = LABOR_SHAPE[line]
        rate = r["Cost per square"] if basis == "per square" else (
            r["Cost per L/F"] if basis == "per L/F" else DETAIL_RATE)
        rate = DETAIL_RATE if (rate in ("X", None)) else float(rate)
        labor[jt].append(dict(line=line, basis=basis, driver=driver, rate=rate,
                              note=(r["Note"] or "").strip()))
    else:
        if line == "Supplmental Total":
            continue
        val = r["Cost rule / value"]
        supplementals[jt].append(dict(
            line=line, default=(float(val) if isinstance(val, (int, float)) else 0.0),
            note=(r["Note"] or "").strip()))

# ---------------------------------------------------------------- selector
selector = dict(
    questions=[
        dict(key="tearOff", label="Is this a tear off job?", type="yn"),
        dict(key="layOver", label="Is this a lay over job?", type="yn"),
        dict(key="membrane", label="Membrane type", type="choice", options=["TPO", "EPDM", "Coating"]),
        dict(key="attachment", label="Installation type", type="choice", options=["MF", "FA"]),
        dict(key="ballastRoof", label="Is this a ballast roof?", type="yn",
             note="If yes, include the ballast rock removal quote"),
        dict(key="keepBallast", label="Are we keeping the ballast? (lay over)", type="yn"),
        dict(key="concreteDeck", label="Is this a concrete deck?", type="yn"),
        dict(key="reskin", label="Is the roof system being reskinned?", type="yn"),
    ],
    constraints=[
        dict(id="C-1", rule="Tear off and lay over cannot both be selected",
             message="Tear off and lay over are both selected"),
        dict(id="C-2", rule="One of tear off or lay over must be selected",
             message="Select either tear off or lay over"),
        dict(id="C-3", rule="Concrete deck and reskin cannot both be selected",
             message="Concrete deck and reskin are both selected"),
        dict(id="C-4", rule="Concrete deck jobs cannot be ballasted",
             message="A concrete deck job cannot be ballasted"),
        dict(id="C-5", rule="Concrete deck jobs must be fully adhered",
             message="A concrete deck job must be fully adhered"),
        dict(id="C-6", rule="TPO cannot be ballasted",
             message="TPO cannot be ballasted"),
        dict(id="C-7", rule="Concrete deck plus tear off plus EPDM is not an allowed combination",
             message="Concrete deck with tear off and EPDM is not an allowed system"),
    ],
)

# ---------------------------------------------------------------- payload
payload = dict(
    meta=dict(
        source="Master_Copy__Commercial_Roofing_Quote_Template__20260630.xlsx",
        via="Roofing_Estimator_Spec_Extract.xlsx",
        built="2026-09-15",
        taxRate=0.07,
        taxNote="ASSUMPTION: 7 percent, taken from the *1.07 hardcoded in the workbook. "
                "Confirm the county rate and the out of state rule (interview Block 4).",
        detailLaborRate=DETAIL_RATE,
        priceNote="ASSUMPTION: unit prices are a snapshot from the master copy on 2026-09-15, "
                  "not a validated price list. Vendor confirmation required in Phase 0.",
    ),
    jobTypes=job_types,
    inputs=[{k: v for k, v in i.items() if k != "jobTypes"} for i in inputs],
    jobInputs=job_inputs,
    materials=materials,
    rules=rules,
    labor=labor,
    supplementals=supplementals,
    margins=[0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80],
    selector=selector,
)

if not os.path.isdir(OUTDIR):
    os.makedirs(OUTDIR)
with open(os.path.join(OUTDIR, "rules.json"), "w") as f:
    json.dump(payload, f, indent=1)
with open(os.path.join(OUTDIR, "rules.js"), "w") as f:
    f.write("// Generated by extract_rules.py. Do not hand edit.\n")
    f.write("window.RULES = ")
    json.dump(payload, f, separators=(",", ":"))
    f.write(";\n")

print("job types:", len(job_types))
print("inputs:", len(inputs))
print("materials:", len(materials))
print("rule rows:", sum(len(v) for v in rules.values()))
print("manual rows:", sum(1 for v in rules.values() for r in v if r["manual"]))
print("flagged rows:", sum(1 for v in rules.values() for r in v if r["flags"]))
print("labor rows:", sum(len(v) for v in labor.values()))
