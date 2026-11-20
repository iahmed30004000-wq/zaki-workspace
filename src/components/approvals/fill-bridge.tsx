"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { FormSchema } from "@/lib/approvals/forms";
import { AttachmentPicker, type PickedFile } from "./attachments";
import { ExpenseNote } from "./expense-note";
import { FormFiller } from "./form-filler";

/** «املأ النموذج» on the page: the boxes, optional files, and the call that makes the request from them (then opens it). */
export function FillBridge({ familyId, schema }: { familyId: string; schema: FormSchema }) {
  const { t } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<PickedFile[]>([]);
  return (
    <div className="space-y-3">
      {schema.purpose ? <ExpenseNote /> : null}
      <FormFiller
        schema={schema}
        extra={
          <div className="space-y-1 text-xs">
            <span className="block font-medium text-fg">{t(schema.purpose === "expense" ? "expense.receipt" : "approvals.form.files")}</span>
            <AttachmentPicker value={files} onChange={setFiles} />
          </div>
        }
        send={async (answers) => {
          const res = await apiPost<{ approval: { id: string } }>(`/api/approval-forms/${familyId}/submit`, { answers, fileIds: files.map((f) => f.id) });
          router.push(`/approvals/${res.approval.id}`);
        }}
      />
    </div>
  );
}
