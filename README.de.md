# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | Deutsch | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Von Japanisch, Chinesisch und Koreanisch bis zur arabischen Schrift — eine Berichts-Engine, die die Schriftsysteme der Welt in schöne PDFs verwandelt, in reinem TypeScript.**

`tsreport-core` übernimmt das Parsen von OpenType-Schriftarten, den Textsatz (das Anordnen der Zeichen auf der Seite mit den korrekten Glyphenformen, -breiten und -positionen), bandbasiertes Berichtslayout, Canvas-/SVG-Vorschau und PDF-Erzeugung — alles über ein einheitliches Rendering-Modell. Es hat null Laufzeitabhängigkeiten. Ohne native Module und ohne WASM läuft dieses eine Paket sowohl unter Node.js als auch in modernen Browsern.

Die Codebeispiele in diesem Dokument verwenden bewusst japanische Geschäftsdaten (Angebote, Rechnungen): Sie dienen zugleich als Live-Demonstration des CJK-Textsatzes dieser Engine.

```bash
npm install tsreport-core
```

Diese README ist voller Beispiele, die Sie unverändert kopieren und ausführen können — von Ihrer ersten PDF-Erzeugung über alle 16 Berichtselemente, vertikalen Schriftsatz, mehrsprachigen Textsatz, Schriftarteinbettung und die Umwandlung von Text in Pfade bis hin zur Browser-Vorschau. Wenn Berichtswerkzeuge für Sie neu sind, beginnen Sie mit den **Grundlagen des Berichtslayouts**, um ein Gefühl für die Konzepte zu bekommen, und erstellen Sie dann mit dem Tutorial Ihr erstes PDF.

## Die Schriftsysteme der Welt korrekt setzen — mit einer einzigen Engine

Ein mehrsprachiger Bericht lässt sich nicht korrekt darstellen, indem man Zeichenketten einfach direkt in ein PDF schreibt. Glyphenauswahl, Vermessung der Zeichenbreiten, Positionierung, Zeilenumbruch, vertikaler Schriftsatz und die Einbettung der Schriftart ins PDF — erst wenn diese gesamte Verarbeitungskette ineinandergreift, erhalten Sie die erwartete Seite.

`tsreport-core` übernimmt diesen gesamten Ablauf, vom Parsen der Schriftart bis zur PDF-Erzeugung.

- **Japanisch, Chinesisch und Koreanisch** — vereinfachtes und traditionelles Chinesisch, Hangul, die Behandlung von Interpunktion und Glyphen für vertikalen Schriftsatz werden auf Basis von Unicode- und OpenType-Daten korrekt gesetzt
- **Arabische Schrift und Rechts-nach-links-Satz (RTL)** — kontextabhängiges Glyphen-Shaping, Verbindungen und Ligaturen (mehrere Zeichen verschmelzen zu einer einzigen Glyphenform) sowie die bidirektionale Unicode-Verarbeitung (Steuerung der Reihenfolge, wenn Rechts-nach-links-Text mit Ziffern und lateinischen Buchstaben gemischt ist) laufen durch dieselbe Layout-Pipeline wie jedes andere Schriftsystem
- **Komplexe Schriftsysteme** — Glyphenersetzung und -positionierung nach den in der Schriftart eingebauten Satzregeln (OpenType Layout), kombinierende Zeichen, Glyphenvarianten (alternative Formen desselben Zeichens) und sprachspezifische Satz-Features werden unterstützt
- **Vertikaler Schriftsatz** — behandelt `vertical-rl` / `vertical-lr`, Glyphen für vertikalen Satz, vertikale Metriken (Maßdaten wie Dickten speziell für vertikalen Text) und Zeichenrotation
- **Automatische Einbettung von Schriftart-Subsets** — nur die tatsächlich verwendeten Glyphen (die pro Zeichen in der Schriftart gespeicherten Formdaten) werden ins PDF eingebettet, sodass das Dokument auch auf Rechnern ohne installierte Schriftart identisch aussieht
- **Umwandlung von Text in Pfade (Outlines)** — pro Element kann Text als schriftartunabhängige Vektorpfade ausgegeben werden
- **Verweise auf Systemschriftarten** — für Arbeitsabläufe, die auf die Schriftarten des Betrachters setzen, können Sie auch leichtgewichtige PDFs ganz ohne eingebettete Schriftarten erzeugen
- **Zeichensalat erkennen, bevor er entsteht** — `checkGlyphCoverage()` meldet Zeichen, die in der Schriftart fehlen, pro Seite und pro Zeichen, noch vor der Ausgabe

Und dieser Textsatz arbeitet als Einheit mit einer eigens für Berichte gebauten Layout-Engine — denn die Fähigkeit, Zeichen korrekt zu setzen, und die Fähigkeit, korrekt zu paginieren, lassen sich nicht voneinander trennen.

- **Layout, das auf die Textmenge reagiert** — Zeilen dehnen sich mit der Textmenge (`stretchWithOverflow`), und Bandhöhen passen sich automatisch an. Lange Produktnamen werden nie abgeschnitten
- **Automatische Seitenumbrüche nach Datenmenge** — wenn Detailzeilen überlaufen, beginnt die Engine eine neue Seite und gibt Kopf- und Überschriftszeilen automatisch erneut aus. Zwischensummen pro Gruppe und Seitenumbrüche erfordern nicht mehr als eine Deklaration
- **Verschachteltes Layout** — auch komplexe Berichte mit Tabellen, Kreuztabellen und Subreports werden von derselben Layout-Engine konsistent platziert
- **WYSIWYG (Vorschau = Druck)** — Elemente werden exakt auf die von Ihnen angegebenen pt-Koordinaten fixiert, und die Canvas-/SVG-Vorschau teilt sich das identische Layout-Ergebnis mit der PDF-Ausgabe. Was Sie auf dem Bildschirm sehen, erhalten Sie auf dem Papier

## Warum tsreport-core

tsreport-core ist aus drei Anliegen entstanden.

**TypeScript hat keine ernstzunehmende Berichtslösung.** Angebote und Rechnungen zu erzeugen ist ein grundlegendes geschäftliches Bedürfnis, doch das TypeScript/Node.js-Ökosystem hatte — bei allen Bibliotheken für Low-Level-PDF-Zeichnung — nichts, was den Namen „Berichts-Engine“ verdient hätte: Bandlayout, automatische Seitenumbrüche, Aggregation und Vorschau-Druck-Treue in einem Paket. Wir wollten Schluss machen mit der Praxis, nur für Berichte eine weitere Sprachlaufzeit oder ein externes Serverprodukt hineinzuziehen.

**Berichtsausgabe ist eine Grundfähigkeit, und jeder sollte sie kostenlos nutzen können.** Berichtsausgabe ist kein Premium-Feature, das wenigen teuren Produkten vorbehalten ist; sie gehört zum Fundament jedes Geschäftssystems. Ohne zu kaufende kommerzielle Lizenzen und ohne nutzungsabhängige Gebühren soll jeder — vom persönlichen Werkzeug bis zum kommerziellen Produkt — dieselbe Engine unverändert nutzen können. tsreport-core veröffentlicht alle seine Funktionen unter einer dualen Lizenz MIT OR Apache-2.0 als Ausdruck dieser Überzeugung.

**Nur wenige Lösungen gehen die Mehrsprachigkeit — asiatische Schriften, arabische Schrift und mehr — direkt an.** Die meisten Berichts- und PDF-Werkzeuge sind um lateinischen Text herum entworfen und behandeln japanischen, chinesischen und koreanischen Schriftsatz oder die von rechts nach links laufende arabische Schrift als Nebensache. tsreport-core hat „die Schriftsysteme der Welt korrekt setzen, mit einer einzigen Engine“ vom ersten Tag an zum Designziel gemacht und alles vom Schriftart-Parsing über den Textsatz bis zur PDF-Einbettung selbst implementiert.

Diese Beweggründe nehmen in drei Stärken Gestalt an.

### Von der Layout-Engine bis zur PDF-Erzeugung — vollständig in einem Paket

Wenn Seiten aus einer Vorlage und Daten zusammengesetzt werden, wird das Ergebnis in einem einzigen Rendering-Modell namens `RenderDocument` festgehalten. Dasselbe Modell kann nach PDF, Canvas oder SVG gerendert werden, sodass keine doppelte Layout-Logik für Bildschirmvorschau und Druck gepflegt werden muss — das PDF sieht exakt so aus wie das, was Sie auf dem Bildschirm gesehen haben. Es ist nicht nötig, eine Bandlayout-Berichts-Engine und eine PDF-Bibliothek miteinander zu verdrahten.

### Reines TypeScript ohne Laufzeitabhängigkeiten

Schriftart-Parsing, Textsatz, PDF-Erzeugung, DEFLATE-Kompression, Verschlüsselung, PNG-Dekodierung und Barcode-Erzeugung sind vollständig in reinem TypeScript implementiert. Ohne native Module und ohne externe Prozesse verhält es sich in jeder Umgebung identisch, und um den Code zu auditieren, der bei der Berichtserzeugung läuft, genügt es, dieses eine Paket zu lesen.

### Alles, was ein Bericht braucht, bereits eingebaut

- Bandlayout mit Titel, Seitenkopf, Detail, Gruppe, Zusammenfassung und mehr
- Tabellen, Kreuztabellen, Subreports, Variablen, Ausdrücke (`Expression`), Seitenumbrüche, Inhaltsverzeichnis, Zusammenführen mehrerer Berichte
- Import bestehender PDFs — Umwandlung von PDF-Seiten in Berichtselemente (`ElementDef`), Stile, Bilder und Schriftartinformationen
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, Verläufe, Beschneidung (Clipping), Transparenz, mathematischer Formelsatz, Bilder
- PDF-Verschlüsselung, PDF/A-1b, 2b und 3b (internationale Normen für die Langzeitarchivierung), PDF/X-1a (eine internationale Norm für die Druckübergabe), Lesezeichen, Links, Formulare, Anmerkungen
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, variable Schriftarten (Schriftarten, deren Strichstärke, Breite und andere Achsen stufenlos variieren) und Farbschriftarten

## Grundlagen des Berichtslayouts

Für Leser, die Berichts-Engines noch nicht kennen, führt dieser Abschnitt die grundlegenden Konzepte der Reihe nach ein.

### Grundprinzip: Ein Bericht entsteht aus „Vorlage“ plus „Daten“

In tsreport-core entsteht ein Bericht aus zwei Teilen: einer **Vorlage** (der Layoutdefinition) und **Daten** (JSON).

Die Vorlage enthält keine tatsächlichen Werte. Sie definiert nur die Rahmen — „hier steht die Artikelbezeichnung; dort steht der Betrag, in dieser Breite und diesem Format“ — sowie Verweise darauf, **welches Datenfeld** jeweils angezeigt wird (geschrieben als `field.item`, also das Feld `item` der Daten).

Die tatsächlichen Werte werden als JSON-Daten übergeben. Jedes Element des Arrays `rows` ist eine Detailzeile.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Bei der Berichtserzeugung durchläuft die Engine `rows` von oben nach unten und gibt das Detail-Layout einmal pro Zeile aus. Im obigen Beispiel werden drei Detailzeilen gedruckt, und `field.item` löst sich der Reihe nach zu りんご, みかん und ぶどう auf. Wächst der Datenbestand auf 10.000 Zeilen, wird der Bericht 10.000 Zeilen lang, ohne dass sich ein einziges Zeichen der Vorlage ändert. Diese Arbeitsteilung — das Layout ist fest, die Zeilenzahl folgt den Daten — ist der Ausgangspunkt jeder Berichts-Engine.

### Eine Seite ist ein Stapel von „Bändern“ (bands)

Auf der Vorlagenseite entwerfen Sie die Seite anschließend als Stapel horizontaler Streifen, der sogenannten **Bänder** (englisch „band“). Statt selbst Y-Koordinaten zu berechnen und Elemente auf der Seite zu platzieren, deklarieren Sie nur, „welches Band was enthält“, und die Engine setzt die Seiten entsprechend der Anzahl der Datenzeilen automatisch zusammen. Eine Seite hat folgenden Aufbau.

```text
┌──────────────────────────┐
│ title                    │ ← einmal am Berichtsanfang (Titel, Empfänger, …)
├──────────────────────────┤
│ pageHeader               │ ← oben auf jeder Seite (Firmenname, Ausstellungsdatum, …)
├──────────────────────────┤
│ columnHeader             │ ← Überschriftszeile der Detailzeilen (Artikel, Menge, Betrag, …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ einmal pro Zeile von rows,
│ details                  │ │ so oft wiederholt, wie Zeilen vorhanden sind
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← schließt die Detailzeilen ab (pro Seite/Spalte)
├──────────────────────────┤
│ pageFooter               │ ← unten auf jeder Seite (Seitenzahlen, …)
└──────────────────────────┘
```

Auf der letzten Seite wird nach dem letzten `details` genau einmal `summary` ausgegeben (Gesamtsummen für den ganzen Bericht und dergleichen). Darüber hinaus gibt es `background`, das unter jede Seite gelegt wird; `lastPageFooter`, das nur auf der letzten Seite verwendet wird; und `noData`, das nur erscheint, wenn die Daten null Zeilen haben — insgesamt können in `bands` zehn Arten von Bändern definiert werden.

| Band | Wann es ausgegeben wird | Typische Verwendung |
| --- | --- | --- |
| `background` | Hintergrund jeder Seite | Wasserzeichen, Zierrahmen |
| `title` | Einmal am Berichtsanfang | Titel, Empfänger |
| `pageHeader` | Oben auf jeder Seite | Firmenname, Ausstellungsdatum |
| `columnHeader` | Vor den Detailzeilen (pro Seite/Spalte) | Überschriftszeile der Detailzeilen |
| `details` | Einmal pro Datenzeile (`rows`) | Detailzeilen |
| `columnFooter` | Nach den Detailzeilen (pro Seite/Spalte) | Zwischensummenbereich |
| `pageFooter` | Unten auf jeder Seite | Seitenzahlen |
| `lastPageFooter` | Unten auf der letzten Seite (ersetzt `pageFooter`, wenn angegeben) | Schlussbemerkungen |
| `summary` | Einmal nach allen Detailzeilen | Gesamtsumme, Anmerkungen |
| `noData` | Wenn die Daten null Zeilen haben | „Keine passenden Daten“ |

Definieren Sie zusätzlich `groups`, werden Gruppenköpfe und -füße automatisch überall dort eingefügt, wo sich der Gruppenschlüssel ändert — so entstehen Layouts wie „Zwischensumme pro Abteilung, danach eine neue Seite beginnen“.

Sie können in der Vorlage außerdem `columns` angeben (`count` = Anzahl der Spalten, `spacing` = Abstand zwischen den Spalten in pt), um den Detailbereich wie bei einer Zeitung in mehrere vertikale **Spalten** fließen zu lassen. Der Standard ist eine Spalte; in diesem Fall bedeutet alles, was in diesem Dokument als „pro Spalte“ beschrieben ist, dasselbe wie „pro Seite“. Der Wechsel zur nächsten Spalte wird als „Spaltenumbruch“ bezeichnet.

### Seitenumbrüche geschehen automatisch

Wenn Detailzeilen nicht mehr auf die Seite passen, schließt die Engine diese Seite automatisch ab (gibt `pageFooter` aus), beginnt die nächste, gibt `pageHeader` und `columnHeader` erneut aus und lässt dann die restlichen Detailzeilen weiterfließen. Sie müssen nie Zeilen zählen oder die verbleibende Seitenhöhe berechnen.

Nur wenn Sie Kontrolle wünschen, greifen Sie zu Folgendem.

- Das Element `break` — erzwingt einen Seiten- oder Spaltenumbruch an beliebiger Position
- `startNewPage` eines Bandes — beginnt dieses Band immer auf einer neuen Seite
- `splitType` eines Bandes — legt fest, ob das Band bei unzureichender Höhe mitten auf der Seite geteilt werden darf (`stretch`) oder ungeteilt auf die nächste Seite verschoben werden muss (`prevent`)

### Subreport = ein Bericht, eingebettet in einen anderen Bericht

Das Element `subreport` bettet eine komplette separate `.report`-Datei in das Layout des Elternberichts ein. „Eine Liste von Aufträgen drucken, und innerhalb jedes Auftrags seine Positionen als Tabelle drucken“ — es ist der Mechanismus, um **verschachtelte Daten** dieser Art zu layouten.

Angenommen, jede Zeile der `rows` des Elternberichts (ein Auftrag) trägt ein Array `items` mit Positionen.

```json
{
  "rows": [
    {
      "orderNo": "A-001",
      "customer": "サンプル商事",
      "items": [
        { "name": "りんご", "qty": 10 },
        { "name": "みかん", "qty": 5 }
      ]
    },
    {
      "orderNo": "A-002",
      "customer": "テスト物産",
      "items": [
        { "name": "ぶどう", "qty": 2 }
      ]
    }
  ]
}
```

Platzieren Sie ein `subreport`-Element im `details`-Band des Elternberichts und übergeben Sie „die `items` dieses Auftrags“ über `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` ist, wie der Name sagt, ein Ausdruck (`Expression`). Um einen festen Dateinamen zu übergeben, schließen Sie ihn innerhalb des Ausdrucks als String-Literal in `'...'` ein (Sie können ihn auch mit einem Ausdruck wie `"field.templatePath"` dynamisch umschalten).

Der Subreport **läuft dann einmal pro Detailzeile des Elternberichts**, und die übergebenen `items` werden als die eigenen `rows` des Subreports behandelt. Der Subreport (`order-items.report`) ist eine eigenständige Vorlage: Er hat seine eigenen Banddefinitionen und verweist auf jede Position über `field.name` und `field.qty`. Auf der Seite entfaltet er sich so.

```text
┌──────────────────────────────┐
│ details                      │ ← rows des Elternberichts, Zeile 1 (Auftrag A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← erhält die items dieses Auftrags (2 Zeilen)
│   │   details              │ │ ← items Zeile 1 (りんご 10)
│   │   details              │ │ ← items Zeile 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows des Elternberichts, Zeile 2 (Auftrag A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← erhält die items dieses Auftrags (1 Zeile)
│   │   details              │ │ ← items Zeile 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

Die Positionstabelle in einer Rechnung, ein pro Kunde wiederholter Detailblock — solche „kleinen Berichte im Bericht“ lassen sich als Komponenten herauslösen und wiederverwenden. Auch Parameter (Überschriftentexte und dergleichen) können vom Elternbericht nach unten durchgereicht werden. Der spätere Abschnitt **Lauffähige Beispiele für jedes Element** enthält ein vollständiges, direkt ausführbares Beispiel genau dieser Konstellation (das Elternelement plus die Vorlage auf Subreport-Seite).

## Ein PDF aus einer `.report`-Datei und JSON-Daten erzeugen

Eine `.report`-Datei ist eine Berichtsvorlage: ein als JSON geschriebenes `ReportTemplate`. Da es sich um reines JSON handelt, können Sie Diffs in Git verfolgen und die Datei aus jeder Sprache oder jedem Werkzeug heraus erzeugen.

Die Minimalkonfiguration besteht aus diesen drei Dateien.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Die beiden Schriftart-Dateinamen gehen von den Schnitten Regular / Bold einer japanischen Schriftart aus (z. B. Noto Sans JP). Ersetzen Sie sie durch die Schriftarten, die Sie zur Hand haben. Wie Sie mehrere Sprachen in einem einzigen Bericht behandeln, wird später unter **Mehrsprachige Berichte erstellen** beschrieben.

### 1. Die Vorlage schreiben: `quotation.report`

Koordinaten, Abmessungen, Ränder und Schriftgrößen sind durchgehend in **pt (Punkt, 1 pt = 1/72 Zoll ≈ 0,353 mm)** angegeben, der Standardeinheit von PDF. `"size": "A4"` wird als 595 × 842 pt behandelt (die ISO-Abmessungen von 210×297 mm, in pt umgerechnet und auf ganze Zahlen gerundet); die 36-pt-Ränder in diesem Beispiel entsprechen etwa 12,7 mm.

Noch eine Voraussetzung: `fontFamily` in `styles` ist kein Schriftart-Dateiname, sondern ein **Schlüssel (logischer Name)**, den Sie später im Laufzeitcode in `fontMap` und `fonts` registrieren. Dass in Vorlage und Code dieselben Namen verwendet werden (`jp` und `jpBold` in diesem Beispiel), stellt die Verbindung her.

```json
{
  "name": "quotation",
  "page": {
    "size": "A4",
    "margins": { "top": 36, "right": 36, "bottom": 36, "left": 36 }
  },
  "parameters": [
    { "name": "title", "type": "string", "defaultValue": "御見積書" }
  ],
  "fields": [
    { "name": "item", "type": "string" },
    { "name": "quantity", "type": "number" },
    { "name": "amount", "type": "number" }
  ],
  "variables": [
    {
      "name": "grandTotal",
      "expression": "field.amount",
      "calculation": "sum",
      "resetType": "report"
    }
  ],
  "styles": [
    { "name": "title", "fontFamily": "jpBold", "fontSize": 20 },
    { "name": "body", "fontFamily": "jp", "fontSize": 10 },
    { "name": "header", "fontFamily": "jpBold", "fontSize": 10 },
    { "name": "amount", "fontFamily": "jp", "fontSize": 10, "hAlign": "right" }
  ],
  "bands": {
    "title": {
      "height": 52,
      "elements": [
        {
          "type": "textField",
          "x": 0, "y": 0, "width": 523, "height": 30,
          "expression": "param.title",
          "style": "title"
        }
      ]
    },
    "columnHeader": {
      "height": 24,
      "elements": [
        {
          "type": "staticText",
          "x": 0, "y": 0, "width": 300, "height": 20,
          "text": "品名",
          "style": "header"
        },
        {
          "type": "staticText",
          "x": 300, "y": 0, "width": 80, "height": 20,
          "text": "数量",
          "style": "header",
          "hAlign": "right"
        },
        {
          "type": "staticText",
          "x": 380, "y": 0, "width": 143, "height": 20,
          "text": "金額",
          "style": "header",
          "hAlign": "right"
        }
      ]
    },
    "details": [
      {
        "height": 24,
        "elements": [
          {
            "type": "textField",
            "x": 0, "y": 0, "width": 300, "height": 20,
            "expression": "field.item",
            "style": "body"
          },
          {
            "type": "textField",
            "x": 300, "y": 0, "width": 80, "height": 20,
            "expression": "field.quantity",
            "pattern": "#,##0",
            "style": "amount"
          },
          {
            "type": "textField",
            "x": 380, "y": 0, "width": 143, "height": 20,
            "expression": "field.amount",
            "pattern": "¥#,##0",
            "style": "amount"
          }
        ]
      }
    ],
    "summary": {
      "height": 36,
      "elements": [
        {
          "type": "line",
          "x": 300, "y": 0, "width": 223, "height": 0,
          "lineWidth": 0.5,
          "lineColor": "#333333"
        },
        {
          "type": "staticText",
          "x": 300, "y": 8, "width": 80, "height": 20,
          "text": "合計",
          "style": "header"
        },
        {
          "type": "textField",
          "x": 380, "y": 8, "width": 143, "height": 20,
          "expression": "vars.grandTotal",
          "pattern": "¥#,##0",
          "style": "amount"
        }
      ]
    }
  }
}
```

Das in den Detailzeilen verwendete `pattern` ist eine Formatangabe für Zahlen/Datumswerte (`#,##0` = Tausendertrennzeichen, `¥#,##0` = Tausendertrennzeichen mit Yen-Zeichen; Details siehe „Zahlen und Datumswerte formatieren“ weiter unten in diesem Dokument).

