# Parity report: workbook versus rule engine

Nick  
September 15, 2026

## What was tested

The same takeoff was entered into a copy of
`Master_Copy__Commercial_Roofing_Quote_Template__20260630.xlsx` and into the
mockup's rule engine. Excel recalculated the workbook copy, then every material
line, every labor line, and the material total were compared on all 16 tabs.

The engine ran in parity mode for this: workbook per tab prices, and quantity
rules exactly as the workbook has them, defects included.

## Result

**442 values compared. 442 matched. No differences.**

Tolerance: quantities to 0.001, money to 5 cents, material totals to 10 cents.
Manual entry lines (tapered insulation, coil and sheet metal, and the other 28
lines the workbook leaves to the estimator) are excluded, since they carry no
formula to reproduce.

## By tab

| Job type | Material lines | Labor lines | Values compared | Matched | Material total |
|---|---:|---:|---:|---:|---:|
| Restoration | 15 | 3 | 19 | 19 | $2,714.14 |
| TO-TPO-MF | 25 | 5 | 31 | 31 | $62,681.00 |
| TO-TPO-FA | 24 | 5 | 30 | 30 | $65,763.36 |
| TO-EPDM-MF | 23 | 5 | 29 | 29 | $61,901.65 |
| TO-EPDM-FA | 22 | 5 | 28 | 28 | $65,053.77 |
| LO-TPO-MF | 25 | 4 | 30 | 30 | $39,544.84 |
| LO-TPO-FA | 24 | 4 | 29 | 29 | $42,964.95 |
| LO-EPDM-MF | 23 | 4 | 28 | 28 | $39,168.78 |
| LO-EPDM-FA | 22 | 4 | 27 | 27 | $58,337.52 |
| LO-EPDM-BAL | 22 | 5 | 28 | 28 | $34,363.32 |
| CON-TO-TPO-FA | 23 | 5 | 29 | 29 | $64,287.84 |
| CON-TO-EPDM-FA | 21 | 5 | 27 | 27 | $63,643.79 |
| CON-LO-TPO-FA | 23 | 4 | 28 | 28 | $41,554.97 |
| CON-LO-EPDM-FA | 21 | 4 | 26 | 26 | $56,927.54 |
| RES-LO-TPO-MF | 22 | 5 | 28 | 28 | $26,790.78 |
| RES-LO-EPDM-MF | 20 | 4 | 25 | 25 | $26,391.71 |
| **Total** | | | **442** | **442** | |

Engine and workbook material totals are identical on every tab, which is why
only one column is shown.

## The takeoff used

ASSUMPTION: these are invented numbers, chosen to exercise every input. They are
not a historical quote.

| Input | Value |
|---|---:|
| Square Footage w/o Parapet Walls | 12,000 |
| Square Footage w/ Parapet Walls | 13,200 |
| Insulation Squares | 120 |
| Membrane Squares | 132 |
| Parapet Wall / Metal Cap L/F | 460 |
| Parapet Wall S/F | 1,200 |
| Screw Length | 3 |
| Metal Dimensions | 14 |
| Required ISO Thickness | 5.2 |
| Gutter Line / Flat Termination L/F (and Gutter Line L/F) | 180 |
| Number of Penetrations | 14 |
| Scupper Boxes | 4 |
| Inside Corners | 6 |
| Outside Corners | 10 |
| Drains | 5 |
| Standard AC Units (5'x3') | 3 |
| Medium AC Units (7'x5') | 2 |
| Large AC Units (15'x10') | 1 |

Restoration only: Square Footage of Membrane 12,000, Pipe Boots to Replace 9,
Number of breaches 7, Square footage of ponding water 900, Parapet Metal
Dimensions 14, Number of Roof Penetrations 14.

## What this proves, and what it does not

It proves the rule engine reproduces the workbook's arithmetic on all 16 tabs,
which means the 383 quantity rules, the waste percentages, the rounding, the
minimum quantity behavior, the labor drivers and the tax treatment were carried
over correctly.

It does not prove the workbook is right. The two copy-paste defects on
`LO-TPO-MF` still produce their wrong answers here, on purpose, because that is
what parity means: the engine has to reproduce history before anyone is asked to
trust it on new work.

## Three findings from the run

1. The supplemental total cell is empty on all 16 job type tabs. Dump fees,
   travel, lodging and rental equipment are typed in and then dropped from the
   grand total. Only the Restoration tab sums them. Filed as D-14.
2. On `LO-EPDM-BAL` the labor total is `SUM(B57:B60)`, one row below Ballast
   Move/Replace. On `RES-LO-TPO-MF` it is `SUM(B56:B59)`, one row below Membrane
   Removal. The first labor line is dropped on both tabs. At $50 per square, a
   150 square ballast job is short $7,500 of labor before margin. Filed as D-15.
3. The EPDM Quickseam Flashing unit price on Restoration is a formula,
   `=275.01/120`, so the spec extract recorded it as blank. It is now carried in
   the seed data as a derived price with its source noted. This was the last
   remaining parity difference.

## Next, and this is the real gate

This run used invented numbers. The go-live gate is 10 to 15 historical quotes
with known win or loss outcomes, entered by the estimator who originally built
them, reconciled to the dollar. Collect them before the schema is finalized:
they decide questions about roof sections, revisions, and overrides that no
amount of design discussion will settle.

## Reproducing it

```
python -m pip install pywin32
python tools\parity_check.py --refill
```

`--refill` rewrites the workbook copy and recalculates it in Excel. Without it,
the existing copy is reused and only the engine side runs. Set the `RECALC`
environment variable to a recalculation script if you would rather not drive
Excel.
