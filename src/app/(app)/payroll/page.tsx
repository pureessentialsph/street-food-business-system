import { ComingSoon } from "@/components/coming-soon";

export default function PayrollPage() {
  return (
    <ComingSoon
      title="Payroll"
      subtitle="Base pay plus set incentives minus deductions, computed from shifts rather than typed in."
      phase="Phase 5"
      does={[
        "Per-shift pay with a visible breakdown: 540 pcs ÷ 10 per stick = 54.0 sticks ÷ 50 required = 1 credit × ₱50.",
        "Per-component set credits across the five products, using the rule set on the Sets screen.",
        "Cash shortages deducted in full, but only once the vendor has acknowledged the count.",
        "A weekly run that moves draft → reviewed → approved → paid, locking the numbers on approval.",
        "A printable payslip showing how every peso was arrived at.",
      ]}
      next={{ href: "/sets", label: "review the set incentive rules" }}
    />
  );
}
