"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";
import { enumLabel, enumOptions } from "@/lib/i18n/enums";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function errText(err: unknown, t: (k: string) => string): string {
	if (err instanceof ApiError && err.messageKey) {
		const x = t(err.messageKey);
		return x !== err.messageKey ? x : t("common.error");
	}
	return t("common.error");
}

interface CustomerRow {
	id: string;
	name: string;
	company: string | null;
	email: string | null;
	phone: string | null;
	notes: string | null;
	creator: { id: string; name: string } | null;
	createdAt: string;
}

interface OpportunityRow {
	id: string;
	number: number;
	title: string;
	/** `null` when the server hid the amount: `prices.view` is a box of its own (the row is still readable). */
	value: number | null;
	stage: string;
	expectedCloseAt: string | null;
	notes: string | null;
	customer: { id: string; name: string; company: string | null } | null;
	owner: { id: string; name: string } | null;
	createdAt: string;
}

const STAGES = enumOptions("OpportunityStage");

const STAGE_STYLES: Record<string, string> = {
	LEAD: "bg-surface-2 text-fg-muted",
	QUALIFIED: "bg-info/10 text-info",
	PROPOSAL: "bg-warn/10 text-warn",
	NEGOTIATION: "bg-cat-6/10 text-cat-6",
	WON: "bg-ok/10 text-ok",
	LOST: "bg-danger/10 text-danger",
};

/**
 * `canEdit` is the customers box «يضيف ويعدّل» (`crm.edit`, the page reads it from the person's capabilities):
 * without it the screen only reads - no create, edit or stage change is offered. `canDelete` is «يحذف» (`crm.delete`;
 * absent: as `canEdit`). The server refuses those requests too; this keeps the screen honest.
 * `canSeePrices` is `prices.view`: without it the amount is a dash and its box is not in the form — the
 * server answers `null` for it and refuses a value (security review C2).
 */
