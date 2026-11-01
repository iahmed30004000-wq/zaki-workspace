/**
 * «مخزون التصنيع» — the shapes the routes answer and the screens read. Pure types: no React, no server imports.
 *
 * Quantities travel as integer micro-units (`...Micro`), money as integer minor units (`...Minor`) plus a currency code. Every field that
 * carries a cost is `null` (or absent from the object) for a person who does not hold `manufacturing.cost`: the server decides, the screen
 * only draws what it was given.
 */
import type { MovementKind } from "./shared";

export interface MfgPerson {
  id: string;
  name: string;
}

export interface MaterialCost {
  currency: string | null;
  /** The value of what is in stock that HAS a price (the sum of the value of the movements, plus the lots priced later), minor units. */
  valueMinor: number;
  /** The weighted average of one base unit over the stock that has a price, as the text to show (null while nothing priced is in stock). */
  averageText: string | null;
  /** The formula box's three numbers, as texts to show (null while nothing is in stock). */
  formula: { value: string; qty: string; average: string } | null;
}

export interface MaterialListItem {
  id: string;
  name: string;
  code: string | null;
  baseUnit: string;
  balanceMicro: number;
  lowStockMicro: number | null;
  low: boolean;
  archived: boolean;
  pendingCount: boolean;
  /** Stock of lots received «بدون سعر» that still have no price (outside the average): a quantity, so everybody who reads sees it. */
  unpricedMicro: number;
  cost: MaterialCost | null;
}

export interface MfgUnit {
  id: string;
  label: string;
  num: number;
  den: number;
  archived: boolean;
}

export interface SupplierItem {
  id: string;
  name: string;
  note: string | null;
  archived: boolean;
}

export interface CountItem {
  id: string;
  materialId: string;
  materialName: string;
  baseUnit: string;
  countedMicro: number;
  expectedMicro: number;
  diffMicro: number;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "MATCHED";
  countedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  /** This viewer may approve or reject it: holds `manufacturing.edit`, is not the person who counted, and it is still pending. */
  canDecide: boolean;
}

export interface MfgOverview {
  spaceId: string;
  spaceName: string;
  canEdit: boolean;
  canCost: boolean;
  materials: MaterialListItem[];
  suppliers: SupplierItem[];
  pending: CountItem[];
}

export interface ProofFile {
  id: string;
  name: string;
  mimeType: string;
  /** The ledger's own door (the library route lets the file out only to the people who may read the receipt). */
  url: string;
}

export interface LotItem {
  id: string;
  receivedOn: string;
  expiresOn: string | null;
  qtyMicro: number;
  enteredQtyMicro: number;
  enteredUnitLabel: string;
  supplier: { id: string; name: string } | null;
  note: string | null;
  proof: ProofFile | null;
  proofNote: string | null;
  createdBy: string;
  createdAt: string;
  /** Costs: null without `manufacturing.cost`, and null while the lot is received without a price and still has none. */
  cost: { currency: string; unitCostMinor: number; totalCostMinor: number } | null;
  reversed: boolean;
  /** Received «بدون سعر» and no price has been filled in yet: outside the average, and any cost that uses it is incomplete. */
  costPending: boolean;
  /** The price was filled in later (by whom and when; never the price itself). */
  costedLater: { by: string; at: string } | null;
  /** This viewer may fill the price now: holds `manufacturing.cost`, and the lot is still pending and not taken back. */
  canFillCost: boolean;
}

export interface MovementItem {
  id: string;
  kind: MovementKind;
  qtyMicro: number;
  reason: string | null;
  lotId: string | null;
  reversesId: string | null;
  reversedById: string | null;
  createdBy: string;
  createdAt: string;
  /** Without `manufacturing.cost`: null. */
  valueMinor: number | null;
  /** May still be reversed by this viewer (an editor, not itself a reversal, not reversed yet). */
  canReverse: boolean;
}

export interface MaterialDetail {
  id: string;
  spaceId: string;
  spaceName: string;
  name: string;
  code: string | null;
  baseUnit: string;
  lowStockMicro: number | null;
  low: boolean;
  archived: boolean;
  balanceMicro: number;
  unpricedMicro: number;
  units: MfgUnit[];
  suppliers: SupplierItem[];
  canEdit: boolean;
  canCost: boolean;
  cost: MaterialCost | null;
  lots: LotItem[];
  movements: MovementItem[];
  counts: CountItem[];
}
