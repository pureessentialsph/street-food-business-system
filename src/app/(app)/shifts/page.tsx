import { ComingSoon } from "@/components/coming-soon";

export default function ShiftsPage() {
  return (
    <ComingSoon
      title="Daily Close"
      subtitle="Issue stock in the morning, count it back at night. This is the core loop the whole system hangs off."
      phase="Phase 4"
      does={[
        "One board listing every cart for today, with status chips: not opened, open, closed, disputed.",
        "Batch issuance — load out all carts at once, defaulting to each cart's usual quantities.",
        "Per-product refills during the day, counted into the same shift.",
        "A numeric grid for the closing count: pieces returned and pieces wasted, per product.",
        "Sold, sales, COGS, cash variance and the vendor's incentive all derived from that one count.",
        "Vendor acknowledgment captured at closing, and approval barred to whoever closed the shift.",
      ]}
      next={{ href: "/carts", label: "check your carts and their usual vendors" }}
    />
  );
}
