import { ComingSoon } from "@/components/coming-soon";

export default function ExpensesPage() {
  return (
    <ComingSoon
      title="Expenses"
      subtitle="Gas, rent, permits, transport, repairs — everything between gross profit and what you actually keep."
      phase="Phase 6"
      does={[
        "Log an expense against the company, a branch, a cart or an employee.",
        "Attach the receipt, and require approval before it hits the P&L.",
        "Recurring expenses like rent and permits, posted automatically.",
        "Full P&L: net sales − COGS − labour − wastage − operating expenses = operating profit.",
        "Drill down from company to branch to cart to a single shift.",
      ]}
    />
  );
}
