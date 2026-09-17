# Street Food Business System — MVP Build Spec

> **For Claude Code.** This is the authoritative build document. Read it fully before writing code.
> Build in the phase order given in §12. After each phase, run the tests and stop at the checkpoint.

---

## 1. What we are building

A central command center for a multi-branch, multi-cart Filipino street-food business. One owner, many branches, many food carts / motor carts, many vendors. The system must answer, at any moment:

| Question | Module |
|---|---|
| How much did we sell today, and where? | Sales & Shifts |
| Where is our inventory and where did it go? | Inventory Ledger |
| What does each product actually cost us? | Costing Engine |
| What should each vendor be paid? | Compensation Engine |
| How much money are we actually making? | P&L / Profitability |
| What do we need to buy, and when? | Replenishment & Procurement |
| Which cart / employee / product / location performs best? | Dashboards |

The business scales from ~5 carts to potentially hundreds. Design the data model and queries for that from day one, but ship a working MVP first.

---

## 2. The single most important design decision

**Street-food carts do not ring up individual transactions.** A vendor sells fishballs one stick at a time, in cash, to walk-up customers, while frying. Requiring a per-transaction POS entry will guarantee the system is never used and the data is garbage.

So the **core loop of this entire system is shift issuance and end-of-day reconciliation**, not a point of sale:

```
OPEN SHIFT  → vendor assigned to cart for a business date, given a cash float
ISSUE       → 400 fishball pieces handed to vendor (cost + price snapshotted)
REFILL      → +200 fishball pieces mid-day (a second issuance, flagged isRefill)
CLOSE SHIFT → count what comes back: returned qty, wasted qty, per product
DERIVE      → piecesSold = issued − returned − wasted        (pieces)
            → sticksSold = piecesSold / piecesPerStick
            → expectedCash = Σ(piecesSold × pricePerPiece) − discounts
            → variance = (cashRemitted + digitalSales) − expectedCash
            → COGS, gross profit, and vendor incentive all fall out automatically
APPROVE     → supervisor approves; numbers become immutable and feed payroll + P&L
```

Everything else in the system hangs off this loop. Sales, inventory consumption, employee performance, wastage cost, cash accountability, and compensation are **all derived from one reconciliation record**. Build this loop correctly and the rest is reporting.

Itemized per-transaction sales capture is a **Phase 9 option** for fixed branches only. Do not build it early.

**Three units, and the difference matters.** Stock moves as **pieces**, customers buy **sticks**, vendors are incentivised on **sets**. A stick is a fixed number of pieces that differs per product (4 kwek-kwek, 3 calamares, 5 squidballs, 10 fishballs, 4 big kikiam), and a set is a five-product bundle of 250 sticks. Everything in the ledger is pieces; everything commercial is sticks; everything in compensation is sets. See §5.3.1 — get this ladder wrong and every number in the system is wrong.

**Who operates this loop: the supervisor, not the vendor.** Vendors do not log in and do not have accounts in the MVP. A branch supervisor issues stock to every cart in the morning and closes every cart at the end of the day, on one device. This means the shift screens are built for **batch operation across many carts**, not for one vendor looking at one shift:

- A **Daily Close board** is the supervisor's home screen: every cart for today's business date in one list, with status chips (`Not opened` / `Open` / `Closed` / `Disputed`), so closing eight carts is eight quick rows and not eight page loads.
- **Batch issuance**: one screen issues the morning load-out to all carts at once, defaulting to each cart's typical quantities from the last 7 days.
- Closing entry is a **tight numeric grid** — product rows, columns for returned and wasted — designed for someone standing at the branch with carts coming back one after another.

Because the supervisor both records the counts and calculates deductions against the vendor's pay, two controls are mandatory (see §4 and §7): the vendor must **acknowledge** the closing count, and a supervisor may **never approve their own closing**.

---

## 3. Tech stack (use exactly this unless told otherwise)

- **Next.js 15** (App Router) + **TypeScript** (`strict: true`)
- **PostgreSQL** + **Prisma** ORM
- **Tailwind CSS** + **shadcn/ui** components; **Recharts** for charts
- **Auth.js (NextAuth)** credentials provider + `bcrypt`; JWT session carries `userId`, `role`, `scopeBranchIds`
- **Zod** for every input boundary; **Server Actions** for mutations, Route Handlers only where an external client needs them
- **decimal.js** / Prisma `Decimal` for all money and quantity math
- **Vitest** for unit tests; **Playwright** for two smoke flows (login → close a shift; login → view P&L)
- **date-fns** + `date-fns-tz`, timezone `Asia/Manila`

### Non-negotiable engineering rules

1. **Never use JavaScript floats for money or quantities.** All monetary columns are `Decimal(14,4)`; all quantity columns are `Decimal(14,4)`. Round half-up to 2 decimals only at display and at payroll settlement.
2. **All business math lives in pure functions** under `src/lib/engines/` with **no database access** — they take plain inputs, return plain outputs. Every engine has a unit test file with the golden examples in §11. This is the difference between a maintainable system and a pile of controllers.
3. **The inventory ledger is append-only.** Corrections are new `ADJUSTMENT` rows, never updates or deletes.
4. **Cost is snapshotted, never recomputed retroactively.** A shift line stores the `unitCost` that applied on its business date. Changing an ingredient price tomorrow must never change last week's reported profit.
5. Every mutation writes an `AuditLog` row.
6. Seed script must be **idempotent** (`prisma db seed` twice = same state).
7. Business date, not timestamp, is the reporting key. A shift belongs to a `businessDate` (a `DATE` column), set from `Company.businessDayCutoffHour` (default 04:00 Manila).
8. **Tenant-ready from row one.** Every table carries a non-null `companyId`, every unique constraint is composite with it (`@@unique([companyId, code])`), every index leads with it, and **no server action may query Prisma directly** — all reads and writes go through `lib/db.ts` helpers that inject `companyId` from the session. The MVP runs exactly one company; retrofitting tenancy later is a rewrite, adding a column now is free (§15.1).
9. **Never convert units ad hoc.** Piece↔stick conversion lives only in `lib/units.ts` (`piecesToSticks`, `sticksToPieces`, `pricePerPieceFrom`). Any inline `/ 10` or `* 4` in a component is a bug.

### Repo layout