export function CrmView({
	canEdit,
	canDelete = canEdit,
	canSeePrices,
}: {
	canEdit: boolean;
	canDelete?: boolean;
	canSeePrices: boolean;
}) {
	const { t } = useI18n();
	const qc = useQueryClient();
	const { toast } = useToast();
	const [tab, setTab] = useState<"customers" | "opportunities">("customers");

	// customers
	const customersQuery = useQuery({
		queryKey: ["crm", "customers"],
		queryFn: () => apiGet<{ customers: CustomerRow[] }>("/api/crm/customers"),
	});

	// opportunities
	const oppsQuery = useQuery({
		queryKey: ["crm", "opportunities"],
		queryFn: () => apiGet<{ opportunities: OpportunityRow[] }>("/api/crm/opportunities"),
	});

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["crm"] });
	};

	// customer mutations
	const saveCustomer = useMutation({
		mutationFn: (payload: { id?: string; body: Record<string, unknown> }) =>
			payload.id
				? apiPatch(`/api/crm/customers/${payload.id}`, payload.body)
				: apiPost("/api/crm/customers", payload.body),
		onSuccess: () => {
			setCustomerModal(null);
			toast(t("crm.saved"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const delCustomer = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/crm/customers/${id}`),
		onSuccess: () => {
			toast(t("crm.deleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	// opportunity mutations
	const saveOpp = useMutation({
		mutationFn: (payload: { id?: string; body: Record<string, unknown> }) =>
			payload.id
				? apiPatch(`/api/crm/opportunities/${payload.id}`, payload.body)
				: apiPost("/api/crm/opportunities", payload.body),
		onSuccess: () => {
			setOppModal(null);
			toast(t("crm.saved"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const delOpp = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/crm/opportunities/${id}`),
		onSuccess: () => {
			toast(t("crm.deleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const [customerModal, setCustomerModal] = useState<CustomerRow | "new" | null>(null);
	const [oppModal, setOppModal] = useState<OpportunityRow | "new" | null>(null);

	const customers = customersQuery.data?.customers ?? [];
	const opps = oppsQuery.data?.opportunities ?? [];

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
					<button
						onClick={() => setTab("customers")}
						className={cn(
							"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
							tab === "customers" ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
						)}
					>
						<Users className="size-4" />
						{t("crm.customers")}
						<span className="text-xs text-muted">({customers.length})</span>
					</button>
					<button
						onClick={() => setTab("opportunities")}
						className={cn(
							"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
							tab === "opportunities" ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
						)}
					>
						<Briefcase className="size-4" />
						{t("crm.opportunities")}
						<span className="text-xs text-muted">({opps.length})</span>
					</button>
				</div>
				{!canEdit ? null : tab === "customers" ? (
					<Button onClick={() => setCustomerModal("new")}>
						<Plus className="size-4" />
						{t("crm.newCustomer")}
					</Button>
				) : (
					<Button onClick={() => setOppModal("new")} disabled={customers.length === 0}>
						<Plus className="size-4" />
						{t("crm.newOpportunity")}
					</Button>
				)}
			</div>

			{tab === "customers" ? (
				<CustomersTab
					rows={customers}
					loading={customersQuery.isLoading}
					canEdit={canEdit}
					onEdit={setCustomerModal}
					onDelete={canDelete ? (id) => delCustomer.mutate(id) : undefined}
				/>
			) : (
				<OpportunitiesTab
					rows={opps}
					loading={oppsQuery.isLoading}
					canEdit={canEdit}
					onEdit={setOppModal}
					onDelete={canDelete ? (id) => delOpp.mutate(id) : undefined}
					onStageChange={(id, stage) =>
						saveOpp.mutate({ id, body: { stage } })
					}
				/>
			)}

			{customerModal ? (
				<CustomerModal
					row={customerModal === "new" ? null : customerModal}
					pending={saveCustomer.isPending}
					onClose={() => setCustomerModal(null)}
					onSave={(body) =>
						saveCustomer.mutate(
							customerModal === "new" ? { body } : { id: customerModal.id, body },
						)
					}
				/>
			) : null}

			{oppModal ? (
				<OpportunityModal
					row={oppModal === "new" ? null : oppModal}
					customers={customers}
					canSeePrices={canSeePrices}
					pending={saveOpp.isPending}
					onClose={() => setOppModal(null)}
					onSave={(body) =>
						saveOpp.mutate(oppModal === "new" ? { body } : { id: oppModal.id, body })
					}
				/>
			) : null}
		</div>
	);
}

export function CustomersTab({
	rows,
	loading,
	canEdit,
	onEdit,
	onDelete,
}: {
	rows: CustomerRow[];
	loading: boolean;
	canEdit: boolean;
	onEdit: (row: CustomerRow) => void;
	/** Absent: the person may not delete (the customers box «يحذف»). */
	onDelete?: (id: string) => void;
}) {
	const { t } = useI18n();
	if (loading) return <div className="py-10 text-center text-sm text-muted">{t("common.loading")}</div>;
	if (rows.length === 0)
		return (
			<div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
				{t("crm.emptyCustomers")}
			</div>
		);
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{rows.map((c) => (
				<div key={c.id} className="rounded-xl border border-border bg-surface-1 p-4">
					<div className="flex items-start justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
								<Users className="size-4.5" />
							</div>
							<div className="min-w-0">
								<p className="break-words font-medium text-fg">{c.name}</p>
								{c.company ? (
									<p className="flex items-center gap-1 text-xs text-muted">
										<Building2 className="size-3" />
										{c.company}
									</p>
								) : null}
							</div>
						</div>
						{canEdit ? (
							<div className="flex shrink-0 gap-1">
								<button
									aria-label={t("common.edit")}
									onClick={() => onEdit(c)}
									className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
								>
									<Pencil className="size-3.5" />
								</button>
								{onDelete ? (
									<button
										aria-label={t("common.delete")}
										onClick={() => onDelete(c.id)}
										className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
									>
										<Trash2 className="size-3.5" />
									</button>
								) : null}
							</div>
						) : null}
					</div>
					<div className="mt-3 space-y-1 text-xs text-muted">
						{c.email ? (
							<p className="flex items-center gap-1.5">
								<Mail className="size-3" />
								{c.email}
							</p>
						) : null}
						{c.phone ? (
							<p className="flex items-center gap-1.5">
								<Phone className="size-3" />
								{c.phone}
							</p>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}

export function OpportunitiesTab({
	rows,
	loading,
	canEdit,
	onEdit,
	onDelete,
	onStageChange,
}: {
	rows: OpportunityRow[];
	loading: boolean;
	canEdit: boolean;
	onEdit: (row: OpportunityRow) => void;
	/** Absent: the person may not delete (the customers box «يحذف»). */
	onDelete?: (id: string) => void;
	onStageChange: (id: string, stage: string) => void;
}) {
	const { t } = useI18n();
	if (loading) return <div className="py-10 text-center text-sm text-muted">{t("common.loading")}</div>;
	if (rows.length === 0)
		return (
			<div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
				{t("crm.emptyOpportunities")}
			</div>
		);
	return (
		<div className="space-y-2">
			{rows.map((o) => (
				<div key={o.id} className="rounded-xl border border-border bg-surface-1 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<span dir="ltr" className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
								OP-{o.number}
							</span>
							<div className="min-w-0">
								<p className="break-words font-medium text-fg">{o.title}</p>
								<p className="text-xs text-muted">
									{t("crm.for")} {o.customer?.name ?? "—"}
									{o.customer?.company ? ` — ${o.customer.company}` : ""}
								</p>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold text-fg">
								{o.value == null ? t("enum.none") : fmtNumber(o.value)}
							</span>
							{canEdit ? (
								<>
									<Select
										value={o.stage}
										onChange={(e) => onStageChange(o.id, e.target.value)}
										aria-label={t("crm.stage")}
										className="w-36 text-xs"
									>
										{STAGES.map((s) => (
											<option key={s.value} value={s.value}>
												{s.label}
											</option>
										))}
									</Select>
									<button
										aria-label={t("common.edit")}
										onClick={() => onEdit(o)}
										className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
									>
										<Pencil className="size-3.5" />
									</button>
									{onDelete ? (
										<button
											aria-label={t("common.delete")}
											onClick={() => onDelete(o.id)}
											className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
										>
											<Trash2 className="size-3.5" />
										</button>
									) : null}
								</>
							) : null}
						</div>
					</div>
					<span
						className={cn(
							"mt-2 inline-block rounded-full px-2 py-0.5 text-xs",
							STAGE_STYLES[o.stage],
						)}
					>
						{enumLabel("OpportunityStage", o.stage)}
					</span>
				</div>
			))}
		</div>
	);
}

function CustomerModal({
	row,
	pending,
	onClose,
	onSave,
}: {
	row: CustomerRow | null;
	pending: boolean;
	onClose: () => void;
	onSave: (body: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const [name, setName] = useState(row?.name ?? "");
	const [company, setCompany] = useState(row?.company ?? "");
	const [email, setEmail] = useState(row?.email ?? "");
	const [phone, setPhone] = useState(row?.phone ?? "");
	const [notes, setNotes] = useState(row?.notes ?? "");
	return (
		<Modal open onClose={onClose} title={row ? t("crm.editCustomer") : t("crm.newCustomer")}>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					onSave({ name, company: company || null, email: email || null, phone: phone || null, notes: notes || null });
				}}
				className="space-y-3"
			>
				<div>
					<label className="text-xs text-muted">{t("crm.name")} *</label>
					<Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
				</div>
				<div>
					<label className="text-xs text-muted">{t("crm.company")}</label>
					<Input value={company} onChange={(e) => setCompany(e.target.value)} />
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label className="text-xs text-muted">{t("crm.email")}</label>
						<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
					</div>
					<div>
						<label className="text-xs text-muted">{t("crm.phone")}</label>
						<Input value={phone} onChange={(e) => setPhone(e.target.value)} />
					</div>
				</div>
				<div>
					<label className="text-xs text-muted">{t("crm.notes")}</label>
					<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
				</div>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" disabled={pending || name.trim().length < 2}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}

function OpportunityModal({
	row,
	customers,
	canSeePrices,
	pending,
	onClose,
	onSave,
}: {
	row: OpportunityRow | null;
	customers: CustomerRow[];
	canSeePrices: boolean;
	pending: boolean;
	onClose: () => void;
	onSave: (body: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const [customerId, setCustomerId] = useState(row?.customer?.id ?? customers[0]?.id ?? "");
	const [title, setTitle] = useState(row?.title ?? "");
	const [value, setValue] = useState(row?.value ?? 0);
	const [stage, setStage] = useState(row?.stage ?? "LEAD");
	const [notes, setNotes] = useState(row?.notes ?? "");
	return (
		<Modal open onClose={onClose} title={row ? `OP-${row.number} — ${t("crm.editOpportunity")}` : t("crm.newOpportunity")}>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					// without `prices.view` the amount is not ours to send: the server refuses it anyway (C2)
					onSave({
						customerId: customerId || undefined,
						title,
						...(canSeePrices ? { value: Number(value) || 0 } : {}),
						stage,
						notes: notes || null,
					});
				}}
				className="space-y-3"
			>
				<div>
					<label className="text-xs text-muted">{t("crm.customer")} *</label>
					<Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required disabled={!!row}>
						{customers.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
								{c.company ? ` — ${c.company}` : ""}
							</option>
						))}
					</Select>
				</div>
				<div>
					<label className="text-xs text-muted">{t("crm.title")} *</label>
					<Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{canSeePrices ? (
						<div>
							<label className="text-xs text-muted">{t("crm.value")}</label>
							<Input type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value))} />
						</div>
					) : null}
					<div>
						<label className="text-xs text-muted">{t("crm.stage")}</label>
						<Select value={stage} onChange={(e) => setStage(e.target.value)}>
							{STAGES.map((s) => (
								<option key={s.value} value={s.value}>
									{s.label}
								</option>
							))}
						</Select>
					</div>
				</div>
				<div>
					<label className="text-xs text-muted">{t("crm.notes")}</label>
					<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
				</div>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" disabled={pending || !customerId || title.trim().length < 3}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
