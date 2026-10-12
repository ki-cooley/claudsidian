/** Public surface of the sessions screen for the shell (Task B3). */
export { SessionsScreen, claudeCodeUrl, matchesFilter, type SessionsScreenProps } from './SessionsScreen';
export {
  NewSessionSheet,
  pickDefaultEnvironment,
  environmentOptionLabel,
  environmentOptions,
  isVaultEnvironment,
  HOST_DOC_URL,
  type NewSessionSheetProps,
} from './NewSessionSheet';
export { SignedOutCard } from './SignedOutCard';
export { EmptyState } from './EmptyState';
export { SessionGroup } from './SessionGroup';
export { SessionRow, rowRenderKey, sameRowProps, type SessionRowProps } from './SessionRow';
export { StatusDot } from './StatusDot';
export { groupSessions, isUnderPath, GROUP_TITLES, type EnvironmentHint, type SessionGroupData } from './grouping';
export {
  statusOf,
  summaryLine,
  needsYouText,
  pendingText,
  isQuiet,
  quietLast,
  shortenPaths,
  MACHINE_TITLE_RE,
  STATUS_LABEL,
  type SessionStatus,
} from './status';