### 2. Die Daten vorbereiten: `quotation.test-data.json`

Jede Zeile in `rows` wird im Detailband an `field.*` gebunden, und `parameters` wird für den gesamten Bericht an `param.*` gebunden.

```json
{
  "parameters": {
    "title": "御見積書"
  },
  "rows": [
    {
      "item": "高耐久ボールベアリング",
      "quantity": 12,
      "amount": 48000
    },
    {
      "item": "産業用制御モジュール",
      "quantity": 3,
      "amount": 126000
    }
  ]
}
```

Die Bindungen bilden sich wie folgt ab.

| JSON | Ausdruck in `.report` | Zweck |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Aktuelle Detailzeile |
| `parameters.title` | `param.title` | Berichtsweites Argument |
| Variable `grandTotal` | `vars.grandTotal` | Berichtsvariablen für Summen, Zählungen usw. |
| Seitenkontext | `PAGE_NUMBER` / `TOTAL_PAGES` | Seitenzahl, Gesamtseitenzahl |

### 3. Die `.report`-Datei laden und das PDF erzeugen

```js
// print-report.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import {
  Font,
  TextMeasurer,
  checkGlyphCoverage,
  createReportFromFile,
  renderToPdf,
} from 'tsreport-core'

function loadFont(path) {
  const bytes = readFileSync(path)
  // Node.js-Buffer können sich einen größeren Speicherpool teilen; Font.load einen
  // ArrayBuffer übergeben, der exakt auf die Bytes dieser Datei zugeschnitten ist
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return Font.load(buffer)
}

const regular = loadFont('./reports/fonts/NotoSansJP-Regular.otf')
const bold = loadFont('./reports/fonts/NotoSansJP-Bold.otf')
const fontMap = new Map([
  ['default', new TextMeasurer(regular)],
  ['jp', new TextMeasurer(regular)],
  ['jpBold', new TextMeasurer(bold)],
])
const fonts = { default: regular, jp: regular, jpBold: bold }
const dataSource = JSON.parse(
  readFileSync('./reports/quotation.test-data.json', 'utf8'),
)

const report = createReportFromFile(
  './reports/quotation.report',
  dataSource,
  { fontMap },
)
const coverageIssues = checkGlyphCoverage(report, fonts)
if (coverageIssues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(coverageIssues)}`)
}

const pdf = renderToPdf(report, {
  fonts,
  metadata: { title: dataSource.parameters.title },
})
writeFileSync('./quotation.pdf', pdf)
```

```bash
node print-report.mjs
```

Dieselben Schriftarten werden zweimal registriert, in `fontMap` und in `fonts`, weil beide unterschiedliche Rollen erfüllen: `fontMap` dient der Vermessung der Zeichenbreiten zur Layoutzeit (`TextMeasurer`), während `fonts` der Schriftarteinbettung zur PDF-Erzeugungszeit dient. Registrieren Sie dieselbe Schriftart in beiden, unter denselben Schlüsselnamen wie im `fontFamily` der Vorlage.

`createReportFromFile()` löst relative Pfade für Bilder und Subreports gegen das Verzeichnis der Haupt-`.report`-Datei auf. Geben Sie `workingDirectory` an, wird stattdessen dieses Verzeichnis zur Basis. Um einzuschränken, was gelesen werden darf, deklarieren Sie das erlaubte Wurzelverzeichnis explizit in `resources.fileRoot`; relative Verweise, die die Wurzel verlassen, sowie symbolische Links, die nach außerhalb zeigen, werden abgewiesen.

## Vorlagen direkt in TypeScript definieren

Statt eine `.report`-Datei zu verwenden, können Sie die Vorlage als TypeScript-Objekt schreiben. Mit Typprüfung und Autovervollständigung griffbereit eignet sich das für die Erzeugung von Vorlagen aus Code. Der Inhalt ist dasselbe Angebot wie im Tutorial. Koordinaten und Abmessungen sind in pt.

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import {
  Font,
  TextMeasurer,
  checkGlyphCoverage,
  createReport,
  renderToPdf,
  type ReportTemplate,
} from 'tsreport-core'

function loadFont(path: string): Font {
  const bytes = readFileSync(path)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return Font.load(buffer)
}

const jpFont = loadFont('./fonts/NotoSansJP-Regular.otf')
const jpBoldFont = loadFont('./fonts/NotoSansJP-Bold.otf')

const template: ReportTemplate = {
  name: 'quotation',
  page: {
    size: 'A4',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
  },
  styles: [
    { name: 'title', fontFamily: 'jpBold', fontSize: 20 },
    { name: 'body', fontFamily: 'jp', fontSize: 10 },
    { name: 'amount', fontFamily: 'jp', fontSize: 10, hAlign: 'right' },
    { name: 'header', fontFamily: 'jpBold', fontSize: 10 },
    { name: 'amountHeader', fontFamily: 'jpBold', fontSize: 10, hAlign: 'right' },
  ],
  fields: [
    { name: 'item', type: 'string' },
    { name: 'quantity', type: 'number' },
    { name: 'amount', type: 'number' },
  ],
  bands: {
    title: {
      height: 52,
      elements: [{
        type: 'staticText',
        x: 0, y: 0, width: 523, height: 32,
        text: '御見積書',
        style: 'title',
      }],
    },
    columnHeader: {
      height: 24,
      elements: [
        { type: 'staticText', x: 0, y: 0, width: 300, height: 20, text: '品名', style: 'header' },
        { type: 'staticText', x: 300, y: 0, width: 80, height: 20, text: '数量', style: 'amountHeader' },
        { type: 'staticText', x: 380, y: 0, width: 143, height: 20, text: '金額', style: 'amountHeader' },
      ],
    },
    details: [{
      height: 24,
      elements: [
        { type: 'textField', x: 0, y: 0, width: 300, height: 20, expression: 'field.item', style: 'body' },
        { type: 'textField', x: 300, y: 0, width: 80, height: 20, expression: 'field.quantity', pattern: '#,##0', style: 'amount' },
        { type: 'textField', x: 380, y: 0, width: 143, height: 20, expression: 'field.amount', pattern: '¥#,##0', style: 'amount' },
      ],
    }],
  },
}

const dataSource = {
  rows: [
    { item: '高耐久ボールベアリング', quantity: 12, amount: 48000 },
    { item: '産業用制御モジュール', quantity: 3, amount: 126000 },
  ],
}

const fontMap = new Map([
  ['default', new TextMeasurer(jpFont)],
  ['jp', new TextMeasurer(jpFont)],
  ['jpBold', new TextMeasurer(jpBoldFont)],
])
const document = createReport(template, dataSource, { fontMap })
const fonts = { default: jpFont, jp: jpFont, jpBold: jpBoldFont }

const coverageIssues = checkGlyphCoverage(document, fonts)
if (coverageIssues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(coverageIssues)}`)
}

const pdf = renderToPdf(document, {
  fonts,
  metadata: { title: '御見積書' },
})
writeFileSync('./quotation.pdf', pdf)
```

### Elemente per ID nachschlagen und vor dem Rendern ändern

Geben Sie einem Element eine beliebige `id`, und Sie können es mit `findElementById()` abrufen — ganz gleich, wie tief es in Bändern oder Frames steckt. Der Rückgabewert ist keine Kopie, sondern das Element innerhalb von `template` selbst; alle Änderungen vor `createReport()` schlagen sich also in Layout und Rendering nieder.

```ts
import { findElementById, getElementChildren } from 'tsreport-core'

const template: ReportTemplate = {
  page: { size: 'A4' },
  bands: {
    details: [{
      height: 40,
      elements: [{
        id: 'customer-block',
        type: 'frame',
        x: 0, y: 0, width: 300, height: 40,
        elements: [{
          id: 'customer-name',
          type: 'staticText',
          x: 0, y: 0, width: 300, height: 20,
          text: '変更前',
        }],
      }],
    }],
  },
}

const customerName = findElementById(template, 'customer-name')
if (customerName?.type === 'staticText') {
  customerName.text = '株式会社サンプル'
}

const customerBlock = findElementById(template, 'customer-block')
if (customerBlock !== undefined) {
  const directChildren = getElementChildren(customerBlock)
  console.log(directChildren.map((element) => element.id)) // ['customer-name']
}

const document = createReport(template, dataSource, { fontMap })
```

`findElementById()` durchsucht reguläre Bänder, Detailbänder, Gruppenköpfe/-füße, Frames, Soft Masks und Tabellenzellen in Tiefensuche. Kommt dieselbe ID mehr als einmal vor, wird das erste Element in Suchreihenfolge zurückgegeben; halten Sie daher jede ID, die Sie ändern möchten, innerhalb der Vorlage eindeutig. Die Elemente in dem von `getElementChildren()` zurückgegebenen Array sind ebenfalls Referenzen in die Originalvorlage.

> Schriftartdateien sind nicht im Paket enthalten. Wählen Sie Schriftarten, deren Lizenzen zu Ihrem Anwendungsfall, Ihrer Vertriebsart und den Einbettungsrechten passen. Ein Stil kann nur eine einzige Schriftart benennen. Um Zeichen mehrerer Sprachen innerhalb eines einzelnen Elements zu mischen, benötigen Sie eine Pan-CJK-Schriftart, die alle in einer Datei abdeckt (eine Schriftart, die japanische, chinesische und koreanische Zeichen bündelt; z. B. Source Han Sans, Noto Sans CJK). Um pro Sprache eine eigene Schriftart zu verwenden, teilen Sie die Elemente nach Sprache auf und wechseln die Stile, wie im nächsten Abschnitt „Mehrsprachige Berichte erstellen“.

## Mehrsprachige Berichte erstellen

Jeder Stil kann genau eine Schriftart benennen, und es gibt keinen automatischen Fallback zwischen Schriftarten. Das Grundmuster für einen mehrsprachigen Bericht lautet daher: **pro Sprache eine Schriftart laden und den Elementen jeder Sprache den Stil dieser Sprache zuweisen**.

Der folgende Auszug stammt aus einem Angebot, das Japanisch und vereinfachtes Chinesisch nebeneinander darstellt. Laden Sie zunächst für jede Sprache eine Schriftart.

```js
const jaFont = loadFont('./fonts/NotoSansJP-Regular.otf')
const zhFont = loadFont('./fonts/NotoSansSC-Regular.otf')
const fontMap = new Map([
  ['default', new TextMeasurer(jaFont)],
  ['ja', new TextMeasurer(jaFont)],
  ['zh', new TextMeasurer(zhFont)],
])
const fonts = { default: jaFont, ja: jaFont, zh: zhFont }
```

Weisen Sie in der Vorlage dem japanischen Wortlaut den Stil `ja` und dem chinesischen Wortlaut den Stil `zh` zu, indem Sie die Elemente nach Sprache aufteilen.

```json
{
  "styles": [
    { "name": "ja", "fontFamily": "ja", "fontSize": 12 },
    { "name": "zh", "fontFamily": "zh", "fontSize": 12 }
  ],
  "bands": {
    "title": {
      "height": 40,
      "elements": [
        { "type": "staticText", "x": 0, "y": 0, "width": 160, "height": 28, "text": "御見積書", "style": "ja" },
        { "type": "staticText", "x": 170, "y": 0, "width": 160, "height": 28, "text": "报价单", "style": "zh" }
      ]
    },
    "columnHeader": {
      "height": 22,
      "elements": [
        { "type": "staticText", "x": 0, "y": 0, "width": 150, "height": 18, "text": "品名", "style": "ja" },
        { "type": "staticText", "x": 160, "y": 0, "width": 150, "height": 18, "text": "商品名称", "style": "zh" }
      ]
    },
    "details": [
      {
        "height": 22,
        "elements": [
          { "type": "textField", "x": 0, "y": 0, "width": 150, "height": 18, "expression": "field.nameJa", "style": "ja" },
          { "type": "textField", "x": 160, "y": 0, "width": 150, "height": 18, "expression": "field.nameZh", "style": "zh" }
        ]
      }
    ]
  }
}
```

Die Daten führen ebenfalls ein Feld pro Sprache.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

Die Ausnahme ist **ein einzelnes Feld, dessen Sprache bis zur Laufzeit unbekannt ist**, etwa ein Freitext-Bemerkungsfeld. Da sich ein solches Feld nicht in Elemente pro Sprache aufteilen lässt, besteht die praktikable Antwort darin, allein diesem Stil eine Pan-CJK-Schriftart zuzuweisen, die viele Schriftsysteme in einer Datei abdeckt (Source Han Sans, Noto Sans CJK und dergleichen). In jedem Fall erkennt `checkGlyphCoverage()` etwaige Lücken in der Schriftartabdeckung vor der Ausgabe.

## Den Schriftart-Ausgabemodus pro Textelement wählen

Selbst innerhalb eines Berichts können Sie den Ausgabemodus pro `staticText` oder `textField` festlegen: durchsuchbarer eingebetteter Text für den Fließtext, Pfade (Outlines) für das Logo, Verweise auf Systemschriftarten für Standardtexte.

| Modus | Angabe | Zustand im PDF | Geeignet für |
| --- | --- | --- | --- |
| Subset-Einbettung | `pdfFontMode: 'embedded'` (Standard) | Bettet die verwendeten Glyphen plus das Schriftprogramm ein. Text kann ausgewählt und durchsucht werden | Verteilung, Langzeitarchivierung, Druck, mehrsprachige Berichte |
| Umwandlung in Pfade | `outlineText: true` | Wandelt Glyphenformen in Vektorpfade um. Trägt keine Schriftartinformationen | Logos, reprofertige Vorlagen — Text, dessen Formen exakt eingefroren werden müssen |
| Verweis auf Systemschriftart | `pdfFontMode: 'reference'` | Bettet keine Schriftart ein; hält nur Schriftartnamen und Zeichen fest | Leichtgewichtige PDFs für die interne Verteilung, wenn die Schriftartumgebung unter Kontrolle ist |

```ts
const textElements = [
  {
    type: 'staticText' as const,
    x: 0, y: 0, width: 220, height: 24,
    text: '検索できる日本語',
    style: 'body',
    pdfFontMode: 'embedded' as const,
  },
  {
    type: 'staticText' as const,
    x: 0, y: 28, width: 220, height: 24,
    text: '形状を固定する標章',
    style: 'body',
    outlineText: true,
  },
  {
    type: 'staticText' as const,
    x: 0, y: 56, width: 220, height: 24,
    text: '端末のフォントを参照',
    style: 'body',
    pdfFontMode: 'reference' as const,
  },
]
```

Die Subset-Einbettung ist der empfohlene Modus, um Glyphenformen unabhängig von der Zielumgebung zu bewahren. Verweise auf Systemschriftarten erfordern überall dort, wo das PDF geöffnet wird, eine kompatible Schriftart, und das Erscheinungsbild kann von Umgebung zu Umgebung variieren. In Pfade umgewandelter Text kann nicht wie gewöhnlicher Text ausgewählt oder durchsucht werden.

## Vertikaler Schriftsatz

Geben Sie einfach `writingMode` an einem Stil an, und der Text wird vertikal gesetzt — mit Glyphen für den vertikalen Satz und vertikalspezifischen Maßdaten (vertikale Metriken — Dickten und dergleichen). `vertical-rl` rückt die Zeilen von rechts nach links vor, `vertical-lr` von links nach rechts.

```ts
const verticalStyle = {
  name: 'vertical',
  fontFamily: 'jp',
  fontSize: 14,
  writingMode: 'vertical-rl' as const,
}

const verticalText = {
  type: 'staticText' as const,
  x: 440, y: 0, width: 70, height: 260,
  text: '四季を通じて美しく読みやすい縦書き帳票',
  style: 'vertical',
}
```

## Exakt denselben Bericht im Browser in der Vorschau anzeigen

Das für PDF aufgebaute `RenderDocument` kann genauso direkt auf ein Canvas gerendert werden. Vorschau und Druck teilen sich dasselbe Layout-Ergebnis, sodass „Bildschirm und Papier sehen unterschiedlich aus“ schlicht nicht passieren kann. Zusammen mit dem festen pt-basierten Layout ist das die Grundlage für ein WYSIWYG-Vorschau- und Bearbeitungserlebnis (die Schriftarteinbettung ist der Standard; nur der Modus mit Verweis auf Systemschriftarten hängt in seinem Erscheinungsbild von der Anzeigeumgebung ab). Ein einziger Aufruf von `renderPage()` zeichnet die Seite, einschließlich Auf- und Abbau der Seite.

```ts
import { CanvasBackend, Font, TextMeasurer, createReport, renderPage } from 'tsreport-core'

const [regularBuffer, boldBuffer] = await Promise.all([
  fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer()),
  fetch('/fonts/NotoSansJP-Bold.otf').then(response => response.arrayBuffer()),
])
const jpFont = Font.load(regularBuffer)
const jpBoldFont = Font.load(boldBuffer)
const fontMap = new Map([
  ['default', new TextMeasurer(jpFont)],
  ['jp', new TextMeasurer(jpFont)],
  ['jpBold', new TextMeasurer(jpBoldFont)],
])
const reportDocument = createReport(template, dataSource, { fontMap })
const page = reportDocument.pages[0]
const canvas = document.querySelector<HTMLCanvasElement>('#preview')!
const context = canvas.getContext('2d')!

