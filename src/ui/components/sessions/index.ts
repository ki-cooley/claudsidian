/** Public surface of the sessions screen for the shell (Task B3). */
export { SessionsScreen, claudeCodeUrl, type SessionsScreenProps } from './SessionsScreen';
export { NewSessionSheet, pickDefaultEnvironment, HOST_DOC_URL, type NewSessionSheetProps } from './NewSessionSheet';
export { SignedOutCard } from './SignedOutCard';
export { EmptyState } from './EmptyState';
export { SessionGroup } from './SessionGroup';
export { SessionRow } from './SessionRow';
export { StatusDot } from './StatusDot';
export { groupSessions, isUnderPath, GROUP_TITLES, type EnvironmentHint, type SessionGroupData } from './grouping';
export { statusOf, summaryLine, STATUS_LABEL, type SessionStatus } from './status';