```
src/
  app/
    (auth)/login
    (app)/dashboard, sales, shifts, inventory, products, costing,
          employees, payroll, expenses, procurement, reports, settings
    api/
  lib/
    engines/          # PURE. costing.ts, reconciliation.ts, compensation.ts,
                      # replenishment.ts, profitability.ts
    engines/__tests__/
    db.ts, auth.ts, rbac.ts, money.ts, businessDate.ts
  components/
prisma/
  schema.prisma, seed.ts, migrations/
docs/
  DOMAIN.md           # you write this: formulas + glossary, kept in sync
```

### Commands

```bash
pnpm dev
pnpm test           # vitest, must pass before each phase checkpoint
pnpm db:push / db:migrate / db:seed
pnpm lint && pnpm typecheck
```

---

## 4. Roles and permissions

| Role | Sees | Can do |
|---|---|---|
| `OWNER` | Everything, all branches | Everything |
| `ADMIN` | Everything | Everything except deleting company settings |
| `AREA_MANAGER` | Branches in their scope | Approve shifts, approve payroll, approve POs, view P&L for scope |
| `SUPERVISOR` | One branch + its carts | Open/close shifts for **all** their carts, issue stock, record closing counts, log expenses, request replenishment. **Cannot approve a shift they closed.** |
| `COMMISSARY` | Warehouse + transfers | Receive POs, run production batches, transfer stock to branches |
| `HR` | Employee module only | 201 files, documents, employment records |
| `VENDOR` | Own pay history only | **No login in the MVP.** Supervisors enter all cart data. Deferred read-only self-service in Phase 9. |

Rules:

- Scope is enforced **in the query layer**, not the UI. Write `assertScope(user, branchId)` in `lib/rbac.ts` and call it at the top of every server action.
- **Segregation of duties.** The user who closes a shift cannot approve it. Approval belongs to the `AREA_MANAGER`, `OWNER`, or `ADMIN`. Enforce this in the server action, not just by hiding a button.
- Vendors never see cost, margin, or anyone else's data.
- Salary/compensation figures visible only to `OWNER`, `ADMIN`, `HR`, and the employee themselves.
- 201 file documents restricted to `OWNER`, `ADMIN`, `HR`. Log every document view in `AuditLog`.

---

## 5. Data model

Prisma-flavoured. Add `id` (cuid), `createdAt`, `updatedAt`, and `createdById` to every table unless stated.

### 5.1 Organization

```
Company        code, name, currency="PHP", timezone="Asia/Manila",
               businessDayCutoffHour=4, defaultWastagePct, settings Json
Area           name, managerId?                      // optional grouping of branches
Branch         code, name, type[BRANCH|COMMISSARY|WAREHOUSE], areaId?, address,
               isActive
Location       name, type[SCHOOL|OFFICE|FACTORY|TERMINAL|MARKET|RESIDENTIAL|
               COMMERCIAL|OTHER], address, lat?, lng?, notes
Cart           code, name, type[FOOD_CART|MOTOR_CART|KIOSK], branchId,
               locationId?, status[ACTIVE|IDLE|MAINTENANCE|RETIRED],
               defaultVendorId?, dailySalesTarget?
User           email, passwordHash, role, employeeId?, isActive
UserBranchScope userId, branchId
AuditLog       userId, action, entity, entityId, before Json, after Json, at
```

**Tenancy.** `Company` is the tenant root. Every other table above and below gets `companyId` with an index, and `User` carries it into the JWT session alongside `role` and `scopeBranchIds`. A Vitest test must assert that (a) every Prisma model except `Company` has a `companyId` field, and (b) a user of company A reading a shift, employee, or report of company B gets zero rows — not an error page, zero rows. Out of scope for the MVP: self-serve signup, billing/subscriptions, subdomain or custom-domain routing, per-tenant branding, and cross-tenant admin tooling (§15.1).

### 5.2 People

```
Employee       employeeNo, firstName, middleName?, lastName, birthDate?,
               mobile, email?, address, emergencyContactName, emergencyContactNo,
               position, dateHired, employmentStatus[PROBATIONARY|REGULAR|
               PART_TIME|CONTRACTUAL|SEPARATED], separationDate?,
               branchId?, cartId?, dailyRate, compensationSchemeId,
               supervisorId?, photoKey?, isActive
EmploymentEvent employeeId, type[HIRED|REGULARIZED|TRANSFERRED|PROMOTED|
               RATE_CHANGE|SUSPENDED|SEPARATED], effectiveDate, details Json
EmployeeDocument employeeId, type[CONTRACT|ID|CLEARANCE|HEALTH_CERT|TRAINING|
               PERFORMANCE|DISCIPLINARY|GOVT_RECORD|OTHER], title, fileKey,
               issuedAt?, expiresAt?, uploadedById
```

`expiresAt` drives a dashboard widget: documents expiring in ≤30 days.

### 5.3 Costing

```
Supplier       name, contactPerson, mobile, address, leadTimeDays, paymentTerms,
               isActive
Ingredient     sku, name, category[RAW|PACKAGING|CONDIMENT|OIL|CONSUMABLE],
               baseUnit[G|ML|PC], currentCostPerBaseUnit Decimal,
               minStock, safetyStock, packSize, isActive
SupplierIngredient supplierId, ingredientId, purchaseUnitName ("sack 25kg",
               "tray 30pcs"), baseUnitsPerPurchaseUnit Decimal,
               lastPurchasePrice, isPreferred
IngredientCostHistory ingredientId, costPerBaseUnit, effectiveFrom,
               source[MANUAL|PURCHASE_RECEIPT|IMPORT], refId?
ProductCategory name, sortOrder
Product        sku, name, categoryId, sellingUnit[PIECE|STICK],
               piecesPerStick Decimal (default 1), stockUnit=PIECE,
               imageKey?, isActive
Recipe         productId, version, batchYieldPieces Decimal, isActive,
               effectiveFrom, notes
RecipeLine     recipeId, ingredientId, qtyInBaseUnit Decimal, wastagePct,
               allocationBasis[PER_BATCH|PER_PIECE|PER_STICK],
               componentType[RAW|PACKAGING|CONDIMENT|OIL|CONSUMABLE]
ProductCostVersion productId, recipeVersion, effectiveFrom,
               costPerPiece, costPerStick, breakdown Json, triggeredBy
PriceList      name, scopeType[COMPANY|BRANCH|CART], scopeId?, effectiveFrom,
               isActive
PriceListItem  priceListId, productId, pricePerStick
SetDefinition  code, name, incentiveAmount, completionMode, isActive,
               effectiveFrom, notes
SetComponent   setDefinitionId, productId, requiredSticks
               @@unique([setDefinitionId, productId])
```

