import type { IssueTable } from './types';
import { tableTotals } from './table-utils';

interface PlanPinIssueTableProps {
	table: IssueTable | undefined;
	onChange?: (table: IssueTable | undefined) => void;
}

export default function PlanPinIssueTable({ table, onChange }: PlanPinIssueTableProps) {
	const editable = Boolean(onChange);
	if (!table) {
		return editable ? (
			<div className="planpin-table__empty">
				<button type="button" className="planpin-app__button planpin-app__button--secondary"
					onClick={() => onChange?.({
						columns: ['omschrijving', 'hoeveelheid', 'prijsimpact'],
						rows: [['', '', '']],
						totals: ['prijsimpact'],
					})}>
					+ tabel toevoegen
				</button>
			</div>
		) : null;
	}
	const totals = tableTotals(table);
	function update(next: IssueTable) {
		onChange?.(next);
	}
	function renameColumn(index: number, name: string) {
		const old = table!.columns[index];
		const columns = table!.columns.map((v, i) => i === index ? name : v);
		const totals = table!.totals.map((v) => v === old ? name : v);
		update({ ...table!, columns, totals });
	}
	function addColumn() {
		let count = table!.columns.length + 1;
		let name = 'kolom ' + count;
		while (table!.columns.includes(name)) { count += 1; name = 'kolom ' + count; }
		update({
			...table!,
			columns: [...table!.columns, name],
			rows: table!.rows.map((row) => [...row, '']),
		});
	}
	function removeColumn(index: number) {
		const name = table!.columns[index];
		const columns = table!.columns.filter((_, i) => i !== index);
		if (columns.length === 0) { onChange?.(undefined); return; }
		update({
			...table!,
			columns,
			rows: table!.rows.map((row) => row.filter((_, i) => i !== index)),
			totals: table!.totals.filter((value) => value !== name),
		});
	}
	function updateCell(rowIndex: number, colIndex: number, value: string) {
		update({
			...table!,
			rows: table!.rows.map((row, i) => i === rowIndex
				? row.map((cell, j) => j === colIndex ? value : cell)
				: row),
		});
	}
	function toggleTotal(column: string, checked: boolean) {
		update({
			...table!,
			totals: checked
				? [...table!.totals.filter((name) => name !== column), column]
				: table!.totals.filter((name) => name !== column),
		});
	}
	return (
		<div className="planpin-table">
			<div className="planpin-table__heading">
				<strong>tabel</strong>
				<span>{table.rows.length} rijen · {table.columns.length} kolommen</span>
			</div>
			<div className="planpin-table__scroll" role="region" aria-label="Tabel van opmerking" tabIndex={0}>
				<table className="planpin-table__grid">
					<thead>
						<tr>
							{table.columns.map((column, index) => (
								<th key={index} scope="col">
									{editable ? (
										<div className="planpin-table__header-control">
											<input aria-label={`Naam kolom ${index + 1}`} value={column}
												onChange={(event) => renameColumn(index, event.target.value)} />
											<button type="button" className="planpin-table__icon-button"
												title="Kolom verwijderen" aria-label={`Kolom ${index + 1} verwijderen`}
												onClick={() => removeColumn(index)}>×</button>
										</div>
									) : column}
								</th>
							))}
							{editable ? <th scope="col">rij</th> : null}
						</tr>
					</thead>
					<tbody>
						{table.rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{table.columns.map((_, colIndex) => (
									<td key={colIndex}>
										{editable
											? <input aria-label={`Rij ${rowIndex + 1}, kolom ${table.columns[colIndex]}`}
												value={row[colIndex] ?? ''}
												onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)} />
											: (row[colIndex] ?? '')}
									</td>
								))}
								{editable ? <td>
									<button type="button" className="planpin-table__icon-button"
										onClick={() => update({
											...table!,
											rows: table!.rows.filter((_, i) => i !== rowIndex),
										})} aria-label={`Rij ${rowIndex + 1} verwijderen`}>×</button>
								</td> : null}
							</tr>
						))}
					</tbody>
					{table.totals.length > 0 ? (
						<tfoot>
							<tr>
								{table.columns.map((column, index) => (
									<td key={index}>
										{Object.prototype.hasOwnProperty.call(totals, column)
											? <strong>{totals[column]}</strong>
											: index === 0 ? <strong>Totaal</strong> : null}
									</td>
								))}
								{editable ? <td /> : null}
							</tr>
						</tfoot>
					) : null}
				</table>
			</div>
			{editable ? (
				<div className="planpin-table__editor">
					<div className="planpin-table__actions">
						<button type="button" className="planpin-app__button planpin-app__button--secondary"
							onClick={() => update({
								...table,
								rows: [...table.rows, table.columns.map(() => '')],
							})}>+ rij</button>
						<button type="button" className="planpin-app__button planpin-app__button--secondary"
							onClick={addColumn}>+ kolom</button>
						<button type="button" className="planpin-app__button planpin-app__button--secondary"
							onClick={() => onChange?.(undefined)}>tabel verwijderen</button>
					</div>
					<fieldset className="planpin-table__totals">
						<legend>Bereken totaal voor</legend>
						{table.columns.map((column, index) => (
							<label key={index}>
								<input type="checkbox" checked={table.totals.includes(column)}
									disabled={!column.trim()}
									onChange={(event) => toggleTotal(column, event.target.checked)} />
								{column || `kolom ${index + 1}`}
							</label>
						))}
					</fieldset>
					<p className="planpin-table__hint">Getallen met komma of punt worden automatisch herkend. De originele celtekst blijft bewaard.</p>
				</div>
			) : null}
		</div>
	);
}
