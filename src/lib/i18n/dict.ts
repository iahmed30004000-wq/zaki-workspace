import base from "./ar.json";
import accounts from "./ar.accounts.json";
import policy from "./ar.policy.json";
import onboarding from "./ar.onboarding.json";
import members from "./ar.members.json";
import spaces from "./ar.spaces.json";
import access from "./ar.access.json";
import theme from "./ar.theme.json";
import ui from "./ar.ui.json";
import guide from "./ar.guide.json";
import enums from "./ar.enums.json";
import shell from "./ar.shell.json";
import today from "./ar.today.json";
import errors from "./ar.errors.json";
import chatErrors from "./ar.chat-errors.json";
import chatFiles from "./ar.chat-files.json";
import chatConversation from "./ar.chat-conversation.json";
import chatHome from "./ar.chat-home.json";
import chatOrder from "./ar.chat-order.json";
import archive from "./ar.archive.json";
import whiteboard from "./ar.whiteboard.json";
import calls from "./ar.calls.json";
import watch from "./ar.watch.json";
import features from "./ar.features.json";
import libraryDrive from "./ar.library-drive.json";
import instant from "./ar.instant.json";
import taskLinks from "./ar.task-links.json";
import milestones from "./ar.milestones.json";
import profileCard from "./ar.profile-card.json";
import cards from "./ar.cards.json";
import cardPage from "./ar.card-page.json";
import navOrder from "./ar.nav-order.json";
import taskRequests from "./ar.task-requests.json";
import quickChat from "./ar.quick-chat.json";
import reminders from "./ar.reminders.json";
import taskSteps from "./ar.task-steps.json";
import timeTracking from "./ar.time-tracking.json";
import recurring from "./ar.recurring.json";
import cardsNav from "./ar.cards-nav.json";
import taskRewards from "./ar.task-rewards.json";
import calendarFeed from "./ar.calendar-feed.json";
import ownerBoard from "./ar.owner-board.json";
import ownerAssistant from "./ar.owner-assistant.json";
import chatAssistant from "./ar.chat-assistant.json";
import customFields from "./ar.custom-fields.json";
import outbox from "./ar.outbox.json";
import checkins from "./ar.checkins.json";
import lastSeen from "./ar.last-seen.json";
import approvals from "./ar.approvals.json";
import taskRules from "./ar.task-rules.json";
import teamDevelopment from "./ar.team-development.json";
import documents from "./ar.documents.json";
import okr from "./ar.okr.json";
import apiDoor from "./ar.api-door.json";
import spaceLibrary from "./ar.space-library.json";
import manufacturing from "./ar.manufacturing.json";
import backup from "./ar.backup.json";

/**
 * The Arabic dictionary: `ar.json` plus one fragment per feature (accounts, policy, onboarding,
 * members, spaces, access, theme, ui, guide, enums, shell, today, errors, ...). Fragments exist so that
 * several people can add strings at the same time without editing the same 700-line file; a later
 * fragment wins on a duplicate key (tests/encoding-hygiene fails on duplicates across files, so
 * none are expected).
 */
export const AR: Record<string, string> = {
  ...base,
  ...accounts,
  ...policy,
  ...onboarding,
  ...members,
  ...spaces,
  ...access,
  ...theme,
  ...ui,
  ...guide,
  ...enums,
  ...shell,
  ...today,
  ...errors,
  ...chatErrors,
  ...chatFiles,
  ...chatConversation,
  ...chatHome,
  ...chatOrder,
  ...archive,
  ...whiteboard,
  ...calls,
  ...watch,
  ...features,
  ...libraryDrive,
  ...instant,
  ...taskLinks,
  ...milestones,
  ...profileCard,
  ...cards,
  ...cardPage,
  ...navOrder,
  ...taskRequests,
  ...quickChat,
  ...reminders,
  ...taskSteps,
  ...timeTracking,
  ...recurring,
  ...cardsNav,
  ...taskRewards,
  ...calendarFeed,
  ...ownerBoard,
  ...ownerAssistant,
  ...chatAssistant,
  ...customFields,
  ...outbox,
  ...checkins,
  ...lastSeen,
  ...approvals,
  ...taskRules,
  ...teamDevelopment,
  ...documents,
  ...okr,
  ...apiDoor,
  ...spaceLibrary,
  ...manufacturing,
  ...backup,
};