`allocationBasis` is what makes oil, sauce, and packaging work correctly:

- `PER_BATCH` — flour, eggs, seasoning: divided by `batchYieldPieces`.
- `PER_PIECE` — cooking oil allocation: cost attributed to each piece fried.
- `PER_STICK` — the bamboo stick, sauce, cup, wrapper: charged once per stick sold.

### 5.3.1 The unit ladder: piece → stick → set

| Unit | What it is | Where it lives |
|---|---|---|
| **Piece** | One fishball, one coated quail egg, one ring of calamares. Produced by the commissary, issued to carts, counted at closing. | Inventory ledger, recipe yield, `costPerPiece` |
| **Stick** | What a customer actually buys. A fixed piece count that differs per product. | `Product.piecesPerStick`, `PriceListItem.pricePerStick`, `costPerStick` |
| **Set** | A five-product load-out target used only for vendor incentive. | `SetDefinition` + `SetComponent` |

**Pieces per stick (CONFIRMED, seed these):**

| Product | Pieces per stick |
|---|---|
| Kwek-kwek | 4 |
| Calamares / squid rings | 3 |
| Squidball | 5 |
| Fishball | 10 |
| Kikiam (big) | 4 |

**The standard set (CONFIRMED, seed as `SetDefinition` `STD-SET`):** 50 sticks of each of the five products — **250 sticks, 1,300 pieces**.

| Component | Required sticks | = Pieces |
|---|---|---|
| Kwek-kwek | 50 | 200 |
| Calamares | 50 | 150 |
| Squidball | 50 | 250 |
| Fishball | 50 | 500 |
| Kikiam (big) | 50 | 200 |

Rules that follow from this:

- **Carts hold loose pieces (CONFIRMED).** Everything is fried loose in the kawali and skewered as customers order, so `stockUnit = PIECE` for every product. Issuance, returns, waste, and the closing count are all in **pieces**. A stick is never a stock quantity.
- `pricePerPiece = pricePerStick / piecesPerStick`, derived, never stored. Revenue is computed on **pieces** (`piecesSold × pricePerPiece`) so 3 leftover fishballs cannot silently round into or out of a peso. The UI shows the stick equivalent to one decimal (`54.0 sticks`).
- `sticksSold = piecesSold / piecesPerStick` as a `Decimal` — **do not floor it** for revenue. Flooring happens only inside set counting (§8).
- Products outside the set (beverages, fries) simply have no `SetComponent` row and earn no set incentive.
- `SetDefinition` is versioned by `effectiveFrom` and snapshotted into `ShiftCompensation.breakdown`, so changing the set next month never rewrites last month's payroll.

**Pricing scope (CONFIRMED).** The MVP runs **one company-wide price list**. Keep `scopeType`/`scopeId` on `PriceList` so branch- and cart-level pricing can be switched on later without a migration, but in the MVP seed and UI create exactly one `COMPANY`-scoped active list, and resolve a product's price as: cart list → branch list → company list (only the last will exist). Per-shift `discountAmount` covers promos.

### 5.4 Inventory

```
InventoryTransaction   // APPEND-ONLY LEDGER
  itemType[INGREDIENT|PRODUCT], itemId,
  locationType[WAREHOUSE|BRANCH|CART|EMPLOYEE], locationId,
  qty Decimal (signed: + in, − out), unitCost Decimal,
  type[PURCHASE_RECEIPT|PRODUCTION_IN|PRODUCTION_CONSUME|TRANSFER_OUT|
       TRANSFER_IN|ISSUE_TO_VENDOR|RETURN_FROM_VENDOR|SALE_CONSUMPTION|
       WASTE|SPOILAGE|DAMAGE|ADJUSTMENT|COUNT_VARIANCE],
  refType, refId, businessDate, occurredAt, reason?, createdById
StockBalance   // derived cache, updated in the SAME db transaction as the ledger row
  itemType, itemId, locationType, locationId, qty, avgUnitCost, updatedAt
  @@unique([itemType, itemId, locationType, locationId])
StockTransfer  fromLocationType/Id, toLocationType/Id, status[DRAFT|IN_TRANSIT|
               RECEIVED|CANCELLED], dispatchedAt?, receivedAt?, notes
StockTransferLine transferId, itemType, itemId, qtySent, qtyReceived?, unitCost
ProductionBatch commissaryId, productId, recipeVersion, plannedQty, actualQty,
               wasteQty, unitCost, status[DRAFT|COMPLETED], producedAt
PhysicalCount  locationType/Id, countedAt, status[DRAFT|POSTED], countedById
PhysicalCountLine countId, itemType, itemId, systemQty, countedQty, variance
```

Transfers create **paired ledger rows** (`TRANSFER_OUT` at source, `TRANSFER_IN` at destination) so nothing evaporates. `StockBalance` is a performance cache — a `pnpm rebuild:balances` script must be able to reconstruct it entirely from the ledger, and a test must assert ledger sum === cached balance.

### 5.5 Shifts and sales (the core loop)

```
CartShift      cartId, employeeId, businessDate, status[OPEN|CLOSED|APPROVED|
               DISPUTED], openedAt, openedById, closedAt, closedById,
               approvedAt, approvedById,
               vendorAcknowledged bool, acknowledgedAt?,
               acknowledgedVia[SIGNATURE|VERBAL_CONFIRMED|SMS_SENT|NONE],
               signatureKey?,
               cashFloat, cashRemitted, digitalSales, otherPayments,
               grossSales, discountTotal, netSales, expectedCash, cashVariance,
               cogs, wasteCost, grossProfit, notes
               @@unique([cartId, businessDate])
ShiftIssue     shiftId, seq, isRefill, issuedAt, issuedById
               // seq 1 = morning load-out; seq >= 2 = per-product top-up refill
ShiftIssueLine issueId, productId, qtyPieces, unitCostPerPiece,
               pricePerStick, piecesPerStick      // all three snapshotted
ShiftLine      // one row per product per shift, built at closing. ALL QTY IN PIECES.
  shiftId, productId, piecesIssued, piecesReturned, piecesWasted, wasteReason?,
  piecesSold (computed), sticksSold (computed, Decimal),
  piecesPerStick, pricePerStick, unitCostPerPiece,   // snapshots
  discountAmount, grossSales, netSales, lineCogs
  @@unique([shiftId, productId])
CashCount      shiftId, denomination, count      // optional, Phase 9
Target         scopeType[COMPANY|BRANCH|CART|EMPLOYEE], scopeId, metric,
               periodType[DAY|WEEK|MONTH], periodStart, value
```

