import type { MouseEvent } from 'react';
import { getMarkerDisplayTitle, getNormalizedOverlayPoint } from './markers';
import type { IssueMarker, OverlayPoint } from './types';

interface PlanPinMarkerLayerProps {
	markers: IssueMarker[];
	issueNumbers: Record<string, number>;
	selectedMarkerId: string | null;
	onOverlayClick: (point: OverlayPoint) => void;
	onMarkerSelect: (markerId: string) => void;
}

export default function PlanPinMarkerLayer({
	markers,
	issueNumbers,
	selectedMarkerId,
	onOverlayClick,
	onMarkerSelect,
}: PlanPinMarkerLayerProps) {
	function handleOverlayClick(event: MouseEvent<HTMLButtonElement>) {
		onOverlayClick(getNormalizedOverlayPoint(event));
	}

	return (
		<div className="planpin-app__overlay-layer">
			<button
				type="button"
				className="planpin-app__overlay"
				aria-label="Markerlaag voor nieuwe planpunten"
				onClick={handleOverlayClick}
			/>
			{markers.map((marker) => {
				const isSelected = marker.id === selectedMarkerId;
				const issueNumber = issueNumbers[marker.id] ?? 0;
				const displayTitle = getMarkerDisplayTitle(marker, issueNumber);

				return (
					<button
						key={marker.id}
						type="button"
						className={`planpin-app__marker${isSelected ? ' is-selected' : ''}`}
						style={{
							left: `${marker.x * 100}%`,
							top: `${marker.y * 100}%`,
						}}
						aria-label={`Selecteer ${displayTitle}`}
						onClick={(event) => {
							event.stopPropagation();
							onMarkerSelect(marker.id);
						}}
					>
						<span className="planpin-app__marker-dot">{issueNumber}</span>
						<span className="planpin-app__marker-label">{displayTitle}</span>
					</button>
				);
			})}
		</div>
	);
}
