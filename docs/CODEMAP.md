# Code map — Zaki Workspace

> Phase A of the owner's review (2026-10-29). This file is generated from the code, not written
> from memory: `scripts/codemap.mjs` reads `src/`, `prisma/schema.prisma` and `src/lib/features.ts`
> and prints every table below. Re-run it after a change and the map is right again.
> ⚠️ A hand-written map drifts. The generator is the source; this file is its output.
> 🔧 `node scripts/codemap.mjs` rewrites it in place.

## What this answers

1. **Where does a job live?** — the folder map (§2).
2. **Who may call this door, and what does it call?** — all 252 routes, one row each (§4).
3. **If I change a service, what breaks?** — every service and its callers (§6).
4. **If I change a table, who writes it?** — every model and the code that writes it (§7).
5. **If I flip a switch, what disappears?** — the 29 feature switches and every place that reads them (§8).

## 1. The layers

```
browser
  │  a page (server component) reads through a service, never through Prisma directly
  │  a client component mutates through fetch('/api/…')
  ▼
src/middleware.ts        ← runs on the edge for every request
  · API writes must come from this app's own pages (Origin guard, canonical path)
  · a page needs a VERIFIED session cookie, else /login?next=…
  · a cookie still owing a password change or the notice → /onboarding
  ▼
src/app/api/**/route.ts  ← thin: parse with zod, call ONE service, wrap in withApi()
  · the door: requireActor / activeOrgCtx / requireWorkspace / crmContext … (§3)
  ▼
src/server/services/*     ← the rules and the transactions
  · re-checks the door (assertMemberCan / memberCan) so a new caller cannot forget it
  ▼
prisma/schema.prisma      ← the data; a write belongs to a service (§7 lists every file that writes)
```

Two rules the code keeps, and a reviewer can check by reading the map:

- **One door per route.** No route decides access by comparing a role name; it asks a guard (§3).
- **One writer per concept.** A model belongs to the service that owns it; §7 names every file that writes a row, and §9 the handlers that still write theirs directly.

## 2. Folder map

| Where | Job |
|---|---|
| `src/app/(app)/` | the signed-in screens: one folder per place (today, boards, chat, crm, …) |
| `src/app/api/` | 252 route handlers — the only mutating surface (§4) |
| `src/app/login`, `register`, `onboarding`, `go` | the doors that work without a session |
| `src/components/` | the interface, grouped by feature; `shell/` is the frame, `ui/` the primitives |
| `src/lib/` | pure helpers that run on both sides: `i18n/`, `format.ts`, `features.ts`, `nav/`, `themes/` |
| `src/server/` | everything that may only run on the server |
| `src/server/policy/` | who may do what: ranks, capabilities, the section grid, conversation and call rules |
| `src/server/services/` | 101 services — the business rules (§6) |
| `src/server/chat/`, `calls/`, `files/`, `watch/`, `realtime/` | the larger features, split out of `services/` |
| `prisma/` | the schema and the additive-only migrations |
| `worker/` | a heartbeat placeholder: no scheduled job runs today |
| `tests/` | unit tests (`tests/`) and the real-database tests (`tests/db/`) |
| `scripts/` | the gate scripts: migrations lint, secret scan, icon and CSS builders, this map |

## 3. The guards — what each one proves

| Guard | Where | What it proves |
|---|---|---|
| `requireUser()` | `server/auth.ts` | a valid session cookie whose `tokenVersion` still matches the database; 403 `auth.onboarding_required` for a pending person |
| `requireActor()` | `policy/actor.ts` | the above, plus an ACTIVE membership: the person, their organization, rank, capabilities, `isOwner`, `isExternal` |
| `requireOrgMember(orgId)` | `auth.ts` | membership of THAT organization, ACTIVE |
| `requireOrgRole(orgId, roles)` | `auth.ts` | the above, and one of the given ranks |
| `requireWorkspace(wsId)` | `auth.ts` | a `WorkspaceMember` row — an ADMIN inherits nothing; the owner needs no row |
| `requireProjectAccess` / `requireTaskAccess` / `requireTeamWork` | `auth.ts` | the workspace a project, a task or a team belongs to, and the caller is in it |
| `activeOrgCtx()` | `services/integrations.ts` | the caller's oldest ACTIVE membership, as `{userId, orgId, orgRole}` — the commonest door |
| `crmContext(mode)` / `directoryContext()` | `app/api/_access.ts` | not a guest, plus `crm.view` / `crm.edit` / `crm.delete` / `directory.view` |
| `ideaAccessCtx(id)` / `ideasCtx` | `services/ideas.ts` | not a guest, plus the idea's own visibility |
| `assertOrgManager(orgId)` | `services/integrations.ts` | the `integrations.manage` capability |
| `assertCan` / `assertMemberCan` / `memberCan` | `policy/actor.ts` | one named capability, on the session or on a member row read from the database |
| `assertNotGuest` / `assertCanWrite` | `services/guest-guard.ts` | an external partner never reads a staff area and never writes |
| `assertFeatureOn` | `services/features.ts` | the feature's switch in «الميزات» is on |
| `currentSpace()` | `services/current-space.ts` | which space this request is working in |
| `assertMayReadFile` | `services/files.ts` | this person may open this file (owner, space, or conversation) |

## 4. Every route — its door and its service

The **Door** column is the first guard the handler calls. `public by design` means there is none on
purpose — §5 says why for each one. A handler with no `withApi` wrapper is marked with † (it answers
by hand: SSE, a redirect, an HMAC check, or the account wrapper that adds `no-store`). A handler that
writes to the database itself, instead of through a service, is marked with ‡ (§9 counts them).
**Service imports** are the functions the handler imports from `server/services/*` — the door itself
is often one of them.

Doors in use: `requireActor` 92 · `activeOrgCtx` 74 · `(none)` 26 · `requireTeamWork` 13 · `requireTaskAccess` 10 · `requireUser` 10 · `requireWorkspace` 8 · `requireAccountsActor` 5 · `crmContext` 4 · `ideaAccessCtx` 4 · `directoryContext` 3 · `currentUser` 1 · `ideasCtx` 1 · `requireOrgMember` 1.