Closing a shift is **one database transaction** that: writes `ShiftLine`s, writes `SALE_CONSUMPTION` + `WASTE` + `RETURN_FROM_VENDOR` ledger rows, updates `StockBalance`, computes shift totals, and computes `ShiftCompensation`. Either all of it lands or none of it does.

### 5.6 Compensation

```
CompensationScheme  name, baseDailyRate, deductShortage bool,
                    maxShortageDeduction Decimal?   // null = uncapped
                    isActive, description
CompensationRule    schemeId, type, priority, params Json, scopeProductId?,
                    scopeCategoryId?, isActive
ShiftCompensation   shiftId, employeeId, basePay, incentiveTotal,
                    deductionTotal, netPay, breakdown Json,
                    status[DRAFT|APPROVED|PAID]
Deduction           employeeId, shiftId?, payrollItemId?, type[CASH_SHORTAGE|
                    CASH_ADVANCE|UNRETURNED_ITEM|DAMAGE|OTHER], amount, note,
                    approvedById
PayrollRun          periodStart, periodEnd, branchId?, status[DRAFT|REVIEWED|
                    APPROVED|PAID], totals Json, approvedById
PayrollItem         payrollRunId, employeeId, daysWorked, basePayTotal,
                    incentiveTotal, deductionTotal, netPay, breakdown Json
```

Rule `type` values and their `params`:

| Type | params | Meaning |
|---|---|---|
| `SET_COMPLETION` | `{ setDefinitionId, completionMode: "PER_COMPONENT"\|"ALL_COMPONENTS"\|"PROPORTIONAL", maxSetsPerComponent: number\|null, requireZeroShortage: bool }` | Pay for selling through a five-product set. `incentiveAmount` comes from the `SetDefinition`. See §8 — the mode changes pay enormously |
| `REFILL_BONUS` | `{ amountPerRefillSet, minRefillSeq }` | Optional extra per refill. **Not used in the MVP seed** — refills are per-product top-ups and already earn credit through day-total set counting |
| `COMMISSION_PCT` | `{ percent, basis: "NET_SALES" }` | % of sales |
| `PER_UNIT` | `{ amountPerUnit }` | Flat amount per unit sold |
| `TARGET_BONUS` | `{ targetNetSales, bonusAmount }` | Hit the daily target, get a bonus |
| `ATTENDANCE` | `{ amount }` | Paid for showing up and closing a shift |

Rules are **data, not code**. Management edits them in Settings. Adding a new rule type is the only thing that requires a deploy.

### 5.7 Expenses, procurement, reporting

```
ExpenseCategory name, type[COGS|OPEX|CAPEX], isActive
Expense        businessDate, categoryId, scopeType[COMPANY|BRANCH|CART],
               scopeId?, employeeId?, amount, paymentMethod[CASH|GCASH|BANK|
               CREDIT], description, attachmentKey?, status[DRAFT|APPROVED],
               approvedById
RecurringExpense categoryId, scopeType, scopeId, amount, frequency[DAILY|WEEKLY|
               MONTHLY], nextRunDate, isActive
PurchaseOrder  poNo, supplierId, destinationBranchId, status[SUGGESTED|APPROVED|
               ORDERED|PARTIALLY_RECEIVED|RECEIVED|CANCELLED], orderedAt?,
               expectedAt?, totalAmount, notes
PurchaseOrderLine poId, ingredientId, qtyPurchaseUnit, purchaseUnitName,
               baseUnitsPerPurchaseUnit, unitPrice, qtyReceivedBase
ReplenishmentSuggestion itemType, itemId, locationType, locationId, onHand,
               avgDailyUsage, daysOfCover, reorderPoint, suggestedQty,
               reason, status[NEW|ACCEPTED|DISMISSED], generatedAt
```

Receiving a PO line **updates the ingredient's cost** (weighted average) and writes an `IngredientCostHistory` row, which in turn triggers a new `ProductCostVersion` for every affected product.

---

## 6. Costing engine — `lib/engines/costing.ts`

```
lineCost(line, ingredientCostPerBaseUnit):
    base = line.qtyInBaseUnit × ingredientCostPerBaseUnit
    return base × (1 + line.wastagePct)

costPerPiece(recipe):
    perBatch   = Σ lineCost(l) for l.allocationBasis == PER_BATCH
    perPieceAdd = Σ lineCost(l) for l.allocationBasis == PER_PIECE
    return (perBatch / recipe.batchYieldPieces) + perPieceAdd

costPerStick(product, recipe):
    perStickAdd = Σ lineCost(l) for l.allocationBasis == PER_STICK
    return costPerPiece(recipe) × product.piecesPerStick + perStickAdd

grossProfitPerStick  = pricePerStick − costPerStick
grossMargin%         = grossProfitPerStick / pricePerStick × 100

costPerSet(setDefinition):
    return Σ over components: costPerStick(component.product)
                              × component.requiredSticks
revenuePerSet(setDefinition, priceList):
    return Σ over components: pricePerStick × component.requiredSticks
```

`costPerSet` / `revenuePerSet` matter because the set is the unit management actually plans in: it answers "what does one cart-day of stock cost me, and what is it worth if fully sold?" Show both on the set definition screen next to the incentive amount, so the owner can see the incentive as a percentage of the set's gross profit before saving it.

The engine returns a **breakdown object** (raw materials, packaging, condiments, oil, consumables, wastage, total) which is stored as `ProductCostVersion.breakdown` and rendered as a cost card in the UI. Management must be able to see where every centavo goes.

**Cost propagation.** When `Ingredient.currentCostPerBaseUnit` changes:

1. Write `IngredientCostHistory`.
2. Find every active recipe using that ingredient.
3. Create a new `ProductCostVersion` per affected product, `effectiveFrom = now`.
4. Surface an alert: "Quail egg cost rose 12%. 3 products affected. Kwek-kwek margin fell from 34.4% to 29.1%." with a link to a price-review screen.

Historical `ProductCostVersion` rows are never edited. Shift lines resolve cost by `effectiveFrom <= businessDate ORDER BY effectiveFrom DESC LIMIT 1`.

---

## 7. Reconciliation engine — `lib/engines/reconciliation.ts`

