import { useState } from 'react';
import type { IssueMarker } from './types';

interface PlanPinMiniMapProps {
	renderSize: { width: number; height: number } | null;
	viewportWidth: number;
	viewportHeight: number;
	scrollLeft: number;
	scrollTop: number;
	markers: IssueMarker[];
	selectedMarkerId: string | null;
	onNavigate: (point: { x: number; y: number }) => void;
}

export default function PlanPinMiniMap({
	renderSize,
	viewportWidth,
	viewportHeight,
	scrollLeft,
	scrollTop,
	markers,
	selectedMarkerId,
	onNavigate,
}: PlanPinMiniMapProps) {
	const [isCollapsed, setIsCollapsed] = useState(false);

	if (
		!renderSize ||
		renderSize.width <= 0 ||
		renderSize.height <= 0 ||
		(renderSize.width <= viewportWidth && renderSize.height <= viewportHeight)
	) {
		return null;
	}

	const viewportBoxWidth = Math.min(1, viewportWidth / renderSize.width) * 100;
	const viewportBoxHeight = Math.min(1, viewportHeight / renderSize.height) * 100;
	const viewportBoxLeft =
		Math.min(1, Math.max(0, scrollLeft / Math.max(renderSize.width, 1))) * 100;
	const viewportBoxTop =
		Math.min(1, Math.max(0, scrollTop / Math.max(renderSize.height, 1))) * 100;

	if (isCollapsed) {
		return (
			<button
				type="button"
				className="planpin-app__minimap-toggle"
				onClick={() => setIsCollapsed(false)}
			>
				overzicht
			</button>
		);
	}

	return (
		<div className="planpin-app__minimap">
			<div className="planpin-app__minimap-header">
				<p className="planpin-app__label">overzicht</p>
				<div className="planpin-app__minimap-actions">
					<p className="planpin-app__coords">klik om te verschuiven</p>
					<button
						type="button"
						className="planpin-app__button planpin-app__button--secondary planpin-app__minimap-collapse"
						onClick={() => setIsCollapsed(true)}
					>
						verberg
					</button>
				</div>
			</div>
			<button
				type="button"
				className="planpin-app__minimap-surface"
				onClick={(event) => {
					const bounds = event.currentTarget.getBoundingClientRect();
					onNavigate({
						x: (event.clientX - bounds.left) / bounds.width,
						y: (event.clientY - bounds.top) / bounds.height,
					});
				}}
			>
				<div
					className="planpin-app__minimap-viewport"
					style={{
						width: `${viewportBoxWidth}%`,
						height: `${viewportBoxHeight}%`,
						left: `${viewportBoxLeft}%`,
						top: `${viewportBoxTop}%`,
					}}
				/>
				{markers.map((marker) => (
					<span
						key={marker.id}
						className={`planpin-app__minimap-marker${marker.id === selectedMarkerId ? ' is-selected' : ''}`}
						style={{
							left: `${marker.x * 100}%`,
							top: `${marker.y * 100}%`,
						}}
					/>
				))}
			</button>
		</div>
	);
}
