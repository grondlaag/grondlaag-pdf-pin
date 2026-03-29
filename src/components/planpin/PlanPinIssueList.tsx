import { useState } from 'react';
import {
	getIssueCategoryLabel,
	getIssuePriorityLabel,
	getIssueStatusLabel,
} from './labels';
import { getMarkerCommentPreview, getMarkerDisplayTitle } from './markers';
import {
	ISSUE_CATEGORY_OPTIONS,
	ISSUE_STATUS_OPTIONS,
	type IssueCategory,
	type IssueMarker,
	type IssueStatus,
} from './types';

interface PlanPinIssueListProps {
	markers: IssueMarker[];
	issueNumbers: Record<string, number>;
	totalMarkers: number;
	totalPages: number;
	currentPage: number;
	pageFilter: 'all' | 'current' | number;
	onPageFilterChange: (pageFilter: 'all' | 'current' | number) => void;
	categoryFilter: 'all' | IssueCategory;
	onCategoryFilterChange: (categoryFilter: 'all' | IssueCategory) => void;
	statusFilter: 'all' | IssueStatus;
	onStatusFilterChange: (statusFilter: 'all' | IssueStatus) => void;
	sortOrder: 'page' | 'newest' | 'oldest';
	onSortOrderChange: (sortOrder: 'page' | 'newest' | 'oldest') => void;
	selectedMarkerId: string | null;
	onIssueOpen: (markerId: string) => void;
	onIssueFocus: (markerId: string) => void;
	onIssueDelete: (markerId: string) => void;
}