**Everything on the left of these formulas is in pieces.** Sticks appear only as a derived display and as the input to set counting.

```
piecesIssued = Σ ShiftIssueLine.qtyPieces across all issues (load-out + refills)
piecesSold   = piecesIssued − piecesReturned − piecesWasted   // must be >= 0
sticksSold   = piecesSold / piecesPerStick                    // Decimal, unfloored
pricePerPiece = pricePerStick / piecesPerStick

grossSales   = Σ piecesSold × pricePerPiece
netSales     = grossSales − discountTotal
expectedCash = netSales − digitalSales − otherPayments
cashVariance = cashRemitted − expectedCash                     // negative = shortage
cogs         = Σ piecesSold × unitCostPerPiece
wasteCost    = Σ piecesWasted × unitCostPerPiece               // OPEX, never COGS
grossProfit  = netSales − cogs
sellThrough% = piecesSold / piecesIssued × 100
```

Validation on close:

- `piecesReturned + piecesWasted <= piecesIssued` — otherwise reject with a clear message naming the product and both numbers.
- Counts are entered and stored in **pieces**. The grid shows the live stick equivalent beside each row so the supervisor can sanity-check against what the vendor says they sold ("54.0 sticks"), but no stick value is ever persisted as a quantity.
- Wastage above a configurable threshold (default 10% of issued) requires a `wasteReason` and supervisor approval.
- `|cashVariance| > ₱100` flags the shift `DISPUTED` and blocks payroll inclusion until resolved.
- **A shift cannot be approved by the user who closed it.** Since the supervisor records the counts that reduce the vendor's pay, approval must come from an area manager, owner, or admin.
- **Cash shortages are deducted in full (CONFIRMED).** There is no cap in the MVP: the whole shortage is deducted from that day's pay (incentive first, then base pay, so `netPay` can fall below the base daily rate). Keep `scheme.maxShortageDeduction` in the schema as a nullable field — `null` means uncapped, which is the seeded default.
- **Vendor acknowledgment is required before any shortage deduction is applied.** Capture an on-screen signature (canvas → stored image) or an explicit "counted in vendor's presence" confirmation naming the vendor. If `vendorAcknowledged` is false, the shift still closes and stock still moves, but `deductShortage` is suppressed and the shift is flagged for review. Unacknowledged pay deductions are how systems like this get abandoned.

Once `APPROVED`, a shift is immutable. Corrections happen through a `ShiftAdjustment` (Phase 9) that writes reversing ledger entries — never an edit.

---

## 8. Compensation engine — `lib/engines/compensation.ts`

Pure function: `computeShiftPay(shift, shiftLines, scheme, rules, deductions) → { basePay, lines[], incentiveTotal, deductionTotal, netPay, breakdown }`

```
basePay = scheme.baseDailyRate            (pro-rated only if configured)

for each rule, in priority order:

  SET_COMPLETION:                    // the important one — see the modes below
     setDef        = SetDefinition as of shift.businessDate
     components    = setDef.components                       // 5 rows
     componentShare = setDef.incentiveAmount / count(components)

     for each component c:
        sticksSold_c = shiftLine(c.productId).sticksSold     // day total, all refills
        credits_c    = floor(sticksSold_c / c.requiredSticks)
        if params.maxSetsPerComponent: credits_c = min(credits_c, max)

     PER_COMPONENT  (CONFIRMED default):
        amount = Σ credits_c × componentShare
     ALL_COMPONENTS:
        amount = floor(min over c of sticksSold_c / c.requiredSticks)
                 × setDef.incentiveAmount
     PROPORTIONAL:
        amount = min over c of (sticksSold_c / c.requiredSticks)
                 × setDef.incentiveAmount           // fractional, no floor

     if params.requireZeroShortage and cashVariance < 0: amount = 0

  REFILL_BONUS:   // present but unused in the MVP seed
     refillSets = credits attributable to issues where seq >= params.minRefillSeq
     amount     = refillSets × params.amountPerRefillSet

  COMMISSION_PCT: amount = netSales × params.percent / 100
  PER_UNIT:       amount = Σ scope.sticksSold × params.amountPerUnit
  TARGET_BONUS:   amount = netSales >= params.targetNetSales ? params.bonusAmount : 0
  ATTENDANCE:     amount = shift.status in (CLOSED, APPROVED) ? params.amount : 0

incentiveTotal = Σ amounts
deductions     = cash shortage (if scheme.deductShortage and
                 shift.vendorAcknowledged; full amount, uncapped unless
                 scheme.maxShortageDeduction is non-null)
                 + advances + unreturned items
netPay         = basePay + incentiveTotal − deductionTotal
```

### Set completion is per-component (CONFIRMED)

Each of the five products carries **its own share of the set incentive** and is counted on its own. A vendor who sells 50+ sticks of four products but only 30 sticks of fishball earns **those four shares**, not zero. This is the owner's decision and the seeded default; `ALL_COMPONENTS` and `PROPORTIONAL` are implemented and switchable in Settings without a deploy.

`SetComponent.creditValue` holds what one credit of that component is worth. **`null` means an equal share of `incentiveAmount`** — the seeded default, and what every set did before the split became editable — so existing definitions keep paying exactly what they paid. A value of `0` is deliberate and means the product earns no incentive; it must never fall through to the equal share. The split is edited for a whole set at once on `/sets`, with a running total shown against `incentiveAmount`, because a split is argued about as a sum. The components are what pay: the total may legitimately differ from `incentiveAmount`, and where it does, the components win. `creditValue` applies **only** to `PER_COMPONENT` — the whole-set modes pay `incentiveAmount` because there the weakest component decides.

Three consequences the owner should see in the UI, not discover in payroll:

1. **Components stack.** Under `PER_COMPONENT`, 150 sticks of fishball is `floor(150/50) = 3` credits — a vendor can earn three-fifths of the incentive from fishball alone while selling nothing else. If that is not wanted, set `maxSetsPerComponent: 1` (seeded `null` = uncapped). Surface the per-component credit count on the cart scorecard so lopsided selling is visible.
2. **An uneven split changes the incentive ceiling.** Five components worth ₱60/₱80/₱50/₱20/₱40 pay ₱250 for a full sell-through, but ₱230 when fishball falls short and ₱170 when kwek-kwek does. The cost of missing a component is no longer uniform, which is the point — it lets the owner put the money where the selling is hard.
3. **Refills need no special rule.** Because credits are computed on the **day's total sticks sold per product** and refills are per-product top-ups, a vendor who sells 50 sticks of fishball, refills, and sells 50 more simply earns 2 fishball credits. `REFILL_BONUS` stays in the schema but is not seeded.

