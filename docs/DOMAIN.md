# Domain reference

Formulas and vocabulary for the Street Food Business System. Kept in sync with
[`spec.md`](../spec.md) — if the two disagree, the spec wins and this file is the bug.

## The unit ladder

| Unit | Meaning | Where it lives |
|---|---|---|
| **Piece** | One fishball, one coated quail egg, one calamares ring. The only stock unit. | Ledger, recipe yield, `costPerPiece` |
| **Stick** | What a customer buys. A product-specific number of pieces. | `piecesPerStick`, `pricePerStick`, `costPerStick` |
| **Set** | A five-product bundle used only for vendor incentive. | `SetDefinition` + `SetComponent` |

Pieces per stick: kwek-kwek 4 · calamares 3 · squidball 5 · fishball 10 · kikiam (big) 4.
One standard set = 50 sticks of each = **250 sticks / 1,300 pieces**.

Conversions live only in `src/lib/units.ts`. An inline `/ 10` anywhere else is a bug.

## Costing

```
lineCost        = qtyInBaseUnit × ingredientCostPerBaseUnit × (1 + wastagePct)
costPerPiece    = (Σ PER_BATCH lineCost / batchYieldPieces) + Σ PER_PIECE lineCost
costPerStick    = costPerPiece × piecesPerStick + Σ PER_STICK lineCost
grossProfit     = pricePerStick − costPerStick
grossMargin%    = grossProfit / pricePerStick × 100
costPerSet      = Σ costPerStick × requiredSticks
```

Cost is snapshotted, never recomputed: a shift line keeps the cost that applied on its
business date, so changing an ingredient price tomorrow cannot move last week's profit.

## Reconciliation (all quantities in pieces)

```
piecesSold   = piecesIssued − piecesReturned − piecesWasted     (>= 0)
sticksSold   = piecesSold / piecesPerStick                      (Decimal, unfloored)
pricePerPiece = pricePerStick / piecesPerStick
grossSales   = Σ piecesSold × pricePerPiece
netSales     = grossSales − discountTotal
expectedCash = netSales − digitalSales − otherPayments
cashVariance = cashRemitted − expectedCash                      (negative = shortage)
cogs         = Σ piecesSold × unitCostPerPiece
wasteCost    = Σ piecesWasted × unitCostPerPiece                (OPEX, never COGS)
grossProfit  = netSales − cogs
sellThrough% = piecesSold / piecesIssued × 100
```

## Compensation

```
basePay        = scheme.baseDailyRate
componentShare = setDefinition.incentiveAmount / componentCount
credits_c      = floor(sticksSold_c / requiredSticks_c)     [PER_COMPONENT — the default]
incentive      = Σ credits_c × componentShare
deductions     = cash shortage (full, uncapped, only if vendorAcknowledged)
                 + advances + unreturned items
netPay         = basePay + incentive − deductions
```

Other modes: `ALL_COMPONENTS` (floor of the weakest ratio × full incentive) and
`PROPORTIONAL` (weakest ratio × full incentive, unfloored). Switchable in Settings.

## Replenishment

```
avgDailyUsage = Σ piecesSold over trailing 14 active days / active days
daysOfCover   = onHand / avgDailyUsage
reorderPoint  = avgDailyUsage × leadTimeDays + safetyStock
suggestedQty  = max(0, avgDailyUsage × (leadTimeDays + coverDays)
                       + safetyStock − onHand − onOrder)   rounded UP to packSize
```

## Profitability

```
Net Sales − COGS = Gross Profit
  − Labor Cost − Wastage Cost − Direct Operating Expenses = Operating Profit
  − Allocated Overhead (optional) = Net Profit
```

## Glossary

| Term | Meaning |
|---|---|
| **Business date** | The reporting day. A cart closing at 01:30 belongs to the previous business date; the cutoff is 04:00 Manila. |
| **Load-out** | The morning issuance of pieces to a cart (`ShiftIssue` seq 1). |
| **Refill** | A mid-day per-product top-up (`ShiftIssue` seq ≥ 2, `isRefill`). |
| **Sell-through** | Pieces sold ÷ pieces issued. |
| **Cash variance** | Cash remitted − expected cash. Negative is a shortage. Beyond ₱100 the shift is `DISPUTED`. |
| **Vendor acknowledgment** | The vendor's confirmation of the closing count. No acknowledgment, no pay deduction. |
| **Segregation of duties** | The user who closes a shift may never approve it. |
| **Tenant** | One cart operator = one `Company` row. Every table carries `companyId`. |