| Method | Path | Door | Service imports |
|---|---|---|---|
| GET, POST | `/api/approval-forms` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: formBodySchema<br>`approval-forms`: createForm, getForm, listForms |
| GET, PUT | `/api/approval-forms/[id]` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: formBodySchema<br>`approval-forms`: getForm, updateForm |
| POST | `/api/approval-forms/[id]/archive` | requireActor † | `approval-access`: approvalsGate<br>`approval-forms`: setFormArchived |
| POST | `/api/approval-forms/[id]/submit` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: fillBodySchema<br>`approval-forms`: submitForm<br>`approvals`: getApproval |
| GET, POST | `/api/approvals` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: amountOf, createBodySchema<br>`approvals`: createApproval, getApproval, listApprovals |
| GET | `/api/approvals/[id]` | requireActor † | `approvals`: getApproval |
| POST | `/api/approvals/[id]/cancel` | requireActor † | `approval-access`: approvalsGate<br>`approvals`: cancelApproval, getApproval |
| POST | `/api/approvals/[id]/decide` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: decideBodySchema<br>`approvals`: decideApproval, getApproval |
| POST | `/api/approvals/[id]/resubmit` | requireActor † | `approval-access`: approvalsGate<br>`approval-input`: amountOf, resubmitBodySchema<br>`approvals`: getApproval, resubmitApproval<br>`approval-forms`: resubmitForm |
| GET | `/api/approvals/approvers` | requireActor † | `approval-access`: approvalsGate, eligibleApprovers, notFound, spaceViewer |
| POST | `/api/auth/login` | **none** (public by design) ‡ | — |
| POST | `/api/auth/logout` | currentUser | — |
| POST | `/api/auth/register` | **none** (public by design) | `registration`: RegistrationUnavailableError, requestRegistration |
| POST | `/api/auth/register/confirm` | **none** (public by design) | `registration`: confirmRegistration |
| GET | `/api/avatars/[id]` | requireActor | `avatars`: readAvatar |
| POST | `/api/boards` | requireTeamWork ‡ | `tasks`: DEFAULT_BOARD_COLUMNS |
| GET, PATCH, POST | `/api/boards/[id]` | requireTeamWork ‡ | — |
| POST | `/api/boards/[id]/columns` | requireTeamWork ‡ | — |
| PATCH, DELETE | `/api/boards/[id]/columns/[columnId]` | requireTeamWork ‡ | — |
| GET | `/api/calendar/feed/[token]` | **none** (public by design) † | `calendar-feed`: authorizeFeedRequest, buildFeedFor, feedEtag |
| POST | `/api/calls` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET | `/api/calls/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/end` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/invite` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/leave` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/mute` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/remove` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/token` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/campaign-items/[itemId]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`campaigns`: deleteCampaignItem, toggleCampaignItem |
| GET, PATCH, DELETE | `/api/campaigns/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: campaignDetail, deleteCampaign, updateCampaign, updateCampaignSchema |
| POST | `/api/campaigns/[id]/items` | activeOrgCtx | `integrations`: activeOrgCtx<br>`campaigns`: addCampaignItem, campaignItemSchema |
| GET | `/api/campaigns/mine` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: myCampaigns |
| GET, POST | `/api/cards` | requireActor | `cards`: createCard, createCardSchema, listCards |
| GET, PATCH, DELETE | `/api/cards/[id]` | requireActor | `cards`: archiveCard, readCard, updateCard, updateCardSchema |
| GET, POST | `/api/cards/[id]/attachments` | requireActor | `card-attachments`: addAttachment, attachSchema, listGallery |
| PATCH, DELETE | `/api/cards/[id]/attachments/[attachmentId]` | requireActor | `card-attachments`: captionSchema, removeAttachment, setCaption |
| PUT | `/api/cards/[id]/attachments/order` | requireActor | `card-attachments`: orderSchema, reorderAttachments |
| PUT | `/api/cards/[id]/cover` | requireActor | `card-attachments`: coverSchema, setCover |
| POST | `/api/cards/[id]/duplicate` | requireActor | `cards`: duplicateCard |
| GET | `/api/cards/[id]/links` | requireActor | `card-links`: listLinks |
| GET | `/api/cards/[id]/log` | requireActor | `card-log`: listLog |
| POST | `/api/cards/[id]/move` | requireActor | `cards`: moveCard, moveCardSchema |
| GET, POST | `/api/cards/[id]/notes` | requireActor | `card-notes`: addNote, listNotes, noteSchema |
| PATCH, DELETE | `/api/cards/[id]/notes/[noteId]` | requireActor | `card-notes`: deleteNote, editNote, editNoteSchema |
| GET | `/api/cards/[id]/page` | requireActor | `card-page`: readCardPage |
| GET, PUT | `/api/cards/[id]/rating` | requireActor | `card-ratings`: rateCard, ratingSchema, readRating |
| POST | `/api/cards/[id]/restore` | requireActor | `cards`: restoreCard |
| GET | `/api/cards/[id]/revisions` | requireActor | `card-revisions`: listRevisions |
| POST | `/api/cards/[id]/revisions/[version]/restore` | requireActor † | `card-revisions`: restoreRevision, restoreSchema |
| POST | `/api/cards/[id]/send` | requireActor | `cards`: sendCard, sendCardSchema |
| PUT | `/api/cards/[id]/status` | requireActor | `card-status`: setCardStatus, statusSchema |
| POST | `/api/cards/[id]/task` | requireActor | `cards`: cardTaskSchema, cardToTask |
| GET | `/api/cards/topics` | requireActor | `cards`: postableTopics |
| GET | `/api/chat/archive` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/attachments/[id]` | requireActor | — |
| GET, POST | `/api/chat/conversations` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET, POST, PATCH, DELETE | `/api/chat/conversations/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, POST | `/api/chat/conversations/[id]/call` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/delivered` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/join` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/messages` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/purge` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/read` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/conversations/[id]/search` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, PUT | `/api/chat/conversations/[id]/whiteboard` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/directory` | directoryContext | `current-space`: currentSpace<br>`last-seen`: lastSeenReader |
| POST | `/api/chat/dm` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET | `/api/chat/home` | activeOrgCtx | `current-space`: currentSpace<br>`integrations`: activeOrgCtx |
| PATCH, DELETE | `/api/chat/messages/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/forward` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/notes` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/pin` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/poll/close` | activeOrgCtx | `integrations`: activeOrgCtx |
| PUT | `/api/chat/messages/[id]/poll/vote` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/react` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/task` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/ticket` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, PUT, DELETE | `/api/chat/order` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/oversight/conversations` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/oversight/conversations/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/spaces/[spaceId]/mute` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/spaces/[spaceId]/topics` | activeOrgCtx | `integrations`: activeOrgCtx |
| PATCH, DELETE | `/api/chat/topics/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/chat/topics/[id]/members` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/unread` | activeOrgCtx | `current-space`: currentSpace<br>`integrations`: activeOrgCtx |
| POST | `/api/chat/uploads` | requireActor | — |
| POST | `/api/checkins/answer` | **none** (public by design) | `checkins`: submitAnswer<br>`checkins-space`: resolveSpaceId |
| GET, PUT | `/api/checkins/config` | **none** (public by design) | `checkins`: getConfig, saveConfig<br>`checkins-space`: resolveSpaceId |
| POST | `/api/checkins/excuse` | **none** (public by design) | `checkins`: setExcused<br>`checkins-space`: resolveSpaceId |
| GET | `/api/checkins/history` | **none** (public by design) | `checkins`: history<br>`checkins-space`: resolveSpaceId |
| GET | `/api/checkins/mine` | **none** (public by design) | `checkins`: cardState<br>`checkins-space`: resolveSpaceId |
| GET | `/api/checkins/today` | **none** (public by design) | `checkins`: getToday<br>`checkins-space`: resolveSpaceId |
| GET, POST | `/api/crm/customers` | crmContext | `space-place`: placeOf<br>`crm`: createCustomer, createCustomerSchema, listCustomers |
| GET, PATCH, DELETE | `/api/crm/customers/[id]` | crmContext | `crm`: deleteCustomer, getCustomer, updateCustomer, updateCustomerSchema |
| GET, POST | `/api/crm/opportunities` | crmContext | `space-place`: placeOf<br>`crm`: createOpportunity, createOpportunitySchema, listOpportunities |
| GET, PATCH, DELETE | `/api/crm/opportunities/[id]` | crmContext | `crm`: deleteOpportunity, getOpportunity, updateOpportunity, updateOpportunitySchema |
| GET, POST | `/api/departments` | directoryContext | `integrations`: activeOrgCtx<br>`departments`: createDepartment, createDepartmentSchema, listDepartments |
| GET, PATCH, DELETE | `/api/departments/[id]` | directoryContext | `integrations`: activeOrgCtx<br>`departments`: deleteDepartment, getDepartment, updateDepartment, updateDepartmentSchema |
| GET, POST | `/api/departments/[id]/campaigns` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: createCampaign, createCampaignSchema, listDepartmentCampaigns |
| POST | `/api/departments/[id]/members` | activeOrgCtx | `integrations`: activeOrgCtx<br>`departments`: membersSchema, setMembers |
| GET, POST | `/api/departments/[id]/tickets` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: createTicket, createTicketSchema, listDepartmentTickets |
| POST, GET | `/api/files` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: ingest, listFiles<br>`current-space`: currentSpace<br>`google`: libraryOnDrive |
| GET, DELETE | `/api/files/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, getFileMeta, softDelete |
| GET | `/api/files/[id]/raw` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, openStored |
| POST | `/api/files/[id]/versions` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, ingest, PENDING_PATH |
| GET, POST | `/api/goals` | requireActor | `guest-guard`: assertNotGuest<br>`goals`: createGoal, goalSchema, listGoals<br>`space-place`: placeOf<br>`features`: isFeatureOn |
| PATCH, DELETE | `/api/goals/[id]` | requireActor | `guest-guard`: assertNotGuest<br>`goals`: deleteGoal, goalPatchSchema, updateGoal |
| POST | `/api/goals/[id]/key-results` | requireActor | `guest-guard`: assertNotGuest<br>`okr`: addKeyResult, keyResultInputSchema |
| GET | `/api/health` | **none** (public by design) † | — |
| GET, POST | `/api/ideas` | ideasCtx | `guest-guard`: assertNotGuest<br>`ideas`: createIdea, listIdeas<br>`current-space`: currentSpace<br>`n8n`: dispatchEvent |
| PATCH, DELETE | `/api/ideas/[id]` | ideaAccessCtx | `ideas`: deleteIdea, updateIdea, ideaAccessCtx<br>`n8n`: dispatchEvent |
| POST | `/api/ideas/[id]/convert` | ideaAccessCtx | `ideas`: ideaAccessCtx, convertIdeaToTask |
| POST | `/api/ideas/[id]/share` | ideaAccessCtx | `ideas`: ideaAccessCtx, shareIdea |
| POST | `/api/ideas/[id]/vote` | ideaAccessCtx | `ideas`: ideaAccessCtx, toggleIdeaVote |
| GET | `/api/instant` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace<br>`features`: isFeatureOn<br>`workspaces`: listWorkspaceMembers<br>`reward-guard`: isOrgOwner<br>`rewards`: defaultCurrencyOf |
| POST | `/api/instant/task` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace<br>`instant-work`: createInstantTask<br>`org-day`: orgTimeZone<br>`reward-input`: rewardBodySchema, toRewardRequest |
| POST | `/api/instant/ticket` | activeOrgCtx | `integrations`: activeOrgCtx<br>`features`: assertFeatureOn<br>`guest-guard`: assertNotGuest<br>`tickets`: createInstantTicket, instantTicketSchema |
| GET, DELETE | `/api/integrations/google` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: disconnectGoogle, getGoogleStatus, listDriveFiles, type DriveFile |
| POST, DELETE | `/api/integrations/google/app` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: clearGoogleApp, saveGoogleApp |
| GET | `/api/integrations/google/callback` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: exchangeCode, connectGoogle, verifyState |
| GET | `/api/integrations/google/start` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: buildAuthUrl, googleApp |
| GET, POST, DELETE | `/api/integrations/n8n` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`n8n`: configureN8n, disconnectN8n, getN8nStatus, recentEvents<br>`guest-guard`: assertNotGuest |
| POST | `/api/integrations/n8n/inbound` | **none** (public by design) † | `n8n`: handleInbound |
| POST | `/api/integrations/n8n/test` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`n8n`: sendTestPayload |
| GET, POST, DELETE | `/api/integrations/telegram` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`telegram`: connectBot, disconnect, listChats<br>`guest-guard`: assertNotGuest |
| GET | `/api/integrations/telegram/messages` | activeOrgCtx | `integrations`: activeOrgCtx<br>`telegram`: chatMessages<br>`guest-guard`: assertNotGuest |
| POST | `/api/integrations/telegram/send` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`telegram`: sendMessage |
| POST | `/api/integrations/telegram/sync` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`telegram`: syncUpdates |
| PATCH, DELETE | `/api/key-results/[id]` | requireActor | `guest-guard`: assertNotGuest<br>`okr`: keyResultPatchSchema, removeKeyResult, updateKeyResult |
| GET, POST | `/api/key-results/[id]/updates` | requireActor | `guest-guard`: assertNotGuest<br>`okr`: checkIn, checkInSchema, listCheckIns |
| GET, POST | `/api/labels` | requireWorkspace ‡ | — |
| GET, PATCH | `/api/me` | requireUser | `users`: updateProfile |
| POST, DELETE | `/api/me/avatar` | requireActor | `avatars`: clearAvatar, setAvatar, AVATAR_MAX_BYTES<br>`features`: assertFeatureOn |
| GET, POST | `/api/me/calendar-feed` | requireActor | `calendar-feed`: createFeedToken, listFeedTokens |
| DELETE | `/api/me/calendar-feed/[id]` | requireActor | `calendar-feed`: revokeFeedToken |
| POST | `/api/me/digits` | requireUser ‡ | — |
| PATCH, GET | `/api/me/last-seen` | requireActor | `features`: assertFeatureOn<br>`last-seen`: myHideLastSeen, setHideLastSeen |
| GET, PUT, DELETE | `/api/me/nav-order` | requireActor | `nav-order`: getNavOrder, resetNavOrder, saveNavOrder |
| POST | `/api/me/password` | requireUser | `onboarding`: changeOwnPassword |
| POST | `/api/me/theme` | requireUser ‡ | — |
| POST | `/api/me/transparency` | requireUser | `onboarding`: acceptTransparency |
| PATCH, DELETE | `/api/milestones/[id]` | requireTeamWork | `features`: assertFeatureOn<br>`org-day`: orgTimeZone<br>`milestones`: deleteMilestone, updateMilestone, milestonePatch |
| GET | `/api/notifications` | requireUser | `current-space`: bellWhere, currentSpace |
| DELETE | `/api/notifications/[id]` | requireUser ‡ | — |
| POST | `/api/notifications/read` | requireUser ‡ | `current-space`: bellWhere, currentSpace |
| GET, PATCH | `/api/organizations/[id]` | requireOrgMember ‡ | — |
| POST, GET | `/api/organizations/[id]/join-code` | **none** (public by design) † | — |
| GET, POST | `/api/organizations/[id]/members` | requireAccountsActor | `accounts`: createAccount, createAccountSchema, requireAccountsActor<br>`org-members`: listOrgMembers |
| PATCH, DELETE | `/api/organizations/[id]/members/[userId]` | requireAccountsActor | `accounts`: offboardBodySchema, requireAccountsActor, setAccountStatus, updateAccount, … |
| POST | `/api/organizations/[id]/members/[userId]/logout` | requireAccountsActor | `accounts`: logoutEverywhere, requireAccountsActor |
| POST | `/api/organizations/[id]/members/[userId]/password` | requireAccountsActor | `accounts`: requireAccountsActor, resetAccountPassword |
| POST | `/api/organizations/[id]/members/[userId]/status` | requireAccountsActor | `accounts`: accountStatusSchema, requireAccountsActor, setAccountStatus |
| POST | `/api/owner-assistant/chat` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-chat`: sendMessage |
| GET | `/api/owner-assistant/conversations` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-chat`: listConversations |
| GET, DELETE | `/api/owner-assistant/conversations/[id]` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-chat`: deleteConversation, getConversation |
| PUT, DELETE | `/api/owner-assistant/key` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-settings`: removeKey, saveKey |
| POST | `/api/owner-assistant/proposals/[id]/approve` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-proposals`: approveProposal |
| POST | `/api/owner-assistant/proposals/[id]/reject` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-proposals`: rejectProposal |
| GET, PUT | `/api/owner-assistant/settings` | requireActor † | `owner-assistant-access`: assistantAccess<br>`owner-assistant-settings`: MODEL_CHOICES, getSettings, updateSettings, usageSummary |
| GET | `/api/owner-board` | requireActor | `owner-board`: loadOverview<br>`owner-board-io`: parseBoardQuery |
| GET | `/api/owner-board/csv` | requireActor | `owner-board`: loadOverview<br>`owner-board-io`: parseBoardQuery, peopleCsv |
| GET | `/api/owner-board/people/[id]` | requireActor | `owner-board`: loadPerson<br>`owner-board-io`: parseBoardQuery |
| GET | `/api/presence` | requireActor | `guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`presence-roster`: presenceRoster<br>`current-space`: currentSpace<br>`features`: isFeatureOn |
| GET | `/api/production` | requireActor | `production`: dayChecklist, dayIso<br>`guest-guard`: assertNotGuest<br>`space-place`: placeOf |
| POST | `/api/production/checklist` | requireActor | `production`: setRoutineDone |
| GET, POST | `/api/production/routines` | requireActor | `production`: createRoutine, listRoutines, routineSchema<br>`guest-guard`: assertNotGuest<br>`space-place`: placeOf |
| PATCH, DELETE | `/api/production/routines/[id]` | requireActor | `production`: deleteRoutine, routineSchema, updateRoutine |
| GET, POST | `/api/projects` | requireWorkspace ‡ | `team-scope`: teamFilterInSpace<br>`teams`: assertMayCreateInTeam |
| PATCH | `/api/projects/[id]` | requireTeamWork ‡ | `teams`: moveProjectToTeam |
| GET | `/api/projects/[id]/boards` | requireTeamWork | — |
| GET, POST | `/api/projects/[id]/fields` | **none** (public by design) | `custom-fields`: createField, listProjectFields |
| PATCH | `/api/projects/[id]/fields/[fieldId]` | **none** (public by design) | `custom-fields`: updateField |
| GET, POST | `/api/projects/[id]/milestones` | requireTeamWork | `features`: assertFeatureOn<br>`org-day`: orgTimeZone<br>`milestones`: createMilestone, listMilestones, milestoneInput |
| GET | `/api/projects/[id]/timeline` | requireTeamWork | `timeline`: getProjectTimeline |
| GET | `/api/push/key` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/push/subscribe` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, POST | `/api/reminders` | requireActor | `reminders`: createReminder, listMyReminders<br>`org-day`: orgTimeZone |
| PATCH, DELETE | `/api/reminders/[id]` | requireActor | `reminders`: dismissReminder, snoozeReminder |
| GET | `/api/rewards/totals` | requireActor | `rewards`: openRewardTotals |
| GET | `/api/rt` | requireActor † | — |
| POST | `/api/rt/typing` | requireActor | — |
| GET | `/api/search` | requireUser | `current-space`: currentSpace<br>`team-scope`: loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, …<br>`files`: searchLibrary |
| GET, PATCH | `/api/settings/features` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: listFeatures, setFeature |
| GET | `/api/spaces/unplaced` | requireActor | `move-to-space`: listUnplaced |
| POST | `/api/spaces/unplaced/move` | requireActor | `move-to-space`: moveSchema, moveToSpace |
| GET, POST | `/api/tasks` | requireWorkspace | `team-scope`: teamFilterInSpace<br>`tasks`: createTask, listTasks<br>`org-day`: orgTimeZone<br>`n8n`: dispatchEvent<br>`rewards`: rewardsVisibleTo<br>`reward-input`: rewardBodySchema, toRewardRequest |
| GET, PATCH, DELETE | `/api/tasks/[id]` | requireTaskAccess | `team-scope`: userSeesProject<br>`tasks`: updateTask, deleteTask<br>`active-people`: assertActiveAssignee<br>`org-day`: orgTimeZone<br>`rewards`: rewardsVisibleTo, setReward<br>`reward-input`: rewardBodySchema, toRewardRequest |
| POST, GET | `/api/tasks/[id]/comments` | requireTeamWork ‡ | `n8n`: dispatchEvent |
| PATCH, DELETE | `/api/tasks/[id]/comments/[commentId]` | requireTeamWork ‡ | — |
| POST | `/api/tasks/[id]/complete` | requireTeamWork | `tasks`: setTaskCompletion<br>`n8n`: dispatchEvent |
| GET | `/api/tasks/[id]/fields` | **none** (public by design) | `custom-fields`: readTaskFields |
| PUT | `/api/tasks/[id]/fields/[fieldId]` | **none** (public by design) | `custom-fields`: setTaskFieldValue |
| GET, POST | `/api/tasks/[id]/links` | requireTaskAccess | `features`: assertFeatureOn<br>`task-links`: addTaskLink, listTaskLinks |
| DELETE | `/api/tasks/[id]/links/[linkId]` | requireTaskAccess | `features`: assertFeatureOn<br>`task-links`: removeTaskLink |
| POST | `/api/tasks/[id]/move` | requireTeamWork | `tasks`: moveTask<br>`n8n`: dispatchEvent |
| POST | `/api/tasks/[id]/pin` | requireTaskAccess | `rewards`: setPinned |
| GET, PUT, DELETE | `/api/tasks/[id]/recurrence` | requireTaskAccess | `task-recurrence`: getRecurrence, setRecurrence, stopRecurrence |
| POST | `/api/tasks/[id]/request/accept` | requireTaskAccess | `task-assign`: answerAssignRequest |
| POST | `/api/tasks/[id]/request/return` | requireTaskAccess | `task-assign`: answerAssignRequest |
| POST | `/api/tasks/[id]/reward` | requireTaskAccess | `rewards`: setReward<br>`reward-input`: rewardBodySchema, toRewardRequest<br>`org-day`: orgTimeZone |
| POST | `/api/tasks/[id]/reward/award` | requireTaskAccess | `rewards`: awardReward |
| POST | `/api/tasks/[id]/reward/cancel` | requireTaskAccess | `rewards`: cancelReward |
| GET, POST | `/api/tasks/[id]/steps` | **none** (public by design) | `task-steps`: addStep, listSteps |
| PATCH, DELETE | `/api/tasks/[id]/steps/[stepId]` | **none** (public by design) | `task-steps`: deleteStep, updateStep |
| GET | `/api/tasks/[id]/time` | **none** (public by design) | `time-tracking`: taskTimeCard |
| POST | `/api/tasks/[id]/time/manual` | **none** (public by design) | `time-tracking`: addManualEntry |
| POST | `/api/tasks/[id]/time/start` | **none** (public by design) | `time-tracking`: startTimer |
| GET, POST | `/api/team-development/criteria` | requireActor | `team-criteria`: addCriterion, criterionInputSchema, listCriteria |
| PATCH | `/api/team-development/criteria/[id]` | requireActor | `team-criteria`: criterionPatchSchema, updateCriterion |
| PATCH | `/api/team-development/goals/[id]` | requireActor | `team-plans`: goalPatchSchema, updateGoal |
| POST | `/api/team-development/goals/[id]/apply` | requireActor | `team-plans`: applyGoal |
| GET | `/api/team-development/lines` | requireActor | `team-lines`: loadStructure |
| PUT | `/api/team-development/lines/[userId]` | requireActor | `team-lines`: setSupervisor, setSupervisorSchema |
| PATCH | `/api/team-development/notes/[id]` | requireActor | `team-plans`: setNoteShared |
| GET | `/api/team-development/people` | requireActor | `team-score`: loadScoreTable<br>`team-score-io`: periodKind |
| GET, POST | `/api/team-development/people/[id]/goals` | requireActor | `team-plans`: createGoal, goalInputSchema, listGoals |
| GET, POST | `/api/team-development/people/[id]/notes` | requireActor | `team-plans`: addNote, listNotes, noteInputSchema |
| GET, PUT | `/api/team-development/people/[id]/reviews` | requireActor | `team-reviews`: listReviews, reviewInputSchema, saveReview |
| GET | `/api/team-development/people/[id]/score` | requireActor | `team-score`: loadPersonScore<br>`team-score-io`: periodKind |
| GET, PUT | `/api/team-development/people/[id]/skills` | requireActor | `team-skills`: loadPersonSkills, personSkillSchema, setPersonSkill |
| GET | `/api/team-development/people/[id]/skills/history` | requireActor | `team-skills`: loadSkillHistory |
| GET | `/api/team-development/people/csv` | requireActor | `team-score`: loadScoreTable<br>`team-score-io`: periodKind, scoreTableCsv |
| PATCH | `/api/team-development/reviews/[id]` | requireActor | `team-reviews`: advanceReview, reviewStatusSchema |
| GET, POST | `/api/team-development/skills` | requireActor | `team-skills`: createSkill, listSkills, skillInputSchema |
| PATCH | `/api/team-development/skills/[id]` | requireActor | `team-skills`: skillPatchSchema, updateSkill |
| GET | `/api/team-development/skills/matrix` | requireActor | `team-skills`: loadSkillMatrix |
| GET | `/api/team-development/skills/matrix/csv` | requireActor | `team-skills`: loadSkillMatrix, skillMatrixCsv |
| GET, PUT | `/api/team-development/weights` | requireActor | `team-score`: getWeights, setWeights, weightsSchema |
| PATCH, DELETE | `/api/tickets/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`tickets`: deleteTicket, updateTicket, updateTicketSchema |
| PATCH, DELETE | `/api/tickets/[id]/comments/[commentId]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`tickets`: deleteTicketComment, editTicketComment, ticketCommentSchema |
| GET, POST | `/api/tickets/[id]/detail` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: addTicketComment, ticketCommentSchema, ticketDetail |
| GET | `/api/tickets/instant` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: listInstantTickets |
| GET | `/api/tickets/mine` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: myTickets |
| PATCH, DELETE | `/api/time/[id]` | **none** (public by design) | `time-tracking`: deleteEntry, updateEntry |
| GET | `/api/time/me` | **none** (public by design) | `time-tracking`: myTimeToday |
| GET | `/api/time/report` | **none** (public by design) | `time-tracking`: timeReport |
| POST | `/api/time/stop` | **none** (public by design) | `time-tracking`: stopTimer |
| GET | `/api/users/[id]` | requireActor | `users`: getProfileForViewer |
| GET, POST | `/api/watch` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`current-space`: currentSpace<br>`watch`: listWatch, startWatch, startWatchSchema |
| GET | `/api/watch/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: watchDetail |
| POST | `/api/watch/[id]/end` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: endWatch |
| GET, POST, PATCH | `/api/watch/[id]/remote` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: handOverRemote, handOverSchema, pressRemote, pressSchema, … |
| GET, POST | `/api/workspaces` | requireUser | `workspaces`: createWorkspace<br>`access`: accessibleWorkspaceIds<br>`current-space`: currentSpace |
| GET, PATCH, DELETE | `/api/workspaces/[id]` | requireWorkspace ‡ | `workspaces`: SpaceConflictError, deleteEmptyWorkspace, readWorkspace |
| POST | `/api/workspaces/[id]/archive` | requireActor | `workspaces`: SpaceConflictError<br>`space-manage`: archiveSchema, setSpaceArchived |
| GET, POST | `/api/workspaces/[id]/delete-all` | requireActor | `workspaces`: SpaceConflictError<br>`space-delete`: deleteAllSchema, deleteSpaceWithWork, spaceContents |
| GET, POST, PATCH, DELETE | `/api/workspaces/[id]/members` | requireWorkspace | `workspaces`: SpaceConflictError, canManageHere, changeWorkspaceMembers, listWorkspaceMembers, … |
| GET, POST | `/api/workspaces/[id]/teams` | requireWorkspace | `teams`: TeamConflictError, createTeam, listTeams |
| PATCH, DELETE | `/api/workspaces/[id]/teams/[teamId]` | requireWorkspace | `teams`: TeamConflictError, deleteTeam, updateTeam |
| POST | `/api/workspaces/[id]/teams/[teamId]/members` | requireWorkspace | `teams`: setTeamMembers |
| PUT | `/api/workspaces/order` | requireActor | `space-manage`: orderSchema, reorderSpaces |
| GET | `/go` | requireActor | `current-space`: SPACE_COOKIE, spacesOf |

## 5. Routes with no guard — and why that is correct

Six of 252. Each one is a door that cannot have a session, or one that is closed.

| Route | Why it has no guard |
|---|---|
| `/api/health` | The liveness probe. Answers `{status, checks:{app,database}}` and nothing else; no data, no identity. |
| `/api/auth/login` | Sign-in itself. Rate-limited (`RateLimitedError`, `login-guard.ts`) and audited; the caller has no session yet by definition. |
| `/api/auth/register` | Asking for a NEW company. Always answers the same 202 (no address enumeration), capped per address and per server (`registration.ts`). |
| `/api/auth/register/confirm` | The one-time link e-mailed by the step above. The token in the body IS the credential. |
| `/api/integrations/n8n/inbound` | Machine door, no session: the caller proves it holds the org's secret with `x-zaki-signature` (HMAC over `timestamp.body`, 5-minute replay window) or the legacy `x-zaki-token`. Org from `x-zaki-org`. |
| `/api/organizations/[id]/join-code` | Retired: answers 410 to every method. It reads nothing and writes nothing. |

Everything else is behind a door. The middleware adds a second line in front of all of them: a write
to `/api/…` must carry an `Origin`/`Sec-Fetch-Site` this app accepts, judged on the canonical path.

## 6. Services → who calls them

`callers` counts the files that import the service (a route, a page, another service). A service with a
high count is a wide surface: changing its signature reaches all of them.

| Service | Lines | Imported by | What it owns |
|---|---|---|---|
| `integrations` | 180 | 82 | Connect/disconnect/config changes (org-level assets): the `integrations.manage` capability. |
| `current-space` | 128 | 52 | THE SPACE YOU ARE IN — the owner's decision (2026-10-25, «العزل شامل… كأني بفتح سايت جديد»): entering a space is like opening a separate site. |
| `features` | 48 | 52 | «الميزات» on the server: the company's switches (`Organization.settings.features`), read on every request. |
| `guest-guard` | 30 | 41 | Org GUESTs are external partners (for example the factory): they see only what is shared with them, never write business data, and never see prices or the staff directory. |
| `team-scope` | 149 | 25 | TEAMS INSIDE A SPACE — the one place that says which projects and tasks a person may see. |
| `org-day` | 26 | 22 | The start of the COMPANY's today — `Organization.timezone`, never the server's clock and never the browser's. |
| `tasks` | 636 | 19 | no header comment — exports `TASK_INCLUDE`, `assignedTo`, `DEFAULT_BOARD_COLUMNS`, `nextTaskNumber`, `createTask`, … |
| `cards` | 614 | 17 | «اللوحات» — the cards of a space. |
| `rewards` | 351 | 16 | «مهمة بمكافأة» — set, award, cancel; and «تثبيت» — pin. |
| `time-tracking` | 662 | 16 | «حساب وقت الشغل» — the time people log on tasks (the owner, 2026-10-30: «حساب وقت الشغل: نعم»). |
| `approval-access` | 144 | 13 | «طلبات الموافقة» — WHO MAY DO WHAT, in one place. |
| `checkins` | 588 | 13 | «التسجيل اليومي» — a short stand-up per space (the owner's approved backlog, 2026-10-31). |
| `team-skills` | 302 | 13 | «المهارات» — the company's skills checklist and each person's level in it. |
| `files` | 529 | 12 | no header comment — exports `fileLibrary`, `PENDING_PATH`, `PREVIEWABLE`, `INLINE_TEXT`, `logFile`, … |
| `access` | 76 | 11 | Workspace-level isolation — the company's master switch. |
| `n8n` | 294 | 10 | Events we allow orgs to forward to n8n — the UI shows exactly this list. |
| `owner-assistant-access` | 29 | 10 | «مساعد المالك» — WHO MAY OPEN IT, in one place. |
| `owner-board` | 781 | 10 | «لوحة المالك» — THE NUMBERS. |
| `approvals` | 739 | 9 | «طلبات الموافقة» — ask, decide, send back, resubmit, cancel, read. |
| `space-place` | 30 | 9 | WHERE A SPACE'S OWN THINGS ARE READ (the owner's decision, 2026-10-25: each space is like a separate site) — for the goals, the daily routines, the customers and the opportuniti… |
| `team-score` | 258 | 9 | «السكور» — a transparent composite per person per period, read from data that already exists. |
| `custom-fields` | 542 | 8 | «حقول مخصصة» — the custom fields of a project's tasks. |
| `google` | 355 | 8 | Only the files the app itself creates (the library's): a non-sensitive scope, so Google asks for no review and the owner's published app keeps its connection. |
| `team-plans` | 259 | 8 | «خطة التطوير» and «ملاحظات ١:١» of one person. |
| `tickets` | 501 | 8 | IT tickets live inside a department. |
| `workspaces` | 331 | 8 | Spaces (workspaces): who is in one, who may change it. |
| `accounts` | 874 | 7 | The account lifecycle: the owner (and, below him, whoever holds `users.manage`) creates, edits, suspends, reactivates and offboards people, resets passwords and ends sessions. |
| `active-people` | 71 | 7 | "Nobody who was suspended or removed still counts." A suspended or offboarded member keeps their OrganizationMember row (history, authorship), so a query that reads that table w… |
| `approval-forms` | 263 | 7 | «نموذج» — reusable forms that create approval requests. |
| `card-audit` | 36 | 7 | Every card entry of the audit log starts with this, then the `LogAction` (`card.edited`). |
| `card-guards` | 45 | 7 | The questions the page inside a card asks about its viewer, answered in one place. |
| `ideas` | 395 | 7 | Membership context resolved from the idea's own org (shared by API routes). |
| `last-seen` | 122 | 7 | «آخر ظهور» — WHO MAY SEE WHEN SOMEBODY WAS LAST AT THEIR SCREEN (the owner, 2026-10-31: «بدي كمان احط آخر ظهور للأعضاء»). |
| `owner-assistant-settings` | 169 | 7 | «مساعد المالك» — THE SETTINGS, THE KEY AND THE COUNTERS. |
| `task-recurrence` | 205 | 7 | «مهمة متكررة» — a task marked as repeating, and the one series it belongs to. |
| `team-criteria` | 109 | 7 | «معايير التقييم» — the criteria a reviewer rates 1-5: the five the owner named (جودة الشغل، الالتزام بالمواعيد، التعاون، المبادرة، التواصل), which the owner may rename, add to (… |
| `approval-input` | 79 | 6 | What a request body says about an approval: the amount as typed (`amount`: "12.5", in the major unit) or already in minor units (`amountMinor`), the currency, the chain, the thi… |
| `checkins-space` | 18 | 6 | The space a check-in request is about: the one the request names (`workspaceId`, which the guards in src/server/services/checkins.ts check against the person), or else the space… |
| `watch` | 372 | 6 | «نتفرّج سوا» — people of a space watch one link together (the owner's ask, 2026-10-26). |
| `campaigns` | 235 | 5 | Campaigns live inside a department (marketing calendars). |
| `card-attachments` | 124 | 5 | «المعرض»: a cover picture and an ordered gallery of pictures and files, with captions. |
| `owner-assistant-chat` | 298 | 5 | «مساعد المالك» — THE CONVERSATION. |
| `owner-assistant-proposals` | 398 | 5 | «مساعد المالك» — PROPOSALS: what the model SUGGESTED, and what happens ONLY when the owner presses «وافق». |
| `owner-board-io` | 74 | 5 | «لوحة المالك» — what comes in (the query string, parsed once, the same for the pages and the routes) and what goes out (the CSV of the people table: exactly the columns on the s… |
| `production` | 262 | 5 | Daily production. |
| `reminders` | 169 | 5 | «ذكّرني» — a person's reminder for THEMSELVES (never for somebody else), on a task, on a chat message, or on its own. |
| `task-steps` | 152 | 5 | «خطوات» — the short checklist inside a task. |
| `team-reviews` | 209 | 5 | «التقييمات» — what the owner and the supervisors write about a person for a period. |
| `teams` | 228 | 5 | TEAMS INSIDE A SPACE — who is in which team, and which project belongs to which (the reading rule is in team-scope.ts). |
| `telegram` | 299 | 5 | Validates a bot token by calling getMe. |
| `users` | 339 | 5 | no header comment — exports `updateProfile`, `getProfileForViewer`, `getPublicProfile`, `memberDirectory` |
| `views` | 490 | 5 | Zones already warned about, per organization, so a bad stored zone is logged once and not on every request. |
| `calendar-feed` | 331 | 4 | «اشتراك التقويم» — a person's private calendar feed. |
| `crm` | 228 | 4 | no header comment — exports `OPPORTUNITY_STAGES`, `createCustomerSchema`, `updateCustomerSchema`, `createOpportunitySchema`, `updateOpportunitySchema`, … |
| `departments` | 240 | 4 | The departments area is the company's staff directory (who works where, with which job title), so org GUESTs get 403 on every function here, read or write. |
| `okr` | 482 | 4 | «الأهداف والنتائج» — the key results of an objective (src/lib/okr.ts holds the arithmetic). |
| `reward-input` | 30 | 4 | What a request body says about a reward: the amount as the person typed it (`amount`: "12.5", in the major unit) or already in minor units (`amountMinor`), the currency (optiona… |
| `team-lines` | 149 | 4 | «الهيكل» — who answers to whom. |
| `milestones` | 173 | 3 | «المعالم» — the milestones of a project (the owner, 2026-10-30: the table, the project page's list and the timeline's diamonds all existed and nothing in the repository ever cre… |
| `owner-board-sections` | 82 | 3 | «لوحة المالك» — THE EXTENSION POINT. |
| `pinned` | 70 | 3 | «مثبّتة» — the pinned tasks a person may be shown, for the strip at the top of a project and the compact card of «اليوم». |
| `registration` | 145 | 3 | Opening a company is open to anyone (owner's decision 23/10), behind three guards: The address is checked. |
| `reward-guard` | 39 | 3 | «مهمة بمكافأة» — the guard every writer of a task goes through (tasks.ts `updateTask` / `deleteTask` / `createTask`, the reward routes). |
| `space-manage` | 61 | 3 | MANAGING THE SPACES FROM «كل المساحات» (the owner's asks, 2026-10-26): put them in order by dragging, archive one (it leaves every list — the switcher, the overview, search by s… |
| `spaces-overview` | 73 | 3 | «كل المساحات» — the owner's and the admins' one look over every space they can open (the owner's decision, 2026-10-25): each space stays a separate site, and this page only coun… |
| `task-assign` | 265 | 3 | GIVING A TASK BY RANK (the owner's decision, 2026-10-30; the pure rule is `policy/assign-rank.ts`). |
| `team-score-io` | 28 | 3 | `?kind=` as a period kind (anything else: the month). |
| `avatars` | 118 | 2 | A PERSON'S PICTURE (the owner's ask, 2026-10-29: «خيار إن المستخدم يحط صورة بروفايل»). |
| `card-notes` | 113 | 2 | «الملاحظات» (the card's thread). |
| `card-page` | 47 | 2 | The page inside a card, as ONE read: the card, what the viewer may do on it, the stars, the gallery. |
| `card-ratings` | 58 | 2 | «التقييم» (the first of the two systems): stars 1 to 5 from the people of the space, one per person per card, changeable. |
| `card-revisions` | 91 | 2 | «الإصدارات»: the snapshots every saved edit left behind (written by `saveCardEdit`, never changed or removed: the table refuses an UPDATE). |
| `goals` | 307 | 2 | no header comment — exports `periodWindow`, `goalSchema`, `goalStatus`, `listGoals`, `createGoal`, … |
| `member-rules` | 184 | 2 | The rank rules of account management, in ONE place, as pure functions with no database and no server-only import — so the members screen can offer exactly what the server allows… |
| `move-to-space` | 106 | 2 | «انقل لمساحة» (the plan, 2026-10-25: each space is like a separate site). |
| `nav-order` | 73 | 2 | «ترتيبي» — the person's own order of the menu, kept on the account (`User.navOrder`, one nullable JSON column). |
| `onboarding` | 88 | 2 | The one-time onboarding every account goes through (the owner creates accounts with a temporary password and nobody has accepted the transparency notice yet): choose your own pa… |
| `org-members` | 202 | 2 | Organization members: the rank rules of account management and the roster. |
| `orgs` | 154 | 2 | no header comment — exports `JOIN_CODE_ALPHABET`, `generateJoinCode`, `registrationOpen`, `registerOrganization`, `canManageOrg` |
| `owner-assistant-names` | 84 | 2 | «مساعد المالك» — PUTTING THE REAL NAMES BACK, for the owner's eyes only. |
| `task-links` | 170 | 2 | «التبعيات» — the links between two tasks (the owner, 2026-10-30: the table existed and nothing wrote it). |
| `team-people` | 115 | 2 | «الأداء والتطوير» — the front door: the people the viewer reads, and the header of one person's file. |
| `timeline` | 76 | 2 | Microsoft-Project-style timeline data for one project: dated tasks become bars, milestones become diamonds, undated tasks are reported separately. |
| `analytics` | 66 | 1 | Numbers behind the analytics page. |
| `calendar` | 62 | 1 | The calendar's data logic, taken out of the page so it can be tested with an injected `now`. |
| `card-links` | 64 | 1 | What the card was turned into: the tasks made from it («حوّلها لمهمة») and the topic it was sent to («أرسل»). |
| `card-log` | 89 | 1 | «السجل»: a read-only timeline made of the AuditLog rows written about this card. |
| `card-status` | 32 | 1 | «حالة الاعتماد» (the second of the two systems): مسودة → قيد المراجعة → معتمدة → مؤرشفة, set by a moderator of the space or the OWNER. |
| `credentials` | 64 | 1 | Account credentials as pure functions (no database): what a username may look like, the password policy, and the temporary passwords the owner hands to a new or reset account. |
| `department-space` | 93 | 1 | EVERY DEPARTMENT HAS ITS SPACE (the owner's decision, 2026-10-25: each space is like a separate site). |
| `first-steps` | 100 | 1 | The first-steps card («خطواتك الأولى») computed from REAL data for the signed-in actor: nothing is stored about "progress" - a step is done because the rows say so (a theme chos… |
| `instant-work` | 131 | 1 | «مهمة فورية» (the owner's ask, 2026-10-27: «+ بالمهام ومهمة فورية لشخص محدد مع أولوية»): a task typed in one go — a title, the person, the priority, a day — with no project to p… |
| `my-work` | 168 | 1 | The company's zone as the person's My Work page reads it: the first company they are an ACTIVE member of. |
| `owner-assistant-data` | 120 | 1 | «مساعد المالك» — WHAT THE MODEL MAY LEARN FROM, as raw material for `buildContext` (src/server/ai/redact.ts). |
| `presence-roster` | 96 | 1 | THE PEOPLE DOCK — who works here and who is at their screen right now (the owner's ask, 2026-10-29: «المستخدمين ظاهرين على زاوية الموقع تحت وكل واحد جنبه علامة خضراء أونلاين»). |
| `recurrence-spawn` | 218 | 1 | «مهمة متكررة» — how ONE occurrence of a series is born, shared by the job runner (mode «حسب الجدول») and by the completion path (mode «عند الإنجاز»), so there is exactly one way… |
| `space-delete` | 93 | 1 | DELETING A SPACE WITH ALL ITS WORK (the owner's decision, 2026-10-26: «كلها مع شغلها»). |
| `team-score-sections` | 40 | 1 | «السكور» — THE EXTENSION POINT. |
| `today` | 298 | 1 | «اليوم» — everything the Today page shows, in one call (`getToday(actor)`), so the page decides nothing. |
| `today-dashboard` | 113 | 1 | The smart cards of «اليوم» — a few numbers, each over what the person may already see. |
| `approval-notify` | 65 | 0 | The bell of «طلبات الموافقة». |

## 7. Models → who writes them

Only `.create`, `.update`, `.upsert` and `.delete` are counted — that is the code that changes a row.
A model written from more than one place is listed with all of them: those are the places a new rule has
to be added to, and the places a bug can leave the row half-written.

| Model | Writes | Written by (file: calls) |
|---|---|---|
| `User` | 14 | `server/services/accounts.ts`: 3<br>`server/services/avatars.ts`: 2<br>`server/services/nav-order.ts`: 2<br>`server/services/onboarding.ts`: 2<br>+5 more |
| `Department` | 4 | `server/services/departments.ts`: 3<br>`server/services/accounts.ts`: 1 |
| `Ticket` | 6 | `server/services/tickets.ts`: 4<br>`server/chat/make-work.ts`: 1<br>`server/services/accounts.ts`: 1 |
| `TicketComment` | 3 | `server/services/tickets.ts`: 3 |
| `TicketActivity` | 7 | `server/services/tickets.ts`: 6<br>`server/services/accounts.ts`: 1 |
| `Campaign` | 4 | `server/services/campaigns.ts`: 3<br>`server/services/accounts.ts`: 1 |
| `CampaignItem` | 3 | `server/services/campaigns.ts`: 3 |
| `Routine` | 6 | `server/services/production.ts`: 3<br>`server/services/accounts.ts`: 1<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `RoutineLog` | 2 | `server/services/production.ts`: 2 |
| `Goal` | 6 | `server/services/goals.ts`: 3<br>`server/services/move-to-space.ts`: 1<br>`server/services/okr.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `DepartmentMember` | 3 | `server/services/departments.ts`: 2<br>`server/services/accounts.ts`: 1 |
| `StoredFile` | 11 | `server/services/files.ts`: 7<br>`server/chat/attachments.ts`: 1<br>`server/chat/purge.ts`: 1<br>`server/services/move-to-space.ts`: 1<br>+1 more |
| `Conversation` | 17 | `server/chat/topics.ts`: 6<br>`server/chat/dm.ts`: 3<br>`server/chat/messages.ts`: 2<br>`server/chat/hq.ts`: 1<br>+5 more |
| `ConversationMember` | 18 | `server/chat/topics.ts`: 6<br>`server/chat/dm.ts`: 4<br>`server/chat/messages.ts`: 3<br>`server/services/workspaces.ts`: 2<br>+3 more |
| `ChatMessage` | 6 | `server/chat/messages.ts`: 5<br>`server/chat/system.ts`: 1 |
| `ChatReaction` | 2 | `server/chat/messages.ts`: 2 |
| `Poll` | 2 | `components/chat/composer/poll-dialog.tsx`: 1<br>`server/chat/polls.ts`: 1 |
| `PollVote` | 2 | `server/chat/polls.ts`: 2 |
| `UserChatOrder` | 3 | `server/chat/order.ts`: 3 |
| `MessageRevision` | 1 | `server/chat/messages.ts`: 1 |
| `MessageNote` | 1 | `server/chat/messages.ts`: 1 |
| `MessageAttachment` | 2 | `server/chat/attachments.ts`: 1<br>`server/chat/messages.ts`: 1 |
| `RealtimeEvent` | 1 | `server/realtime/emit.ts`: 1 |
| `Whiteboard` | 2 | `server/chat/whiteboard.ts`: 2 |
| `Call` | 4 | `server/calls/calls.ts`: 4 |
| `CallPerson` | 4 | `server/calls/calls.ts`: 4 |
| `PushSubscription` | 4 | `server/calls/push.ts`: 4 |
| `WatchSession` | 4 | `server/services/watch.ts`: 4 |
| `Organization` | 5 | `server/services/google.ts`: 2<br>`app/api/organizations/[id]/route.ts`: 1<br>`server/services/features.ts`: 1<br>`server/services/team-score.ts`: 1 |
| `OrganizationMember` | 6 | `server/services/accounts.ts`: 4<br>`server/services/last-seen.ts`: 1<br>`server/services/team-lines.ts`: 1 |
| `Workspace` | 9 | `server/services/department-space.ts`: 2<br>`server/services/space-manage.ts`: 2<br>`server/services/workspaces.ts`: 2<br>`app/api/workspaces/[id]/route.ts`: 1<br>+2 more |
| `WorkspaceMember` | 17 | `server/services/accounts.ts`: 6<br>`server/services/workspaces.ts`: 5<br>`server/services/department-space.ts`: 3<br>`server/chat/hq.ts`: 2<br>+1 more |
| `Team` | 8 | `server/services/teams.ts`: 4<br>`server/services/accounts.ts`: 3<br>`server/services/workspaces.ts`: 1 |
| `TeamMember` | 6 | `server/services/teams.ts`: 3<br>`server/services/accounts.ts`: 1<br>`server/services/department-space.ts`: 1<br>`server/services/workspaces.ts`: 1 |
| `Project` | 7 | `server/services/accounts.ts`: 2<br>`app/api/projects/[id]/route.ts`: 1<br>`app/api/projects/route.ts`: 1<br>`server/services/instant-work.ts`: 1<br>+2 more |
| `Milestone` | 5 | `server/services/milestones.ts`: 3<br>`server/services/accounts.ts`: 2 |
| `Board` | 3 | `app/api/boards/[id]/route.ts`: 1<br>`app/api/boards/route.ts`: 1<br>`server/services/instant-work.ts`: 1 |
| `BoardColumn` | 4 | `app/api/boards/[id]/columns/[columnId]/route.ts`: 2<br>`app/api/boards/[id]/columns/route.ts`: 1<br>`app/api/boards/[id]/route.ts`: 1 |
| `TaskCounter` | 1 | `server/services/tasks.ts`: 1 |
| `Task` | 16 | `server/services/tasks.ts`: 5<br>`server/services/rewards.ts`: 4<br>`server/chat/make-work.ts`: 1<br>`server/services/accounts.ts`: 1<br>+5 more |
| `TaskRecurrence` | 7 | `server/services/task-recurrence.ts`: 3<br>`server/jobs/recurrence.ts`: 2<br>`server/services/recurrence-spawn.ts`: 2 |
| `TaskStep` | 6 | `server/services/task-steps.ts`: 5<br>`server/services/recurrence-spawn.ts`: 1 |
| `Reminder` | 5 | `server/services/reminders.ts`: 3<br>`server/jobs/reminders.ts`: 2 |
| `TimeEntry` | 5 | `server/services/time-tracking.ts`: 5 |
| `CalendarFeedToken` | 3 | `server/services/calendar-feed.ts`: 3 |
| `TaskAssignRequest` | 2 | `server/services/task-assign.ts`: 2 |
| `TaskCoAssignee` | 4 | `server/services/task-assign.ts`: 2<br>`server/services/accounts.ts`: 1<br>`server/services/teams.ts`: 1 |
| `Label` | 1 | `app/api/labels/route.ts`: 1 |
| `TaskDependency` | 2 | `server/services/task-links.ts`: 2 |
| `TaskComment` | 3 | `app/api/tasks/[id]/comments/[commentId]/route.ts`: 2<br>`app/api/tasks/[id]/comments/route.ts`: 1 |
| `TaskActivity` | 10 | `server/services/tasks.ts`: 4<br>`server/services/task-assign.ts`: 3<br>`app/api/tasks/[id]/comments/route.ts`: 1<br>`server/activity.ts`: 1<br>+1 more |
| `Notification` | 8 | `server/notify.ts`: 3<br>`app/api/notifications/[id]/route.ts`: 1<br>`app/api/notifications/read/route.ts`: 1<br>`server/chat/notify.ts`: 1<br>+2 more |
| `AuditLog` | 32 | `server/services/teams.ts`: 5<br>`server/services/approvals.ts`: 4<br>`server/services/rewards.ts`: 4<br>`server/services/approval-forms.ts`: 3<br>+11 more |
| `Idea` | 7 | `server/services/ideas.ts`: 5<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `IdeaVote` | 2 | `server/services/ideas.ts`: 2 |
| `Integration` | 4 | `server/services/integrations.ts`: 2<br>`server/services/google.ts`: 1<br>`server/services/telegram.ts`: 1 |
| `TelegramChat` | 1 | `server/services/telegram.ts`: 1 |
| `TelegramMessage` | 3 | `server/services/telegram.ts`: 3 |
| `IntegrationEvent` | 1 | `server/services/integrations.ts`: 1 |
| `Customer` | 5 | `server/services/crm.ts`: 3<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `Opportunity` | 7 | `server/services/crm.ts`: 3<br>`server/services/move-to-space.ts`: 2<br>`server/services/accounts.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `PendingRegistration` | 4 | `server/services/registration.ts`: 4 |
| `Card` | 8 | `server/services/cards.ts`: 6<br>`server/services/card-attachments.ts`: 1<br>`server/services/card-status.ts`: 1 |
| `CardRevision` | 1 | `server/services/cards.ts`: 1 |
| `CardNote` | 3 | `server/services/card-notes.ts`: 3 |
| `CardRating` | 1 | `server/services/card-ratings.ts`: 1 |
| `CardAttachment` | 4 | `server/services/card-attachments.ts`: 4 |
| `AiSettings` | 3 | `server/services/owner-assistant-settings.ts`: 3 |
| `AiUsage` | 1 | `server/services/owner-assistant-settings.ts`: 1 |
| `AiConversation` | 3 | `server/services/owner-assistant-chat.ts`: 3 |
| `AiMessage` | 2 | `server/services/owner-assistant-chat.ts`: 2 |
| `AiProposal` | 8 | `server/services/owner-assistant-proposals.ts`: 8 |
| `ProjectField` | 3 | `server/services/custom-fields.ts`: 3 |
| `TaskFieldValue` | 2 | `server/services/custom-fields.ts`: 2 |
| `CheckinConfig` | 1 | `server/services/checkins.ts`: 1 |
| `CheckinAnswer` | 5 | `server/services/checkins.ts`: 5 |
| `ApprovalRequest` | 4 | `server/services/approvals.ts`: 4 |
| `ApprovalStep` | 6 | `server/services/approvals.ts`: 6 |
| `ApprovalAttachment` | 2 | `server/services/approvals.ts`: 2 |
| `FormTemplate` | 4 | `server/services/approval-forms.ts`: 4 |
| `Skill` | 2 | `server/services/team-skills.ts`: 2 |
| `PersonSkill` | 2 | `server/services/team-skills.ts`: 2 |
| `PersonSkillHistory` | 1 | `server/services/team-skills.ts`: 1 |
| `ReviewCriterion` | 3 | `server/services/team-criteria.ts`: 3 |
| `Review` | 4 | `server/services/team-reviews.ts`: 4 |
| `DevGoal` | 4 | `server/services/team-plans.ts`: 4 |
| `ReviewNote` | 2 | `server/services/team-plans.ts`: 2 |
| `KeyResult` | 4 | `server/services/okr.ts`: 4 |
| `KeyResultTask` | 3 | `server/services/okr.ts`: 3 |
| `KeyResultUpdate` | 1 | `server/services/okr.ts`: 1 |

`PollOption` has no direct write of its own: it is filled only through a nested write on `Poll.options` in `server/chat/poll-shared.ts` — counted here so a change there is read as a change here.
`TaskLabel` has no direct write of its own: it is filled only through a nested write on `Task.labels` in `server/services/tasks.ts` — counted here so a change there is read as a change here.
⚠️ **Nothing writes `CheckinRound` — not a route, not a service, not the seed, not a nested write.** The table was created by the first migration and has never held a row: a feature that was not built. 🔧 Keep the table (additive-only) and either build the feature or stop selecting it in Phase E.

## 8. Feature switches → where they are read

The owner's rule: every new feature sits behind its own switch, and off means the site is as it was
before it. A switch is only honest if something reads it, so this is the list of readers.

| Switch | Places that read it |
|---|---|
| `watch` | 12 — `app/(app)/watch/[id]/page.tsx`, `app/(app)/watch/page.tsx`, `app/api/watch/[id]/end/route.ts`, `app/api/watch/[id]/remote/route.ts`, `app/api/watch/[id]/route.ts`, `app/api/watch/route.ts`, `components/watch/watch-home.tsx`, `lib/guide/page-help.ts`, `lib/nav/new-actions.ts`, `lib/nav/places.ts`, `lib/watch/source.ts`, `server/policy/capabilities.ts` |
| `sectionPermissions` | 1 — `server/policy/section-grid.ts` |
| `libraryDrive` | 1 — `server/services/google.ts` |
| `pushEverything` | 1 — `server/notify.ts` |
| `chatRowMenu` | 2 — `server/chat/home.ts`, `server/chat/purge.ts` |
| `callNoiseFilter` | 1 — `server/calls/calls.ts` |
| `instantWork` | 3 — `app/api/instant/route.ts`, `app/api/instant/ticket/route.ts`, `server/services/instant-work.ts` |
| `avatars` | 2 — `app/(app)/profile/page.tsx`, `app/api/me/avatar/route.ts` |
| `peopleDock` | 1 — `app/api/presence/route.ts` |
| `chatBubbles` | 1 — `server/chat/topics.ts` |
| `taskLinks` | 3 — `app/(app)/tasks/[id]/page.tsx`, `app/api/tasks/[id]/links/[linkId]/route.ts`, `app/api/tasks/[id]/links/route.ts` |
| `milestones` | 6 — `app/(app)/projects/[id]/page.tsx`, `app/(app)/tasks/[id]/page.tsx`, `app/api/milestones/[id]/route.ts`, `app/api/projects/[id]/milestones/route.ts`, `server/services/calendar-feed.ts`, `server/services/milestones.ts` |
| `ownerHiddenOnline` | 4 — `app/api/presence/route.ts`, `server/chat/directory.ts`, `server/chat/topics.ts`, `server/services/last-seen.ts` |
| `quickChat` | 0 —  |
| `taskSteps` | 4 — `app/(app)/boards/[id]/page.tsx`, `app/(app)/list/page.tsx`, `app/(app)/tasks/[id]/page.tsx`, `server/services/task-steps.ts` |
| `reminders` | 6 — `app/(app)/page.tsx`, `app/(app)/tasks/[id]/page.tsx`, `server/chat/topics.ts`, `server/jobs/run.ts`, `server/services/calendar-feed.ts`, `server/services/reminders.ts` |
| `timeTracking` | 5 — `app/(app)/page.tsx`, `app/(app)/tasks/[id]/page.tsx`, `app/(app)/time/page.tsx`, `server/services/team-score-sections.ts`, `server/services/time-tracking.ts` |
| `recurringTasks` | 4 — `app/(app)/boards/[id]/page.tsx`, `app/(app)/list/page.tsx`, `app/(app)/tasks/[id]/page.tsx`, `server/services/task-recurrence.ts` |
| `calendarFeed` | 2 — `app/(app)/calendar/page.tsx`, `server/services/calendar-feed.ts` |
| `ownerBoard` | 2 — `lib/nav/places.ts`, `server/policy/board.ts` |
| `taskRewards` | 4 — `app/api/instant/route.ts`, `server/services/my-work.ts`, `server/services/reward-guard.ts`, `server/services/rewards.ts` |
| `ownerAssistant` | 2 — `lib/nav/places.ts`, `server/services/owner-assistant-access.ts` |
| `chatOutbox` | 1 — `server/chat/topics.ts` |
| `customFields` | 2 — `app/(app)/projects/[id]/page.tsx`, `server/services/custom-fields.ts` |
| `checkins` | 6 — `app/(app)/checkins/page.tsx`, `app/(app)/page.tsx`, `lib/guide/page-help.ts`, `lib/nav/places.ts`, `server/jobs/run.ts`, `server/services/checkins.ts` |
| `lastSeen` | 4 — `app/(app)/profile/page.tsx`, `app/api/me/last-seen/route.ts`, `server/realtime/presence.ts`, `server/services/last-seen.ts` |
| `approvals` | 6 — `app/(app)/approvals/[id]/page.tsx`, `app/(app)/approvals/forms/page.tsx`, `app/(app)/approvals/page.tsx`, `lib/guide/page-help.ts`, `lib/nav/places.ts`, `server/services/approval-access.ts` |
| `teamDevelopment` | 4 — `app/(app)/owner/page.tsx`, `lib/nav/places.ts`, `server/policy/team-development.ts`, `server/services/team-score.ts` |
| `okr` | 3 — `app/api/goals/route.ts`, `server/services/goals.ts`, `server/services/okr.ts` |

## 9. What this map noticed

Written down, not fixed: Phase E decides what becomes a PR. Every item was read in the code, not guessed.

- **Every guarded route asks a guard — none compares a role name.** 246 of 252 routes open with a function from §3; the other 6 are the doors listed in §5.
- **Two doors carry most of the traffic.** `activeOrgCtx()` and `requireActor()` are the first call of 166 routes; both re-read the membership and its status from the database on every request, so a suspension takes effect on the next call, not on the next sign-in.
- **16 route handlers write to the database themselves instead of calling a service.** 10 of them write their own `audit()` row (`/api/auth/login`, `/api/boards`, `/api/boards/[id]`, `/api/boards/[id]/columns`, `/api/boards/[id]/columns/[columnId]`, `/api/labels`, `/api/organizations/[id]`, `/api/projects`, `/api/projects/[id]`, `/api/workspaces/[id]`); 2 write a task-feed row instead (`/api/tasks/[id]/comments`, `/api/tasks/[id]/comments/[commentId]`); 4 write neither (`/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read`); 4 of those are one person's own preference (`/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read`), which is right. Nothing is silently lost today, but *who may, what is logged and what is notified* lives in the handler, not in one place. No screen file writes directly: every write comes through `/api`.
- **16 models are written from more than three files** — see §7 for the list. Those are where a new invariant has to be added more than once, and where a half-written row is possible if one caller forgets a field.