Every line in the result carries `{ ruleType, label, basis, computation, amount }` so the payslip literally shows: *"Set completion — fishball: 540 pcs ÷ 10 per stick = 54.0 sticks ÷ 50 required = 1 credit × ₱50 = ₱50.00."* Management must never have to trust a black box.

Payroll run: aggregate `ShiftCompensation` over the period per employee → `PayrollItem`. `DRAFT → REVIEWED → APPROVED → PAID`. On `APPROVED`, snapshot the full breakdown JSON — later rule edits must not change historical payroll.

---

## 9. Replenishment engine — `lib/engines/replenishment.ts`

```
// ALL QUANTITIES IN PIECES
window          = trailing 14 business days with at least one closed shift
avgDailyUsage   = Σ piecesSold over window / number of active days
daysOfCover     = onHand / avgDailyUsage        (null if avgDailyUsage == 0)
reorderPoint    = avgDailyUsage × leadTimeDays + safetyStock
suggestedQty    = max(0, avgDailyUsage × (leadTimeDays + coverDays)
                        + safetyStock − onHand − onOrder)
                  rounded UP to packSize
trigger         = onHand <= reorderPoint
```

Suggestions are stored in pieces and **displayed in both units** — "4,900 pcs (490 sticks)" — because the owner thinks in sticks but the commissary produces and counts pieces. A second suggestion view rolls the five set components up into whole sets: *"Cart-012 can build 2.4 more standard sets from stock on hand."*

`coverDays` default 7, configurable per branch. Output messages read like the example in the brief: *"Cart #12 is projected to run out of fishballs in ~1.5 days at its average daily sales. Recommended replenishment: 500 pcs."*

Run nightly (a `/api/cron/replenishment` route + a manual "Regenerate" button). Suggestions are always overridable: management edits qty, accepts, or dismisses with a reason. `SUGGESTED → APPROVED → ORDERED → RECEIVED → STOCKED` is the PO lifecycle.

Also flag **overstock**: `daysOfCover > 30` on a perishable item.

---

## 10. Profitability — `lib/engines/profitability.ts`

```
Net Sales
− COGS                        (Σ ShiftLine.lineCogs)
= Gross Profit
− Labor Cost                  (Σ ShiftCompensation.netPay for the scope/period)
− Wastage Cost                (Σ WASTE ledger rows × unitCost)
− Direct Operating Expenses   (Expense rows scoped to that branch/cart)
= Operating Profit
− Allocated Company Overhead  (optional toggle; allocate by net-sales share)
= Net Profit
```

Every report must **drill down**: Company → Branch → Cart → Business Date → Shift → Shift Lines. Each level is a link. A number the owner cannot click into is a number the owner will not trust.

Report dimensions required for MVP: product, category, branch, cart, location, employee, day, week, month, custom range.

---

## 11. Golden test cases (write these as Vitest tests first)

### 11.1 Costing — Kwek-kwek

Batch yields **200 pieces**; product `sellingUnit = STICK`, `piecesPerStick = 4`; `wastagePct = 0` for all lines.

| Component | Basis | Cost |
|---|---|---|
| Quail eggs 200 pc @ ₱1.20 | PER_BATCH | ₱240.00 |
| Flour 500 g @ ₱0.06/g | PER_BATCH | ₱30.00 |
| Cornstarch 200 g @ ₱0.08/g | PER_BATCH | ₱16.00 |
| Seasoning | PER_BATCH | ₱10.00 |
| Food coloring | PER_BATCH | ₱5.00 |
| Cooking oil allocation | PER_PIECE | ₱0.35 |
| Packaging (cup + bamboo stick) | PER_STICK | ₱0.80 |
| Sauce | PER_STICK | ₱1.20 |

Expected:

- batch total (PER_BATCH) = **₱301.00**
- `costPerPiece` = 301 / 200 + 0.35 = **₱1.8550**
- `costPerStick` = 1.8550 × 4 + 0.80 + 1.20 = **₱9.4200**
- `pricePerStick` ₱15.00 → gross profit **₱5.5800**, margin **37.20%**
- `pricePerPiece` = 15.00 / 4 = **₱3.7500** (derived, never stored)

### 11.2 Reconciliation — Cart-012, fishball only

Vendor Ana. Fishball: `piecesPerStick = 10`, `pricePerStick = ₱10.00` (→ `pricePerPiece = ₱1.00`), `unitCostPerPiece = ₱0.45`.
Morning load-out **400 pcs**, one refill **+200 pcs**. Closing count: returned **50 pcs**, wasted **10 pcs**. Cash remitted ₱528.00, no digital sales, no discounts.
Scheme: base ₱500/day, `deductShortage: true`, `maxShortageDeduction: null`.

Expected:

- `piecesIssued` = **600**; `piecesSold` = 600 − 50 − 10 = **540**
- `sticksSold` = 540 / 10 = **54.0 sticks** (not floored)
- `netSales` = 540 × 1.00 = **₱540.00**
- `expectedCash` = **₱540.00**; `cashVariance` = 528 − 540 = **−₱12.00** (shortage, under the ₱100 dispute threshold)
- `cogs` = 540 × 0.45 = **₱243.00**; `wasteCost` = 10 × 0.45 = **₱4.50**
- `grossProfit` = 540 − 243.00 = **₱297.00**
- sell-through = 540 / 600 = **90.00%**
- pay, with the standard set (fishball component only): base ₱500 + `floor(54.0/50) = 1` credit × ₱50 − ₱12.00 shortage = **₱538.00**

Assert also: a closing entry of returned 600 + wasted 10 is **rejected** (returns + waste exceed issued).

### 11.3 Ledger integrity

After the shift in 11.2 closes: `SUM(qty)` in `InventoryTransaction` for fishball at `EMPLOYEE:Ana` must be **0** — 600 pieces in (400 + 200 refill), 540 `SALE_CONSUMPTION`, 50 `RETURN_FROM_VENDOR`, 10 `WASTE` — and `StockBalance` must agree with the ledger sum for every item/location pair. Run `rebuild:balances` inside the test and assert the cache is unchanged.

### 11.4 Cost immutability

Raise quail egg cost to ₱1.50 today. Assert: a new `ProductCostVersion` exists; yesterday's approved shift still reports the old COGS and the same gross profit.

