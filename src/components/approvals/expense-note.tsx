"use client";

import { useI18n } from "@/lib/i18n";

/**
 * ⚠️ + 🔧 on the screens of the office-money forms («طلب مصروف», «تحويل بين الصناديق», I1.3): internal office spending only; order money,
 * wallets and cash balances stay in the orders system; no amount is ever approved by a chat message.
 */
export function ExpenseNote() {
  const { t } = useI18n();
  return (
    <p data-expense-note className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg">
      <span className="block font-medium">{t("expense.note")}</span>
      <span className="block text-fg-muted">{t("expense.note_fix")}</span>
    </p>
  );
}
