import {
	useEffect,
	useId,
	useRef,
	useState,
	type ChangeEvent,
	type DragEvent,
	type FormEvent,
} from 'react';
import { createMarkerImages, revokeMarkerImages } from './markers';
import {
	getIssueCategoryLabel,
	getIssuePriorityLabel,
	getIssueStatusLabel,
} from './labels';
import {
	ISSUE_CATEGORY_OPTIONS,
	ISSUE_PRIORITY_OPTIONS,
	ISSUE_STATUS_OPTIONS,
	type IssueMarkerDraft,
} from './types';

interface PlanPinIssueModalProps {
	draft: IssueMarkerDraft;
	onSave: (draft: IssueMarkerDraft) => void;
	onCancel: () => void;
	onDelete: (() => void) | null;
}

export default function PlanPinIssueModal({
	draft,
	onSave,
	onCancel,
	onDelete,
}: PlanPinIssueModalProps) {
	const titleId = useId();
	const commentId = useId();
	const categoryId = useId();
	const statusId = useId();
	const priorityId = useId();
	const referenceId = useId();
	const imagesId = useId();
	const headingId = useId();
	const [draftValue, setDraftValue] = useState(draft);
	const [isDraggingFiles, setIsDraggingFiles] = useState(false);
	const [discardedImages, setDiscardedImages] = useState(draft.images.slice(0, 0));
	const initialImageIdsRef = useRef(new Set(draft.images.map((image) => image.id)));

	const heading = draft.mode === 'create' ? 'nieuw aandachtspunt' : 'bewerk aandachtspunt';

	useEffect(() => {
		setDraftValue(draft);
		setIsDraggingFiles(false);
		setDiscardedImages([]);
		initialImageIdsRef.current = new Set(draft.images.map((image) => image.id));
	}, [draft]);

	useEffect(() => {
		return () => {
			revokeMarkerImages(discardedImages);
		};
	}, [discardedImages]);

	function appendFiles(fileList: FileList | File[]) {
		const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith('image/'));

		if (imageFiles.length === 0) {
			return;
		}

		setDraftValue((currentValue) => ({
			...currentValue,
			images: [...currentValue.images, ...createMarkerImages(imageFiles)],
		}));
	}

	function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
		if (event.target.files) {
			appendFiles(event.target.files);
		}

		event.target.value = '';
	}

	function handleDrop(event: DragEvent<HTMLLabelElement>) {
		event.preventDefault();
		setIsDraggingFiles(false);
		appendFiles(event.dataTransfer.files);
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		onSave(draftValue);
	}

	return (
		<div className="planpin-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
			<div className="planpin-modal__backdrop" onClick={onCancel} />
			<div className="planpin-modal__card">
				<div className="planpin-modal__header">
					<div>
						<p className="planpin-app__label">opmerking</p>
						<h2 id={headingId}>{heading}</h2>
					</div>
					<p className="planpin-app__coords">
						pagina {draft.pageNumber} op {Math.round(draft.x * 100)}% / {Math.round(draft.y * 100)}%
					</p>
				</div>

				<form className="planpin-modal__form" onSubmit={handleSubmit}>
					<label className="planpin-modal__field" htmlFor={titleId}>
						<span className="planpin-app__label">titel</span>
						<input
							id={titleId}
							className="planpin-modal__input"
							type="text"
							value={draftValue.title}
							onChange={(event) =>
								setDraftValue((currentValue) => ({
									...currentValue,
									title: event.target.value,
								}))
							}
							placeholder="titel van opmerking"
						/>
					</label>

					<label className="planpin-modal__field" htmlFor={commentId}>
						<span className="planpin-app__label">commentaar</span>
						<textarea
							id={commentId}
							className="planpin-modal__textarea"
							value={draftValue.comment}
							onChange={(event) =>
								setDraftValue((currentValue) => ({
									...currentValue,
									comment: event.target.value,
								}))
							}
							placeholder="voeg een notitie toe"
							rows={5}
						/>
					</label>

					<div className="planpin-modal__meta-grid">
						<label className="planpin-modal__field" htmlFor={categoryId}>
							<span className="planpin-app__label">categorie</span>
							<select
								id={categoryId}
								className="planpin-modal__input"
								value={draftValue.category}
								onChange={(event) =>
									setDraftValue((currentValue) => ({
										...currentValue,
										category: event.target.value as IssueMarkerDraft['category'],
									}))
								}
							>
								{ISSUE_CATEGORY_OPTIONS.map((option) => (
									<option key={option} value={option}>
										{getIssueCategoryLabel(option)}
									</option>
								))}
							</select>
						</label>

						<label className="planpin-modal__field" htmlFor={statusId}>
							<span className="planpin-app__label">status</span>
							<select
								id={statusId}
								className="planpin-modal__input"
								value={draftValue.status}
								onChange={(event) =>
									setDraftValue((currentValue) => ({
										...currentValue,
										status: event.target.value as IssueMarkerDraft['status'],
									}))
								}
							>
								{ISSUE_STATUS_OPTIONS.map((option) => (
									<option key={option} value={option}>
										{getIssueStatusLabel(option)}
									</option>
								))}
							</select>
						</label>

						<label className="planpin-modal__field" htmlFor={priorityId}>
							<span className="planpin-app__label">prioriteit</span>
							<select
								id={priorityId}
								className="planpin-modal__input"
								value={draftValue.priority}
								onChange={(event) =>
									setDraftValue((currentValue) => ({
										...currentValue,
										priority: event.target.value as IssueMarkerDraft['priority'],
									}))
								}
							>
								{ISSUE_PRIORITY_OPTIONS.map((option) => (
									<option key={option} value={option}>
										{getIssuePriorityLabel(option)}
									</option>
								))}
							</select>
						</label>

						<label className="planpin-modal__field" htmlFor={referenceId}>
							<span className="planpin-app__label">referentie</span>
							<input
								id={referenceId}
								className="planpin-modal__input"
								type="text"
								value={draftValue.reference}
								onChange={(event) =>
									setDraftValue((currentValue) => ({
										...currentValue,
										reference: event.target.value,
									}))
								}
								placeholder="ruimte, as of notitieref"
							/>
						</label>
					</div>

					<label
						className={`planpin-modal__dropzone${isDraggingFiles ? ' is-dragging' : ''}`}
						htmlFor={imagesId}
						onDragOver={(event) => {
							event.preventDefault();
							setIsDraggingFiles(true);
						}}
						onDragLeave={() => setIsDraggingFiles(false)}
						onDrop={handleDrop}
					>
						<input
							id={imagesId}
							className="planpin-app__input"
							type="file"
							accept="image/*"
							multiple
							onChange={handleFileChange}
						/>
						<span className="planpin-app__label">afbeeldingen</span>
						<p>Sleep afbeeldingen hierheen of klik om te uploaden.</p>
					</label>

					{draftValue.images.length > 0 ? (
						<div className="planpin-modal__thumb-grid">
							{draftValue.images.map((image) => (
								<div key={image.id} className="planpin-modal__thumb">
									{image.previewUrl ? (
										<img
											className="planpin-modal__thumb-image"
											src={image.previewUrl}
											alt={image.name}
										/>
									) : (
										<div className="planpin-modal__thumb-image planpin-modal__thumb-image--placeholder">
											geen voorbeeld
										</div>
									)}
									<div className="planpin-modal__thumb-meta">
										<p>{image.name}</p>
										<button
											type="button"
											className="planpin-app__button planpin-app__button--secondary"
											onClick={() =>
												setDraftValue((currentValue) => {
													if (!initialImageIdsRef.current.has(image.id)) {
														setDiscardedImages((currentImages) => [
															...currentImages,
															image,
														]);
													}

													return {
														...currentValue,
														images: currentValue.images.filter(
															(currentImage) => currentImage.id !== image.id,
														),
													};
												})
											}
										>
											verwijder
										</button>
									</div>
								</div>
							))}
						</div>
					) : null}

					<div className="planpin-modal__actions">
						<button
							type="button"
							className="planpin-app__button planpin-app__button--secondary"
							onClick={onCancel}
						>
							annuleer
						</button>
						{onDelete ? (
							<button
								type="button"
								className="planpin-app__button planpin-modal__delete"
								onClick={onDelete}
							>
								verwijder markering
							</button>
						) : null}
						<button type="submit" className="planpin-app__button">
							bewaar opmerking
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