### 11.5 Replenishment

Fishball at Cart-012, **in pieces**: onHand 600, trailing 14-day sales 7,000 pcs over 14 active days → `avgDailyUsage` 500 pcs/day. Lead time 2 days, safetyStock 1,000, coverDays 7, packSize 250.

- `reorderPoint` = 500 × 2 + 1,000 = **2,000** → 600 ≤ 2,000, triggers
- `daysOfCover` = 600 / 500 = **1.2 days**
- `suggestedQty` = 500 × 9 + 1,000 − 600 − 0 = **4,900** → rounded up to packSize 250 = **5,000 pcs**
- display string contains both units: **"5,000 pcs (500 sticks)"**

---

### 11.6 Set completion — the five-product bundle

`SetDefinition STD-SET`, `incentiveAmount = ₱250.00`, five components at 50 required sticks each, every `creditValue` null → each share is `₱50.00`. `completionMode = PER_COMPONENT`, `maxSetsPerComponent = null`.

One shift's closing figures:

| Product | Pieces sold | ÷ pcs/stick | Sticks sold | ÷ 50 required | Credits |
|---|---|---|---|---|---|
| Kwek-kwek | 240 | 4 | 60.0 | 1.20 | **1** |
| Calamares | 180 | 3 | 60.0 | 1.20 | **1** |
| Squidball | 275 | 5 | 55.0 | 1.10 | **1** |
| Fishball | 300 | 10 | 30.0 | 0.60 | **0** |
| Kikiam (big) | 208 | 4 | 52.0 | 1.04 | **1** |

Expected, same data, all three modes:

- `PER_COMPONENT` (the seeded default) → 4 credits × ₱50.00 = **₱200.00**
- `ALL_COMPONENTS` → `floor(min ratio) = floor(0.60) = 0` sets = **₱0.00**
- `PROPORTIONAL` → 0.60 × ₱250.00 = **₱150.00**

Stacking and the cap, on a second fixture — fishball 1,000 pcs sold (100.0 sticks), everything else zero:

- `maxSetsPerComponent: null` → `floor(100/50) = 2` credits = **₱100.00**
- `maxSetsPerComponent: 1` → **₱50.00**

And `requireZeroShortage: true` with `cashVariance = −₱12.00` → incentive **₱0.00** regardless of mode.

---

## 12. Build phases — stop at each checkpoint

**Phase 0 — Foundation.** Next.js + Prisma + Postgres, auth, RBAC helpers, **`companyId` scoping in `lib/db.ts` and the tenant-isolation test**, app shell, `lib/money.ts` / `lib/units.ts` / `lib/businessDate.ts`, seed skeleton, CI running `typecheck + lint + test`.
*Done when:* an OWNER and a SUPERVISOR log in and see different navigation, and the tenant-isolation test passes with two seeded companies.

**Phase 1 — Master data.** Company, branches, carts, locations, suppliers, ingredients, product categories, products (**with `piecesPerStick`**), employees, the company price list (**`pricePerStick`**), and **set definitions with their components**. Full CRUD with Zod validation and list/search/filter.
*Done when:* seed loads a realistic PH operation — 1 commissary, 2 branches, 8 carts, 10 employees, 25 ingredients, 12 products, and the `STD-SET` five-product set — and everything is editable in the UI.

**Phase 2 — Costing engine.** Recipes/BOM builder, unit conversion, cost versions, cost breakdown card, margin analysis, price-change impact alert. Tests 11.1 and 11.4 pass.
*Done when:* editing an ingredient price visibly changes affected product costs and creates a new cost version, while historical costs stay put.

**Phase 3 — Inventory ledger.** Ledger + balance cache, production batches, transfers with paired rows, wastage/adjustment entry, physical count, item ledger view, `rebuild:balances`. Test 11.3 passes.
*Done when:* stock can be traced Supplier → Commissary → Branch → Cart → Employee and every movement has a record with a who and a why.

**Phase 4 — Shift reconciliation (the core loop).** Daily Close board listing all carts by status, batch issuance with 7-day default quantities and a **"load one standard set" button** (1,300 pcs across the five products in one tap), per-product refills, numeric-grid closing entry, vendor acknowledgment capture, validations, independent approval, immutability. Mobile-first: big tap targets, numeric keypads, minimal typing, usable one-handed at a branch. Test 11.2 (reconciliation half) passes.
*Done when:* one supervisor can issue to and close **eight carts** on a phone in under ten minutes, and none of those shifts can be approved by that supervisor.

**Phase 5 — Compensation and payroll.** Schemes, configurable rules UI (**set definition editor, component credit mode, per-component credit worth, `maxSetsPerComponent`**), per-shift computation with a per-component credit breakdown, deductions, payroll run with review/approve/lock, printable payslip. Test 11.2 (compensation half) passes.
*Done when:* payroll for a week is produced from shift data with zero manual arithmetic, each peso is traceable to a rule, and a payslip shows the five per-component credit lines with their stick math.

**Phase 6 — Expenses and P&L.** Expense categories, entry with receipt upload, approval, recurring expenses, overhead allocation toggle, P&L at every level with full drill-down.
*Done when:* Company → Branch → Cart → Shift → Line drill-down works and the numbers reconcile at every level.

