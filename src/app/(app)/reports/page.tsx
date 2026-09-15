import { ComingSoon } from "@/components/coming-soon";

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      subtitle="Sales, profitability and performance by product, cart, location, employee and date range."
      phase="Phase 7"
      does={[
        "Today's sales, transactions, units sold and performance against target.",
        "Best sellers and slow movers, so stock follows demand.",
        "Cart and employee scorecards — who is performing and who needs help.",
        "Locations with strong sales but weak profit, which is where money quietly leaks.",
        "Every figure clickable down to the shift that produced it.",
      ]}
    />
  );
}