renderPage(page, new CanvasBackend(context, {
  scale: 1.5, // Anzeigemaßstab: 1.0 zeichnet 1 pt als 1 px
  devicePixelRatio: window.devicePixelRatio, // hält Text und Linien auf High-DPI-Displays scharf
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Wenn Sie eine Vorschau-UI in React bauen, steht außerdem das Paket `tsreport-react` zur Verfügung.

## Die Schrift-Engine eigenständig verwenden

Auch ohne einen Bericht zu erstellen, können Sie jede Fähigkeit für sich nutzen: Schriftart-Parsing, Shaping (die Umwandlung einer Zeichenkette in die Abfolge und Positionen der tatsächlich gezeichneten Glyphen), Textvermessung und Subset-Erzeugung.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: Textbreite in pt bei 12 pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // Glyphen-IDs und Positionen nach dem Shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: Bézier-Pfaddaten

console.log(measurement.width, shaped, glyph.outline)
```

## Ein bestehendes PDF in Berichtselemente umwandeln (PDF-Import)

`importPdfPage()` parst eine Seite eines bestehenden PDFs und wandelt sie in ein Array von tsreport-core-Berichtselementen (`ElementDef`) um. Das ist kein bloßer Viewer: Text kommt als `staticText` herein, Bilder als `image`, Formen als `path` — Komponenten, die Sie direkt in dieser Berichts-Engine bearbeiten und neu anordnen können.

Nehmen Sie das PDF eines Formulars, das Sie bisher auf Papier geführt haben, oder ein von einem anderen System erzeugtes PDF, und verwenden Sie es als Basis — ergänzen Sie Datenfelder, ordnen Sie das Layout um. Es ist der Einstiegspunkt, um **bestehende Berichtsbestände in Vorlagen zu verwandeln**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: Array von Berichtselementen (staticText / image / path, …)
// page.styles:   von den Elementen referenzierte Textstildefinitionen
// page.images:   von den Elementen referenzierte Bilddaten
// page.fonts:    Informationen über die referenzierten Schriftarten
console.log(pageCount, page.width, page.height, page.elements.length)
```

Die importierten `elements` und `styles` können direkt in Vorlagenbänder platziert werden. Passwörter für verschlüsselte PDFs, der Import von Anmerkungen, die Umwandlung importierten Texts in Pfade und mehr werden über `PdfImportOptions` gesteuert.
## Ausdrücke meistern

Alles „Dynamische“ in einem Bericht wird als Ausdruck geschrieben: der Inhalt, den ein `textField` druckt, die Druckbedingung in `printWhenExpression`, Barcode-Daten, Bildpfade, an einen Subreport übergebene Daten — jede Eigenschaft vom Typ `Expression` akzeptiert dieselbe Ausdruckssprache.

Ausdrücke gibt es in zwei Formen.

- **String-Ausdrücke** — Zeichenketten wie `"field.price * field.quantity"`. Sie sind eine sichere Teilmenge von JavaScript, die von einem eigenen Parser interpretiert wird; `eval` und `new Function` werden nie verwendet. Vorlagen bleiben als JSON speicherbar (`.report`-Dateien)
- **Callback-Ausdrücke** — TypeScript-Funktionen der Form `(field, vars, param, report) => …`. Sie erhalten die volle Sprachmächtigkeit, aber die Vorlage lässt sich nicht mehr als JSON speichern (dies setzt voraus, dass Sie Vorlagen in TypeScript halten)

Wir empfehlen, zunächst zu prüfen, wie weit Sie mit String-Ausdrücken kommen, und erst dann zu Callbacks zu wechseln, wenn diese nicht ausreichen.

### In Ausdrücken referenzierbare Werte

| Name | Beschreibung |
| --- | --- |
| `field.*` | Die aktuelle Datenzeile. Verschachtelter Zugriff wie `field.customer.name` wird unterstützt |
| `vars.*` | Variablen (in `variables` definierte Aggregatwerte, siehe unten). `var.*` funktioniert genauso |
| `param.*` | Berichtsweite Werte: über `parameters` der Datenquelle übergebene Werte und die `defaultValue`s der `parameters` der Vorlage. In einem Subreport erscheinen hier auch die vom Elternbericht übergebenen Parameter |
| `PAGE_NUMBER` | Die aktuelle Seitenzahl (beginnend bei 1) |
| `COLUMN_NUMBER` | Die aktuelle Spaltennummer (beginnend bei 1) |
| `REPORT_COUNT` | Die Anzahl der verarbeiteten Datenzeilen |
| `TOTAL_PAGES` | Die Gesamtseitenzahl. **Direkt referenziert liefert sie „die bisherige Seitenzahl“**; um die endgültige Gesamtseitenzahl zu drucken, kombinieren Sie sie mit `evaluationTime: 'report'` oder `'auto'` (siehe unten) |

Der Verweis auf ein nicht existierendes Feld wirft keine Ausnahme; er wird zu `undefined` ausgewertet (selbst wenn ein Zwischenglied von `field.a.b` `null` ist, wird sicher `null` zurückgegeben).

### Verfügbare Syntax in String-Ausdrücken

| Kategorie | Verfügbar |
| --- | --- |
| Literale | Zahlen (`1200`, `0.5`), Zeichenketten (`'見積'` oder `"見積"`, mit Escapes wie `\n`), `true` / `false` / `null` / `undefined` |
| Template-Literale | `` `合計 ${vars.total} 円` `` — innerhalb von `${}` darf ein vollständiger Ausdruck stehen |
| Arithmetik | `+` (numerische Addition und String-Verkettung), `-`, `*`, `/` |
| Vergleich | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Logik | `&&`, `\|\|`, `!` (Kurzschlussauswertung wie in JavaScript) |
| Nullish Coalescing | `??` — liefert die rechte Seite, wenn die linke null/undefined ist |
| Bedingung (ternär) | `condition ? valueIfTrue : valueIfFalse` |
| Sonstiges | unäres `-` / `+`, Klammern `( )`, Memberzugriff in Punktnotation (Eigenschaftsnamen dürfen japanisch sein: `field.顧客名`) |
| Eingebaute Funktionen | `format(value, pattern)` = Formatierung (siehe unten) / `round(value, digits?)` = kaufmännisches Runden / `roundUp`, `roundDown`, `roundHalfEven` (Banker-Rundung), `ceil`, `floor`, `trunc` (jeweils ist das zweite Argument die Anzahl der Nachkommastellen, 0 wenn weggelassen) / `now()` = aktuelle Zeit |

**Nicht verfügbar**: `==` / `!=` (verwenden Sie `===` / `!==`), `%` und `**`, Klammernotation (`field['a-b']`) und Array-Indizierung, Methodenaufrufe (`field.name.toUpperCase()` schlägt zur Auswertungszeit fehl — aufrufbar sind ausschließlich die obigen eingebauten Funktionen), Zuweisungen, Funktionsdefinitionen, `new`, Optional Chaining (`?.` — ohnehin unnötig, da Zwischen-Nulls nie eine Ausnahme werfen). Wenn Sie eines davon benötigen, verwenden Sie einen Callback-Ausdruck.

Diese Einschränkungen dienen der Sicherheit. String-Ausdrücke werden von einem eigenen Parser interpretiert und niemals als Code ausgeführt, sodass eine von außen erhaltene Vorlage keinen beliebigen Code einschleusen kann.

### Ein berechnetes Ergebnis drucken

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Beispieldaten:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Dies druckt `¥3,960`.

### Zeichenketten zusammensetzen

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

In `${}` eines Template-Literals eingebettete Werte werden in Zeichenketten umgewandelt und verkettet. **null wird zur Zeichenkette `"null"`**; hängen Sie daher wie im Beispiel `?? ''` an Werte an, die fehlen können.

### Inhalte anhand einer Bedingung umschalten

Verwenden Sie den ternären Operator, um umzuschalten, was gedruckt wird.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Wenn Sie ändern möchten, *ob* etwas angezeigt wird, statt *was* angezeigt wird, verwenden Sie das für alle Elemente verfügbare `printWhenExpression` (siehe „Ein Element nur bei erfüllter Bedingung drucken“). Um die Gestaltung (Farbe, Fettdruck) anhand einer Bedingung umzuschalten, geben Sie in den `conditionalStyles` der Stildefinition einen Bedingungsausdruck derselben Form an.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Zahlen und Datumswerte formatieren — `format` und `pattern`

`textField` kann das Ausdrucksergebnis zur Druckzeit über die Eigenschaft `pattern` formatieren. Um einen Teilwert innerhalb eines Ausdrucks zu formatieren, verwenden Sie die eingebaute Funktion `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Zahlenmuster kombinieren `#` (Ziffer anzeigen, falls vorhanden), `0` (Auffüllen mit Nullen) und `,` (Tausendertrennzeichen) und können ein Präfix und Suffix tragen. Gerundet wird kaufmännisch.

| Muster | Eingabe | Ausgabe |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Die Datumsmuster-Token sind `yyyy` (vierstelliges Jahr), `MM` / `M` (Monat mit/ohne führende Null), `dd` / `d` (Tag mit/ohne führende Null), `HH` (Stunde mit führender Null, 24-Stunden-Format), `mm` (Minuten) und `ss` (Sekunden). Ein null/undefined-Wert ergibt eine leere Zeichenkette.

Für Formate darüber hinaus (japanische Ära-Datumsangaben, Wochentagsnamen, Währungsstellenbehandlung und so weiter) registrieren Sie benannte TypeScript-Funktionen in den `formatters` der Vorlage und schreiben den Namen in `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// Auf Elementseite: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` sucht zuerst nach einem registrierten Formatter dieses Namens und wird als eingebautes Format interpretiert, wenn keiner gefunden wird. Formatter sind Funktionen; Vorlagen, die dieses Feature nutzen, werden daher in TypeScript statt JSON gehalten.

### Summen, Durchschnitte und Zählungen drucken — Variablen (`variables`)

Aggregation über Detailzeilen hinweg wird in den `variables` der Vorlage definiert. Bei jeder verarbeiteten Datenzeile speist eine Variable das Ergebnis ihres `expression` in ihr Aggregat ein, und Ausdrücke können den aktuellen Wert als `vars.name` referenzieren.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Platzieren Sie ein `textField` mit `"expression": "vars.pageTotal"` im Band `pageFooter` für eine Seitenzwischensumme und eines mit `"expression": "vars.grandTotal"` im Band `summary` für eine Gesamtsumme.

**Eigenschaftsliste (jeder Eintrag von `variables`)**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Variablenname, aus Ausdrücken als `vars.name` referenziert |
| `expression` | Expression | ✓ | Wird für jede Zeile ausgewertet; das Ergebnis fließt in das Aggregat ein |
| `calculation` | `'sum'` = Summe / `'average'` = Durchschnitt / `'count'` = Anzahl / `'distinctCount'` = Anzahl unterschiedlicher Werte / `'min'` = Minimum / `'max'` = Maximum / `'first'` = erster Wert / `'nothing'` = wird jede Zeile überschrieben (letzter Wert) | ✓ | Aggregationsmethode |
| `resetType` | `'report'` = über den ganzen Bericht hinweg weiter aggregieren (kein Zurücksetzen; Standard) / `'page'` = pro Seite zurücksetzen / `'column'` = pro Spalte zurücksetzen / `'group'` = pro in `resetGroup` benannter Gruppe zurücksetzen / `'none'` = wird nie zurückgesetzt, wie `'report'`, aber bei verzögerter Auswertung (`evaluationTime`) bleibt der Wert auf dem Stand des Moments fixiert, in dem das Element platziert wurde (er wird nicht später durch das endgültige Aggregat ersetzt) |  | Rücksetzbereich der Aggregation |
| `resetGroup` | string |  | Zielgruppenname bei `resetType: 'group'` |
| `incrementCondition` | Expression |  | Wenn gesetzt, fließen Zeilen, deren Auswertungsergebnis falsy ist, nicht in das Aggregat ein (bedingte Aggregation) |
| `initialValue` | Expression |  | Anfangswert bei der Initialisierung und bei jedem Zurücksetzen |

Mit `incrementCondition` passt eine bedingte Aggregation wie „nur eine bestimmte Kategorie summieren“ in eine einzige Variable:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Um Ausführungsergebnisse eines Subreports im Elternbericht zu aggregieren, verwenden Sie die `returnValues` des `subreport`-Elements, die die Variablen des Kindes zurück in die `vars.*` des Elternberichts schreiben (siehe die Eigenschaftsliste von `subreport`).

### Seitenzahlen und die Gesamtseitenzahl drucken

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 100, "height": 16,
  "expression": "`${PAGE_NUMBER} / ${TOTAL_PAGES}`",
  "evaluationTime": "auto",
  "hAlign": "center",
  "style": "body"
}
```

Der Schlüssel ist `evaluationTime: 'auto'`. Ausdrücke werden normalerweise in dem Moment ausgewertet, in dem ein Element platziert wird — doch zu diesem Zeitpunkt ist die endgültige Gesamtseitenzahl noch nicht bekannt. Mit `'auto'` wird der Ausdruck statisch analysiert und **jede Referenz zu ihrem jeweils korrekten Zeitpunkt ausgewertet** — `PAGE_NUMBER` beim Abschluss der Seite, `TOTAL_PAGES` beim Abschluss des Berichts. Da `'auto'` den Ausdruck analysieren muss, steht es nur für String-Ausdrücke zur Verfügung (die Angabe auf einem Callback-Ausdruck wirft eine Ausnahme).

### Über String-Ausdrücke hinaus — Callback-Ausdrücke

Wenn Ihre Vorlage in TypeScript definiert ist, können Sie überall dort, wo eine `Expression` akzeptiert wird, direkt eine Funktion schreiben. Sie nimmt vier Argumente, `(field, vars, param, report)`; über `report` erreichen Sie eingebaute Werte wie `PAGE_NUMBER`, die Funktion `format` und die registrierten `formatters`.

```ts
{
  type: 'textField',
  x: 0, y: 0, width: 300, height: 20,
  expression: (field, vars, param, report) => {
    const code = String(field.productCode)
    return code.match(/^[A-Z]{2}-\d{4}$/) ? code.toUpperCase() : `不正なコード: ${code}`
  },
  style: 'body',
}
```

Methodenaufrufe, reguläre Ausdrücke, externe Funktionen — alles, was Sie in TypeScript schreiben können, steht zur Verfügung. Es gibt zwei Kompromisse: Die Vorlage kann nicht mehr als JSON gespeichert oder übertragen werden, und `evaluationTime: 'auto'` ist nicht verfügbar (explizite Werte wie `'report'` funktionieren weiterhin).

### Was passiert, wenn ein Ausdruck fehlschlägt

- **Syntaxfehler und verbotene Konstrukte** (Methodenaufrufe usw.) werfen einen `ExpressionLanguageError` mit Positionsinformationen, der unverändert an den Aufrufer von `createReport()` weitergereicht wird. Er wird nie stillschweigend in eine leere Zelle verwandelt
- **Verweise auf nicht existierende Felder oder Variablen** sind keine Fehler; sie werden zu `undefined` ausgewertet. In einem `textField` wird bei gesetztem `blankWhenNull: true` eine leere Zeichenkette gedruckt; ohne diese Angabe wird die Zeichenkette `null` gedruckt
- Um von Nutzern gelieferte Ausdrücke vor der Ausführung zu validieren, liefert `validateExpressionSource(source)` das Ergebnis der Syntaxprüfung (einen Fehler oder `null`)

## Lauffähige Beispiele für jedes Element

Hier sind alle 16 Elemente, die `ElementDef` bereitstellt. Jedes Element nimmt `x`, `y`, `width` und `height` (in pt, 1 pt = 1/72 Zoll) entgegen und wird in die `elements` eines Bandes oder eines `frame` platziert.

| Was Sie tun möchten | Element |
| --- | --- |
| Festen Text drucken | `staticText` |
| Daten, Variablen oder Ausdrucksergebnisse drucken | `textField` |
| Eine Linie zeichnen | `line` |
| Ein Rechteck oder eine abgerundete Box zeichnen | `rectangle` |
| Einen Kreis oder eine Ellipse zeichnen | `ellipse` |
| Eine beliebige Vektorform zeichnen | `path` |
| Ein Bild platzieren | `image` |
| Mehrere Elemente in einem Rahmen gruppieren | `frame` |
| Eine Tabelle drucken | `table` |
| Eine Kreuztabelle drucken | `crosstab` |
| Einen Bericht in einen anderen einbetten | `subreport` |
| Einen Barcode oder QR-Code drucken | `barcode` |
| Eine mathematische Formel drucken | `math` |
| SVG drucken | `svg` |
| Ein ausfüllbares PDF-Formular erstellen | `formField` |
| An beliebiger Stelle einen Seiten- oder Spaltenumbruch erzwingen | `break` |
| Ein Element nur bei erfüllter Bedingung drucken | `printWhenExpression` (ein für alle Elemente gemeinsames Attribut) |

Im Folgenden erhält jedes Element eine Definition, die Sie direkt in das `elements`-Array eines Bandes einsetzen können, plus Beispieldaten für die Elemente, die Ausdrücke verwenden. Am Ende des Abschnitts jedes Elements steht die elementspezifische Eigenschaftsliste. Für die allen Elementen gemeinsamen Eigenschaften (Position, Farben, Druckbedingungen und so weiter) und die Stileigenschaften siehe die „Referenz der Elementeigenschaften“ weiter unten.

### Festen Text drucken — `staticText`

Druckt eine in der Vorlage geschriebene Zeichenkette exakt so, wie sie ist. Verwenden Sie es für Überschriften und Beschriftungen.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Elementtyp |
| `text` | string | ✓ | Die zu druckende feste Zeichenkette |
| `actualText` | string |  | Ersatztext für den Fall, dass die sichtbaren Zeichen vom per Kopieren und Suchen erhaltenen Text abweichen (PDF /ActualText). Wird hauptsächlich vom PDF-Import verwendet, um die Einstellung des Quell-PDFs zu erhalten |
| `hyperlink` | HyperlinkDef |  | Hyperlink (siehe **`HyperlinkDef`** im Abschnitt über die gemeinsamen Eigenschaften) |
| `anchorName` | string |  | Ankername. Wird als Ziel für Lesezeichen und dokumentinterne Links (`hyperlink` vom Typ `'localAnchor'`) registriert |
| `bookmarkLevel` | number |  | Hierarchieebene (1 = oberste Ebene, 1–6), auf der der Text dieses Elements im Inhaltsverzeichnis (Lesezeichen) in der Seitenleiste des PDF-Viewers aufgeführt wird |

Hinweis: Darüber hinaus können alle elementgemeinsamen Eigenschaften und jede `TextProperties`-Eigenschaft angegeben werden.

### Daten und Ausdrucksergebnisse drucken — `textField`

Druckt das Ergebnis der Auswertung von `expression`. Es kann `field.*` (Daten), `vars.*` (Variablen), `param.*` (Parameter), `PAGE_NUMBER` und mehr referenzieren, und Template-Literale erlauben das Zusammensetzen von Zeichenketten. Die vollständige Ausdruckssprache finden Sie unter „Ausdrücke meistern“. Verwenden Sie `pattern` für die Zahlen-/Datumsformatierung und `stretchWithOverflow`, damit die Höhe mit der Textmenge wachsen kann.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Beispieldaten:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Elementtyp |
| `expression` | Expression | ✓ | Ausdruck, der den zu druckenden Wert liefert |
| `pattern` | string |  | Formatmuster. Ein an der Vorlage registrierter benutzerdefinierter Formatter (ein `formatters`-Name) hat Vorrang; andernfalls wird der Wert mit dem eingebauten Formatter formatiert |
| `blankWhenNull` | boolean |  | Bei null/undefined als Ausdrucksergebnis eine leere Zeichenkette drucken (ohne diese Angabe wird die Zeichenkette `'null'` gedruckt) |
| `stretchWithOverflow` | boolean |  | Wenn der Inhalt nicht in height passt, die Elementhöhe auf den Inhalt dehnen |
| `evaluationTime` | `'now'` = sofort an Ort und Stelle auswerten (Standard) / `'band'` = beim Abschluss des Bandes auswerten / `'column'` = am Ende der Spalte auswerten / `'page'` = am Ende der Seite auswerten / `'group'` = beim Schließen der in `evaluationGroup` benannten Gruppe auswerten / `'report'` = am Ende des Berichts auswerten (TOTAL_PAGES usw. sind endgültig) / `'auto'` = jede vom Ausdruck referenzierte Variable und jeden eingebauten Wert einzeln zu seinem eigenen Rücksetzzeitpunkt auswerten (nur String-Ausdrücke; Callback-Ausdrücke werfen eine Ausnahme) |  | Wann der Ausdruck ausgewertet wird. Bei jedem Nicht-Standardwert wird der Bereich bei der Platzierung zunächst leer reserviert und ausgefüllt, sobald der Wert zum entsprechenden Zeitpunkt feststeht. Typische Verwendungen: eine Gruppensumme vor der Gruppe anzeigen (`'group'`), die endgültige Gesamtseitenzahl drucken (`'report'`) |
| `evaluationGroup` | string |  | Zielgruppenname bei `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = nicht passende Zeilen werden nicht gezeichnet (Standard; in der aktuellen Implementierung identisch mit `'truncate'`) / `'truncate'` = nicht passenden Text zeilenweise abschneiden / `'ellipsisChar'` = die letzte Zeile an einer Zeichengrenze kürzen und `...` anhängen / `'ellipsisWord'` = die letzte Zeile an einer Wortgrenze kürzen und `...` anhängen |  | Behandlung von Text, der bei ausgeschaltetem `stretchWithOverflow` nicht in die Höhe passt. Standard: `none` |
| `hyperlink` | HyperlinkDef |  | Hyperlink (siehe **`HyperlinkDef`** im Abschnitt über die gemeinsamen Eigenschaften) |
| `anchorName` | string |  | Ankername. Wird als Ziel für Lesezeichen und dokumentinterne Links (`hyperlink` vom Typ `'localAnchor'`) registriert |
| `bookmarkLevel` | number |  | Hierarchieebene (1 = oberste Ebene, 1–6), auf der der Text dieses Elements im Inhaltsverzeichnis (Lesezeichen) in der Seitenleiste des PDF-Viewers aufgeführt wird |

Hinweis: Darüber hinaus können alle elementgemeinsamen Eigenschaften und jede `TextProperties`-Eigenschaft angegeben werden. `isPrintRepeatedValues: false` wird von diesem Element beachtet (unterdrückt das Drucken aufeinanderfolgender identischer Werte).

### Eine Linie zeichnen — `line`

Dieses Beispiel ist eine horizontale Linie der Höhe 0. `lineStyle` akzeptiert neben `solid` auch `dashed` und andere.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Elementtyp. Die Strecke wird von der linken oberen Ecke `(x, y)` des Elements zu seiner rechten unteren Ecke `(x+width, y+height)` gezeichnet (`height: 0` ergibt eine horizontale Linie, `width: 0` eine vertikale, beide ungleich null eine Diagonale) |
| `lineWidth` | number |  | Linienbreite (pt). Standard: 1 |
| `lineStyle` | `'solid'` = durchgezogen / `'dashed'` = gestrichelt / `'dotted'` = gepunktet |  | Linienstil. Standard: solid |
| `lineColor` | string |  | Linienfarbe. Standard: das `forecolor` des Elements, oder `#000000`, wenn auch dieses fehlt |

### Ein Rechteck oder eine abgerundete Box zeichnen — `rectangle`

Mit `cornerRadii` lässt sich jede Ecke einzeln abrunden.

```json
{
  "type": "rectangle",
  "x": 0, "y": 0, "width": 100, "height": 60,
  "cornerRadii": {
    "topLeft": 12,
    "topRight": 12,
    "bottomRight": 4,
    "bottomLeft": 4
  },
  "fill": "#E0F2FE",
  "stroke": "#0369A1",
  "strokeWidth": 1
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Elementtyp |
| `radius` | number |  | Eckenradius (pt, von allen Ecken geteilt) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Radius pro Ecke (pt) |
| `fill` | FillDef |  | Füllung (siehe **`FillDef`** im Abschnitt über die gemeinsamen Eigenschaften). Standard: das `backcolor` des Stils (sofern es nicht `transparent` ist) |
| `stroke` | string |  | Rahmenfarbe. Standard: das `forecolor` des Stils |
| `strokeWidth` | number |  | Rahmenbreite (pt). Standard: 1 |

### Einen Kreis oder eine Ellipse zeichnen — `ellipse`

Zeichnet eine Ellipse, die der Breite und Höhe des Elements einbeschrieben ist.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Elementtyp. Zeichnet die Ellipse, die dem Begrenzungsrahmen des Elements einbeschrieben ist (Mittelpunkt `(x+width/2, y+height/2)`, Radien `width/2` × `height/2`) |
| `fill` | FillDef |  | Füllung (siehe **`FillDef`** im Abschnitt über die gemeinsamen Eigenschaften). Ohne Angabe keine Füllung |
| `stroke` | string |  | Rahmenfarbe. Ohne Angabe kein Rahmen |
| `strokeWidth` | number |  | Rahmenbreite (pt). Standard: 1 (wenn `stroke` gesetzt ist) |

### Eine beliebige Vektorform zeichnen — `path`

Schreiben Sie SVG-Pfadsyntax in `d` und ihr Koordinatensystem in `viewBox`. Die Form wird auf den Rahmen des Elements skaliert.

```json
{
  "type": "path",
  "x": 0, "y": 0, "width": 100, "height": 60,
  "viewBox": [0, 0, 100, 60],
  "d": "M 5 55 L 50 5 L 95 55 Z",
  "fill": "#FEF3C7",
  "stroke": "#B45309",
  "strokeWidth": 2
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Elementtyp |
| `d` | string | ✓ | SVG-Pfaddaten (M/L/C/Z usw.). Koordinaten sind elementlokale pt |
| `pdfSourceVector` | PdfSourceVectorDef |  | Wird vom PDF-Import erzeugt, um eine wiederholt auftretende Form (Kartensymbole usw.) als „eine Definition + N Platzierungen“ zu erhalten (siehe **`PdfSourceVectorDef`** weiter unten). Wenn gesetzt, wird `d` nicht geparst. In handgeschriebenen Vorlagen nicht nötig |
| `affineTransform` | [number, number, number, number, number, number] |  | Affine Transformationsmatrix, die Pfadkoordinaten vor dem Zeichnen in elementlokale Koordinaten abbildet. `[a, b, c, d, e, f]` ergibt `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. Pfadkoordinaten werden aus dieser Region auf Breite und Höhe des Elements skaliert |
| `fill` | FillDef |  | Füllung (siehe **`FillDef`** im Abschnitt über die gemeinsamen Eigenschaften). Ohne Angabe keine Füllung |
| `fillRule` | `'nonzero'` (Standard) / `'evenodd'` |  | Regel, die bei selbstschneidenden oder verschachtelten Pfaden entscheidet, welche Regionen als „innen“ gelten. Um ein Donut-artiges Loch auszustanzen, ist `'evenodd'` die verlässliche Wahl |
| `fillOpacity` | number |  | Deckkraft der Füllung (0.0–1.0) |
| `stroke` | FillDef |  | Kontur (Volltonfarben ebenso wie Verläufe und mehr). Ohne Angabe keine Kontur |
| `strokeWidth` | number |  | Konturbreite (pt). Standard: 1 (wenn `stroke` gesetzt ist) |
| `strokeOpacity` | number |  | Deckkraft der Kontur (0.0–1.0) |
| `strokeLinecap` | `'butt'` = am Ende abgeschnitten / `'round'` = runde Kappe / `'square'` = quadratische Kappe (um die halbe Linienbreite verlängert) |  | Form der Linienenden |
| `strokeLinejoin` | `'miter'` = Gehrung (spitz) / `'round'` = abgerundet / `'bevel'` = abgeschrägt |  | Form der Linienverbindungen |
| `strokeMiterLimit` | number |  | Gehrungsgrenze. Standard: 10 |
| `strokeDasharray` | number[] |  | Strichmuster (Array aus Strich- und Lückenlängen, pt) |
| `strokeDashoffset` | number |  | Startversatz in das Strichmuster (pt) |

### Ein Bild platzieren — `image`

Geben Sie das Bild mit `sourceExpression` (einem Ausdruck) oder `source` (einem festen Wert) an. `scaleMode` steuert, wie das Bild in den Rahmen eingepasst wird, und `onError` wählt das Verhalten, wenn das Bild nicht gefunden werden kann (`error` = einen Fehler auslösen / `blank` = leer lassen / `icon` = ein Symbol anzeigen).

```json
{
  "type": "image",
  "x": 0, "y": 0, "width": 100, "height": 72,
  "sourceExpression": "field.logoPath",
  "scaleMode": "retainShape",
  "hAlign": "center",
  "vAlign": "middle",
  "onError": "error"
}
```

Beispieldaten:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Elementtyp |
| `source` | string | | Feste Bildreferenz (Bild-ID). Schreiben Sie einen Pfad relativ zur `.report`-Datei, einen absoluten Pfad, eine URL, einen Data-URI usw. direkt hinein (zu den ID-Regeln siehe „Einschränkungen beim Laden von Ressourcen und Bild-ID-Regeln“ weiter unten). Wird verwendet, wenn `sourceExpression` fehlt oder sein Ergebnis sich nicht auflösen lässt |
| `sourceExpression` | Expression | | Dynamischer Bildquellen-Ausdruck. Ein String-Ergebnis wird als Bild-ID aufgelöst; ein `Uint8Array`-Ergebnis wird als die Bilddaten selbst behandelt |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Wie das Bild skaliert wird. `'clip'` = das Bild in natürlicher Größe platzieren und am Elementrahmen beschneiden / `'fillFrame'` = unter Ignorieren des Seitenverhältnisses auf den Rahmen dehnen / `'retainShape'` = das Seitenverhältnis beibehalten und auf die größte in den Rahmen passende Größe skalieren / `'realSize'` = natürliche Größe plus Rahmenbeschnitt (identisch zu `'clip'` implementiert). Standard: `'retainShape'`. Wenn die Bildgröße nicht ermittelt werden kann, verhält es sich wie `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Horizontale Platzierung des Bildes im Rahmen (beeinflusst die Randplatzierung bei `retainShape` und die Beschnittposition bei `clip`/`realSize`). Standard: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Vertikale Platzierung des Bildes im Rahmen. Standard: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Verhalten, wenn die Bildquelle undefiniert ist oder sich nicht auflösen lässt. `'error'` = eine Ausnahme werfen / `'blank'` = nichts zeichnen / `'icon'` = eine graue Platzhalterbox mit ×-Markierung zeichnen. Standard: `'icon'` |
| `lazy` | boolean | | Existiert nur in der Typdefinition; wird von den aktuellen Implementierungen der Layout-Engine und der Renderer nicht referenziert (nicht von der Spezifikation abgedeckt) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Bilddrehwinkel (Grad) |
| `affineTransform` | [number, number, number, number, number, number] | | Alternative Möglichkeit, die Platzierung direkt als Matrix anzugeben. `[a, b, c, d, e, f]` ist eine Transformation, die das Einheitsquadrat-Bild (0–1) über `x' = a·x + c·y + e`, `y' = b·x + d·y + f` abbildet; wenn gesetzt, wird die Platzierungsberechnung aus `scaleMode`/`hAlign`/`vAlign`/`rotation` übersprungen. Wird hauptsächlich vom PDF-Import verwendet, um die ursprüngliche Platzierung zu erhalten |
| `opacity` | number | | Deckkraft (0.0–1.0) |
| `interpolate` | boolean | | Den Viewer Pixelgrenzen glätten lassen, wenn ein Bild niedriger Auflösung vergrößert wird (PDF /Interpolate). Für Fotos aktivieren; für Bilder, die scharf bleiben müssen, etwa Barcodes, deaktivieren |
| `alternates` | PdfImageAlternateDef[] |  | PDF-Alternativbilder (/Alternates), um auf dem Bildschirm und im Druck unterschiedliche Bilder zu verwenden. Jeder Eintrag hat zwei Eigenschaften: `source` = Verweis auf das Alternativbild (Pflicht) und `defaultForPrinting` = ob dieses beim Drucken verwendet wird |
| `opi` | PdfOpiMetadataDef |  | OPI-Informationen für den kommerziellen Druck, bei dem ein niedrig aufgelöstes Platzhalterbild zur Ausgabezeit gegen das hochaufgelöste Bild getauscht wird. Hauptsächlich zur Erhaltung beim PDF-Import (siehe **`PdfOpiMetadataDef`** weiter unten) |
| `measure` | PdfMeasurement |  | Maßstabs- und Koordinatensysteminformationen für die Messwerkzeuge des Viewers in Zeichnungs- und Karten-PDFs. Hauptsächlich zur Erhaltung beim PDF-Import (siehe **`PdfMeasurement`** weiter unten) |
| `pointData` | PdfPointData[] |  | Punktdaten (Breiten-/Längengrad usw.) in Karten-PDFs. Hauptsächlich zur Erhaltung beim PDF-Import (siehe **`PdfPointData`** weiter unten) |
| `hyperlink` | HyperlinkDef | | Hyperlink (`type`: `'reference'` = URL / `'localAnchor'` = dokumentinterner Anker / `'localPage'` = dokumentinterne Seite / `'remoteAnchor'`, `'remotePage'` = Anker/Seite in einem externen PDF; `target`: Ausdruck für das Linkziel; `remoteDocument?`: Ausdruck für den externen PDF-Pfad) |

### Mehrere Elemente in einem Rahmen gruppieren — `frame`

Gruppiert Kindelemente; `border` zeichnet einen Rahmen und `clip` beschneidet jeden Überlauf. Die Koordinaten der Kindelemente nehmen die linke obere Ecke des Frames als Ursprung.

```json
{
  "type": "frame",
  "x": 0, "y": 0, "width": 200, "height": 72,
  "clip": true,
  "border": {
    "top": { "width": 1, "color": "#6B7280", "style": "solid" },
    "right": { "width": 1, "color": "#6B7280", "style": "solid" },
    "bottom": { "width": 1, "color": "#6B7280", "style": "solid" },
    "left": { "width": 1, "color": "#6B7280", "style": "solid" }
  },
  "elements": [
    {
      "type": "staticText",
      "x": 8, "y": 8, "width": 184, "height": 20,
      "text": "frame内の子要素",
      "style": "body"
    },
    {
      "type": "textField",
      "x": 8, "y": 36, "width": 184, "height": 20,
      "expression": "field.note",
      "style": "body"
    }
  ]
}
```

Beispieldaten:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Elementtyp |
| `clip` | boolean | | Ob Kinder an der Frame-Grenze beschnitten werden. Standard: true |
| `border` | BorderDef | | Rahmen (siehe **`BorderDef`** im Abschnitt über die gemeinsamen Eigenschaften) |
| `padding` | Padding | | Innenabstand (`top?`/`bottom?`/`left?`/`right?`, jeweils in pt) |
| `rotation` | number | | Drehwinkel des Frames (Grad, gegen den Uhrzeigersinn in Seitenkoordinaten) |
| `rotationOriginX` | number | | X des Drehursprungs (frame-relativ, pt). Standard: 0 |
| `rotationOriginY` | number | | Y des Drehursprungs (frame-relativ, pt). Standard: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Affine Matrix, die frame-lokale Koordinaten (Y nach oben) in den Elternkoordinatenraum abbildet (Matrixaufbau und Bedeutung wie beim `affineTransform` von `image`). Wird hauptsächlich vom PDF-Import verwendet, um die ursprüngliche Platzierung zu erhalten |
| `pdfForm` | PdfFormXObjectDef |  | Bewahrt beim PDF-Import das Koordinatensystem und die Metadaten, die eine Komponente (Form XObject) des Quell-PDFs trug, und gibt sie wieder aus (siehe **`PdfFormXObjectDef`** weiter unten). In handgeschriebenen Vorlagen nicht nötig |
| `hyperlink` | HyperlinkDef | | Hyperlink (gleiche Struktur wie die gleichnamige Eigenschaft von `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Beschneidungspfad in SVG-Pfadsyntax. `d` = Pfaddaten, `fillRule` = Füllregel |
| `transparencyGroup` | boolean | | Behält die Grenze der PDF-Transparenzgruppe bei, auch wenn weder `isolated` noch `knockout` aktiviert ist. Das stellt sicher, dass das zusammengesetzte Ergebnis von Deckkraft und Überblendung so bleibt, als wäre der Frame als ein einziges verflachtes Bild zusammengesetzt worden (hauptsächlich für die Treue beim PDF-Import) |
| `isolated` | boolean | | Isolierte Transparenzgruppe (PDF /Group /I). Wenn dies (oder `knockout` / `softMask`) gesetzt ist, wird der Frame als Einheit zusammengesetzt, bevor Deckkraft, Überblendung und Masken angewendet werden |
| `knockout` | boolean | | Knockout-Transparenzgruppe (PDF /Group /K). Überlappende Kinder innerhalb der Gruppe scheinen nicht durcheinander hindurch; an jeder Position wird nur das oberste Kind mit dem Hintergrund zusammengesetzt |
| `softMask` | FrameSoftMaskDef | | Soft Mask, die den Frame teilweise transparent macht (siehe **`FrameSoftMaskDef`** in der Tabelle unten). Verwendet das Rendering ihrer `elements` als „Transparenzkarte“ und ermöglicht Effekte wie ein allmähliches Ausblenden entlang eines Verlaufs |
| `deviceParams` | DeviceParamsDef | | Parameter für die Druckvorstufe des kommerziellen Drucks (siehe **`DeviceParamsDef`** in der Tabelle unten). Für gewöhnliche Berichte nicht nötig; hauptsächlich vom PDF-Import verwendet, um die Einstellungen des Quell-PDFs zu erhalten |
| `elements` | ElementDef[] | | Kindelemente innerhalb des Frames |

**`FrameSoftMaskDef`** (Struktur von `softMask`)
| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Maskentyp. `'luminosity'` = je heller ein Maskenbereich, desto deckender der Frame / `'alpha'` = je deckender ein Maskenbereich, desto deckender der Frame |
| `colorSpace` | PdfProcessColorSpaceDef | | Misch-Farbraum der Soft-Mask-Transparenzgruppe |
| `isolated` | boolean | | Isolationsflag der Soft-Mask-Transparenzgruppe |
| `knockout` | boolean | | Knockout-Flag der Soft-Mask-Transparenzgruppe |
| `backdrop` | [number, number, number] | | /BC-Hintergrundfarbe für Luminosity-Masken (DeviceRGB 0–1). Standard: Schwarz |
| `elements` | ElementDef[] | ✓ | Elemente, die als Transparenzgruppe zusammengesetzt werden, um die Maske zu definieren |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | /SMask /TR-Übertragungsfunktion, die Maskenwerte (0..1) neu abbildet |

**`DeviceParamsDef`** (Struktur von `deviceParams`. Für die Druckvorstufe des kommerziellen Drucks und normalerweise nicht nötig — hauptsächlich zur Erhaltung beim PDF-Import)
| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | /TR-Übertragungsfunktion: `'Identity'` / `'Default'` / eine einzelne, von allen Farbplatten geteilte Funktion / ein Array von Funktionen, eine pro Platte der vier Farben |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | /BG-Schwarzaufbau-Funktion (`'Default'` = Gerätestandard über /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | /UCR-Unterfarbenreduktions-Funktion (`'Default'` = Gerätestandard über /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | /HT-Rasterung (Typ-1-Raster / Schwellwert-Arrays der Typen 6, 10, 16 / Typ-5-Sammlung pro Farbmittel) |
| `halftoneOrigin` | [number, number] | | PDF-2.0-Rasterursprung (/HTO, Gerätepixel) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | PDF-2.0-Steuerung der Schwarzpunktkompensation (/UseBlackPtComp) |
| `flatness` | number | | Flachheitstoleranz (/FL) |
| `smoothness` | number | | Glättetoleranz für Verläufe (/SM) |
| `strokeAdjustment` | boolean | | Automatische Konturanpassung (/SA) |

### Eine Tabelle drucken — `table`

Eine Tabelle mit Kopfzeilen, Detailzeilen und Fußzeilen. Übergeben Sie ein Array von Zeilendaten über `dataSourceExpression`; die Detailzeilen wiederholen sich einmal pro Arrayelement.

```json
{
  "type": "table",
  "x": 0, "y": 0, "width": 440, "height": 100,
  "dataSourceExpression": "field.items",
  "columns": [
    { "width": 280, "style": { "fontId": "jp", "fontSize": 9 } },
    { "width": 80, "style": { "fontId": "jp", "fontSize": 9, "hAlign": "right" } },
    { "width": 80, "style": { "fontId": "jp", "fontSize": 9, "hAlign": "right" } }
  ],
  "headerRows": [
    {
      "height": 20,
      "cells": [
        { "text": "品名", "backcolor": "#E5E7EB" },
        { "text": "数量", "backcolor": "#E5E7EB" },
        { "text": "金額", "backcolor": "#E5E7EB" }
      ]
    }
  ],
  "detailRows": [
    {
      "height": 18,
      "cells": [
        { "expression": "field.name" },
        { "expression": "field.quantity" },
        { "expression": "field.amount" }
      ]
    }
  ],
  "footerRows": [
    {
      "height": 20,
      "cells": [
        { "text": "以上", "colSpan": 3, "hAlign": "right" }
      ]
    }
  ]
}
```

Beispieldaten (jedes Element von `items` wird zu einer Detailzeile der Tabelle):

```json
{
  "rows": [
    {
      "items": [
        { "name": "部品A", "quantity": 2, "amount": 12000 },
        { "name": "部品B", "quantity": 4, "amount": 36000 }
      ]
    }
  ]
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Elementtyp |
| `columns` | TableColumnElementDef[] | ✓ | Array der Spaltendefinitionen. Weicht die Summe aller Spalten-`width`s von der Elementbreite ab, werden alle Spalten proportional skaliert, sodass sie exakt in die Elementbreite passen |
| `headerRows` | TableRowElementDef[] |  | Array der Kopfzeilen. Wenn sich die Tabelle über Seiten verteilt, werden sie oben auf jeder Seite erneut gezeichnet |
| `detailRows` | TableRowElementDef[] |  | Array der Detailzeilen. Wird wiederholt gezeichnet, einmal pro Datenzeile (Datenzeilen × alle Zeilen in detailRows) |
| `footerRows` | TableRowElementDef[] |  | Array der Fußzeilen. Wenn sich die Tabelle über Seiten verteilt, werden sie nur auf der letzten Seite gezeichnet |
| `dataSourceExpression` | Expression |  | Verwendet das Array, zu dem der Ausdruck ausgewertet wird, als Datenzeilen dieser Tabelle. Ohne Angabe werden die rows der Hauptdatenquelle verwendet. Wirft eine Ausnahme, wenn das Ergebnis kein Array ist |

**`TableColumnElementDef`** (jeder Eintrag von `columns` = eine Spaltendefinition)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `width` | number | ✓ | Spaltenbreite (pt). Stimmt die Summe über alle Spalten nicht mit der Elementbreite überein, werden die Breiten proportional verteilt |
| `style` | TableCellStyleDef |  | Standard-Zellenstil dieser Spalte. Gibt eine Zelle eine gleichnamige Eigenschaft an, gewinnt die Einstellung der Zelle (Rahmen werden Kante für Kante zusammengeführt) |

**`TableRowElementDef`** (jeder Eintrag von `headerRows`/`detailRows`/`footerRows` = eine Zeilendefinition)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `height` | number | ✓ | Zeilenhöhe (pt). Wird als Minimum behandelt: Die Zeile dehnt sich automatisch aus, wenn umbrochener Text oder Kindelemente in der Zelle nicht passen (bei rowSpan-Zellen dehnt ein Inhaltsüberlauf die letzte Zeile des zusammengeführten Bereichs) |
| `cells` | TableCellElementDef[] | ✓ | Array der Zellendefinitionen dieser Zeile. Spalten, die von einem `rowSpan` einer darüberliegenden Zeile belegt sind, werden bei der Platzierung automatisch übersprungen |

**`TableCellElementDef`** (jeder Eintrag von `cells` = eine Zellendefinition. Zusätzlich zum Folgenden kann jede `TableCellStyleDef`-Eigenschaft direkt angegeben werden)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `text` | string |  | Fester Zellentext |
| `expression` | Expression |  | Datenbindungsausdruck. Die bloße Form `field.name` liest den Wert direkt aus der Datenzeile; alles andere wird über die Ausdrucksauswertung der Engine aufgelöst. Hat bei Angabe Vorrang vor `text` |
| `colSpan` | number |  | Anzahl der horizontal zu verbindenden Spalten. Standard: 1 |
| `rowSpan` | number |  | Anzahl der vertikal zu verbindenden Zeilen. Standard: 1. Die Zellenhöhe ist die Summe der Zeilenhöhen über den zusammengeführten Bereich |
| `elements` | ElementDef[] |  | Array von Kindelementen, die in der Zelle platziert werden. Bei Angabe hat es Vorrang vor dem Rendering von `text`/`expression` und wird auf die Fläche abzüglich des Innenabstands beschnitten gezeichnet. Die Zeilenhöhe dehnt sich automatisch auf die von den Kindern benötigte Höhe |

**`TableCellStyleDef`** (Zellenstil, verwendet in Zellendefinitionen und im `style` einer Spalte)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = linksbündig / `'center'` = zentriert / `'right'` = rechtsbündig |  | Horizontale Textausrichtung |
| `vAlign` | `'top'` = oben ausgerichtet / `'middle'` = zentriert / `'bottom'` = unten ausgerichtet |  | Vertikale Textausrichtung |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Textdrehung (Grad). Standard: 0 |
| `backcolor` | string |  | Hintergrundfarbe der Zelle |
| `forecolor` | string |  | Textfarbe. Standard: `#000000` |
| `fontId` | string |  | Schriftart-ID. Standard: `'default'` |
| `fontSize` | number |  | Schriftgröße (pt). Standard: 10 |
| `bold` | boolean |  | Fett |
| `italic` | boolean |  | Kursiv |
| `underline` | boolean |  | Unterstrichen |
| `strikethrough` | boolean |  | Durchgestrichen |
| `lineSpacing` | LineSpacingDef |  | Zeilenabstandseinstellungen (siehe **`LineSpacingDef`** im Abschnitt über die gemeinsamen Eigenschaften) |
| `letterSpacing` | number |  | Zeichenabstand (pt). Fügt zwischen allen Zeichen einen festen Betrag ein (negative Werte verengen) |
| `wordSpacing` | number |  | Wortabstand (pt; zusätzliche Breite, die Leerzeichen hinzugefügt wird) |
| `firstLineIndent` | number |  | Erstzeileneinzug (pt) |
| `leftIndent` | number |  | Linker Einzug (pt) |
| `rightIndent` | number |  | Rechter Einzug (pt) |
| `wrap` | boolean |  | Textumbruch. Standard: true |
| `shrinkToFit` | boolean |  | Die Schriftgröße automatisch verkleinern, damit der Text in die Zelle passt |
| `minFontSize` | number |  | Minimale Schriftgröße (pt) unter `shrinkToFit`. Standard: 4 |
| `fitWidth` | boolean |  | Die Schriftgröße automatisch anpassen (in beide Richtungen, verkleinern und vergrößern), damit die längste Zeile exakt in die Zellenbreite passt. Eine solche Zelle trägt nicht zur automatischen Zeilenhöhendehnung bei |
| `outlineText` | boolean |  | Den Text in Pfade (Outlines) umgewandelt zeichnen |
| `padding` | number |  | Zelleninnenabstand (pt). Standard: 2 |
| `border` | BorderDef |  | Rahmen pro Zelle (siehe **`BorderDef`** im Abschnitt über die gemeinsamen Eigenschaften). Wird mit dem Rahmen des Spalten-`style` zusammengeführt; die Einstellung der Zelle gewinnt |
| `opacity` | number |  | Deckkraft (0.0–1.0). Unter 1 wird die gesamte Zelle als Deckkraftgruppe gezeichnet |

### Eine Kreuztabelle drucken — `crosstab`

Aggregiert Daten nach Zeilengruppen × Spaltengruppen. Dieses Beispiel summiert `amount` nach Region × Kategorie und gibt außerdem Zwischensummen und eine Gesamtsumme aus.

```json
{
  "type": "crosstab",
  "x": 0, "y": 0, "width": 440, "height": 140,
  "dataSourceExpression": "field.sales",
  "rowGroups": [{ "field": "region" }],
  "columnGroups": [{ "field": "category" }],
  "measures": [
    { "field": "amount", "calculation": "sum", "format": "#,##0" }
  ],
  "rowHeaderWidth": 90,
  "cellWidth": 80,
  "cellHeight": 20,
  "showSubtotals": true,
  "showGrandTotal": true,
  "border": { "color": "#9CA3AF", "width": 0.5 }
}
```

Beispieldaten:

```json
{
  "rows": [
    {
      "sales": [
        { "region": "東日本", "category": "製品", "amount": 48000 },
        { "region": "東日本", "category": "保守", "amount": 8000 },
        { "region": "西日本", "category": "製品", "amount": 36000 }
      ]
    }
  ]
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Elementtyp |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Array der Zeilengruppen-Definitionen. Mehrere Einträge bilden verschachtelte Gruppenebenen, wobei jede Ebene von links eine Zeilenkopf-Spalte belegt. Kopfzellen äußerer Gruppen werden über ihren Bereich vertikal zusammengeführt |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Array der Spaltengruppen-Definitionen. Äußere Gruppen stapeln sich oben und innere darunter; äußere Köpfe werden horizontal über die Breite ihrer Spalten zusammengeführt |
| `measures` | { field, calculation, format? }[] | ✓ | Array der Kennzahl-Definitionen (Aggregatzellen). Bei mehreren Einträgen werden sie innerhalb jeder Datenzelle vertikal gestapelt, wobei jede einen Platz (mindestens `cellHeight`) einnimmt und ihre eigene `calculation`/`format` anwendet. Ein leeres Array wird als implizite Einzelkennzahl mit `field: ''` und `calculation: 'sum'` behandelt |
| `rowHeaderWidth` | number |  | Zeilenkopfbreite (pt), angewendet auf jede Ebene der Zeilengruppen. Standard: 80 |
| `columnHeaderHeight` | number |  | Spaltenkopfhöhe (pt), angewendet auf jede Ebene der Spaltengruppen. Standard: 20 |
| `cellWidth` | number |  | Datenzellenbreite (pt). Standard: 60 |
| `cellHeight` | number |  | Datenzellenhöhe (pt; die Platzhöhe für eine Kennzahl). Dehnt sich mit Textumbruch automatisch aus. Standard: 20 |
| `border` | { color?, width? } |  | Rahmeneinstellungen (siehe Tabelle unten). Nur bei Angabe werden Außenrahmen, Zeilen-/Spaltentrenner und Kopfebenen-Trenner gezeichnet (sie kreuzen nie eine zusammengeführte äußere Kopfzelle) |
| `showSubtotals` | boolean |  | Zwischensummen anzeigen. Standard: false. Bei true wird am Ende des Blocks jeder Gruppe — außer auf der innersten Ebene — eine mit „Total“ beschriftete Zwischensummenzeile/-spalte eingefügt. Zwischensummenwerte werden mit der `calculation` jeder Kennzahl aus den Rohwerten neu aggregiert |
| `showGrandTotal` | boolean |  | Die Gesamtsumme anzeigen. Standard: false. Bei true wird am Ende eine mit „Total“ beschriftete Gesamtsummenzeile/-spalte angehängt (bei null Datenzeilen nicht ausgegeben). Auch Gesamtsummenwerte werden aus den Rohwerten neu aggregiert |
| `dataSourceExpression` | Expression |  | Verwendet das Array, zu dem der Ausdruck ausgewertet wird, als Datenzeilen dieser Kreuztabelle. Ohne Angabe (oder wenn das Ergebnis kein Array ist) werden die rows der Hauptdatenquelle verwendet |

**Zeilen-/Spaltengruppen-Definition (jeder Eintrag von `rowGroups`/`columnGroups`)**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `field` | string | ✓ | Feldname, nach dem gruppiert wird. Gruppen erscheinen in der Reihenfolge ihres ersten Auftretens in den Daten |
| `headerFormat` | string |  | Anzeigeformat für Kopfwerte. Ein einfaches Format, das nur bei numerischen Werten angewendet wird (`'#,##0'` oder alles mit `,` → Tausendertrennzeichen; eine Dezimalangabe wie `'.00'` → feste Dezimalstellen in dieser Genauigkeit; alles andere → einfache Zeichenkettenumwandlung) |

**Kennzahl-Definition (jeder Eintrag von `measures`)**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `field` | string | ✓ | Zu aggregierender Feldname. Nicht-numerische Werte werden in Zahlen umgewandelt; nicht umwandelbare Werte zählen als 0 |
| `calculation` | `'sum'` = Summe / `'count'` = Anzahl / `'average'` = Durchschnitt / `'min'` = Minimum / `'max'` = Maximum | ✓ | Aggregationsmethode. Zwischensummen und Gesamtsummen werden mit derselben Methode aus der Menge der Rohwerte neu aggregiert, sodass auch `average` und dergleichen korrekt herauskommen |
| `format` | string |  | Anzeigeformat für Aggregatwerte (dasselbe einfache Format wie `headerFormat`: `'#,##0'` oder `,` → Tausendertrennzeichen, `'.NN'` → NN feste Dezimalstellen, keines → einfache Zeichenkettenumwandlung) |

**Rahmeneinstellungen (`border`)**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `color` | string |  | Linienfarbe. Standard: `#000000` |
| `width` | number |  | Linienbreite (pt) des Außenrahmens und der Kopf-/Datengrenzen. Standard: 0.5. Innere Zeilen-/Spaltentrenner werden mit der halben Breite gezeichnet |

### Einen Bericht in einen anderen einbetten — `subreport`

Die Idee wurde in den **Grundlagen des Berichtslayouts** erklärt. Hier ist eine vollständige Definition, die unverändert funktioniert. Der Subreport läuft einmal pro Detailzeile des Elternberichts, und das über `dataSourceExpression` übergebene Array wird zu den `rows` des Subreports.

```json
{
  "type": "subreport",
  "x": 0, "y": 0, "width": 240, "height": 64,
  "templateExpression": "'subreport.report'",
  "dataSourceExpression": "field.items",
  "parameters": [
    { "name": "heading", "expression": "'内訳'" }
  ],
  "usingCache": true
}
```

Beispieldaten:

```json
{
  "rows": [
    {
      "items": [
        { "name": "部品A", "amount": 12000 },
        { "name": "部品B", "amount": 36000 }
      ]
    }
  ]
}
```

Die eingebettete Datei `subreport.report` ist ihrerseits eine eigenständige Vorlage. Sie referenziert jedes Element der erhaltenen `items` als gewöhnliche `field.*`-Werte und empfängt die vom Elternbericht übergebenen Parameter über `param.*`. Beachten Sie, dass als Subreport ausgeführte Vorlagen ihre Bänder `pageHeader`, `pageFooter` und `background` nicht ausgeben (die Seitenverwaltung ist Aufgabe des Elternberichts). Überschriften kommen in das `title`-Band, etwa so:

```json
{
  "name": "subreport",
  "page": {
    "width": 240,
    "height": 100,
    "margins": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
  },
  "parameters": [
    { "name": "heading", "type": "string" }
  ],
  "styles": [
    { "name": "body", "fontFamily": "jp", "fontSize": 9 }
  ],
  "bands": {
    "title": {
      "height": 18,
      "elements": [
        {
          "type": "textField",
          "x": 0, "y": 0, "width": 240, "height": 16,
          "expression": "param.heading",
          "style": "body"
        }
      ]
    },
    "details": [
      {
        "height": 16,
        "elements": [
          {
            "type": "textField",
            "x": 0, "y": 0, "width": 160, "height": 14,
            "expression": "field.name",
            "style": "body"
          },
          {
            "type": "textField",
            "x": 160, "y": 0, "width": 80, "height": 14,
            "expression": "field.amount",
            "pattern": "#,##0",
            "hAlign": "right",
            "style": "body"
          }
        ]
      }
    ]
  }
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Elementtyp |
| `templateExpression` | Expression | ✓ | Ausdruck, der den Namen der Kindvorlage liefert. Bei Verwendung von `createReportFromFile()` wird er automatisch als Dateipfad aufgelöst; beim direkten Aufruf von `createReport()` lösen Sie ihn mit der Option `resolveSubreportTemplate` auf (eine Funktion, die den Namen und das Arbeitsverzeichnis erhält und `{ template, workingDirectory? }` zurückgibt, oder `null`, wenn sie nicht auflösen kann) |
| `dataSourceExpression` | Expression | | Ausdruck, der die Datenquelle des Kindberichts liefert (ein Array von Zeilenobjekten). Ohne Angabe werden die Datenquellenzeilen des Elternberichts unverändert verwendet. Ein Nicht-Array-Ergebnis wird als leere Daten behandelt |
| `parameters` | SubreportParamDef[] |  | An den Kindbericht übergebene Parameter (siehe **`SubreportParamDef`** in der Tabelle unten). Sie haben Vorrang vor gleichnamigen Einträgen aus `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Ausdruck, der ein Objekt liefert, das in die Kindparameter eingemischt wird (einzelne `parameters` gewinnen) |
| `returnValues` | ReturnValueDef[] |  | Definitionen, die Variablenwerte des Kindberichts an den Elternbericht zurückgeben (siehe **`ReturnValueDef`** in der Tabelle unten) |
| `usingCache` | boolean | | Innerhalb einer Ausführung des Elternberichts aufgelöste Kindvorlagen pro Vorlagenname zwischenspeichern und wiederverwenden |
| `runToBottom` | boolean | | Nach dem Subreport-Inhalt den verbleibenden Platz der Seite/Spalte aufbrauchen (nachfolgende Elemente werden unter den verbleibenden Platz geschoben) |

**`SubreportParamDef`** (jeder Eintrag von `parameters` = ein an den Kindbericht übergebener Parameter)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Parametername, der an den Kindbericht übergeben wird (auf Kindseite als `param.name` referenziert) |
| `expression` | Expression | ✓ | Ausdruck, der den Parameterwert berechnet. Wird im Kontext des Elternberichts ausgewertet |

**`ReturnValueDef`** (jeder Eintrag von `returnValues` = eine Definition, die einen Wert vom Kind zum Elternbericht zurückgibt)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Variablenname, der den Wert auf Elternseite empfängt. Diese Variable wird davon ausgenommen, durch die normale Variablenberechnung des Elternberichts überschrieben zu werden |
| `subreportVariable` | string | ✓ | Quellvariablenname auf Kindseite. Wenn der Kindbericht seinen Lauf beendet, wird sein Wert an den Elternbericht weitergegeben |
| `calculation` | `'nothing'` = den Wert des Kindes unverändert zuweisen (bei jedem Lauf überschrieben) / `'count'` = Anzahl / `'sum'` = Summe / `'average'` = Durchschnitt / `'min'` = Minimum / `'max'` = Maximum / `'first'` = den ersten erhaltenen Wert behalten | ✓ | Wie der Wert in die Elternvariable eingefaltet wird. Alles außer `'nothing'` aggregiert über die Läufe hinweg, wenn der Subreport mehrfach ausgeführt wird |

### Barcodes und QR-Codes drucken — `barcode`

`barcodeType` akzeptiert Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417 und mehr. `showText` fügt den menschenlesbaren Text als Referenz zum Scannen hinzu.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Beispieldaten:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Elementtyp |
| `barcodeType` | string | ✓ | Barcode-Symbologie (Groß-/Kleinschreibung wird ignoriert). Zulässige Werte: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Jeder andere Wert ist nicht unterstützt und zeichnet einen Platzhalter |
| `expression` | Expression | ✓ | Ausdruck, der die Barcode-Daten liefert (das Auswertungsergebnis wird in eine Zeichenkette umgewandelt und kodiert) |
| `showText` | boolean | | Menschenlesbaren Text unter eindimensionalen Barcodes anzeigen (Textbereichshöhe 10 pt, Schriftgröße 8 pt; die Balkenhöhe verringert sich um diesen Betrag). Bei zweidimensionalen Codes (QR / Data Matrix / PDF417) nicht verwendet |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Fehlerkorrekturstufe des QR Codes — die Fähigkeit, lesbar zu bleiben, auch wenn ein Teil des Codes verschmiert oder fehlt. Die Widerstandsfähigkeit steigt von `'L'` nach `'H'`, um den Preis eines feineren Musters. Für grobe Druckmedien wird `'Q'` oder `'H'` empfohlen. Standard: `'M'`. Nur für QR Codes wirksam (die Fehlerkorrekturstufe von PDF417 wird automatisch aus der Datenlänge gewählt) |

### Mathematische Formeln drucken — `math`

Setzt Formeln im LaTeX-Stil. Der Formelsatz erfordert eine spezielle Schriftart mit mathematikspezifischen Metriken (der OpenType-MATH-Tabelle); frei verfügbare Beispiele sind STIX Two Math und Latin Modern Math. Eine gewöhnliche Fließtext-Schriftart kann sie nicht ersetzen. `formula` wird als Ausdruck ausgewertet (dieses Beispiel referenziert das Feld `formula` der Daten).

```json
{
  "type": "math",
  "x": 0, "y": 0, "width": 220, "height": 60,
  "formula": "field.formula",
  "mathFontFamily": "math",
  "fontSize": 18,
  "color": "#111827"
}
```

Beispieldaten:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Registrieren Sie bei Verwendung des `math`-Elements eine Schriftart mit OpenType-MATH-Tabelle sowohl in `fontMap` als auch in den `fonts` der PDF-Ausgabe.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Elementtyp |
| `formula` | Expression | ✓ | Ausdruck, der eine LaTeX-Formelzeichenkette liefert (schließen Sie eine feste Formel innerhalb des Ausdrucks als String-Literal in `'...'` ein). Bei leerem Ergebnis wird nichts gezeichnet |
| `mathFontFamily` | string | | Für das Mathematik-Rendering verwendete Schriftart (eine in fontMap registrierte Schriftart-ID). Standard: das fontFamily des Elementstils, oder `'default'`, wenn auch dieses fehlt |
| `fontSize` | number | | Schriftgröße (pt). Standard: das fontSize des Elementstils, oder 12, wenn auch dieses fehlt |
| `color` | string | | Textfarbe. Standard: in dieser Reihenfolge aufgelöst — das forecolor des Elements → das forecolor des Stils → `#000000` |

### SVG drucken — `svg`

Rendert ein SVG-Dokument direkt in den Bericht. `svgContent` wird als Ausdruck ausgewertet (eine feste SVG-Zeichenkette kann über Daten oder Parameter geliefert werden).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Beispieldaten:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Elementtyp |
| `svgContent` | Expression | ✓ | Ausdruck, der eine SVG-Markup-Zeichenkette liefert. Das Ergebnis wird in eine Zeichenkette umgewandelt und an Position und Größe des Elements als SVG gerendert |

### Ausfüllbare PDF-Formulare erstellen — `formField`

Platziert Formularfelder, die ausfüllen kann, wer das PDF öffnet. `fieldType` akzeptiert `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox` und `signature`.

```json
{
  "type": "formField",
  "fieldType": "text",
  "fieldName": "contactName",
  "x": 0, "y": 0, "width": 180, "height": 24,
  "value": "field.contact",
  "style": "body",
  "borderColor": "#777777",
  "backgroundColor": "#FFFFFF"
}
```

Beispieldaten (werden zum Anfangswert des Formulars):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Elementtyp. Ein interaktives Formularfeld. Vorschau-Backends zeichnen sein anfängliches Erscheinungsbild, und die PDF-Ausgabe gibt es als tatsächlich ausfüllbares Feld aus |
| `fieldType` | `'text'` = Texteingabefeld (PDF /Tx) / `'checkbox'` = Kontrollkästchen (/Btn) / `'radio'` = Optionsfeld (/Btn; Widgets mit demselben `fieldName` bilden eine sich gegenseitig ausschließende Gruppe) / `'pushbutton'` = Schaltfläche (/Btn; Beschriftung plus optionale URI-Aktion) / `'dropdown'` = Dropdown (Kombinationsfeld, /Ch) / `'listbox'` = Listenfeld (/Ch) / `'signature'` = Signaturfeld (/Sig) | ✓ | Feldtyp |
| `fieldName` | string | ✓ | Vollqualifizierter Feldname. Muss innerhalb des Dokuments eindeutig sein (Duplikate werfen eine Ausnahme). Die Ausnahme ist `radio`, wo derselbe Name eine sich gegenseitig ausschließende Gruppe bildet |
| `value` | Expression |  | Anfangswert (text: der Eingabewert; dropdown/listbox: der ausgewählte Wert; bei einem `multiSelect`-Listenfeld mehrere Werte durch Zeilenumbrüche getrennt angeben). Wird als Ausdruck ausgewertet. Die Kombination mit `valueStream` wirft eine Ausnahme |
| `checked` | Expression |  | Anfänglicher Ankreuzzustand (checkbox/radio). Wird als Ausdruck ausgewertet. Bei Optionsfeldern wird das `exportValue` des angekreuzten Feldes zum ausgewählten Wert der Gruppe |
| `exportValue` | string |  | Die Zeichenkette, die als Wert festgehalten wird, der „an“ für dieses Kontrollkästchen/Optionsfeld bedeutet, wenn die Formulareingabe übermittelt oder extrahiert wird (checkbox/radio). Standard: `'Yes'`. In einer Optionsfeldgruppe unterscheidet dieser Wert die einzelnen Optionen |
| `options` | FormFieldOption[] |  | Array der Optionen (dropdown/listbox). Siehe Tabelle unten |
| `editable` | boolean |  | Zusätzlich zu den Optionen freie Eingabe erlauben (lässt ein Dropdown Combo-artige Eingaben akzeptieren) |
| `multiSelect` | boolean |  | Mehrfachauswahl erlauben (listbox) |
| `caption` | string |  | Schaltflächenbeschriftung (pushbutton) |
| `action` | string |  | URI, die beim Drücken der Schaltfläche geöffnet wird |
| `multiline` | boolean |  | Mehrzeilige Eingabe (text) |
| `readOnly` | boolean |  | Das Feld schreibgeschützt machen |
| `required` | boolean |  | Das Feld als Pflichtfeld markieren |
| `noExport` | boolean |  | Den Wert dieses Feldes bei der Formularübermittlung nicht exportieren |
| `password` | boolean |  | Passworteingabe (text; getippte Zeichen werden maskiert) |
| `fileSelect` | boolean |  | Das Feld zu einem Dateiauswahlfeld machen (text). Die Kombination mit `multiline`/`password` wirft eine Ausnahme |
| `doNotSpellCheck` | boolean |  | Rechtschreibprüfung deaktivieren (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | Scrollen für Eingaben, die den sichtbaren Bereich überschreiten, nicht zulassen (text) |
| `comb` | boolean |  | Als gleichmäßig verteilte Zeichenboxen (Kammfeld) anzeigen (text). `maxLength` muss angegeben werden; die Kombination mit `multiline`/`password`/`fileSelect` wirft eine Ausnahme |
| `richText` | string |  | Rich-Text-Wert (PDF /RV), der in unterstützenden Viewern mit Formatierung (Fett, Farben usw.) angezeigt wird. Das Setzen aktiviert das Rich-Text-Flag des Feldes. Die Kombination mit `richTextStream` wirft eine Ausnahme |
| `richTextStream` | Uint8Array |  | Stream-Form von `richText`. Für die byte-genaue Erhaltung, wenn das /RV des Quell-PDFs beim PDF-Import ein Stream war; handgeschriebene Vorlagen verwenden normalerweise `richText`. Die Kombination mit `richText` wirft eine Ausnahme |
| `defaultStyle` | string |  | Standardstil für Rich Text (PDF /DS). Eine CSS-artige Formatzeichenkette (z. B. `font: Helvetica 12pt`), die Vorgaben für alles liefert, was `richText` nicht angibt |
| `valueStream` | Uint8Array |  | Zur Erhaltung beim PDF-Import. War der Feldwert (/V) des Quell-PDFs ein Stream-Objekt statt einer Zeichenkette, werden diese Bytes verlustfrei wieder ausgegeben. Handgeschriebene Vorlagen verwenden normalerweise `value`. Die Kombination mit `value` wirft eine Ausnahme |
| `defaultValue` | string |  | Standardwert, auf den das Feld beim Formular-Reset zurückkehrt (/DV) |
| `sort` | boolean |  | Die Optionen sortiert anzeigen (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Den Wert sofort bei Auswahländerung übernehmen (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Optionsfelder innerhalb einer Gruppe, die dasselbe `exportValue` teilen, gemeinsam ein- und ausschalten |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Hängt dem Feld Eingabeskripte an, die in PDF-Viewern laufen. K = bei jedem Tastenanschlag (z. B. Nicht-Ziffern entfernen), F = Anzeigeformatierung (z. B. zwei Dezimalstellen anzeigen), V = Wertvalidierung (z. B. negative Zahlen ablehnen), C = Neuberechnung (z. B. automatisch aus den Werten anderer Felder berechnen). Der Inhalt ist normalerweise ein `PdfActionDef` (später beschrieben) mit `subtype: 'JavaScript'`. Die Core-Engine bettet die Skripte nur ins PDF ein und führt sie nie aus. Bei einer Optionsfeldgruppe müssen alle Widgets identische Definitionen tragen, sonst wird eine Ausnahme geworfen |
| `calculationOrder` | number |  | Wenn mehrere Felder eine `'C'`-Aktion (Neuberechnung) haben, die Reihenfolge, in der der Viewer sie neu berechnet (PDF /CO). Aufsteigende Reihenfolge ganzer Zahlen ≥ 0. Duplikate, negative Werte und Nicht-Ganzzahlen werfen eine Ausnahme |
| `maxLength` | number |  | Maximale Eingabelänge (text) |
| `borderColor` | string |  | Rahmenfarbe (`#RRGGBB`). Ohne Angabe kein Rahmen. Wird als 1-pt-Umriss gezeichnet — kreisförmig bei Optionsfeldern, sonst rechteckig |
| `backgroundColor` | string |  | Hintergrundfarbe (`#RRGGBB`). Ohne Angabe transparent. Wird bei Optionsfeldern als Kreis gefüllt, sonst als Rechteck |

**`FormFieldOption`** (jeder Eintrag von `options` = eine Optionsdefinition)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `value` | string | ✓ | Exportwert, der im Feldwert (/V) gespeichert wird |
| `label` | string |  | Anzeigebeschriftung. Standard: gleich `value` |

Hinweis: Darüber hinaus können alle elementgemeinsamen Eigenschaften und jede `TextProperties`-Eigenschaft angegeben werden (angewendet auf Schriftart, Ausrichtung usw. des Eingabetexts).

### An beliebiger Stelle einen Seiten- oder Spaltenumbruch erzwingen — `break`

Erzwingt mitten im Detailfluss den Wechsel zur nächsten Seite (`"breakType": "page"`) oder Spalte (`"column"`). Platzieren Sie es direkt in einem Band; es kann nicht in einen `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Eigenschaftsliste**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Elementtyp |
| `breakType` | `'page'` \| `'column'` | ✓ | Umbruchtyp. Teilt das Band an der y-Position des Elements; `'page'` = auf der nächsten Seite fortsetzen / `'column'` = in der nächsten Spalte fortsetzen, wenn das Layout mehrspaltig ist (Vorlagen-`columns.count` von 2 oder mehr; siehe **Grundlagen des Berichtslayouts**) und dies nicht die letzte Spalte ist (andernfalls wirkt es als Seitenumbruch) |

### Ein Element nur bei erfüllter Bedingung drucken — `printWhenExpression`

`printWhenExpression` ist kein eigener Elementtyp, sondern **ein für alle Elemente gemeinsames Attribut**. Das Element wird nur in den Zeilen gedruckt, in denen der Ausdruck truthy auswertet. Das folgende Beispiel druckt „※ 至急“ (dringend) nur in Detailzeilen, in denen `urgent` gleich `true` ist.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Beispieldaten (nur für die erste Zeile gedruckt):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

Auch Bänder akzeptieren ein gleichnamiges `printWhenExpression`, das die Ausgabe des gesamten Bandes unterdrückt (z. B. ein Bemerkungsband nur ausgeben, wenn `param.showNotes` gesetzt ist). Ist die Vorlage in TypeScript definiert, gibt der `onBeforeRender`-Callback des Elements noch feinere Kontrolle — geben Sie `null` zurück, um das Drucken des Elements zu überspringen, oder ein `ElementDef`, um mit an Ort und Stelle überschriebenen Attributen wie Text, Abmessungen und Farben zu drucken.
## Referenz der Elementeigenschaften

Die jedem Elementbeispiel beigefügte „Eigenschaftsliste“ deckt nur die für dieses Element spezifischen Eigenschaften ab. Darüber hinaus akzeptiert jedes Element gemeinsame Eigenschaften für Position, Größe, Druckbedingungen, Farben und mehr. Dieser Abschnitt fasst die für alle Elemente gemeinsamen Eigenschaften und die Eigenschaften der in den `styles` der Vorlage definierten Stile zusammen.

### Für alle Elemente gemeinsame Eigenschaften

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string |  | Bezeichner, um ein Element vor dem Rendern mit `findElementById()` nachzuschlagen und zu ändern. Beeinflusst den gedruckten Inhalt selbst nicht. Halten Sie als Änderungsziele verwendete IDs innerhalb der Vorlage eindeutig (bei Duplikaten wird das erste Element in Suchreihenfolge zurückgegeben) |
| `x` | number | ✓ | X-Koordinate innerhalb des übergeordneten Bandes/Containers (pt) |
| `y` | number | ✓ | Y-Koordinate innerhalb des übergeordneten Bandes/Containers (pt) |
| `width` | number | ✓ | Breite (pt) |
| `height` | number | ✓ | Höhe (pt) |
| `style` | string |  | Name des anzuwendenden Stils (referenziert das `name` einer in `styles` definierten `StyleDef`; ohne Angabe wird der `isDefault`-Stil angewendet) |
| `positionType` | `'float'` = rückt um den Betrag nach unten, um den sich die darüberliegenden Elemente gedehnt haben / `'fixRelativeToTop'` = fixiert die Position von der Oberkante des Bandes (Standard) / `'fixRelativeToBottom'` = behält den Abstand zur Unterkante des Bandes (rückt um den Dehnungsbetrag des Bandes nach unten) |  | Positionierungsregel bei Banddehnung. Standard: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = dehnt sich nicht (Standard) / `'containerHeight'` = lässt die Elementhöhe der effektiven Bandhöhe entsprechen / `'containerBottom'` = dehnt die Unterkante des Elements bis zur effektiven Bandunterkante (ändert nur die Höhe) |  | Dehnungsregel des Elements bei Banddehnung. Standard: `noStretch` |
| `printWhenExpression` | Expression \| null |  | Ist das Auswertungsergebnis falsy, wird dieses Element nicht gedruckt |
| `onBeforeRender` | OnBeforeRenderCallback |  | Unmittelbar vor dem Rendern aufgerufener Callback: `(elem, field, vars, param, report) => ElementDef \| null`. Die Rückgabe von `null` überspringt das Drucken (eine Obermenge von `printWhenExpression`); die Rückgabe eines `ElementDef` rendert mit dieser Definition (überschreibt jedes Attribut dynamisch). Auswertungsreihenfolge: `onBeforeRender` → `printWhenExpression` (gegen die überschriebene Definition ausgewertet) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Wenn das Element nicht gedruckt wird und kein anderes gedrucktes Element den vertikalen Streifen überlappt, den das Element einnimmt, wird dieser Streifen entfernt und die darunterliegenden Elemente werden nach oben gezogen, wodurch das Band schrumpft |
| `isPrintRepeatedValues` | boolean |  | Bei `false` wird das Drucken unterdrückt, wenn der Wert (textField) derselbe wie der vorherige ist (während der Unterdrückung wird das Element als Höhe 0 behandelt, wenn `isRemoveLineWhenBlank` truthy ist) |
| `isPrintWhenDetailOverflows` | boolean |  | Druckt dieses Element auf jedem Seiten-/Spaltenabschnitt erneut, auf den das Band überläuft |
| `mode` | `'opaque'` = füllt den Hintergrund mit `backcolor` / `'transparent'` = füllt den Hintergrund nicht |  | Anzeigemodus. Standard: `transparent` (zuerst am Element, dann am Stil aufgelöst) |
| `forecolor` | string |  | Vordergrundfarbe (`#RRGGBB` oder `#RRGGBBAA`) |
| `backcolor` | string |  | Hintergrundfarbe (gezeichnet, wenn `mode` gleich `opaque` ist) |
| `border` | BorderDef |  | Rahmen (siehe **`BorderDef`** unten). Für line-/rectangle-/ellipse-/path-Elemente wird der Rahmen nicht gezeichnet (ob er aus einem Stil stammt oder direkt am Element angegeben ist; diese Elemente geben Linien über ihre eigenen `stroke`- und ähnlichen Eigenschaften an) |
| `padding` | Padding |  | Innenabstand (siehe **`Padding`** unten) |
| `blendMode` | BlendModeDef |  | Wie die Farben dieses Elements mit dem bereits darunter gezeichneten Inhalt zusammengesetzt werden (siehe **`BlendModeDef`** unten). Typisches Beispiel: Die Angabe von `'multiply'` auf einem Siegel- oder Stempelbild legt es halbtransparent darüber, ohne den darunterliegenden Text zu verdecken |
| `overprintFill` | boolean |  | Für die Druckvorstufe des kommerziellen Drucks. Legt Überdrucken für Füllungen fest (die Flächen von Text und Formen): Sie werden auf die darunterliegenden Farbplatten gedruckt, ohne diese auszusparen |
| `overprintStroke` | boolean |  | Für die Druckvorstufe des kommerziellen Drucks. Überdrucken-Einstellung für Linien (Konturen) |
| `overprintMode` | 0 \| 1 |  | Wählt das Verhalten bei aktiviertem `overprintFill`/`overprintStroke` (PDF /OPM). `0` = jede Farbkomponente überschreibt die darunterliegende Farbe (Standard) / `1` = Farbkomponenten mit Wert 0 lassen die darunterliegende Farbe intakt |
| `renderingIntent` | `'AbsoluteColorimetric'` = farbmetrisch treu / `'RelativeColorimetric'` = treu nach Abgleich der Weißpunkte / `'Saturation'` = priorisiert Leuchtkraft / `'Perceptual'` = priorisiert ein natürliches Erscheinungsbild |  | Prioritätsrichtlinie für die Umwandlung von Farben, die nicht in den Farbraum des Ausgabegeräts passen (PDF-Rendering-Intent). Für kommerziellen Druck und Farbmanagement gedacht; normalerweise keine Angabe nötig |
| `alphaIsShape` | boolean |  | Feinsteuerung der PDF-Transparenzkomposition (interpretiert Deckkraft und Masken als „Form“; /AIS). Normalerweise keine Angabe nötig; hauptsächlich für die getreue Wiederausgabe importierter PDFs verwendet |
| `textKnockout` | boolean |  | Vermeidet bei überlappenden halbtransparenten Zeichen die doppelte Komposition der Überlappungen innerhalb desselben Texts (PDF /TK). Standard: `true`. Normalerweise keine Angabe nötig |
| `optionalContent` | OptionalContentDef |  | Legt dieses Element auf eine PDF-„Ebene“. Sichtbarkeit und Drucken können über das Ebenenpanel des Viewers umgeschaltet werden (z. B. ein Wasserzeichen auf dem Bildschirm anzeigen, aber beim Drucken weglassen). Siehe **`OptionalContentDef`** unten |
| `opacity` | number |  | Deckkraft des Elements (0.0–1.0). Bei Elementen mit Kindern wird sie nach deren Komposition als Gruppe angewendet |

**`BlendModeDef`** (für `blendMode` angebbare Mischmodi)

Elemente malen normalerweise über das, was unter ihnen gezeichnet wurde (`'normal'`). Die Angabe eines Mischmodus kombiniert die obere und untere Farbe rechnerisch. In Geschäftsdokumenten sind typische Verwendungen das Überlagern eines persönlichen oder Firmensiegels über Text (`'multiply'`) und ein weiß-aussparungsartiger Effekt auf dunklem Hintergrund (`'screen'`).

| Konstante | Effekt |
| --- | --- |
| `'normal'` | Malt mit der oberen Farbe ohne Mischung (entspricht dem Standard) |
| `'multiply'` | Multiplizieren. Überlappungen werden immer dunkler. Für Siegel, Stempel und Textmarker-artige Überlagerungen |
| `'screen'` | Inverses Multiplizieren. Überlappungen werden immer heller |
| `'overlay'` | Multipliziert, wo die Basis dunkel ist, und screent, wo sie hell ist. Betont den Kontrast |
| `'darken'` | Nimmt die dunklere der beiden Farben |
| `'lighten'` | Nimmt die hellere der beiden Farben |
| `'color-dodge'` | Hellt die Basis entsprechend der oberen Farbe auf (überstrahlt sie) |
| `'color-burn'` | Dunkelt die Basis entsprechend der oberen Farbe nach |
| `'hard-light'` | Wechselt je nach Helligkeit der oberen Farbe zwischen Multiplizieren und inversem Multiplizieren (starker Beleuchtungseffekt) |
| `'soft-light'` | Eine schwächere Variante von `'hard-light'` (weicher Beleuchtungseffekt) |
| `'difference'` | Absolutwert der Differenz der beiden Farben |
| `'exclusion'` | Eine kontrastärmere Variante von `'difference'` |
| `'hue'` | Oberer Farbton + untere Sättigung und Luminanz |
| `'saturation'` | Obere Sättigung + unterer Farbton und Luminanz |
| `'color'` | Oberer Farbton und Sättigung + untere Luminanz (zum Einfärben einer monochromen Basis) |
| `'luminosity'` | Obere Luminanz + unterer Farbton und Sättigung |

**`Expression`** (Details siehe „Ausdrücke meistern“)
| Form | Beschreibung |
| --- | --- |
| string | Ausdrucks-Minisprache. Beispiele: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Eine TypeScript-Funktion `(field, vars, param, report) => unknown`. `report` (ReportContext) stellt bereit: `PAGE_NUMBER` (aktuelle Seitenzahl, beginnend bei 1), `COLUMN_NUMBER` (aktuelle Spaltennummer, beginnend bei 1), `REPORT_COUNT` (Anzahl der verarbeiteten Datensätze), `TOTAL_PAGES` (Gesamtseitenzahl; endgültig mit evaluationTime=report), `RETURN_VALUE` (in der Typdefinition vorhanden, aber in der aktuellen Implementierung immer undefined — Subreport-Rückgabewerte werden über `vars.*` empfangen), `format` (eingebaute Formatierungsfunktionen) und `formatters` (an der Vorlage registrierte benutzerdefinierte Formatter) |

**`BorderDef`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `width` | number |  | Linienbreite (pt). Von allen Seiten geteilter Standard |
| `color` | string |  | Linienfarbe. Von allen Seiten geteilter Standard |
| `style` | `'solid'` = durchgezogene Linie / `'dashed'` = gestrichelte Linie / `'dotted'` = gepunktete Linie |  | Linienstil. Von allen Seiten geteilter Standard |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Einstellungen pro Seite (siehe **`BorderSideDef`** unten). Sie haben Vorrang vor den Einstellungen für alle Seiten; `null` blendet diese Seite aus |

**`BorderSideDef`** (verwendet in `top`/`bottom`/`left`/`right` von `BorderDef`)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `width` | number | ✓ | Linienbreite (pt) |
| `color` | string | ✓ | Linienfarbe |
| `style` | `'solid'` = durchgezogene Linie / `'dashed'` = gestrichelte Linie / `'dotted'` = gepunktete Linie | ✓ | Linienstil |

**`Padding`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Innenabstand auf jeder Seite (pt) |

**`HyperlinkDef`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'reference'` = externe URL / `'localAnchor'` = zu einem Anker im selben Dokument / `'localPage'` = zu einer Seitenzahl im selben Dokument / `'remoteAnchor'` = zu einem Anker in einem anderen PDF-Dokument / `'remotePage'` = zu einer Seite in einem anderen PDF-Dokument | ✓ | Linktyp |
| `target` | Expression | ✓ | Linkziel (eine URL, ein Ankername oder ein Seitenzahl-Ausdruck) |
| `remoteDocument` | Expression |  | Pfad der entfernten PDF-Datei (für remotePage / remoteAnchor) |

**`TextProperties`** (Text- und Absatzeigenschaften von staticText / textField / formField)
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `markup` | `'none'` = einfacher Text / `'styled'` = Styled-Markup (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>` usw.) / `'html'` = HTML-Teilmenge (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Markup-Typ |
| `hAlign` | `'left'` = linksbündig / `'center'` = zentriert / `'right'` = rechtsbündig / `'justify'` = Blocksatz |  | Horizontale Ausrichtung |
| `vAlign` | `'top'` = oben ausgerichtet / `'middle'` = mittig ausgerichtet / `'bottom'` = unten ausgerichtet |  | Vertikale Ausrichtung |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Textdrehung (Grad) |
| `lineSpacing` | LineSpacingDef |  | Zeilenabstandseinstellungen (siehe **`LineSpacingDef`** unten) |
| `letterSpacing` | number |  | Zeichenabstand (pt). Fügt zwischen allen Zeichen einen festen Betrag ein (negative Werte verengen) |
| `tracking` | number |  | Eine andere Art der Zeichenabstandsanpassung. Während `letterSpacing` einheitlich einen festen Betrag hinzufügt, verwendet dies die in die Schriftart selbst eingebaute Abstandsanpassungstabelle (die AAT-`trak`-Tabelle), um Abstände nach von der Schriftgröße abhängigen Entwurfswerten zu verengen oder zu weiten. Die Zahl ist der „Track-Wert“ der Tabelle: 0 = normal, negativ = enger, positiv = weiter (Zwischenwerte werden interpoliert). Keine Wirkung bei Schriftarten ohne `trak`-Tabelle |
| `wordSpacing` | number |  | Wortabstand (pt; zusätzliche Breite, die Leerzeichen hinzugefügt wird) |
| `horizontalScale` | number |  | Skalierungsfaktor, der Glyphenformen horizontal dehnt (unter 1 = verdichtet, verengt die Breite; über 1 = expandiert, weitet sie). Umbruch und Zeilenvorschub werden aus den skalierten Breiten berechnet. Standard: 1 |
| `baselineOffset` | number |  | Setzt die Grundlinienposition (die Referenzlinie, auf der die Zeichen sitzen) explizit in pt von der Oberkante des Elements. Wird normalerweise automatisch berechnet, daher keine Angabe nötig (hauptsächlich vom PDF-Import gesetzt, um die ursprünglichen Textpositionen zu reproduzieren) |
| `firstLineIndent` | number |  | Erstzeileneinzug (pt) |
| `leftIndent` | number |  | Linker Einzug (pt) |
| `rightIndent` | number |  | Rechter Einzug (pt) |
| `padding` | Padding |  | Innenabstand |
| `direction` | `'ltr'` = links nach rechts / `'rtl'` = rechts nach links / `'auto'` = automatisch aus dem Inhalt erkannt (bidirektionale Textanalyse) |  | Textrichtung |
| `openTypeScript` | string |  | OpenType-Tag, das angibt, nach den Regeln welches Schriftsystems in der Schriftart Text in Glyphenformen umgewandelt wird (Shaping) (z. B. `'latn'` = lateinische Schrift, `'arab'` = arabische Schrift). Normalerweise keine Angabe nötig (wird automatisch aus dem Textinhalt behandelt) |
| `openTypeLanguage` | string |  | OpenType-Tag, das die Sprache explizit macht für Schriftarten, die Glyphenformen innerhalb desselben Schriftsystems je Sprache variieren. Normalerweise keine Angabe nötig |
| `openTypeFeatures` | Record<string, number> |  | Schaltet die in die Schriftart eingebauten Glyphenumschalt-Features ein oder aus. Beispiele: `{ "palt": 1 }` = japanische Zeichenabstände verengen, `{ "liga": 0 }` = Ligaturen deaktivieren, `{ "zero": 1 }` = Null mit Schrägstrich. Werte: 0 = aus / 1 = ein; bei Glyphenauswahl-Features eine 1-basierte Alternativglyphen-Nummer |
| `shrinkToFit` | boolean |  | Automatisches Verkleinern: reduziert die Schriftgröße, damit der Text in Breite und Höhe des Elements passt |
| `minFontSize` | number |  | Minimale Schriftgröße (pt) für `shrinkToFit`. Standard: 4 |
| `fitWidth` | boolean |  | Passt die Schriftgröße automatisch an, damit die längste Zeile exakt in die Inhaltsbreite des Elements passt (in beide Richtungen, verkleinern und vergrößern) |
| `outlineText` | boolean |  | Wandelt den Text in Pfade (Outlines) um. Standard: `false` |
| `pdfFontMode` | `'embedded'` = bettet das Schriftprogramm ein / `'reference'` = gibt einen Systemschriftart-Verweis ohne Einbettung aus |  | Wie das PDF-Schriftprogramm behandelt wird |
| `textPaintMode` | `'fill'` = Füllung / `'stroke'` = nur Kontur / `'fillStroke'` = Füllung + Kontur |  | Durch den PDF-Import erhaltene Textmal-Semantik. Standard: `fill` |
| `textStrokeColor` | string |  | Konturfarbe für stroke / fillStroke |
| `textStrokeWidth` | number |  | Konturstrichbreite für Text (pt) |
| `tabStops` | TabStopDef[] |  | Tabstopp-Definitionen (siehe **`TabStopDef`** unten) |
| `tabStopWidth` | number |  | Standard-Tabulatorabstand (pt). 40 pt ohne Angabe |
| `wrap` | boolean |  | Textumbruch. Standard: `true` (undefined bedeutet, dass der Umbruch aktiviert ist) |

**`LineSpacingDef`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'single'` = einzeilig / `'1.5'` = 1,5 Zeilen / `'double'` = doppelt / `'proportional'` = Verhältnis / `'fixed'` = fester Wert / `'minimum'` = Minimalwert | ✓ | Zeilenabstandstyp |
| `value` | number |  | Wert für fixed / minimum / proportional |

**`TabStopDef`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `position` | number | ✓ | Tabstopp-Position (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Tabstopp-Ausrichtung. Standard: `left` |

**`FillDef`** (die Vereinigung der Typen, die von Füllung (`fill`) und Kontur (`stroke`) von `path` sowie von der Füllung (`fill`) von `rectangle`/`ellipse` akzeptiert werden. Das `stroke` von `rectangle`/`ellipse` akzeptiert nur eine Volltonfarben-Zeichenkette)
| Form | Beschreibung |
| --- | --- |
| string | Volltonfarbe (`#RRGGBB` oder `#RRGGBBAA`) |
| PdfSpecialColorDef | Sonderfarbe (Separation/DeviceN). Farbangabe für bestimmte Druckfarben wie Gold, Silber oder Firmenfarben (siehe Tabelle unten) |
| LinearGradientDef | Linearer Verlauf — Farben ändern sich entlang einer Achse, die zwei Punkte verbindet (siehe Tabelle unten) |
| RadialGradientDef | Radialer Verlauf — Farben ändern sich von einem Zentrum nach außen (siehe Tabelle unten) |
| MeshGradientDef | Mesh-Verlauf — Farben ändern sich entlang freier Formen (siehe Tabelle unten) |
| TilingPatternDef | Kachelmuster — füllt durch Kacheln eines kleinen Motivs (siehe Tabelle unten) |
| FunctionShadingDef | Funktions-Shading — Farben werden per Formel aus Koordinaten berechnet (siehe Tabelle unten) |

**`GradientStopDef`** (Farbstopps eines Verlaufs; verwendet in den `stops` jedes Verlaufs)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Position entlang der Verlaufsachse als Verhältnis von 0 bis 1 (0 = Startpunkt, 1 = Endpunkt) |
| `color` | string | ✓ | Farbe an dieser Position (`#RRGGBB`) |
| `opacity` | number |  | Deckkraft an dieser Position (0–1). Standard: 1 |

**`LinearGradientDef`** (linearer Verlauf — eine Füllung, deren Farben sich entlang einer Achse ändern, die zwei Punkte verbindet)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Diskriminator, der einen linearen Verlauf anzeigt |
| `x1` | number |  | X-Koordinate des Startpunkts, **als Verhältnis der Breite des Element-Begrenzungsrahmens** (0 = linke Kante, 1 = rechte Kante). Standard: 0 |
| `y1` | number |  | Y-Koordinate des Startpunkts, **als Verhältnis der Höhe des Element-Begrenzungsrahmens** (0 = obere Kante, 1 = untere Kante). Standard: 0 |
| `x2` | number |  | X-Koordinate des Endpunkts (Verhältnis der Breite). Standard: 1 (bei unveränderten Standardwerten ein horizontaler Verlauf von links nach rechts) |
| `y2` | number |  | Y-Koordinate des Endpunkts (Verhältnis der Höhe). Standard: 0 |
| `stops` | GradientStopDef[] | ✓ | Array der Farbstopps (siehe Tabelle oben) |
| `spreadMethod` | `'pad'` = füllt mit den Randfarben / `'reflect'` = wiederholt gespiegelt / `'repeat'` = wiederholt unverändert |  | Wie außerhalb des Verlaufsbereichs gemalt wird. Standard: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Erhaltungsmetadaten für die verlustfreie Wiederausgabe eines importierten PDF-Verlaufs. In handgeschriebenen Vorlagen keine Angabe nötig |

**`RadialGradientDef`** (radialer Verlauf — eine Füllung, deren Farben sich von einem Zentrum nach außen ändern)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Diskriminator, der einen radialen Verlauf anzeigt |
| `cx` | number |  | X-Koordinate des Mittelpunkts des äußeren Kreises (Verhältnis der Breite des Element-Begrenzungsrahmens). Standard: 0.5 |
| `cy` | number |  | Y-Koordinate des Mittelpunkts des äußeren Kreises (Verhältnis der Höhe). Standard: 0.5 |
| `r` | number |  | Radius des äußeren Kreises, **als Verhältnis des größeren Werts von Breite und Höhe**. Standard: 0.5 |
| `fx` | number |  | X-Koordinate des Fokuspunkts (wo der Verlauf beginnt) (Verhältnis der Breite). Standard: `cx` |
| `fy` | number |  | Y-Koordinate des Fokuspunkts (Verhältnis der Höhe). Standard: `cy` |
| `fr` | number |  | Radius des Fokuskreises (Verhältnis des größeren Werts von Breite und Höhe). Standard: 0 |
| `stops` | GradientStopDef[] | ✓ | Array der Farbstopps |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Wie außerhalb des Bereichs gemalt wird (wie bei `LinearGradientDef`). Standard: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadaten für die verlustfreie Wiederausgabe des PDF-Imports. In handgeschriebenen Vorlagen keine Angabe nötig |

**`MeshGradientDef`** (Mesh-Verlauf — eine Füllung, die den Eckpunkten von Gittern oder Dreiecken Farben zuweist und Farben entlang freier Formen variiert)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Diskriminator, der einen Mesh-Verlauf anzeigt |
| `patches` | MeshPatchDef[] |  | Array der Flächen-Patches. Jeder Patch hat `points` (ein 4×4-Kontrollpunktnetz, ausgedrückt als 32 Zahlen in x,y-Reihenfolge; **Koordinaten sind elementlokale pt**) und `colors` (die Farben der 4 Ecken) |
| `triangles` | MeshTriangleDef[] |  | Array der Verlaufsdreiecke. Jedes Dreieck hat `points` (x0,y0,x1,y1,x2,y2; elementlokale pt) und `colors` (die Farben der 3 Eckpunkte); Farben werden zwischen den Eckpunkten interpoliert |
| `lattice` | MeshLatticeDef |  | Mesh in Gitterform. Hat `columns` (Anzahl der Eckpunkte pro Zeile, 2 oder mehr), `points` (Folge der Eckpunktkoordinaten; elementlokale pt) und `colors` (eine Farbe pro Eckpunkt, in derselben Reihenfolge wie `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Kompakte Darstellung nativer, aus einem PDF importierter Mesh-Daten. In handgeschriebenen Vorlagen keine Angabe nötig |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Wie oben, für Verlaufsdreiecke |
| `pdfShading` | PdfMeshShadingDef |  | Metadaten für die verlustfreie Wiederausgabe des PDF-Imports. In handgeschriebenen Vorlagen keine Angabe nötig |

**`TilingPatternDef`** (Kachelmuster — füllt durch Kacheln eines kleinen Motivs; für Schraffuren, Schachbrettmuster, wiederholte Logos und dergleichen)

„Musterraum“ in der Tabelle ist das eigene Koordinatensystem des Musters. Ist `matrix` nicht angegeben, fällt er mit den elementlokalen pt-Koordinaten zusammen.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Diskriminator, der ein Kachelmuster anzeigt |
| `bbox` | [number, number, number, number] | ✓ | Begrenzungsrahmen eines Motivs (der Musterzelle), in Musterraum-Koordinaten |
| `xStep` | number | ✓ | Horizontales Wiederholungsintervall der Zelle (Musterraum) |
| `yStep` | number | ✓ | Vertikales Wiederholungsintervall der Zelle (Musterraum) |
| `graphics` | TileGraphicDef[] | ✓ | Array der innerhalb der Zelle gezeichneten Grafiken, unterschieden durch `kind`: `'path'` (SVG-Pfaddaten + Füllung/Kontur) / `'image'` (referenziert über `source` eine Bildressourcen-ID) / `'text'` (Text mit Schriftart, Größe und Farbe) / `'group'` (verschachtelte Gruppe mit Transformation, Beschneidung, Deckkraft usw.). Alle Koordinaten liegen im Musterraum |
| `tilingType` | 1 = konstanter Abstand (Zellen dürfen zur Anpassung an das Ausgabegerät leicht verzerrt werden) \| 2 = keine Verzerrung (der Abstand darf leicht variieren) \| 3 = konstanter Abstand mit schnellem Kacheln |  | Präzisionsmodus des Kachelns. Standard: 1 |
| `paintType` | `'colored'` = das Muster trägt seine eigenen Farben / `'uncolored'` = wird mit dem `color` des Verbrauchers einfarbig eingefärbt |  | Wie Farbe getragen wird. Standard: `'colored'` |
| `color` | string |  | Einfärbungsfarbe bei Verwendung eines `'uncolored'`-Musters |
| `matrix` | [number, number, number, number, number, number] |  | Affine Transformationsmatrix vom Musterraum in den elementlokalen Raum. Standard: Einheitsmatrix |

**`FunctionShadingDef`** (Funktionsschattierung — eine Füllung, deren Farbe durch eine Formel aus den Koordinaten (x, y) berechnet wird; tritt hauptsächlich beim PDF-Import auf)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Diskriminator, der eine Funktionsschattierung anzeigt. Es gibt zwei Varianten: eine Formelform mit `expression` und eine abgetastete Form mit `sampled` |
| `domain` | [number, number, number, number] | ✓ | Eingabedefinitionsbereich `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (nur Formelform) | PostScript-Rechnerausdruck (PDF FunctionType 4). Nimmt x, y und gibt r, g, b zurück. Beispiel: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (nur abgetastete Form) | Abgetastete Funktionsdaten (PDF FunctionType 0). Hat `size` (Abmessungen des Abtastgitters), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (Ausgabebereich), `samples` (Abtastwerte je Gitterpunkt) sowie optional `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | Abbildungsmatrix vom Eingabedefinitionsbereich auf **elementlokale pt**. Standard: Einheitsmatrix |
| `background` | [number, number, number] |  | Hintergrundfarbe außerhalb des Definitionsbereichs (DeviceRGB-Komponenten, 0–1) |
| `bbox` | [number, number, number, number] |  | Begrenzungsrahmen, der das Malen begrenzt |
| `antiAlias` | boolean |  | Kantenglättungs-Hinweis |
| `paintOperator` | `'pattern'` = als Muster gemalt (Standard) / `'sh'` = direkt unter der aktuellen Beschneidung gezeichnet |  | Malverfahren für die PDF-Ausgabe |

**`PdfSpecialColorDef`** (Sonderfarben-Füllung — Farbangabe für den Druck mit bestimmten Druckfarben wie Gold, Silber oder Unternehmensfarben, die gewöhnliche CMYK-Mischung nicht wiedergeben kann)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Diskriminator, der eine Sonderfarben-Füllung anzeigt |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | Der Farbraum der Sonderfarbe. Eine einzelne Druckfarbe verwendet `kind: 'separation'` mit `name` (Name der Druckfarbe), `alternate` (der Prozessfarbraum, der in Umgebungen ohne die Sonderfarbe stattdessen verwendet wird; siehe Tabelle unten) und `tintTransform` (gibt die Umrechnung vom Farbton in die Ersatzfarbe als PDF-Funktion an, z. B. `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = weiß bei Farbton 0 und blau bei 1). Mehrere Druckfarben verwenden `kind: 'deviceN'` mit `names` (Array der Druckfarbennamen), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = Standard / `'NChannel'` = erweiterte Form, die Attributinformationen je Druckfarbe tragen kann), `colorants` (eine Abbildung von jedem Druckfarbennamen auf eine Einzelfarben-Definition), `process` und `mixingHints` |
| `components` | number[] | ✓ | Farbtonwert jeder Druckfarbe (0–1) |
| `displayColor` | string | ✓ | Farbe, die stattdessen für Bildschirmanzeige und Vorschauen verwendet wird, die die Sonderfarbe nicht besitzen |

**`PdfProcessColorSpaceDef`** (Prozessfarbraum — der Farbraum „gewöhnlicher Farben“, die durch Mischen von Standarddruckfarben wie CMYK ausgedrückt werden. Wird im `alternate` einer Sonderfarbe und im `colorSpace` einer Soft Mask verwendet, unterschieden durch `kind`)

| Variante (`kind`) | Zusätzliche Eigenschaften | Beschreibung |
| --- | --- | --- |
| `'gray'` | Keine | Graustufen (DeviceGray) |
| `'rgb'` | Keine | RGB (DeviceRGB) |
| `'cmyk'` | Keine | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (alle Pflicht) | Farbmetrisch kalibriertes Grau (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (je Komponente), `matrix` (3×3) (alle Pflicht) | Farbmetrisch kalibriertes RGB (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (alle Pflicht) | L\*a\*b\*-Farbraum |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (ICC-Profil-Bytes) (alle Pflicht) | Farbraum auf Basis eines ICC-Profils |

`whitePoint`/`blackPoint` werden als `[x, y, z]`-Arrays im CIE-XYZ-Farbraum angegeben.

### Eigenschaften von Bändern (`bands`) und Gruppen (`groups`)

Die zehn Arten von Bändern, die im `bands` der Vorlage angegeben werden (siehe **Eine Seite ist ein Stapel von „Bändern“ (bands)**), werden alle mit dem folgenden `BandDef` definiert (nur `details` ist ein Array von `BandDef`).

**`BandDef`**

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `height` | number | ✓ | Mindesthöhe des Bandes (pt). Wächst, wenn sich Elemente dehnen |
| `elements` | ElementDef[] |  | Auf dem Band platzierte Elemente |
| `startNewPage` | boolean |  | Beginnt dieses Band immer auf einer neuen Seite |
| `spacingBefore` | number |  | Abstand vor dem Band (pt) |
| `spacingAfter` | number |  | Abstand nach dem Band (pt) |
| `splitType` | `'stretch'` = druckt so viel, wie auf die Seite passt, und setzt den Rest auf der nächsten Seite fort (Standard) / `'prevent'` = teilt nicht; schickt das ganze Band auf die nächste Seite (es wird geteilt, wenn es auch auf die neue Seite nicht passt) / `'immediate'` = teilt sofort an der aktuellen Position, auch mitten in einem Element |  | Wie das Band geteilt wird, wenn es an einer Seitengrenze nicht passt |
| `printWhenExpression` | Expression \| null |  | Ist das Auswertungsergebnis falsy, wird dieses Band nicht ausgegeben |

**`GroupDef`** (jeder Eintrag von `groups`)

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Gruppenname. Wird aus dem `resetGroup` einer Variablen und dem `evaluationGroup` eines textField referenziert |
| `expression` | Expression | ✓ | Gruppenschlüssel. Wird für jede Zeile ausgewertet; wo immer sich der Wert ändert, wird die vorherige Gruppe geschlossen und eine neue Gruppe beginnt |
| `header` | BandDef |  | Am Anfang der Gruppe ausgegebenes Band |
| `footer` | BandDef |  | Am Ende der Gruppe ausgegebenes Band |
| `keepTogether` | boolean |  | Passt die ganze Gruppe nicht in den verbleibenden Platz, würde aber auf eine neue Seite passen, beginnt sie nach einem Seitenumbruch |
| `minHeightToStartNewPage` | number |  | Beginnt die Gruppe auf einer neuen Seite, wenn die Resthöhe der Seite kleiner als dieser Wert ist (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Erstreckt sich die Gruppe über mehrere Seiten, wird der Kopf auf jeder Fortsetzungsseite erneut gedruckt |
| `resetPageNumber` | boolean |  | Setzt `PAGE_NUMBER` beim Beginn der Gruppe auf 1 zurück |
| `startNewPage` | boolean |  | Beginnt jede Gruppe auf einer neuen Seite |
| `startNewColumn` | boolean |  | Beginnt jede Gruppe in einer neuen Spalte |
| `footerPosition` | `'normal'` = unmittelbar nach den Detailzeilen ausgegeben (Standard) / `'stackAtBottom'` = zum Seitenende hin gestapelt / `'forceAtBottom'` = immer ganz unten auf der Seite platziert, wobei der dazwischenliegende Restplatz verbraucht wird / `'collateAtBottom'` = richtet sich nur dann unten aus, wenn der Fuß einer anderen Gruppe unten ausgerichtet ist (für sich allein wie `'normal'`) |  | Vertikale Position des Gruppenfußes |

### In Stilen (`styles`) verfügbare Eigenschaften

Stile werden im `styles`-Array der Vorlage definiert und über `name` aus der `style`-Eigenschaft eines Elements referenziert. Schriftarten, Textausrichtung, Farben und andere textbezogene Einstellungen werden vorrangig über Stile vorgenommen.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Stilname (wird aus dem `style` von Elementen referenziert) |
| `parentStyle` | string |  | Name des übergeordneten Stils. Erbt dessen Eigenschaften und überschreibt sie mit den eigenen Einstellungen (Zirkelverweise werden ignoriert) |
| `isDefault` | boolean |  | Ein Stil mit `true` wird als Standard auf Elemente ohne `style` angewendet |
| `fontFamily` | string |  | Schriftfamilie. Standard: `'default'` |
| `fontSize` | number |  | Schriftgröße (pt). Standard: 10 |
| `bold` | boolean |  | Fett. Standard: `false` |
| `italic` | boolean |  | Kursiv. Standard: `false` |
| `underline` | boolean |  | Unterstreichung. Standard: `false` |
| `strikethrough` | boolean |  | Durchstreichung. Standard: `false` |
| `forecolor` | string |  | Vordergrundfarbe (`#RRGGBB` oder `#RRGGBBAA`). Standard: `#000000` |
| `backcolor` | string |  | Hintergrundfarbe. Standard: `transparent` |
| `hAlign` | `'left'` = linksbündig / `'center'` = zentriert / `'right'` = rechtsbündig / `'justify'` = Blocksatz |  | Horizontale Ausrichtung. Standard: `left` |
| `vAlign` | `'top'` = oben ausgerichtet / `'middle'` = mittig ausgerichtet / `'bottom'` = unten ausgerichtet |  | Vertikale Ausrichtung. Standard: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Textdrehung (Grad) |
| `padding` | Padding |  | Innenabstand |
| `border` | BorderDef |  | Rahmen |
| `mode` | `'opaque'` = füllt den Hintergrund mit `backcolor` / `'transparent'` = füllt den Hintergrund nicht |  | Anzeigemodus |
| `opacity` | number |  | Deckkraft (0.0–1.0) |
| `variation` | Record<string, number> |  | Achsenwerte variabler Schriften (z. B. `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = Horizontalschrift / `'vertical-rl'` = Vertikalschrift mit von rechts nach links fortschreitenden Zeilen / `'vertical-lr'` = Vertikalschrift mit von links nach rechts fortschreitenden Zeilen |  | Schreibrichtung |
| `conditionalStyles` | ConditionalStyleDef[] |  | Bedingte Stile (siehe Tabelle unten). Trifft eine Bedingung zu, werden die entsprechenden Eigenschaften überschrieben |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Textrichtung (ltr = von links nach rechts / rtl = von rechts nach links / auto = automatisch aus dem Inhalt erkannt) |
| `openTypeScript` | string |  | OpenType-Tag, das angibt, welche Regeln welches Schriftsystems in der Schriftart bei der Umwandlung von Text in Glyphenformen (Shaping) verwendet werden (z. B. `'latn'` = lateinische Schrift, `'arab'` = arabische Schrift). Normalerweise keine Angabe nötig (wird automatisch aus dem Textinhalt bestimmt) |
| `openTypeLanguage` | string |  | OpenType-Tag, das die Sprache explizit macht — für Schriftarten, die Glyphenformen innerhalb desselben Schriftsystems je nach Sprache variieren. Normalerweise keine Angabe nötig |
| `openTypeFeatures` | Record<string, number> |  | Schaltet die in der Schriftart eingebauten Glyphenumschalt-Funktionen ein oder aus. Beispiele: `{ "palt": 1 }` = japanische Laufweite enger setzen, `{ "liga": 0 }` = Ligaturen deaktivieren, `{ "zero": 1 }` = durchgestrichene Null. Werte: 0 = aus / 1 = ein; bei Glyphenauswahl-Funktionen eine 1-basierte Nummer der Alternativglyphe |

**`ConditionalStyleDef`**
| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Bedingung für die Anwendung. Ist sie truthy, überschreiben die untenstehenden Eigenschaften den Stil |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Gleiche Typen wie die gleichnamigen StyleDef-Eigenschaften |  | Werte, die bei Zutreffen der Bedingung überschrieben werden (die Bedeutungen entsprechen den zugehörigen StyleDef-Eigenschaften) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Gleiche Typen wie die gleichnamigen StyleDef-Eigenschaften |  | In der Typdefinition deklariert, doch die aktuelle Implementierung wendet ihre Überschreibungen bei Zutreffen der Bedingung nicht an |

### Typen für den PDF-Import und fortgeschrittene PDF-Funktionen

Die hier aufgeführten Typen dienen zwei Zwecken: (1) „Erhaltungs“-Typen für die Wiederausgabe eines importierten PDFs ohne den Verlust eines einzigen Bytes und (2) Typen für die Nutzung fortgeschrittener Funktionen wie PDF-Ebenen, Formularskripte und Druckvorstufen-Einstellungen für den kommerziellen Druck. Beim Schreiben eines gewöhnlichen Berichts von Hand geben Sie sie so gut wie nie an. Typen, die als „vom PDF-Import gesetzt“ beschrieben sind, treten innerhalb der von `importPdfPage()` erzeugten Elemente auf.

**`OptionalContentDef`** (PDF-Ebenen-Funktion)

PDF kann Inhalte auf „Ebenen“ (Optional Content Groups, OCGs) platzieren, deren Sichtbarkeit und Druckbarkeit sich aus dem Ebenen-Bedienfeld des Betrachters umschalten lassen. Wird dies im `optionalContent` eines Elements angegeben, so wird dieses Element auf eine Ebene gelegt. Beispiel: ein „Vertraulich“-Wasserzeichen auf eine Ebene legen, die nur beim Drucken erscheint.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `name` | string | ✓ | Ebenenname, der im Ebenen-Bedienfeld des Betrachters angezeigt wird |
| `visible` | boolean |  | Anfängliche Sichtbarkeit am Bildschirm. Standard: true |
| `print` | boolean |  | Anfänglicher Druckzustand. Standard: folgt `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Vom PDF-Import gesetzt. Erhält die Ebenendefinition (OCG) des Quell-PDFs oder eine Zugehörigkeitsdefinition (OCMD), die die Sichtbarkeit aus einer Kombination mehrerer Ebenen bestimmt. Eine Zugehörigkeit hat `groups` (die Zielebenen), `policy` (`'AllOn'` = sichtbar, wenn alle an sind / `'AnyOn'` = wenn irgendeine an ist / `'AnyOff'` = wenn irgendeine aus ist / `'AllOff'` = wenn alle aus sind) sowie einen optionalen Sichtbarkeitslogik-Ausdruck `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | Vom PDF-Import gesetzt. Erhält die dokumentweite Ebenenkonfiguration (die Liste aller Ebenen, die Standardkonfiguration, den Anzeigereihenfolge-Baum des Ebenen-Bedienfelds, sich gegenseitig ausschließende Auswahlgruppen, Sperrung usw.) |

**`PdfRawValueDef`** (PDF-„Rohwerte“)

Viele der Erhaltungseigenschaften tragen PDF-interne Daten als „Rohwerte“, ohne sie zu interpretieren. Ein Rohwert ist ein JavaScript-Wert folgender Gestalt: `null`, Boolesche Werte und Zahlen unverändert; ein PDF-Name ist `{ kind: 'name', value: 'DeviceRGB' }`; eine Zeichenkette ist `{ kind: 'string', bytes: Uint8Array }`; ein Array ist `{ kind: 'array', items: [...] }`; ein Wörterbuch ist `{ kind: 'dictionary', entries: { ... } }`; ein Stream ist `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (von einem PDF-Betrachter ausgeführte Aktionen)

Wird im `additionalActions` von Formularfeldern und anderswo verwendet und definiert, „was der Betrachter tun soll“. Die Inhalte werden nur serialisiert und importiert — **die Core-Engine führt sie niemals aus** (die Ausführung übernimmt ein Betrachter, der sie unterstützt).

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Aktionstyp. `'JavaScript'` = ein Skript ausführen (Formatierung, Validierung und automatische Berechnung von Formulareingaben nutzen dies) / `'GoTo'` = zu einem Ziel innerhalb des Dokuments springen / `'GoToR'` = zu einem anderen Dokument springen / `'GoToE'` = zu einem eingebetteten Dokument springen / `'URI'` = eine URL öffnen / `'Launch'` = eine Anwendung oder Datei starten / `'Named'` = vordefinierter Befehl (nächste Seite usw.) / `'SubmitForm'` = das Formular übermitteln / `'ResetForm'` = das Formular zurücksetzen / `'ImportData'` = Daten importieren / `'Hide'` = Sichtbarkeit einer Anmerkung umschalten / `'SetOCGState'` = Sichtbarkeit einer Ebene umschalten / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = weitere PDF-Standardaktionen |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Wörterbuch, das die Einstellungen jedes Aktionstyps als Rohwerte hält (siehe **`PdfRawValueDef`** oben). Beispiel: für `'JavaScript'` `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Ziel für die `'GoTo'`-Familie. Entweder benannt (`{ kind: 'named', name, representation: 'name' \| 'string' }`) oder explizit (Zielseite + wie die Ansicht eingepasst wird) |
| `structureDestination` | PdfStructureDestinationDef |  | Ziel auf Basis eines Dokumentstruktur-Elements (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Gibt die von Medienaktionen anvisierte Anmerkung an |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Folge von Ebenen und Operationen (`'ON'` / `'OFF'` / `'Toggle'`), die durch `'SetOCGState'` umgeschaltet werden |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Gibt die von `'Hide'` / `'SubmitForm'` / `'ResetForm'` anvisierten Feldnamen an |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Angabe der eingebetteten Datei für `'GoToE'` (rekursive Struktur) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Plattformspezifische Parameter für `'Launch'`. Nur erhalten, niemals ausgeführt |
| `articleTarget` | PdfArticleActionTargetDef |  | Angabe des Artikelstrangs für `'Thread'` |
| `documentPartIndex` | number |  | Nummer des Ziel-Dokumentteils für `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Instanznummer der Rich-Media |
| `next` | PdfActionDef \| PdfActionDef[] |  | Als Nächstes auszuführende Aktion(en) (Verkettung) |

**`PdfFormXObjectDef`** (Metadatenerhaltung für importierte PDF-Komponenten)

Innerhalb eines PDFs können wiederholt verwendete Zeicheninhalte in Komponenten namens „Form XObjects“ verpackt werden. Der PDF-Import wandelt eine solche Komponente in ein `frame`-Element um und bewahrt das Koordinatensystem und die Metadaten der Komponente in diesem Typ auf, sodass sie bei der Wiederausgabe wiederhergestellt werden können. In handgeschriebenen Vorlagen keine Angabe nötig.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Begrenzungsrahmen der Komponente (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Transformationsmatrix des Koordinatensystems der Komponente (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Koordinatentransformation, die galt, als diese Komponente im Quell-PDF gezeichnet wurde |
| `formType` | 1 |  | Formulartypnummer der Komponente (die PDF-Spezifikation definiert nur 1) |
| `group` | Record<string, PdfRawValueDef> |  | Rohwert-Erhaltung des Transparenzgruppen-Wörterbuchs |
| `reference` | Record<string, PdfRawValueDef> |  | Rohwert-Erhaltung des Wörterbuchs für externe PDF-Referenzen |
| `metadata` | Stream-Form von PdfRawValueDef (`kind: 'stream'`) |  | Erhält den Metadaten-Stream |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Erhält anwendungsspezifische Daten des Erzeugerprogramms (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Erhält den Zeitstempel der letzten Änderung |
| `structParent` / `structParents` | number |  | Erhält die Zuordnungsschlüssel in getaggtes PDF hinein (Dokumentstruktur wie die Lesereihenfolge) |
| `opi` | PdfOpiMetadataDef |  | Erhält OPI-Informationen (siehe Tabelle unten) |
| `name` | string |  | Komponentenname |
| `measure` | PdfMeasurement |  | Erhält Messinformationen (siehe Tabelle unten) |
| `pointData` | PdfPointData[] |  | Erhält Punktwolkendaten (siehe Tabelle unten) |

**`PdfSourceVectorDef`** (gemeinsame Definitionen importierter wiederholter Formen)

Beim Import eines PDFs, in dem sich dieselbe Form in großer Zahl wiederholt — wie bei Kartensymbolen —, werden die Umrissdaten der Form in der Form „eine Definition + N Platzierungen“ aufbewahrt. Sie tritt im `pdfSourceVector` eines `path`-Elements auf; ist sie angegeben, findet keine Analyse von `d` statt. In handgeschriebenen Vorlagen keine Angabe nötig.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Array wiederverwendbarer Formdefinitionen. Jede Definition hat `commands` (0 = zum Startpunkt bewegen [2 Koordinaten], 1 = Gerade [2], 2 = kubische Bézierkurve [6], 3 = Pfad schließen [0]) und `coords` (ein flaches Array der Koordinaten in Befehlsreihenfolge) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Array der Platzierungen der Definitionen. Jede Platzierung hat `definitionIndex` (Definitionsnummer) und `matrix` (6-elementige affine Matrix) |

**`PdfOpiMetadataDef`** (Bildersetzungsinformationen für den kommerziellen Druck)

OPI (Open Prepress Interface) ist ein Mechanismus des kommerziellen Drucks, bei dem während der Bearbeitung ein leichtes Bild niedriger Auflösung verwendet und bei der Ausgabe durch die Druckerei gegen das hochaufgelöste Bild ausgetauscht wird. Wird erhalten, wenn das importierte PDF diese Angabe mitführte.

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | OPI-Version |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Hält die Inhalte des OPI-Wörterbuchs als PDF-Rohwerte (Quelldateiname für die Ersetzung, Beschnittbereich usw.) |

**`PdfMeasurement`** (Messinformationen für Zeichnungen und Karten)

In Zeichnungs- und Karten-PDFs können die Messwerkzeuge des Betrachters Entfernungen und Flächen in einem Maßstab wie „1 cm auf dem Papier entspricht 1 m in der realen Welt“ messen. Dieser Typ erhält diesen Maßstab und die Koordinatensysteminformationen und kommt in einer geradlinigen Form (`kind: 'rectilinear'`) und einer georäumlichen Form (`kind: 'geospatial'`) vor.

| Eigenschaft (`'rectilinear'`) | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Diskriminator für geradlinige Messung |
| `scaleRatio` | string | ✓ | Anzeigetext des Maßstabs (z. B. `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` ist optional) | Kette von Zahlenanzeigeformaten für die X-/Y-Richtung (Einheitenbezeichnungen, Umrechnungsfaktoren, Dezimal-/Bruchanzeige usw.). Wird `y` weggelassen, wird `x` verwendet |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Zahlenanzeigeformate für Entfernung/Fläche |
| `angle` / `slope` | PdfNumberFormat[] |  | Zahlenanzeigeformate für Winkel/Steigung |
| `origin` | [number, number] |  | Messursprung |
| `yToX` | number |  | Umrechnungsfaktor von Y- in X-Einheiten |

| Eigenschaft (`'geospatial'`) | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Diskriminator für georäumliche Messung |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Geodätisches Koordinatensystem. Entweder ein EPSG-Code oder eine WKT-Zeichenkette ist erforderlich |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Kontrollpunkte in geodätischen Koordinaten und die entsprechenden lokalen Kontrollpunkte innerhalb des Bildes oder der Komponente (gleiche Anzahl) |
| `dimension` | 2 \| 3 |  | Koordinatendimension. Standard: 2 |
| `bounds` | [number, number][] |  | Polygon des messbaren Bereichs |
| `displayCoordinateSystem` | Wie `coordinateSystem` |  | Koordinatensystem für die Anzeige |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Bevorzugte Anzeigeeinheiten für Entfernung, Fläche und Winkel |
| `projectedCoordinateSystemMatrix` | 12-elementiges Zahlentupel |  | 4×4-affine Matrix für das projizierte Koordinatensystem (12 Elemente in Zeilenreihenfolge, wobei die konstante vierte Spalte weggelassen wird) |

**`PdfPointData`** (Punktwolkendaten von Karten)

Zum Erhalten von in Karten-PDFs eingebetteten Punktdatentabellen mit benannten Spalten wie `LAT` (Breitengrad), `LON` (Längengrad) und `ALT` (Höhe).

| Eigenschaft | Typ / zulässige Werte | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Array der Spaltennamen (eindeutig und nicht leer; die Spalten `LAT`/`LON`/`ALT` müssen numerisch sein) |
| `rows` | PdfRawValueDef[][] | ✓ | Werte jeder Zeile. Die Zeilenlänge entspricht `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (Tonwertübertragungsfunktionen der Druckvorstufe)

In den `deviceParams` von `frame` und in `softMask` verwendete Funktionen, die einen Wert (0–1) auf einen anderen Wert abbilden. In der Druckvorstufe drücken sie Tonwertkurven aus — „Farbe dieser Dichte wird in jener Dichte gedruckt“. Ein `TransferFunctionDef` ist entweder ein `CalculatorFunctionDef` (ein PostScript-Rechnerausdruck, z. B. `{ expression: '{ 1 exch sub }' }` = Schwarz und Weiß umkehren) oder ein `PdfFunctionDef` (ein PDF-Funktionsobjekt: eine Tabelle abgetasteter Werte, exponentielle Interpolation oder eine Kombination daraus); dort, wo er verwendet wird, kann auch `'Identity'` (keine Transformation) angegeben werden.

**`HalftoneDef`** (Rasterdefinition der Druckvorstufe)

Druckmaschinen drücken Tonwertabstufungen durch die Größe kleiner Punkte (Rasterpunkte) aus. Dies gibt an, wie diese Punkte aufgebaut sind, und wird für die Erhaltung beim PDF-Import und für das Erstellen von Druckvorstufendaten verwendet. `type` unterscheidet fünf Formen:

| Form | Haupteigenschaften | Beschreibung |
| --- | --- | --- |
| type 1 (Screen) | `frequency` (Rasterweite) ✓, `angle` (Winkel) ✓, `spotFunction` (Punktform; ein vordefinierter Name wie `'Round'` oder ein Rechnerausdruck) ✓, `accurateScreens` (fordert einen hochpräzisen Rasteraufbau an; optional) | Standardform, die das Raster durch Rasterweite, Winkel und Punktform definiert (`type` darf weggelassen werden) |
| type 6 (Schwellenwert-Array) | `width` ✓, `height` ✓, `thresholds` (Breite × Höhe Werte, 0–255) ✓ | Definiert das Raster direkt über eine Schwellenwerttabelle |
| type 10 (gewinkelte Schwellenwerte) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Schwellenwertdefinition mit gewinkelten Zellen |
| type 16 (16-Bit-Schwellenwerte) | `width` ✓, `height` ✓, `thresholds` (16-Bit-Werte) ✓, optionales zweites Rechteck | Hochpräzise Schwellenwertdefinition |
| type 5 (Sammlung je Druckplatte) | `halftones` (Array aus `{ colorant: Druckfarbenname, halftone: eine der obigen Formen }`) ✓ | Weist jeder Farbplatte, etwa Cyan und Magenta, ein anderes Raster zu |

Die vier Formen außer type 5 können ein optionales `transferFunction` (`'Identity'` oder ein `TransferFunctionDef`) tragen (bei type 5 trägt jede innere Rasterdefinition je Druckplatte ihr eigenes).

## Kern-API

Die am häufigsten verwendeten APIs, einzeln aufgeführt mit einem minimalen Beispiel, damit Sie sie nach „was Sie tun möchten“ nachschlagen können. Für `template`, `dataSource`, `fontMap` und `fonts` werden genau die im Tutorial gebauten angenommen.

### Einen Bericht erstellen

#### Einen Bericht aus einer Vorlage und Daten erstellen — `createReport()`

Setzt Vorlage und Daten in ein Layout um und gibt ein seitenorientiertes `RenderDocument` zurück. Ausdrücke verwenden eine sichere eingebaute Ausdruckssprache, die `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` und mehr referenzieren kann — weder `eval` noch `Function` kommen zum Einsatz. TypeScript-Callback-Ausdrücke sind ebenfalls eine Option.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // Anzahl der ins Layout gesetzten Seiten
```

#### Vorlagenelemente per ID nachschlagen und ändern — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Beide APIs geben Referenzen auf Elemente der Originalvorlage zurück. Nehmen Sie Ihre Änderungen vor dem Aufruf von `createReport()` vor. `getElementChildren()` gibt nur für `frame` und `table` (Elemente in Zellen) Kindelemente zurück; für andere Elemente gibt es ein leeres Array zurück. Einzelheiten zum Suchbereich finden Sie unter **Elemente per ID nachschlagen und vor dem Rendern ändern**.

#### Einen Bericht aus einer `.report`-Datei erstellen — `createReportFromFile()` (Node.js)

Liest eine JSON-Vorlage und löst relative Pfade für Bilder und Subreports gegen das Verzeichnis der Vorlage auf.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Mehrere Berichte zu einem Band zusammenfassen — `createReportBook()`

Verkettet mehrere Vorlagen — ein Deckblatt, einen Hauptteil und so weiter — zu einem einzigen `RenderDocument` mit durchgehender Seitennummerierung.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Bereits erstellte `RenderDocument`s verketten — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

Kollidierende Bild-IDs werden automatisch umbenannt.

#### Automatisch eine Inhaltsverzeichnisseite erzeugen — `insertTableOfContents()`

Sammelt Inhaltsverzeichnis-Einträge aus Ankern (`anchorName`) im Bericht und fügt die Inhaltsverzeichnisseiten vorne ein.

```ts
const withToc = insertTableOfContents(
  document,
  // Seitengröße und Ränder des Inhaltsverzeichnisses in pt (dieses Beispiel: A4 Hochformat)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // Schriftart-ID (fontMap-Schlüssel), die für den Text des Inhaltsverzeichnisses verwendet wird
  { title: '目次' },
)
```

#### Die Seitenzahl eines bestehenden PDFs ermitteln — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Ein bestehendes PDF als Berichtselemente importieren — `importPdfPage()`

Einzelheiten finden Sie unter **Ein bestehendes PDF in Berichtselemente umwandeln (PDF-Import)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Rendern und Ausgeben

#### Ein PDF ausgeben — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Eine einzelne Seite in der Vorschau anzeigen — `renderPage()`

Seitenweises Rendern. Verwenden Sie es, um nur die gerade in einer Browser-Vorschau angezeigte Seite zu zeichnen.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Den ganzen Bericht auf ein beliebiges Backend rendern — `render()`

Rendert alle Seiten auf ein beliebiges Ausgabeziel, das die `RenderBackend`-Schnittstelle implementiert.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Auf ein HTML-Canvas zeichnen — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### SVG ausgeben — `SvgBackend`

Erzeugt je Seite eine eigenständige `<svg>`-Zeichenkette.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // Array von <svg>-Zeichenketten, eine je Seite
```

#### Feingranulare Kontrolle über die PDF-Erzeugung — `PdfBackend`

PDF-spezifische Optionen wie Seitenminiaturen werden dem Konstruktor übergeben.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` gilt für die i-te Seite. Für `thumbnailImageId` (das in der Seitenliste angezeigte Miniaturbild) geben Sie eine Bild-ID an, die in `document.images` existiert.

#### Fertige PDFs zusammenführen — `mergePdfFiles()`

Führt mehrere PDFs mit einem reinen TypeScript-PDF-Parser zu einem einzigen zusammen.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Mit Schriftarten arbeiten

#### Eine Schriftdatei laden — `Font.load()`

Analysiert TTF, OTF, TTC, OTC, WOFF, WOFF2 und EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Textbreite messen — `TextMeasurer`

Schnelle Textmessung, gestützt auf den Glyphen-Cache von `Font`. In der `fontMap` registriert, wird sie auch für das Layout verwendet.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Eine Zeichenkette in eine Glyphenfolge umwandeln — `font.shapeText()`

Nutzt Informationen aus OpenType / AAT (der Erweiterungsspezifikation von Schriften der Apple-Linie) / Graphite (der Erweiterungsspezifikation von Schriften der SIL-Linie), um eine Glyphenfolge (Glyphennummern mit Positionen und Vorschüben) mit angewandter Glyphenauswahl, Ligaturen und Positionierungsanpassungen zu erhalten.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Fehlende Glyphen vor dem Drucken erkennen — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Barcodes, SVG, mathematische Formeln und Bilder eigenständig verwenden

#### Einen Barcode eigenständig erzeugen — `renderBarcode()`

Erzeugt Barcode-Zeichenknoten direkt, ohne den Umweg über ein Berichtselement.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### SVG analysieren und rendern — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Eine mathematische Formel eigenständig setzen — `parseMathLaTeX()` / `layoutMathFormula()`

Erfordert eine Schriftart, die Dimensionsinformationen für mathematische Formeln enthält (die OpenType-MATH-Tabelle) — zum Beispiel STIX Two Math oder Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// Argumente: analysierte Formel, Font-Objekt, Schriftart-ID (fontMap-Schlüssel), Schriftgröße in pt, Textfarbe
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box ist das ins Layout gesetzte Ergebnis; math-Elemente in Vorlagen führen intern dasselbe Layout aus
```

#### Bildabmessungen ermitteln — `getImageDimensions()`

Unterstützt PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Ein PNG dekodieren — `decodePng()`

Ein reiner TypeScript-PNG-Dekodierer.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Im Browser ein PDF ausgeben, das WebP/AVIF enthält — `prepareBrowserPdfImageResources()`

JPEG wird direkt ins PDF eingelagert, und PNG übernimmt der eingebaute Dekodierer. Beim Erzeugen eines PDFs mit WebP/AVIF im Browser dekodiert `tsreport-core/browser` zunächst nur die tatsächlich vom `RenderDocument` referenzierten Bilder mit den Standard-Codecs des Browsers und übergibt die Ergebnisse an die PDF-Erzeugung. Nicht referenzierte Bilder bleiben unverändert und werden nicht dekodiert.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: zur Renderzeit gelieferte Bildbytes; catalog: Katalogeinstellungen des
// PDF-Dokuments; collection: PDF-Portfolio-Einstellungen — lassen Sie weg, was Sie nicht nutzen
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Um WebP/AVIF in Node.js zu dekodieren, verwenden Sie `createNodeExternalRasterImageDecoder()` aus `tsreport-core/node`.

## Einschränkungen beim Laden von Ressourcen und Regeln für Bild-IDs

Ausführliche Regeln, die Sie heranziehen, sobald sie für den Serverbetrieb oder die Einbettung als Bibliothek relevant werden.

### Die Verzeichnisse einschränken, aus denen Bilder und Vorlagen geladen werden

Das Laden von Bilddateien kann auf ausdrücklich erlaubte Verzeichnisse beschränkt werden.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` löst relative Pfade standardmäßig gegen das Verzeichnis der Hauptvorlage auf, schränkt den Ladebereich selbst aus Gründen der Abwärtskompatibilität aber nicht implizit ein. Ist `resources.fileRoot` angegeben, gilt dieselbe Einschränkung gleichermaßen für Bilder, die Hauptvorlage und Subreports. Fehlende Bilder werden gemäß der `onError`-Einstellung des jeweiligen Elements behandelt, und Referenzen, die aus dem erlaubten Verzeichnis hinauszeigen (auch über symbolische Links), führen immer zu einem Fehler.

### Regeln für Bild-IDs

Jedes Bild eines `RenderDocument` wird aus `RenderDocument.images` mit `RenderImage.imageId` (ebenso beim `imageId` einer Alternative) als Schlüssel nachgeschlagen. **Verbraucher müssen diese ID genau unverändert als Schlüssel verwenden und dürfen Schlüssel nicht durch Pfadverkettung oder Ähnliches neu zusammensetzen.** IDs werden nach folgenden Regeln vergeben.

- Das Laden eines Bildes über einen relativen Pfad ersetzt die ID nicht durch den absoluten Pfad des Servers oder den symlink-aufgelösten Pfad. Die Referenz, wie sie in der Vorlage geschrieben steht, bleibt der Schlüssel (ist sie als absoluter Pfad geschrieben, wird dieser Wert unverändert beibehalten)
- Der symlink-aufgelöste physische Pfad wird intern nur dafür verwendet, zu entscheiden, ob zwei Referenzen dieselbe Datei sind. Auch wenn die Basisverzeichnisse abweichen, verwenden Bilder, die auf dieselbe physische Datei zeigen, dieselbe ID wieder
- In Konfigurationen, in denen der Wurzelbericht ein Bild der Lieferung zur Renderzeit überlässt — also `createReport()` direkt verwendet wird, ohne das betreffende Bild über `resources` zu führen, sodass die in der Vorlage geschriebene Referenz unverändert zur ID wird und die Bytes später über `renderToPdf(document, { images })` geliefert werden —, erhalten von Subreports über relative Pfade geladene lokale Bilder stets host-unabhängige interne IDs. Da Referenzen in Ausdrücken und dynamischen Subreports nicht im Voraus aufgezählt werden können, hängt dies weder davon ab, ob ein Name tatsächlich kollidierte, noch von der Layout-Reihenfolge. Folglich kann ein lokales Bild eines Subreports niemals eine gleichnamige ID der Renderzeit-Lieferung an sich reißen

### Bildlieferung zur Renderzeit und Alternativen

Konnte eine Alternative zur Layout-Zeit nicht aufgelöst werden, bleibt die ID des Originalbildes erhalten. Canvas-/SVG-Vorschauen halten daher nicht an, und die Bytes können später über `renderToPdf(document, { images })` geliefert werden. Ausdrücklich übergebene `images` werden in `document.images` zusammengeführt, wobei bei gleicher ID der ausdrücklich übergebene Wert Vorrang hat. Auch während der PDF-Erzeugung werden nicht gelieferte Alternativen lediglich aus den Alternativkandidaten ausgeschlossen — weder das Rendern des Hauptbildes noch der Bericht als Ganzes hält an.

### Umfang der Sammlung von Bildreferenzen

Die Sammlung von Bildreferenzen behandelt nicht nur gewöhnliche `image`-Elemente, sondern über denselben Mechanismus auch Alternativen, Gruppen-Soft-Masks und die Kachelmuster von Füllungen (fill/stroke) samt ihrer verschachtelten Soft Masks. Wenn Sie im Browser PDF-spezifische Seitenminiaturen, Miniaturen von Sammlungsordnern oder Web-Capture-Bilder verwenden, übergeben Sie dieselben `catalog`, `collection` und `pageOptions` sowohl an `prepareBrowserPdfImageResources(document, options)` als auch an `renderToPdf(document, options)` (mit der primitiven API übergeben Sie dieselben Optionen an `new PdfBackend(options)` und rufen `render(document, backend)` auf). Auch diese WebP-/AVIF-Bilder werden vor der PDF-Erzeugung nur nach Bedarf dekodiert.

## Laufzeitanforderungen

- Node.js 18 oder neuer
- ES Modules / CommonJS
- Moderne Browser
- Keine Laufzeit-Abhängigkeitspakete

Die Brotli-Komprimierung und -Dekomprimierung von WOFF2 nutzt sowohl unter Node.js als auch in Browsern die in tsreport-core eingebaute reine TypeScript-Implementierung. Es werden keine externen Pakete, kein WASM und keine nativen Bibliotheken benötigt.

## Lizenz

tsreport-core steht Ihnen wahlweise unter der [MIT-Lizenz](./LICENSE-MIT) oder der [Apache-Lizenz 2.0](./LICENSE-APACHE) zur Verfügung (SPDX: `MIT OR Apache-2.0`). Urheberrechtshinweise und Lizenzbedingungen von Code und Daten Dritter finden Sie in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