**Phase 7 — Dashboards.** Owner dashboard (today's sales, transactions, units, vs target, top carts, top products, cash variance alerts, expiring documents), branch dashboard, cart scorecard, employee scorecard, sales trends, best/slow movers.
*Done when:* the owner opens one page and knows how the business did today without touching a spreadsheet.

**Phase 8 — Procurement and replenishment.** Suggestion engine + cron, PO lifecycle, receiving with cost update, supplier performance. Test 11.5 passes.
*Done when:* the system proposes a sensible order list each morning and receiving a PO updates ingredient cost and product costing automatically.

**Phase 9 — 201 files and polish.** Employee documents with expiry reminders, employment history, RBAC hardening and audit review, CSV/Excel export on all reports, shift adjustments/reversals, optional itemized sales mode for fixed branches, cash denomination count, Playwright smoke tests.

---

## 13. UI principles

- **Mobile-first for supervisor screens.** Used outdoors, on cheap Android phones, on mobile data, possibly in rain, while carts are coming back. Large targets, numeric keypads, minimal typing, confirmation before destructive actions.
- **Optimize the supervisor for repetition, not for a single record.** Keyboard/tab order down a column, carry-forward defaults, "same as yesterday" buttons, and a running count of carts still open today. The supervisor repeats this flow eight to twenty times every evening; every saved tap compounds.
- **Desktop-first for owner dashboards and reports.**
- Currency always rendered as `₱1,234.56`. Quantities show units (`540 pcs`, `1.5 kg`).
- **Always show both units where a human reads a quantity.** Counts are entered in pieces; render the stick equivalent immediately beside the input (`540 pcs → 54.0 sticks`). Never make the supervisor divide by 3, 4, 5, or 10 in their head at the end of a shift.
- **Set progress belongs on the cart screen**, as five small bars against 50 sticks each, so the supervisor and vendor can see mid-day which component is lagging and worth pushing. This is the one screen that changes selling behaviour.
- Tagalog/English labels where it helps operators: "Issue / Labas", "Return / Balik", "Waste / Sira". Keep the codebase English.
- Every computed number gets a tooltip or expandable row showing its formula. Trust is the product.
- Empty states tell the user the next action, not "No data found."
- Optimistic UI is banned for anything touching money or stock. Wait for the server.

---

## 14. Explicitly out of scope for MVP

Offline-first sync, native mobile app, hardware POS/printers, e-wallet API integration, BIR/government tax filing, statutory payroll deductions (SSS/PhilHealth/Pag-IBIG contribution tables), biometric attendance, franchisee portal, customer loyalty, multi-currency, and the SaaS surface of multi-tenancy — signup, billing, domains, branding (the `companyId` plumbing itself **is** in scope; see §15.1).

Design decisions must not *block* these — particularly offline sync (keep shift closing a single idempotent payload with a client-generated `idempotencyKey`) and statutory payroll (keep `Deduction` generic).

---

## 15. Assumptions — all CONFIRMED by the owner

Every item below has been answered. Nothing in this spec is waiting on a decision; only the master-data numbers at the end of this section are outstanding, and they do not block Phase 0.

1. ✅ **CONFIRMED — one company operated now, built tenant-ready for resale later.** Currency ₱ PHP, timezone `Asia/Manila`, a single seeded company. The owner intends to sell the system to other cart operators once proven, so `companyId` is on every table and injected by the query layer from day one (§15.1) — but none of the SaaS surface (signup, billing, domains, branding) is built in the MVP.
2. ✅ **CONFIRMED — Sales are captured by shift reconciliation, not per transaction.** Itemized entry is deferred to Phase 9.
3. ✅ **CONFIRMED — Carts hold finished / ready-to-fry goods only, issued and counted by the piece.** The **commissary** holds all ingredients and runs production batches; ingredient-level costing happens there, never at the cart. Cart-level inventory is therefore `itemType = PRODUCT` throughout.
4. ✅ **CONFIRMED — Vendors are employees on a daily rate plus incentives**, not consignment operators buying stock outright.
5. ✅ **CONFIRMED — Cash shortages are deducted in full, uncapped**, from incentive first and then base pay, and only when the vendor has acknowledged the count (§7). `maxShortageDeduction` stays in the schema as a nullable cap for later use; seed it `null`.
6. ✅ **CONFIRMED — web app, online-only.** Mobile-friendly, installable as a PWA later. Shift closing stays a single idempotent payload with a client-generated `idempotencyKey` so offline support can be added without a rewrite, but no offline code ships in the MVP.
7. ✅ **CONFIRMED — a set is a five-product bundle of 250 sticks, and a stick is a product-specific number of pieces** (§5.3.1). Set credit is counted on the **day's total sticks sold per product**, across the morning load-out and every refill.
8. ✅ **CONFIRMED — Wastage cost is an operating expense, not COGS**, reported as its own line per cart so product margins stay comparable across carts.
9. ✅ **CONFIRMED — Supervisors enter all cart data for all their carts.** Vendors have no accounts in the MVP. Shift screens are built for batch operation, approval is independent of the person who closed the shift, and vendor acknowledgment is captured at closing.
10. ✅ **CONFIRMED — One company-wide price list.** Same peso price per product at every branch, cart, and location; promos are recorded as per-shift discounts. Branch/cart price scoping stays in the schema, unused (§5.3).

11. ✅ **CONFIRMED — set completion is per-component.** Each of the five products carries its own share of the set incentive (equal by default, editable per component) and is credited on its own, so four of five components sold through earns 4/5 of the incentive (§8). `ALL_COMPONENTS` and `PROPORTIONAL` are implemented and switchable in Settings.
12. ✅ **CONFIRMED — refills are per-product top-ups** of any quantity, not whole new sets. Because credits are computed on day totals, refills earn incentive automatically and `REFILL_BONUS` is not seeded.
13. ✅ **CONFIRMED — carts hold loose pieces**, skewered at the point of sale. `stockUnit = PIECE` for every product; the ledger, issuance, returns, waste, and closing counts are all in pieces.

### 15.1 Multi-tenant readiness — what to build now, what to defer

Build now (cheap today, a rewrite later):

- `companyId` non-null on every table, indexed, leading every composite index.
- Every unique constraint composite with it: `@@unique([companyId, code])`, `@@unique([companyId, employeeNo])`, `@@unique([companyId, sku])`.
- `companyId` in the JWT session; `lib/db.ts` wrappers inject it on every read and write. No server action touches `prisma.*` directly.
- All company-level configuration as **data** (`Company.settings`, compensation rules, set definitions, price lists) rather than constants in code — a second operator will want different pieces-per-stick, different sets, and a different incentive.
- The tenant-isolation test from §5.1, seeded with two companies.

Defer (do not build in the MVP): self-serve signup and onboarding, subscription billing and plan limits, subdomain or custom-domain routing, per-tenant branding and theming, cross-tenant super-admin tooling, per-tenant data export/import, usage metering.

### Master data the owner still needs to supply (blocks the seed, not the build)

These are numbers, not decisions — Claude Code should seed placeholders clearly marked `TODO_OWNER` and build the UI to edit them:

- **`pricePerStick` for each of the five products** (₱ per stick as sold to customers).
- **The set incentive amount** — how many pesos a full 250-stick set earns the vendor. The tests use ₱250.00 (₱50.00 per component); confirm before payroll goes live.
- **Base daily rate** — the brief's example was ₱500/day.
- **Real ingredient costs and batch yields** for each of the five products; the kwek-kwek figures in §11.1 are illustrative.
- **Cash variance dispute threshold** — defaulted to ₱100.


