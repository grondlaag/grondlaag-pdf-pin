# Grondlaag / PlanPin Grasshopper PDF exporter (prototype v0.3)

Een Python 3-script voor **Rhino 8 + Grasshopper** dat meerdere Rhino-XY-rechthoeken omzet naar pagina's van **één PDF** en opmerkingen met **PlanPin-manifest v1** insluit. Gegevens blijven bewerkbaar via de huidige PlanPin-webapplicatie na het openen van de PDF.

## Setup

1. Open Rhino 8 en Grasshopper. Maak een **Python 3 Script**-component.
2. Voeg inputs toe en hernoem ze exact zoals in de tabel (hoofdletters zijn relevant). Zet de access-modus correct. Alle geometrie-inputs: **Type hint `Curve`**. Voor `Images`: **Tree Access**.
3. Open de Python-editor, vervang de code door de inhoud van `planpin_export_gh.py`.
4. Rhino installeert `pymupdf` via de `# requirements:`-regel indien nodig. Gebruik deze code **niet** in de oude IronPython 2-component.
5. Zorg voor een **parallel Top-vlak**, waarbij +Y omhoog staat. Het script gebruikt een bestaande Top-view; als die er niet is, de actieve view.
6. De geplande tekening moet **baked/zichtbaar in Rhino** en afdrukbaar zijn. Alleen Grasshopper-preview-objecten geven niet noodzakelijk een Rhino PDF-print. Bewaar de boundary- en opmerkingrechthoeken als hulpgeometrie op een niet-afdrukbare of verborgen laag.
7. Verbind een Grasshopper **Button** met `Export`. Elke puls levert precies één export op.

## Inputs

| Naam | GH Type | Access | Verplicht | Toelichting |
|---|---|---|---|---|
| `PdfBoundaries` | Curve | List | Ja | Gesloten, XY, niet-geroteerde rechthoeken; **lijstvolgorde = PDF-paginavolgorde** |
| `RemarkRectangles` | Curve | List | Ja | Gesloten vlakke XY-curve; rotatie en kleine vormafwijkingen zijn toegestaan; kan leeg zijn |
| `Title` | Text | List | Nee | Titel per opmerking; wanneer losgekoppeld automatisch genummerd |
| `Comment` | Text | List | Nee | Beschrijving per opmerking |
| `Category` | Text | List | Nee | `design`, `technical`, `site`, `coordination`, `safety`, `other` of Nederlandse labels |
| `Status` | Text | List | Nee | `open`, `in progress`, `resolved` of Nederlandse labels |
| `Priority` | Text | List | Nee | `low`, `medium`, `high` of Nederlandse labels |
| `Reference` | Text | List | Nee | Ruimte / as / notitiereferentie |
| `Images` | Text | Tree | Nee | Bestandspaden naar afbeelding; tak `{i}` hoort bij opmerking met index `i` |
| `RemarkIds` | Text | List | Nee | Bestaande UUID's om identiteit te behouden bij sorteren |
| `OutputFolder` | Text | Item | Ja | **Bestaande** outputmap op de lokale schijf |
| `FileName` | Text | Item | Nee | Standaard `planpin-grasshopper.pdf` |
| `Scale` | Number | Item | Nee | 100 betekent 1:100; standaard 100 |
| `Dpi` | Integer | Item | Nee | Standaard 150 (vector output waar mogelijk) |
| `SnapshotMargin` | Number | Item | Nee | Extra marge rond de opmerkingsrechthoek, als fractie van de breedte/hoogte; standaard `0.30` (30%), bereik `0..3` |
| `Export` | Boolean | Item | Ja | Button |

**Metadata-lijsten:** ofwel volledig niet aangesloten, ofwel exact even lang als `RemarkRectangles`, in overeenkomende volgorde.

## Outputs

| Naam | Type | Omschrijving |
|---|---|---|
| `PdfPath` | Text | Laatst geslaagde PDF-bestand |
| `RemarkMap` | DataTree[int] | Tak `{0}` bevat alle opmerkingindices op pagina 1, tak `{1}` die op pagina 2, enz. Ook lege takken worden aangehouden. |
| `Manifest` | Text | JSON-voorvertoning van het ingebedde PlanPin-manifest |
| `Log` | Text | Status of foutmeldingen |

## Exact PlanPin-formaat

De uiteindelijke PDF heeft:
- Planpagina's in de volgorde van `PdfBoundaries`;
- een samenvattingspagina met overzicht;
- een detailpagina per opmerking, inclusief een **planfragment uit de originele planpagina** met rood stippelkader;
- klikbare markers op planpagina's;
- ingesloten **`planpin-manifest.json`** met `kind: planpin-manifest`, `version: 1`, PlanPin `issues` en `sessions`;
- ingesloten **`planpin-source.pdf`**: de originele planpagina's zonder ingevoegde markers;
- optionele ingesloten beelden via `planpin-images/{id}-{name}`;
- voor **iedere opmerking** een automatisch gegenereerde, ingebedde PNG van het planfragment, die PlanPin als gewone afbeelding kan bewerken, bewaren en opnieuw exporteren.

