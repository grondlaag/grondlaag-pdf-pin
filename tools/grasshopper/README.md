# PlanPin Grasshopper exporter v0.5 — dynamische tabellen

Deze versie bouwt voort op v0.4 en ondersteunt een **optionele tabel per opmerking**. De kolommen worden niet hardcoded: je kunt met Bumblebee de Excel-gegevens rechtstreeks als Grasshopper DataTree aanbieden.

## Drie nieuwe Grasshopper-inputs

| Input | Type | Access | Betekenis |
|---|---|---|---|
| `TableColumns` | Text | **List** | Kolomkoppen, dezelfde volgorde als in elke data-branch. |
| `TableData` | Generic | **Tree** | Elke branch bevat **één rij**: `{opmerkingIndex;rijIndex}`. |
| `TableTotals` | Text | **List** | Kolomnamen (exacte naam; hoofdletterongevoelig) waarvoor een totaal wordt getoond. |

### Voorbeeld

`TableColumns = [artikelwijziging, a, b, i, hv, eenheidsprijs, prijsimpact]`

`TableTotals = [hv, prijsimpact]`

```
TableData
{28;0} -> [51.11.20.ARCH. | wand, 4,87, 2,95, -1, -14,37, 152,53, -2191,32]
{28;1} -> [53.25.ARCH. | tapijttegels, 0,15, 4,87, 1, 0,73, 45,49, 33,23]
{28;2} -> [...]
{49;0} -> [...]  # opmerking 50 heeft ook een eigen tabel
```

**De eerste index is altijd nul-gebaseerd**, dus branch `{28;0}` hoort bij `RemarkRectangles[28]`, niet bij zichtbaar opmerkingsnummer 28. De tweede index sorteert de rijen oplopend. Lege of ontbrekende branches leveren geen tabel op. Kolomnamen kunnen gedeeld worden door alle opmerkingen, maar slechts de opmerkingen die gegevens hebben krijgen effectief een tabel.

De exporter controleert dat elke rij hetzelfde aantal items bevat als `TableColumns`, dat kolomnamen uniek zijn en dat elke naam in `TableTotals` bestaat. Het maximum is voorlopig 16 kolommen, om de PDF leesbaar te houden. Alle celwaarden worden als tekst bewaard; de berekening gebeurt enkel voor de geselecteerde kolommen. Getallen met Nederlandse decimaalnotatie, bijvoorbeeld `-2.191,32`, worden ondersteund. De originele celwaarden wijzigen niet door de totalenberekening.

## PDF en PlanPin-webapp

- Tabellen verschijnen bij de opmerking, na de tekst of op een vervolgpagina als er onvoldoende ruimte is. De kolomkoppen herhalen bij vervolgpagina's.
- Het embedded `planpin-manifest.json` behoudt `version: 1`. Een opmerking met data krijgt optioneel `table: {columns: string[], rows: string[][], totals: string[]}`.
- De volledige tabellen blijven beschikbaar in de PlanPin-webapp. De webapp kan ze bekijken en via het opmerkingenformulier aanpassen, met rijen, kolommen en optionele totalen.
- Het `TableTotals`-veld bevat de **namen** van de kolommen, niet de indexen. Een alternatieve naam of andere volgorde vraagt dus geen wijziging van Python-code.
- Het numerieke totaal is een **berekend resultaat**, geen apart hardcoded veld.

## Bestaande inputs

Alle eerdere v0.4-inputs en hun gedrag blijven behouden: `PdfBoundaries`, `RemarkRectangles`, `Title`, `RemarkNumber`, `Comment`, `Category`, `Status`, `Priority`, `Reference`, `Images`, `RemarkIds`, `OutputFolder`, `FileName`, `Scale`, `Dpi`, `SnapshotMargin`, `Export`.

De vorige outputs blijven `PdfPath`, `RemarkMap`, `Manifest`, `Log`. Export start uitsluitend op de flank van de `Export`-button.

## Testen

`python test_tables.py` test een DataTree met tabellen voor meerdere opmerkingen, Europese getallen, totaalberekening, ingebedde manifestmetadata, PDF-paginering en vervolgpagina's zonder Rhino. De volledige Rhino-vectorprint en GH DataTree-binding kunnen enkel in Rhino 8 worden gevalideerd.

## Grenzen

- Eén tabel per opmerking; niet meerdere losse tabellen onder dezelfde opmerking.
- De drie tabelinputs zijn globaal voor één exporter: elke opmerking gebruikt hetzelfde kolommenschema bij de GH-export. In de webapp kan iedere opmerking nadien zijn eigen kolommen krijgen.
- De export van een Grasshopper-project overschrijft geen webwijzigingen *in place*: PlanPin bewaart wijzigingen bij de volgende webexport naar PDF. Om wijzigingen naar Grasshopper terug te brengen is een latere import nodig.
- Voor zeer lange celwaarden kan een rij te hoog worden voor één pagina; het script meldt dan een fout in plaats van gegevens stilzwijgend te schrappen.
- Bij opmerkingen met eigen afbeeldingen wordt de tabel wegens ruimtegebrek op een vervolgpagina geplaatst. Het overzicht en alle oorspronkelijke opmerkinglinks blijven geldig.