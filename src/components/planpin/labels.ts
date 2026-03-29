import type { IssueCategory, IssuePriority, IssueStatus } from './types';

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
	design: 'ontwerp',
	technical: 'technisch',
	site: 'werf',
	coordination: 'coordinatie',
	safety: 'veiligheid',
	other: 'overig',
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
	open: 'open',
	'in progress': 'in behandeling',
	resolved: 'opgelost',
};

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
	low: 'laag',
	medium: 'middel',
	high: 'hoog',
};

export function getIssueCategoryLabel(category: IssueCategory): string {
	return ISSUE_CATEGORY_LABELS[category];
}

export function getIssueStatusLabel(status: IssueStatus): string {
	return ISSUE_STATUS_LABELS[status];
}

export function getIssuePriorityLabel(priority: IssuePriority): string {
	return ISSUE_PRIORITY_LABELS[priority];
}