PlanPin leest de `planpin-manifest.json`-bijlage, laadt `planpin-source.pdf` in zijn viewer en zet de markers via de genormaliseerde `x/y` terug op de juiste pagina. Hiermee kunnen titel, commentaar, categorie, status, prioriteit en referentie op de webpagina bewerkt worden.

**Let op:** de huidige PlanPin-software bewaart enkel de *positie* (middelpunt van de Rhino-opmerkingrechthoek), **niet** de afmetingen van de rechthoek. De uitsnede en het rode kader worden bij de Grasshopper-export bepaald uit de **XY-bounding box** van de oorspronkelijke curve. Voor gedraaide/onregelmatige curves is dat dus het omhullende kader, niet hun exacte contour.

### Automatische planfragmenten (v0.3)

- Een geselecteerde opmerkingszone verschijnt op de bijbehorende opmerkingenpagina als **vectoriële PDF-uitsnede** met het rode selectiekader. De uitsnede komt uit de originele, niet-gemarkeerde plan-PDF (geen Rhino screenshot nodig).
- `SnapshotMargin = 0` toont zo dicht mogelijk de selectie; `0.30` toont 30% extra rondom; `1.0` voegt 100% extra toe. Er blijft minstens 1% van de paginabreedte/-hoogte aan context, waar mogelijk. De uitsnede wordt altijd begrensd door de PDF-pagina.
- PlanPin-manifest v1 blijft exact hetzelfde schema. De snapshot wordt automatisch toegevoegd als **eerste afbeelding** van de opmerking (`planpin-images/…planfragment-opmerking-NNN.png`). Zo blijft deze ook bij bewerken en exporteren via de website behouden.
- Reeds bestaande `Images`-input blijft ondersteund. Bij opmerkingen mét eigen afbeeldingen staan commentaar en planfragment naast elkaar; bestaande afbeeldingen komen onderaan.
- Bij tientallen of honderden opmerkingen kan de PDF groter worden: per opmerking wordt een PNG-voorbeeld van maximaal ongeveer 1200 px breed gerenderd (bij uitzonderlijk kleine zones is er een zoomlimiet).
- Wanneer je een opmerking later *verplaatst* in PlanPin, blijft de oorspronkelijke snapshot een afbeelding van de eerdere planzone. Die wordt pas vernieuwd bij een nieuwe Grasshopper-export; de huidige webapp bewaart immers geen rechthoekgeometrie.


## Grenzen van prototype v0.3

- Geen live cloud-synchronisatie. Bewerkingen in PlanPin worden meegenomen bij de **webexport** naar een nieuwe PDF; een nieuwe Grasshopper-export zal die webwijzigingen niet automatisch terug in Rhino opnemen.
- `RemarkIds` is nodig als de **lijstvolgorde** wijzigt; zonder deze input worden UUID's deterministisch van outputbestandslocatie en lijstindex afgeleid.
- PDF-print volgt de afdrukbare Rhino-geometrie van de Top-viewport. Materiaal-/weergavestijlen en fonts eerst in Rhino controleren.
- `PdfBoundaries` moeten vlakke, niet-geroteerde XY-rechthoeken blijven. Opmerkingcontouren mogen geroteerd of onregelmatig zijn; hun XY-bounding-box-middelpunt bepaalt de markerpositie. De PDF's kunnen per pagina verschillende afmetingen hebben.
- Aangemaakte PDF's kunnen bestaande bestanden overschrijven na een nieuwe button-puls. Bij een fout blijft de bestaande PDF behouden.
- Het script is in deze omgeving alleen **zonder Rhino** getest: manifest, paginatoewijzing, PDF-pagina's, PDF-bijlagen en links. Er is nog een lokale Rhino 8-test nodig op de vector-print en GH-componentintegratie.

## Tests

`python test_export_core.py` voert een pure Python/PyMuPDF-test uit met 2 planpagina's en 3 opmerkingen en controleert het PDF-manifest, ingesloten snapshots, vectorfragmenten, linkannotaties en foutcondities. Deze test draait buiten Rhino.

## Wijziging v0.2

- `RemarkRectangles` accepteert voortaan geroteerde of licht onregelmatige **gesloten, vlakke** curves. De markerpositie is het middelpunt van de XY bounding box.
- De strikte vormcontrole blijft behouden voor `PdfBoundaries`, omdat die de exacte PDF-pagina-uitsnede bepalen.
- Als een opmerking buiten een pagina valt of meerdere pagina's raakt, blijft de export bewust stoppen met een foutmelding.

## Wijziging v0.3

- Automatisch planfragment op elke opmerkingenpagina, zonder extra verplichte Grasshopper-input.
- Extra optionele `SnapshotMargin` input (standaard `0.30`).
- Vectorafbeelding van het gekozen planfragment plus PNG-bijlage die PlanPin bij herexport bewaart.
- Unieke/stabiele snapshot-identificaties per opmerking (geen dubbele afbeeldingen bij herexport).
- Dynamische paginaopmaak: bij eigen afbeeldingen blijven commentaar, planfragment en bijlagen zichtbaar.