function renderFilterGroup<T extends string | number>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: Array<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="planpin-app__issue-filter-group">
			<span className="planpin-app__issue-filter-label">{label}</span>
			<div className="planpin-app__issue-filter-options">
				{options.map((option) => {
					const isActive = option.value === value;

					return (
						<button
							key={String(option.value)}
							type="button"
							className={`planpin-app__issue-filter-option${isActive ? ' is-active' : ''}`}
							onClick={() => onChange(option.value)}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export default function PlanPinIssueList({
	markers,
	issueNumbers,
	totalMarkers,
	totalPages,
	currentPage,
	pageFilter,
	onPageFilterChange,
	categoryFilter,
	onCategoryFilterChange,
	statusFilter,
	onStatusFilterChange,
	sortOrder,
	onSortOrderChange,
	selectedMarkerId,
	onIssueOpen,
	onIssueFocus,
	onIssueDelete,
}: PlanPinIssueListProps) {
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const pageFilterOptions: Array<{ value: 'all' | 'current' | number; label: string }> = [
		{ value: 'all', label: 'alle pagina’s' },
		{ value: 'current', label: 'huidige pagina' },
		...Array.from({ length: totalPages }, (_, index) => ({
			value: index + 1,
			label: `pagina ${index + 1}`,
		})),
	];
	const sortOptions: Array<{ value: 'page' | 'newest' | 'oldest'; label: string }> = [
		{ value: 'page', label: 'paginavolgorde' },
		{ value: 'newest', label: 'nieuwste eerst' },
		{ value: 'oldest', label: 'oudste eerst' },
	];
	const categoryOptions: Array<{ value: 'all' | IssueCategory; label: string }> = [
		{ value: 'all', label: 'alle categorieën' },
		...ISSUE_CATEGORY_OPTIONS.map((category) => ({
			value: category,
			label: getIssueCategoryLabel(category),
		})),
	];
	const statusOptions: Array<{ value: 'all' | IssueStatus; label: string }> = [
		{ value: 'all', label: 'alle statussen' },
		...ISSUE_STATUS_OPTIONS.map((status) => ({
			value: status,
			label: getIssueStatusLabel(status),
		})),
	];

	const filterGroups = (
		<div className="planpin-app__issue-toolbar planpin-app__issue-toolbar--expanded">
			{renderFilterGroup({
				label: 'toon',
				options: pageFilterOptions,
				value: pageFilter,
				onChange: onPageFilterChange,
			})}
			{renderFilterGroup({
				label: 'sorteer',
				options: sortOptions,
				value: sortOrder,
				onChange: onSortOrderChange,
			})}
			{renderFilterGroup({
				label: 'categorie',
				options: categoryOptions,
				value: categoryFilter,
				onChange: onCategoryFilterChange,
			})}
			{renderFilterGroup({
				label: 'status',
				options: statusOptions,
				value: statusFilter,
				onChange: onStatusFilterChange,
			})}
		</div>
	);

	if (markers.length === 0) {
		return (
			<div className="planpin-app__panel">
				<div className="planpin-app__panel-header">
					<p className="planpin-app__label">opmerkingen</p>
					<p className="planpin-app__coords">{totalMarkers} totaal</p>
				</div>
				<div className="planpin-app__issue-toolbar">
					<button
						type="button"
						className={`planpin-app__issue-filter-toggle${isFilterOpen ? ' is-active' : ''}`}
						onClick={() => setIsFilterOpen((value) => !value)}
					>
						{isFilterOpen ? 'verberg filters' : 'filters'}
					</button>
				</div>
				{isFilterOpen ? filterGroups : null}
				<div className="planpin-app__empty-sidebar">
					<p>Nog geen opmerkingen.</p>
					<p>Klik op de PDF-overlay om de eerste markering te maken.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="planpin-app__panel">
			<div className="planpin-app__panel-header">
				<p className="planpin-app__label">opmerkingen</p>
				<p className="planpin-app__coords">
					{markers.length} zichtbaar / {totalMarkers} totaal
				</p>
			</div>
			<div className="planpin-app__issue-toolbar">
				<button
					type="button"
					className={`planpin-app__issue-filter-toggle${isFilterOpen ? ' is-active' : ''}`}
					onClick={() => setIsFilterOpen((value) => !value)}
				>
					{isFilterOpen ? 'verberg filters' : 'filters'}
				</button>
			</div>
			{isFilterOpen ? filterGroups : null}
			<div className="planpin-app__issue-list planpin-app__issue-list--scrollable">
				{markers.map((marker) => {
					const isSelected = marker.id === selectedMarkerId;
					const commentPreview = getMarkerCommentPreview(marker.comment);
					const issueNumber = issueNumbers[marker.id] ?? 0;
					const displayTitle = getMarkerDisplayTitle(marker, issueNumber);

					return (
						<div
							key={marker.id}
							className={`planpin-app__issue-item${isSelected ? ' is-selected' : ''}`}
						>
							<button
								type="button"
								className="planpin-app__issue-open"
								onClick={() => onIssueOpen(marker.id)}
							>
								<div className="planpin-app__issue-row">
									<p className="planpin-app__issue-id">opmerking {issueNumber}</p>
									<p className="planpin-app__issue-page">pagina {marker.pageNumber}</p>
								</div>
								<h3 className="planpin-app__issue-title">{displayTitle}</h3>
								<div className="planpin-app__issue-row">
									<p className="planpin-app__issue-meta">
										{getIssueCategoryLabel(marker.category)} / {getIssueStatusLabel(marker.status)} / {getIssuePriorityLabel(marker.priority)}
									</p>
									{marker.reference ? (
										<p className="planpin-app__issue-meta">ref. {marker.reference}</p>
									) : null}
								</div>
								<div className="planpin-app__issue-row">
									<p className="planpin-app__issue-meta">
										{marker.images.length} afbeelding{marker.images.length === 1 ? '' : 'en'}
									</p>
									{commentPreview ? (
										<p className="planpin-app__issue-meta">{commentPreview}</p>
									) : (
										<p className="planpin-app__issue-meta">Nog geen commentaar.</p>
									)}
								</div>
							</button>
							<div className="planpin-app__issue-actions">
								<button
									type="button"
									className="planpin-app__button planpin-app__button--secondary planpin-app__issue-action"
									onClick={() => onIssueFocus(marker.id)}
								>
									ga naar
								</button>
								<button
									type="button"
									className="planpin-app__button planpin-app__button--secondary planpin-app__issue-delete"
									onClick={() => onIssueDelete(marker.id)}
								>
									verwijder
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
