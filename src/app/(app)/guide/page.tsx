import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody } from "@/components/ui/card";
import { GuideSection, Note, Step, Steps, Table, Warn } from "@/components/guide";

export const metadata = { title: "Guide" };

/**
 * How to run the business on this system. Written for the people who will actually use
 * it — an owner setting it up once, a supervisor using it every morning — not for
 * developers. Keep it current: a screen that changes and a guide that does not is worse
 * than no guide, because people trust it.
 */

const CONTENTS = [
  ["how-it-thinks", "How the system thinks"],
  ["setup", "Setting up — do this once"],
  ["opening-stock", "Loading your opening stock"],
  ["daily", "The daily loop"],
  ["inventory", "Keeping stock straight"],
  ["assets", "Equipment"],
  ["expenses", "Expenses"],
  ["payroll", "Paying people"],
  ["procurement", "Buying"],
  ["reports", "Knowing if you made money"],
  ["people", "Staff records"],
  ["roles", "Who can do what"],
  ["logins", "Logins and access"],
  ["account", "Your own login"],
  ["problems", "When something looks wrong"],
] as const;

export default async function GuidePage() {
  await requireUser();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Guide"
        subtitle="How to run the business on this system, from first setup to the end of a trading day."
      />

      <Card>
        <CardBody>
          <p className="mb-2 text-sm font-medium text-stone-700">On this page</p>
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {CONTENTS.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="text-brand-700 hover:underline">
                  {i + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-8">
          <GuideSection
            id="how-it-thinks"
            title="1 · How the system thinks"
            lead="Four ideas. Everything else follows from them, and most confusion comes from one of these being misunderstood."
          >
            <div>
              <p className="text-sm font-medium text-stone-900">Pieces, sticks, sets</p>
              <div className="mt-1 space-y-2 text-sm text-stone-600">
                <p>
                  Carts hold <strong>loose pieces</strong> and skewer them when a customer buys.
                  So stock is counted in pieces, customers buy sticks, and incentive is measured
                  in sets. The system converts between them; you never do.
                </p>
                <Table
                  head={["Product", "Pieces per stick"]}
                  rows={[
                    ["Kwek-kwek", "4"],
                    ["Calamares / squid rings", "3"],
                    ["Squidball", "5"],
                    ["Fishball", "10"],
                    ["Kikiam (big)", "4"],
                  ]}
                />
                <p>
                  A <strong>set</strong> is 50 sticks of each of the five — 250 sticks, 1,300
                  pieces. It exists only to work out incentive.
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-stone-900">You record the day, not each sale</p>
              <p className="mt-1 text-sm text-stone-600">
                There is no cash register. A vendor is issued stock in the morning; at night you
                count what came back. <strong>Sold = issued − returned − wasted.</strong> That
                count is the sale record, so an accurate count matters more here than anywhere
                else in the system.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-stone-900">The business day starts at 4am</p>
              <p className="mt-1 text-sm text-stone-600">
                A cart closing at 1am belongs to the previous day&rsquo;s trading, which is what
                you would say yourself. Change the hour on{" "}
                <Link href="/settings" className="text-brand-700 hover:underline">/settings</Link>{" "}
                if your carts run differently.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-stone-900">Nothing is deleted quietly</p>
              <p className="mt-1 text-sm text-stone-600">
                Stock movements are an append-only ledger and every change is written to the
                audit log. Correcting a shift does not erase the first count; it records a
                correction. That is deliberate — it is what lets you settle an argument in six
                months.
              </p>
            </div>
          </GuideSection>

          <GuideSection
            id="setup"
            title="2 · Setting up — do this once"
            lead="In this order. Each step depends on the one before it, so skipping ahead means coming back."
          >
            <Steps>
              <Step n={1} title="Check company settings" where="/settings">
                <p>
                  Business day cutoff, cash variance threshold — the peso gap that flags a shift
                  as disputed — and your timezone. Also add job titles here, or just type new
                  ones on an employee and they are remembered.
                </p>
              </Step>
              <Step n={2} title="Add your branches" where="/branches">
                <p>
                  A branch is where stock is held and issued from. Mark your kitchen as a{" "}
                  <strong>commissary</strong> — that is where production happens.
                </p>
              </Step>
              <Step n={3} title="Add the spots you sell from" where="/locations">
                <p>Morayta, Recto station, the market. A cart is posted to a location.</p>
              </Step>
              <Step n={4} title="Add your carts" where="/carts">
                <p>
                  Each cart belongs to a branch, sits at a location, and has a usual vendor and a
                  daily sales target. The target is what the dashboard measures against.
                </p>
              </Step>
              <Step n={5} title="Add ingredients" where="/ingredients">
                <p>
                  Everything you buy: flour, cornstarch, quail eggs, frozen fishball, cooking
                  oil, sauces, sticks, cups, LPG gas, napkins. Set the real cost per gram, ml or
                  piece — these costs drive every profit figure in the system.
                </p>
              </Step>
              <Step n={6} title="Add products" where="/products">
                <p>
                  What a customer buys. Set <strong>pieces per stick</strong> correctly; it is
                  the number the whole unit ladder rests on.
                </p>
              </Step>
              <Step n={7} title="Write a recipe for each product" where="/costing">
                <p>
                  What one stick consumes — including the stick itself, the sauce and the cup.
                  Without a recipe a product has no cost, and everything it sells shows as pure
                  profit.
                </p>
                <Warn>
                  A product with no recipe makes your margins look far better than they are. The
                  dashboard warns you when a shift sells goods at zero cost — take that warning
                  seriously.
                </Warn>
              </Step>
              <Step n={8} title="Set your prices" where="/price-list">
                <p>
                  One price list for the whole company, per stick. Price per piece is worked out,
                  never typed.
                </p>
              </Step>
              <Step n={9} title="Define the set" where="/sets">
                <p>
                  50 sticks of each product, and what a full set pays. You can give each product
                  its own credit worth — a cart shifts fishball far more easily than calamares,
                  so an equal split pays most for the easiest selling.
                </p>
              </Step>
              <Step n={10} title="Add compensation schemes" where="/settings">
                <p>
                  Daily rate, and whether cash shortages are deducted. Shortages are only ever
                  deducted after the vendor has acknowledged them.
                </p>
              </Step>
              <Step n={11} title="Add your people" where="/employees">
                <p>
                  Vendors, supervisors, commissary staff. Vendors have no login — supervisors
                  record their shifts for them.
                </p>
              </Step>
              <Step n={12} title="Add suppliers, and say what each one sells" where="/suppliers">
                <p>
                  Who you buy from, and their lead time. Then open a supplier and link the
                  ingredients they supply: how they sell it (&ldquo;sack 25kg&rdquo;), how many
                  grams or pieces a pack holds, and the price.
                </p>
                <p>
                  You can also create a supplier in passing from the asset form; it is flagged
                  here until you complete its details.
                </p>
              </Step>
              <Step n={13} title="Record your equipment" where="/assets">
                <p>Fryers, LPG tanks, tongs, the motor carts. See section 6.</p>
              </Step>
            </Steps>
          </GuideSection>

          <GuideSection
            id="opening-stock"
            title="3 · Loading your opening stock"
            lead="Defining an ingredient does not give you any of it. Quantities come in separately."
          >
            <p className="text-sm text-stone-600">
              For stock you <strong>already have</strong> on the day you start using the system,
              use an adjustment. For anything arriving from a supplier from now on, raise a
              purchase order instead — it records the real cost and updates the ingredient&rsquo;s
              average.
            </p>
            <Steps>
              <Step n={1} title="Count what you physically have" />
              <Step n={2} title="Open the adjustment form" where="/inventory">
                <p>Press <strong>Adjust stock</strong>.</p>
              </Step>
              <Step n={3} title="Fill it in">
                <p>
                  What happened: <strong>Correction</strong>. Direction: <strong>In</strong>. Pick
                  the item and the branch holding it, enter the quantity in base units — grams,
                  ml or pieces — and <strong>enter the unit cost</strong>.
                </p>
              </Step>
              <Step n={4} title="Say why">
                <p>&ldquo;Opening balance, counted 18 Sep&rdquo; is enough. The reason is what someone reads later.</p>
              </Step>
            </Steps>
            <Warn>
              The unit cost is not optional for an item that has never had stock. Without it the
              goods enter at ₱0 and everything sold from them reports no cost of goods — which
              makes your profit look far higher than it is. The form refuses a blank cost in that
              case. An explicit 0 is accepted, for stock that really was free.
            </Warn>
          </GuideSection>

          <GuideSection
            id="daily"
            title="4 · The daily loop"
            lead="This is the part that runs every day. Everything else in the system exists to support it."
          >
            <p className="text-sm text-stone-600">
              It all happens on{" "}
              <Link href="/shifts" className="text-brand-700 hover:underline">/shifts</Link> — the
              Daily Close board.
            </p>
            <Steps>
              <Step n={1} title="Morning — open the cart">
                <p>
                  Pick the cart, confirm the vendor. Opening a shift does not move stock; it just
                  says this cart is trading today.
                </p>
              </Step>
              <Step n={2} title="Morning — issue the load-out">
                <p>
                  Enter the pieces of each product going onto the cart. The system suggests
                  quantities from what that cart usually sells. Stock moves from the branch to the
                  vendor, and the branch balance drops.
                </p>
                <p>
                  Issue the supplies too — sauce, cups, sticks, napkins, LPG. These are tracked
                  but never sold; their cost is already inside each product&rsquo;s recipe, so they
                  are not charged twice.
                </p>
              </Step>
              <Step n={3} title="During the day — refills">
                <p>
                  A top-up is a per-product refill on the same shift. Credit is worked out on the
                  day&rsquo;s total sticks sold, so refills need no special handling.
                </p>
              </Step>
              <Step n={4} title="Night — count what came back">
                <p>
                  Count returned pieces and wasted pieces, per product, in <strong>whole
                  pieces</strong>. The system works out what was sold and what it was worth.
                </p>
              </Step>
              <Step n={5} title="Night — count the cash">
                <p>
                  Enter cash remitted, plus any GCash or other digital payments. The system
                  compares that with what the sales say should be there.
                </p>
              </Step>
              <Step n={6} title="Night — close the shift">
                <p>
                  If cash is off by more than your threshold the shift is flagged{" "}
                  <strong>disputed</strong>, and payroll is blocked until it is settled. That is
                  the point of the flag.
                </p>
              </Step>
              <Step n={7} title="Next day — approve">
                <p>
                  A different person approves — the one who closed it cannot. Approval is what
                  makes the day final and payable.
                </p>
              </Step>
            </Steps>
            <Note>
              Got the count wrong? Reopen the shift and re-count. The system reverses the original
              movements and posts the corrected ones, so stock stays right and the first count is
              still on record.
            </Note>
          </GuideSection>

          <GuideSection
            id="inventory"
            title="5 · Keeping stock straight"
            lead="Four ways stock moves. All of them write to the same ledger."
          >
            <Table
              head={["What", "Where", "When to use it"]}
              rows={[
                [
                  "Receive a purchase order",
                  <Link key="p" href="/procurement" className="text-brand-700 hover:underline">/procurement</Link>,
                  "Goods arriving from a supplier. Records the real cost and updates the ingredient's average.",
                ],
                [
                  "Production batch",
                  <Link key="pr" href="/inventory/production" className="text-brand-700 hover:underline">/inventory/production</Link>,
                  "The commissary turning ingredients into finished product. Consumes the recipe, yields countable pieces.",
                ],
                [
                  "Transfer",
                  <Link key="t" href="/inventory/transfers" className="text-brand-700 hover:underline">/inventory/transfers</Link>,
                  "Moving stock between branches, commissary and warehouse. Sent and received are counted separately, so shortfalls show.",
                ],
                [
                  "Adjustment",
                  <Link key="i" href="/inventory" className="text-brand-700 hover:underline">/inventory</Link>,
                  "Opening balances, count corrections, spoilage and damage.",
                ],
              ]}
            />
            <Note>
              Stock is valued at <strong>weighted average cost</strong>. That is why an adjustment
              takes a cost on the way in but ignores one on the way out — what leaves is worth the
              running average, and being able to name a cost for departing stock would let anyone
              write whatever profit figure they liked.
            </Note>
            <p className="text-sm text-stone-600">
              If a balance ever looks wrong, <strong>Rebuild from ledger</strong> on{" "}
              <Link href="/inventory" className="text-brand-700 hover:underline">/inventory</Link>{" "}
              recalculates every balance from the movements. The ledger is the truth; the balances
              are only a cache of it.
            </p>
          </GuideSection>

          <GuideSection
            id="assets"
            title="6 · Equipment"
            lead="The durable things a cart needs. Not stock — equipment is not consumed by selling."
          >
            <p className="text-sm text-stone-600">
              On <Link href="/assets" className="text-brand-700 hover:underline">/assets</Link>:
              fryers, LPG tanks, tongs, squeeze bottles, the motor carts themselves. Each one gets
              a tag, what it cost, its condition, and who is holding it.
            </p>
            <p className="text-sm text-stone-600">
              Use <strong>Move</strong> when equipment changes hands. Every move is kept with its
              reason, so you can always answer &ldquo;who had the fryer when it broke?&rdquo; A
              cart&rsquo;s scorecard lists what it is carrying.
            </p>
            <Note>
              LPG splits in two, and this is intentional: the <strong>gas</strong> is an ingredient
              and is consumed, so it belongs in inventory. The <strong>tank</strong> is an asset
              and comes back, so it belongs here.
            </Note>
            <p className="text-sm text-stone-600">
              <strong>Category</strong> and <strong>Bought from</strong> both accept new entries.
              Choose <em>Add a new category</em> or <em>Add a new supplier</em> and type it — the
              category is remembered and offered next time, and a new supplier name creates the
              supplier there and then. Typing a name that already exists matches it rather than
              making a second copy.
            </p>
            <Warn>
              A supplier created this way knows only its name, and is marked{" "}
              <strong>details to follow</strong> on{" "}
              <Link href="/suppliers" className="text-brand-700 hover:underline">/suppliers</Link>.
              Give it a contact and a real lead time when you get a moment — until you do,
              procurement will plan orders against a placeholder lead time of one day.
            </Warn>
          </GuideSection>

          <GuideSection
            id="expenses"
            title="7 · Expenses"
            lead="Everything you spend that is not stock."
          >
            <p className="text-sm text-stone-600">
              On <Link href="/expenses" className="text-brand-700 hover:underline">/expenses</Link>:
              rent, electricity, fuel, repairs, permits. Charge an expense to a cart or branch and
              it lands in that unit&rsquo;s profit and loss. Company overhead sits above the carts.
            </p>
            <p className="text-sm text-stone-600">
              Recurring costs can be set up once and repeat. Whoever records an expense cannot
              approve it.
            </p>
            <Note>
              Wastage is an operating expense, not cost of goods. It is reported on its own line so
              margins stay comparable between carts — a cart that wastes a lot should look
              different from one that sells less.
            </Note>
          </GuideSection>

          <GuideSection
            id="payroll"
            title="8 · Paying people"
            lead="Built from shifts you have already approved. No arithmetic by hand."
          >
            <Steps>
              <Step n={1} title="Create the run for a period" where="/payroll" />
              <Step n={2} title="Review each payslip">
                <p>
                  Every line shows its own arithmetic — &ldquo;87.5 sticks ÷ 50 required = 1 credit
                  × ₱60.00&rdquo; — so a vendor who queries their pay can be shown exactly where it
                  came from.
                </p>
              </Step>
              <Step n={3} title="Approve and lock">
                <p>Whoever created the run cannot approve it.</p>
              </Step>
            </Steps>
            <Warn>
              A disputed shift blocks payroll until it is resolved, and a cash shortage is only
              deducted after the vendor has acknowledged it. Both are deliberate: pay disputes are
              easier to prevent than to settle.
            </Warn>
          </GuideSection>

          <GuideSection
            id="procurement"
            title="9 · Buying"
            lead="Worked out from what actually sold, not from guesswork."
          >
            <Warn>
              Nothing can be ordered until the ingredient has a <strong>preferred supplier</strong>.
              Set that by opening the supplier on{" "}
              <Link href="/suppliers" className="text-brand-700 hover:underline">/suppliers</Link>{" "}
              and linking the ingredient with its pack size and price — that is what tells the
              system who to buy from, what pack to order in, and how long delivery takes. An
              ingredient can have several suppliers but only one preferred; ticking a new one
              un-ticks the old.
            </Warn>
            <p className="text-sm text-stone-600">
              <Link href="/procurement" className="text-brand-700 hover:underline">/procurement</Link>{" "}
              suggests what to order from recent consumption, current stock, safety levels and each
              supplier&rsquo;s lead time. Turn suggestions into a purchase order, mark it ordered,
              then receive it when it arrives — receiving is what brings the stock in and updates
              costs.
            </p>
            <Note>
              Receiving a purchase order updates the ingredient&rsquo;s weighted-average cost, which
              cascades into a new cost version for every product using it. Old shifts keep the cost
              that applied on their day; history is never rewritten.
            </Note>
          </GuideSection>

          <GuideSection
            id="reports"
            title="10 · Knowing if you made money"
          >
            <p className="text-sm text-stone-600">
              <Link href="/dashboard" className="text-brand-700 hover:underline">/dashboard</Link>{" "}
              is the morning-after view: yesterday&rsquo;s sales against target, what is still open,
              what is disputed, what needs attention.
            </p>
            <p className="text-sm text-stone-600">
              <Link href="/reports" className="text-brand-700 hover:underline">/reports</Link> is
              the profit and loss, and it drills from the whole company down to a single shift:
              company → branch → cart → day. Every figure can be traced to the movements behind it.
            </p>
            <p className="text-sm text-stone-600">
              A cart&rsquo;s own scorecard shows its last fourteen days, who worked it, its
              sell-through, and its equipment.
            </p>
          </GuideSection>

          <GuideSection
            id="people"
            title="11 · Staff records"
          >
            <p className="text-sm text-stone-600">
              Each employee has a 201 file — contracts, IDs, clearances, with expiry dates. The
              dashboard warns before something expires, but only to people entitled to see
              employment records.
            </p>
            <p className="text-sm text-stone-600">
              A vendor&rsquo;s scorecard shows sales next to cash accuracy on purpose: someone who
              sells a lot but is short every day is not your best vendor.
            </p>
          </GuideSection>

          <GuideSection
            id="roles"
            title="12 · Who can do what"
            lead="Roles exist so that the person who records something is not the person who approves it."
          >
            <Table
              head={["Role", "What they do"]}
              rows={[
                ["Owner", "Everything, across every branch."],
                ["Admin", "Everything operational. Cannot change company settings."],
                ["Area Manager", "Approves shifts, payroll, expenses and purchase orders for their branches. Does not record them."],
                ["Supervisor", "The daily loop: opens carts, issues stock, counts back, closes shifts, records expenses — for their own branches only."],
                ["Commissary", "Production and stock. No sales or pay."],
                ["HR", "Employee records and 201 files."],
                ["Vendor", "No login. Supervisors record their shifts."],
              ]}
            />
            <Note>
              Supervisors see only their assigned branches — in lists, reports and exports alike.
              Changing someone&rsquo;s branch assignment takes effect next time they sign in.
            </Note>
          </GuideSection>

          <GuideSection
            id="logins"
            title="13 · Logins and access"
            lead="Owners and admins manage who can sign in, on /users."
          >
            <Steps>
              <Step n={1} title="Add a login" where="/users">
                <p>
                  Email, name, role, and a starting password. Give it in person rather than by
                  message, and have them change it on their own account page.
                </p>
              </Step>
              <Step n={2} title="Tick the branches they see">
                <p>
                  Only area managers and supervisors need this — owners and admins see every
                  branch regardless. A supervisor with no branches ticked sees nothing at all.
                </p>
              </Step>
              <Step n={3} title="Set a password for someone locked out" where="/users">
                <p>
                  There is no reset email in this system, so this is the way back in. It signs
                  them out everywhere; they should change it themselves afterwards.
                </p>
              </Step>
              <Step n={4} title="Switch off a login when someone leaves">
                <p>
                  Untick <em>Can sign in</em>. Logins are never deleted — an account is named on
                  every shift it closed, and that history has to keep making sense.
                </p>
              </Step>
            </Steps>
            <Note>
              Nobody can give out a role above their own, so an admin cannot create an owner. You
              also cannot change your own role or switch off your own login, and the last active
              owner cannot be demoted — otherwise a single slip locks everyone out of the company.
            </Note>
            <Warn>
              Keep <strong>two owner logins</strong>. With only one, losing it means nobody can
              manage the company, and there is no password-reset email to fall back on. The
              Logins screen warns you when only one is active.
            </Warn>
            <Note>
              Five wrong passwords in a row locks that device out of that account for fifteen
              minutes, and the screen says how long is left. It is per device, so someone else
              guessing at your email cannot lock you out of your own phone — and if a supervisor
              locks themselves out, they can wait it out or an owner can set them a new password.
            </Note>
          </GuideSection>

          <GuideSection
            id="account"
            title="14 · Your own login"
          >
            <p className="text-sm text-stone-600">
              Click your name at the bottom of the sidebar to open{" "}
              <Link href="/account" className="text-brand-700 hover:underline">your account</Link>.
              It shows who you are signed in as and lets you change your password.
            </p>
            <p className="text-sm text-stone-600">
              You need your current password to set a new one, and a new one must be at least
              12 characters. A short phrase you can remember beats a short password you cannot.
            </p>
            <Warn>
              Changing your password <strong>signs out every other device</strong> signed in as
              you — including one left open at home, or a phone you no longer carry. That is the
              point: do it straight away if you think anyone else has seen your password.
            </Warn>
            <Note>
              There is no &ldquo;forgot password&rdquo; email. If someone cannot get in, an owner
              has to set a new password for them. Your name, email and role are set by an owner
              too.
            </Note>
          </GuideSection>

          <GuideSection
            id="problems"
            title="15 · When something looks wrong"
          >
            <Table
              head={["What you see", "What it means", "What to do"]}
              rows={[
                [
                  "“Sold goods at zero cost”",
                  "A product sold with no recipe, or stock that came in at ₱0.",
                  <>Add the recipe on <Link key="c" href="/costing" className="text-brand-700 hover:underline">/costing</Link>, and always enter a unit cost when adjusting stock in.</>,
                ],
                [
                  "A shift is disputed",
                  "Cash is off by more than your threshold.",
                  "Count again, talk to the vendor, then correct the shift or record the shortage once acknowledged. Payroll stays blocked until it is settled.",
                ],
                [
                  "Stock balance looks wrong",
                  "The cached balance has drifted from the ledger.",
                  <>Press <strong>Rebuild from ledger</strong> on <Link key="i" href="/inventory" className="text-brand-700 hover:underline">/inventory</Link>.</>,
                ],
                [
                  "A cart cannot be closed",
                  "Usually nothing was issued, so there is nothing to count.",
                  "Close it as an empty day with a reason.",
                ],
                [
                  "You are asked to sign in again",
                  "The session expired, your password was changed on another device, or an owner deactivated the account.",
                  "Sign in again. Nothing is lost — unsaved form entries are, so re-enter those.",
                ],
                [
                  "“Too many attempts. Try again in N minutes.”",
                  "Five wrong passwords from this device in fifteen minutes.",
                  "Wait it out, or ask an owner to set you a new password on the Logins screen.",
                ],
                [
                  "A record will not delete",
                  "It has history — shifts, movements, or trading days behind it.",
                  "Archive or retire it instead. The message names what is holding it.",
                ],
              ]}
            />
          </GuideSection>
        </CardBody>
      </Card>

      <p className="text-xs text-stone-500">
        This guide is kept in step with the system. If a screen here does not match what you see,
        it is the guide that is wrong — say so and it will be fixed.
      </p>
    </div>
  );
}
