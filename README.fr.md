# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | Français | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Du japonais, du chinois et du coréen à l'écriture arabe — un moteur de rapports qui transforme les systèmes d'écriture du monde en PDF élégants, en pur TypeScript.**

`tsreport-core` prend en charge l'analyse des polices OpenType, la composition du texte (disposer les caractères sur la page avec les formes de glyphes, les largeurs et les positions correctes), la mise en page de rapports par bandes, l'aperçu Canvas/SVG et la génération de PDF — le tout à travers un modèle de rendu unique et cohérent. Il ne comporte aucune dépendance à l'exécution. Sans module natif ni WASM, ce paquet unique fonctionne aussi bien sous Node.js que dans les navigateurs modernes.

Les exemples de code de ce document utilisent volontairement des données commerciales japonaises (devis, factures) : ils servent en même temps de démonstration en conditions réelles des capacités de composition CJK de ce moteur.

```bash
npm install tsreport-core
```

Ce README regorge d'exemples à copier et exécuter tels quels, couvrant tous les sujets : de votre première génération de PDF aux 16 éléments de rapport, en passant par l'écriture verticale, la composition multilingue, l'incorporation de polices et la vectorisation du texte, jusqu'à l'aperçu dans le navigateur. Si les outils de rapport sont nouveaux pour vous, commencez par **Notions de base de la mise en page des rapports** pour vous familiariser avec les concepts, puis créez votre premier PDF avec le tutoriel.

## Composer correctement les systèmes d'écriture du monde, avec un seul moteur

Un rapport multilingue ne peut pas s'afficher correctement en écrivant simplement des chaînes de caractères telles quelles dans un PDF. Sélection des glyphes, mesure de la largeur des caractères, positionnement, coupure de ligne, écriture verticale et incorporation des polices dans le PDF — ce n'est que lorsque toute cette chaîne de traitements s'articule correctement que vous obtenez la page attendue.

`tsreport-core` prend en charge l'intégralité de ce flux, de l'analyse des polices à la génération du PDF.

- **Japonais, chinois et coréen** — le chinois simplifié et traditionnel, le hangul, le traitement de la ponctuation et les glyphes d'écriture verticale sont tous composés correctement sur la base des données Unicode et OpenType
- **Écriture arabe et composition de droite à gauche (RTL)** — la mise en forme contextuelle des glyphes, les liaisons et ligatures (plusieurs caractères fusionnant en une seule forme de glyphe) et le traitement bidirectionnel Unicode (contrôle de l'ordre lorsque du texte de droite à gauche se mêle à des chiffres et des lettres latines) sont gérés par le même pipeline de mise en page que toutes les autres écritures
- **Systèmes d'écriture complexes** — la substitution et le positionnement des glyphes pilotés par les règles de composition intégrées à la police (OpenType Layout), les caractères combinants, les variantes de glyphes (dessins alternatifs d'un même caractère) et les fonctionnalités de composition propres à chaque langue sont pris en charge
- **Écriture verticale** — gère `vertical-rl` / `vertical-lr`, les glyphes d'écriture verticale, les métriques verticales (données dimensionnelles telles que les chasses propres au texte vertical) et la rotation des caractères
- **Incorporation automatique de sous-ensembles de polices** — seuls les glyphes réellement utilisés (les données de forme par caractère stockées dans la police) sont incorporés dans le PDF, de sorte que le document s'affiche à l'identique même sur les machines où la police n'est pas installée
- **Vectorisation du texte** — élément par élément, le texte peut être produit sous forme de tracés vectoriels indépendants de la police
- **Références aux polices système** — pour les flux de travail qui s'appuient sur les polices du lecteur, vous pouvez aussi produire des PDF légers sans aucune police incorporée
- **Détection du texte illisible avant qu'il n'apparaisse** — `checkGlyphCoverage()` signale, page par page et caractère par caractère, les caractères absents de la police avant la sortie

Et cette composition du texte fonctionne d'un seul tenant avec un moteur de mise en page conçu spécifiquement pour les rapports — car la capacité à poser correctement les caractères et la capacité à paginer correctement sont indissociables.

- **Une mise en page qui s'adapte au volume de texte** — les lignes s'étirent selon la quantité de texte (`stretchWithOverflow`) et la hauteur des bandes s'ajuste automatiquement. Les noms de produits longs ne sont jamais tronqués
- **Sauts de page automatiques pilotés par le volume de données** — lorsque les lignes de détail débordent, le moteur entame une nouvelle page et réémet automatiquement l'en-tête et les lignes de titre. Les sous-totaux par groupe et les sauts de page ne demandent rien de plus qu'une déclaration
- **Mise en page imbriquée** — même les rapports complexes combinant tableaux, tableaux croisés et sous-rapports sont placés de manière cohérente par le même moteur de mise en page
- **WYSIWYG (aperçu = impression)** — les éléments sont fixés exactement aux coordonnées en pt que vous spécifiez, et l'aperçu Canvas/SVG partage un résultat de mise en page identique avec la sortie PDF. Ce que vous voyez à l'écran est ce que vous obtenez sur papier

## Pourquoi tsreport-core

tsreport-core est né de trois préoccupations.

**TypeScript ne dispose d'aucune solution de rapports digne de ce nom.** Produire des devis et des factures est un besoin métier élémentaire ; pourtant l'écosystème TypeScript/Node.js — s'il possède des bibliothèques de dessin PDF de bas niveau — n'offrait rien qui mérite le nom de "moteur de rapports" : mise en page par bandes, sauts de page automatiques, agrégation et fidélité aperçu-impression réunis dans un seul paquet. Nous voulions en finir avec la pratique consistant à embarquer un autre environnement d'exécution ou un produit serveur externe uniquement pour les rapports.

**La génération de rapports est une capacité fondamentale, et chacun doit pouvoir l'utiliser gratuitement.** La sortie de rapports n'est pas une fonctionnalité premium réservée à quelques produits coûteux ; elle fait partie du socle de tout système métier. Sans licence commerciale à acheter ni frais à l'usage, tout le monde — des outils personnels aux produits commerciaux — doit pouvoir utiliser le même moteur tel quel. tsreport-core publie l'ensemble de ses fonctionnalités sous une double licence MIT OR Apache-2.0, incarnation de cette conviction.

**Rares sont les solutions qui abordent de front la prise en charge multilingue — écritures asiatiques, écriture arabe et au-delà.** La plupart des outils de rapports et de PDF sont conçus autour du texte latin, traitant la composition du japonais, du chinois et du coréen ou l'écriture arabe de droite à gauche comme des préoccupations secondaires. tsreport-core a fait de "composer correctement les systèmes d'écriture du monde, avec un seul moteur" un objectif de conception dès le premier jour, en implémentant tout en interne, de l'analyse des polices à la composition et à l'incorporation dans le PDF.

Ces motivations prennent corps en trois points forts.

### Du moteur de mise en page à la génération du PDF, tout dans un seul paquet

Lorsque les pages sont assemblées à partir d'un modèle et de données, le résultat est capturé dans un modèle de rendu unique appelé `RenderDocument`. Ce même modèle peut être rendu en PDF, Canvas ou SVG ; il n'est donc pas nécessaire de maintenir une logique de mise en page en double pour l'aperçu à l'écran et l'impression — le PDF est exactement identique à ce que vous avez vu à l'écran. Nul besoin de raccorder ensemble un moteur de rapports par bandes et une bibliothèque PDF.

### Du TypeScript pur, sans aucune dépendance à l'exécution

L'analyse des polices, la composition du texte, la génération de PDF, la compression DEFLATE, le chiffrement, le décodage PNG et la génération de codes-barres sont tous implémentés en pur TypeScript. Sans module natif ni processus externe, le moteur se comporte de manière identique dans tous les environnements, et auditer le code exécuté pendant la génération d'un rapport revient à lire ce seul paquet.

### Tout ce dont un rapport a besoin, intégré d'origine

- Mise en page par bandes avec titre, en-tête de page, détail, groupe, résumé et plus encore
- Tableaux, tableaux croisés, sous-rapports, variables, expressions, sauts de page, table des matières, fusion de plusieurs rapports
- Import de PDF existants — conversion de pages PDF en éléments de rapport (`ElementDef`), styles, images et informations de police
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, dégradés, découpage (clipping), transparence, composition mathématique, images
- Chiffrement PDF, PDF/A-1b, 2b et 3b (normes internationales d'archivage à long terme), PDF/X-1a (norme internationale de remise de fichiers pour l'impression), signets, liens, formulaires, annotations
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, polices variables (polices dont la graisse, la largeur et d'autres axes varient en continu) et polices en couleur

## Notions de base de la mise en page des rapports

Pour les lecteurs qui découvrent les moteurs de rapports, cette section parcourt les concepts fondamentaux dans l'ordre.

### Préambule : un rapport se construit à partir d'un "modèle" plus des "données"

Dans tsreport-core, un rapport se construit à partir de deux éléments : un **modèle** (la définition de la mise en page) et des **données** (JSON).

Le modèle ne contient aucune valeur réelle. Il ne définit que les cadres — "le nom de l'article va ici ; le montant va là, avec cette largeur et dans ce format" — ainsi que des références indiquant **quel champ de données afficher** dans chacun (écrites `field.item`, c'est-à-dire le champ `item` des données).

Les valeurs réelles sont transmises sous forme de données JSON. Chaque élément du tableau `rows` constitue une ligne de détail.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Lors de la génération du rapport, le moteur parcourt `rows` de haut en bas, en émettant la mise en page de détail une fois par ligne. Dans l'exemple ci-dessus, trois lignes de détail sont imprimées, et `field.item` se résout tour à tour en りんご, みかん et ぶどう. Si les données passent à 10 000 lignes, le rapport s'allonge à 10 000 lignes sans changer un seul caractère du modèle. Cette répartition des rôles — la mise en page est fixe, le nombre de lignes suit les données — est le point de départ de tout moteur de rapports.

### Une page est un empilement de "bandes"

Côté modèle, vous concevez ensuite la page comme un empilement de rubans horizontaux appelés **bandes**. Plutôt que de calculer vous-même les coordonnées Y et de placer les éléments sur la page, vous déclarez seulement "quelle bande contient quoi", et le moteur assemble automatiquement les pages en fonction du nombre de lignes de données. Une page a la structure suivante.

```text
┌──────────────────────────┐
│ title                    │ ← une fois au début du rapport (titre, destinataire…)
├──────────────────────────┤
│ pageHeader               │ ← en haut de chaque page (nom de la société, date d'émission…)
├──────────────────────────┤
│ columnHeader             │ ← ligne de titre des lignes de détail (article, quantité, montant…)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ une fois par ligne de rows,
│ details                  │ │ répétée autant de fois qu'il y a de lignes
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← clôt les lignes de détail (par page/colonne)
├──────────────────────────┤
│ pageFooter               │ ← en bas de chaque page (numéros de page…)
└──────────────────────────┘
```

Sur la dernière page, après le dernier `details`, `summary` (totaux généraux de l'ensemble du rapport, etc.) est émis exactement une fois. Il existe en outre `background`, posé sous chaque page ; `lastPageFooter`, utilisé uniquement sur la dernière page ; et `noData`, qui n'apparaît que lorsque les données comptent zéro ligne — dix types de bandes au total peuvent être définis dans `bands`.

| Bande | Moment d'émission | Usage typique |
| --- | --- | --- |
| `background` | Arrière-plan de chaque page | Filigranes, bordures décoratives |
| `title` | Une fois au début du rapport | Titre, destinataire |
| `pageHeader` | En haut de chaque page | Nom de la société, date d'émission |
| `columnHeader` | Avant les lignes de détail (par page/colonne) | Ligne de titre du détail |
| `details` | Une fois par ligne de données (`rows`) | Lignes de détail |
| `columnFooter` | Après les lignes de détail (par page/colonne) | Zone de sous-total |
| `pageFooter` | En bas de chaque page | Numéros de page |
| `lastPageFooter` | En bas de la dernière page (remplace `pageFooter` lorsqu'il est spécifié) | Mentions finales |
| `summary` | Une fois après toutes les lignes de détail | Total général, remarques |
| `noData` | Lorsque les données comptent zéro ligne | "Aucune donnée correspondante" |

Si vous définissez en plus des `groups`, des en-têtes et pieds de groupe sont insérés automatiquement partout où la clé de groupe change, ce qui permet des mises en page du type "sous-total par service, puis nouvelle page".

Vous pouvez également spécifier `columns` dans le modèle (`count` = nombre de colonnes, `spacing` = espacement entre colonnes en pt) pour faire couler la zone de détail dans plusieurs **colonnes** verticales, à la manière d'un journal. La valeur par défaut est une seule colonne, auquel cas tout ce qui est décrit "par colonne" dans ce document équivaut à "par page". Le passage à la colonne suivante est appelé "saut de colonne".

### Les sauts de page se font automatiquement

Lorsque les lignes de détail ne tiennent plus sur la page, le moteur clôt automatiquement cette page (en émettant `pageFooter`), entame la suivante, émet à nouveau `pageHeader` et `columnHeader`, puis continue de faire couler les lignes de détail restantes. Vous n'avez jamais besoin de compter les lignes ni de calculer la hauteur restante d'une page.

Ce n'est que lorsque vous voulez garder la main que vous recourez aux mécanismes suivants.

- L'élément `break` — force un saut de page ou un saut de colonne à n'importe quelle position
- `startNewPage` d'une bande — démarre toujours cette bande sur une nouvelle page
- `splitType` d'une bande — lorsque la hauteur est insuffisante, détermine si la bande peut chevaucher deux pages en cours de route (`stretch`) ou doit être déplacée entière sur la page suivante (`prevent`)

### Sous-rapport = un autre rapport incorporé dans un rapport

L'élément `subreport` incorpore un `.report` séparé tout entier dans la mise en page du rapport parent. "Imprimer une liste de commandes et, dans chaque commande, imprimer ses lignes d'articles sous forme de tableau" — c'est le mécanisme de mise en page des **données imbriquées** de ce type.

Supposons que chaque ligne de `rows` du parent (une commande) porte un tableau `items` de lignes d'articles.

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

Placez un élément `subreport` dans la bande `details` du parent et transmettez "les `items` de cette commande" via `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` est, comme son nom l'indique, une expression. Pour passer un nom de fichier fixe, entourez-le de `'...'` en tant que littéral de chaîne dans l'expression (vous pouvez aussi le commuter dynamiquement avec une expression telle que `"field.templatePath"`).

Le sous-rapport **s'exécute alors une fois pour chaque ligne de détail du parent**, et les `items` transmis sont traités comme les `rows` propres du sous-rapport. Le sous-rapport (`order-items.report`) est un modèle indépendant à part entière : il possède ses propres définitions de bandes et référence chaque ligne d'article via `field.name` et `field.qty`. Sur la page, il se déploie ainsi.

```text
┌──────────────────────────────┐
│ details                      │ ← rows du parent, ligne 1 (commande A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← reçoit les items de cette commande (2 lignes)
│   │   details              │ │ ← items ligne 1 (りんご 10)
│   │   details              │ │ ← items ligne 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows du parent, ligne 2 (commande A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← reçoit les items de cette commande (1 ligne)
│   │   details              │ │ ← items ligne 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

Le tableau de lignes d'articles à l'intérieur d'une facture, un bloc de détail répété par client — les "petits rapports dans un rapport" peuvent ainsi être découpés en composants et réutilisés. Des paramètres (libellés de titre, etc.) peuvent aussi être transmis depuis le parent. La section ultérieure **Exemples fonctionnels pour chaque élément** contient un exemple complet, prêt à exécuter, de ce montage précis (l'élément côté parent plus le modèle côté sous-rapport).

## Générer un PDF à partir d'un fichier `.report` et de données JSON

Un fichier `.report` est un modèle de rapport : un `ReportTemplate` écrit en JSON. Comme il s'agit de JSON pur, vous pouvez suivre les différences dans Git et le générer depuis n'importe quel langage ou outil.

La configuration minimale tient en ces trois fichiers.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Les deux noms de fichiers de police supposent les graisses Regular / Bold d'une police japonaise (par ex. Noto Sans JP). Remplacez-les par les polices dont vous disposez. La gestion de plusieurs langues dans un même rapport est traitée plus loin dans **Créer des rapports multilingues**.

### 1. Écrire le modèle, `quotation.report`

Les coordonnées, dimensions, marges et tailles de police sont toutes en **pt (points, 1pt = 1/72 pouce ≈ 0,353mm)**, l'unité standard du PDF. `"size": "A4"` est traité comme 595 × 842pt (les dimensions ISO de 210×297mm converties en pt et arrondies à l'entier), et les marges de 36pt de cet exemple font environ 12,7mm.

Autre point de départ : `fontFamily` dans `styles` n'est pas un nom de fichier de police mais une **clé (nom logique)** que vous enregistrerez plus tard dans le `fontMap` et le `fonts` du code d'exécution. C'est l'emploi des mêmes noms dans le modèle et dans le code (`jp` et `jpBold` dans cet exemple) qui les relie.

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

Le `pattern` utilisé dans les lignes de détail est un spécificateur de format de nombre/date (`#,##0` = séparateurs de milliers, `¥#,##0` = séparateurs de milliers avec le symbole yen ; voir "Formater les nombres et les dates" plus loin dans ce document pour les détails).

### 2. Préparer les données, `quotation.test-data.json`

Chaque ligne de `rows` est liée à `field.*` dans la bande de détail, et `parameters` est lié à `param.*` pour l'ensemble du rapport.

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

Les liaisons s'établissent comme suit.

| JSON | Expression dans `.report` | Rôle |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Ligne de détail courante |
| `parameters.title` | `param.title` | Argument à l'échelle du rapport |
| Variable `grandTotal` | `vars.grandTotal` | Variables de rapport pour sommes, comptages, etc. |
| Contexte de page | `PAGE_NUMBER` / `TOTAL_PAGES` | Numéro de page, nombre total de pages |

### 3. Charger le `.report` et générer le PDF

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
  // Les Buffers Node.js peuvent partager un pool mémoire plus large ; passez à Font.load
  // un ArrayBuffer découpé exactement sur les octets de ce fichier
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

Les mêmes polices sont enregistrées deux fois, dans `fontMap` et dans `fonts`, car les deux jouent des rôles différents : `fontMap` sert à la mesure de la largeur des caractères au moment de la mise en page (`TextMeasurer`), tandis que `fonts` sert à l'incorporation des polices au moment de la génération du PDF. Enregistrez la même police dans les deux, sous les mêmes noms de clés que le `fontFamily` du modèle.

`createReportFromFile()` résout les chemins relatifs des images et des sous-rapports par rapport au répertoire du `.report` principal. Si vous spécifiez `workingDirectory`, c'est ce répertoire qui sert de base à la place. Pour restreindre ce qui peut être lu, déclarez explicitement la racine autorisée dans `resources.fileRoot` ; les références relatives qui s'échappent de cette racine, ainsi que les liens symboliques pointant en dehors, sont rejetés.

## Définir les modèles directement en TypeScript

Au lieu d'utiliser un fichier `.report`, vous pouvez écrire le modèle sous forme d'objet TypeScript. Avec la vérification de types et la complétion à portée de main, cette approche convient bien à la génération de modèles depuis le code. Le contenu est le même devis que dans le tutoriel. Les coordonnées et dimensions sont en pt.

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

### Rechercher des éléments par ID et les modifier avant le rendu

Donnez à un élément un `id` arbitraire et vous pourrez le récupérer avec `findElementById()`, quelle que soit la profondeur à laquelle il se trouve dans les bandes ou les cadres. La valeur de retour n'est pas une copie mais l'élément contenu dans `template` lui-même ; toute modification effectuée avant `createReport()` est donc répercutée dans la mise en page et le rendu.

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

`findElementById()` parcourt en profondeur d'abord les bandes ordinaires, les bandes de détail, les en-têtes/pieds de groupe, les cadres, les masques de fusion (soft masks) et les cellules de tableau. Lorsque le même ID apparaît plusieurs fois, la fonction renvoie le premier élément dans l'ordre de parcours ; gardez donc unique dans le modèle tout ID que vous comptez modifier. Les éléments du tableau renvoyé par `getElementChildren()` sont eux aussi des références vers le modèle d'origine.

> Les fichiers de polices ne sont pas fournis avec le paquet. Choisissez des polices dont la licence convient à votre cas d'usage, à votre mode de distribution et aux autorisations d'incorporation. Un style ne peut nommer qu'une seule police. Pour mélanger des caractères de plusieurs langues au sein d'un même élément, il vous faut une police Pan-CJK qui les couvre toutes dans un seul fichier (une police regroupant les caractères japonais, chinois et coréens ; par ex. Source Han Sans, Noto Sans CJK). Pour utiliser une police distincte par langue, découpez les éléments par langue et changez de style, comme dans la section suivante, "Créer des rapports multilingues".

## Créer des rapports multilingues

Chaque style ne peut nommer qu'une seule police, et il n'existe aucun repli automatique d'une police vers une autre. Le schéma de base d'un rapport multilingue consiste donc à **charger une police par langue et à appliquer le style de chaque langue aux éléments de cette langue**.

L'extrait suivant provient d'un devis présentant côte à côte le japonais et le chinois simplifié. Chargez d'abord une police pour chaque langue.

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

Dans le modèle, appliquez le style `ja` aux libellés japonais et le style `zh` aux libellés chinois, en séparant les éléments par langue.

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

Les données portent de même un champ par langue.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

L'exception est **le champ unique dont la langue n'est connue qu'à l'exécution**, comme une zone de remarques libre. Puisqu'un tel champ ne peut pas être scindé en éléments par langue, la réponse pratique consiste à attribuer — à ce style uniquement — une police Pan-CJK couvrant de nombreux systèmes d'écriture dans un seul fichier (Source Han Sans, Noto Sans CJK, etc.). Dans tous les cas, `checkGlyphCoverage()` détecte toute lacune de couverture de la police avant la sortie.

## Choisir un mode de sortie de police par élément de texte

Même au sein d'un seul rapport, vous pouvez spécifier le mode de sortie par `staticText` ou `textField` : texte incorporé et interrogeable pour le corps, contours vectorisés pour le logo, références aux polices système pour les mentions standard.

| Mode | Spécification | État dans le PDF | Convient à |
| --- | --- | --- | --- |
| Incorporation de sous-ensemble | `pdfFontMode: 'embedded'` (par défaut) | Incorpore les glyphes utilisés plus le programme de police. Le texte peut être sélectionné et recherché | Diffusion, archivage à long terme, impression, rapports multilingues |
| Vectorisation en contours | `outlineText: true` | Convertit les formes des glyphes en tracés vectoriels. Ne transporte aucune information de police | Logos, documents prêts à imprimer — texte dont les formes doivent être figées exactement |
| Référence aux polices système | `pdfFontMode: 'reference'` | N'incorpore aucune police ; n'enregistre que le nom de la police et les caractères | PDF légers pour diffusion interne, quand l'environnement de polices est maîtrisé |

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

L'incorporation de sous-ensembles est le mode recommandé pour préserver les formes des glyphes quel que soit l'environnement de destination. Les références aux polices système exigent une police compatible partout où le PDF est ouvert, et l'apparence peut varier d'un environnement à l'autre. Le texte vectorisé en contours ne peut plus être sélectionné ni recherché comme du texte ordinaire.

## Écriture verticale

Spécifiez simplement `writingMode` sur un style, et le texte est composé verticalement à l'aide des glyphes d'écriture verticale et des données dimensionnelles propres au vertical (métriques verticales — chasses et autres). `vertical-rl` fait progresser les lignes de droite à gauche ; `vertical-lr` de gauche à droite.

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

## Prévisualiser exactement le même rapport dans le navigateur

Le `RenderDocument` que vous avez construit pour le PDF peut tout aussi bien être rendu directement sur un Canvas. L'aperçu et l'impression partagent le même résultat de mise en page, si bien que "l'écran et le papier diffèrent" ne peut tout simplement pas se produire. Combiné à la mise en page fixe en pt, c'est le socle d'une expérience d'aperçu et d'édition WYSIWYG (l'incorporation de polices est le comportement par défaut ; seul le mode de référence aux polices système fait dépendre l'apparence de l'environnement de visualisation). Un seul appel à `renderPage()` dessine la page, y compris sa préparation et sa finalisation.

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
  scale: 1.5, // échelle d'affichage : 1.0 dessine 1pt comme 1px
  devicePixelRatio: window.devicePixelRatio, // garde le texte et les traits nets sur les écrans haute densité
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Si vous construisez une interface d'aperçu en React, le paquet `tsreport-react` est également disponible.

## Utiliser le moteur de polices de manière autonome

Même sans construire de rapport, vous pouvez utiliser chaque capacité séparément : analyse de polices, mise en forme (conversion d'une chaîne en la séquence et les positions des glyphes réellement dessinés), mesure de texte et génération de sous-ensembles.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width : largeur de la chaîne en pt à 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // IDs de glyphes et positions après mise en forme
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline : données de tracé de Bézier

console.log(measurement.width, shaped, glyph.outline)
```

## Convertir un PDF existant en éléments de rapport (import PDF)

`importPdfPage()` analyse une page d'un PDF existant et la convertit en un tableau d'éléments de rapport tsreport-core (`ElementDef`). Ce n'est pas un simple visualiseur : le texte arrive en `staticText`, les images en `image`, les formes en `path` — des composants que vous pouvez éditer et réagencer directement dans ce moteur de rapports.

Prenez le PDF d'un formulaire que vous exploitiez sur papier, ou un PDF produit par un autre système, et servez-vous-en comme base — en y ajoutant des champs de fusion de données, en remaniant la mise en page. C'est la porte d'entrée pour **transformer des actifs de rapports existants en modèles**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements : tableau d'éléments de rapport (staticText / image / path…)
// page.styles :   définitions de styles de texte référencées par les éléments
// page.images :   données d'images référencées par les éléments
// page.fonts :    informations sur les polices référencées
console.log(pageCount, page.width, page.height, page.elements.length)
```

Les `elements` et `styles` importés peuvent être placés tels quels dans les bandes d'un modèle. Le mot de passe des PDF chiffrés, l'import des annotations, la vectorisation du texte importé et plus encore se contrôlent via `PdfImportOptions`.
## Maîtriser les expressions

Tout ce qui est "dynamique" dans un rapport s'écrit sous forme d'expression : le contenu imprimé par un `textField`, la condition d'impression dans `printWhenExpression`, les données d'un code-barres, les chemins d'images, les données transmises à un sous-rapport — chaque propriété de type `Expression` accepte le même langage d'expressions.

Les expressions existent sous deux formes.

- **Expressions chaînes** — des chaînes telles que `"field.price * field.quantity"`. C'est un sous-ensemble sûr de JavaScript interprété par un analyseur dédié ; `eval` et `new Function` ne sont jamais utilisés. Les modèles restent enregistrables en JSON (fichiers `.report`)
- **Expressions callback** — des fonctions TypeScript de la forme `(field, vars, param, report) => …`. Vous disposez de toute la puissance du langage, mais le modèle ne peut plus être enregistré en JSON (cela suppose que vous conserviez vos modèles en TypeScript)

Nous recommandons de voir d'abord jusqu'où les expressions chaînes vous mènent, et de ne passer aux callbacks que lorsqu'elles ne suffisent plus.

### Valeurs référençables dans les expressions

| Nom | Description |
| --- | --- |
| `field.*` | La ligne de données courante. L'accès imbriqué tel que `field.customer.name` est pris en charge |
| `vars.*` | Les variables (valeurs d'agrégation définies dans `variables`, décrites plus loin). `var.*` fonctionne de même |
| `param.*` | Les valeurs à l'échelle du rapport : valeurs passées via `parameters` de la source de données et `defaultValue` des `parameters` du modèle. Dans un sous-rapport, les paramètres transmis par le parent y figurent aussi |
| `PAGE_NUMBER` | Le numéro de page courant (à partir de 1) |
| `COLUMN_NUMBER` | Le numéro de colonne courant (à partir de 1) |
| `REPORT_COUNT` | Le nombre de lignes de données traitées |
| `TOTAL_PAGES` | Le nombre total de pages. **Référencé tel quel, il donne "le nombre de pages jusqu'ici"** ; pour imprimer le total final, combinez-le avec `evaluationTime: 'report'` ou `'auto'` (décrits plus loin) |

Référencer un champ inexistant ne lève pas d'exception ; l'évaluation donne `undefined` (même lorsqu'une partie intermédiaire de `field.a.b` vaut `null`, elle renvoie `null` en toute sécurité).

### Syntaxe disponible dans les expressions chaînes

| Catégorie | Disponible |
| --- | --- |
| Littéraux | nombres (`1200`, `0.5`), chaînes (`'見積'` ou `"見積"`, avec des échappements tels que `\n`), `true` / `false` / `null` / `undefined` |
| Littéraux de gabarit | `` `合計 ${vars.total} 円` `` — une expression complète peut figurer dans `${}` |
| Arithmétique | `+` (addition numérique et concaténation de chaînes), `-`, `*`, `/` |
| Comparaison | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Logique | `&&`, `\|\|`, `!` (évaluation en court-circuit, comme en JavaScript) |
| Coalescence des nuls | `??` — renvoie le membre droit lorsque le gauche est null/undefined |
| Conditionnel (ternaire) | `condition ? valeurSiVrai : valeurSiFaux` |
| Divers | `-` / `+` unaires, parenthèses `( )`, accès aux membres par notation pointée (les noms de propriétés peuvent être japonais : `field.顧客名`) |
| Fonctions intégrées | `format(value, pattern)` = formatage (décrit plus loin) / `round(value, digits?)` = arrondi arithmétique / `roundUp`, `roundDown`, `roundHalfEven` (arrondi bancaire), `ceil`, `floor`, `trunc` (pour chacune, le second argument est le nombre de décimales, 0 si omis) / `now()` = heure courante |

**Indisponibles** : `==` / `!=` (utilisez `===` / `!==`), `%` et `**`, la notation entre crochets (`field['a-b']`) et l'indexation de tableaux, les appels de méthodes (`field.name.toUpperCase()` échoue à l'évaluation — les seules fonctions appelables sont les fonctions intégrées ci-dessus), l'affectation, la définition de fonctions, `new`, le chaînage optionnel (`?.` — de toute façon inutile, puisque les nulls intermédiaires ne lèvent jamais d'exception). Lorsque vous avez besoin de l'un de ces éléments, utilisez une expression callback.

Ces restrictions existent pour la sécurité. Les expressions chaînes sont interprétées par un analyseur dédié et ne sont jamais exécutées comme du code ; un modèle reçu de l'extérieur ne peut donc pas y glisser du code arbitraire.

### Imprimer un résultat calculé

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Données d'exemple :

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Cela imprime `¥3,960`.

### Construire des chaînes

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

Les valeurs insérées dans les `${}` d'un littéral de gabarit sont converties en chaîne puis concaténées. **null devient la chaîne `"null"`** ; ajoutez donc `?? ''` aux valeurs susceptibles de manquer, comme dans l'exemple.

### Commuter le contenu selon une condition

Utilisez l'opérateur ternaire pour changer ce qui est imprimé.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Lorsque vous voulez changer *si* quelque chose s'affiche plutôt que *ce qui* s'affiche, utilisez la propriété commune aux éléments `printWhenExpression` (voir "Imprimer un élément seulement lorsqu'une condition est remplie"). Pour commuter la mise en forme (couleur, gras) selon une condition, spécifiez une expression de condition de même forme dans les `conditionalStyles` de la définition de style.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Formater les nombres et les dates — `format` et `pattern`

`textField` peut formater le résultat de l'expression au moment de l'impression via la propriété `pattern`. Pour formater une partie d'une valeur à l'intérieur d'une expression, utilisez la fonction intégrée `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Les motifs numériques combinent `#` (afficher le chiffre s'il existe), `0` (remplissage par des zéros) et `,` (séparateur de milliers), et peuvent porter un préfixe et un suffixe. L'arrondi se fait à la demi-unité supérieure (half-up).

| Motif | Entrée | Sortie |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Les jetons de motif de date sont `yyyy` (année sur 4 chiffres), `MM` / `M` (mois avec/sans zéro initial), `dd` / `d` (jour avec/sans zéro initial), `HH` (heure avec zéro initial, horloge sur 24 heures), `mm` (minutes) et `ss` (secondes). Une valeur null/undefined produit une chaîne vide.

Pour les formats au-delà de ceux-ci (dates en ère japonaise, noms de jours de la semaine, gestion des décimales monétaires, etc.), enregistrez des fonctions TypeScript nommées dans les `formatters` du modèle et écrivez leur nom dans `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// Côté élément : { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` cherche d'abord un formateur enregistré sous ce nom, puis est interprété comme un format intégré si aucun n'est trouvé. Les formateurs étant des fonctions, les modèles utilisant cette fonctionnalité se conservent en TypeScript plutôt qu'en JSON.

### Imprimer totaux, moyennes et comptages — les variables (`variables`)

Les agrégations qui s'étendent sur plusieurs lignes de détail se définissent dans les `variables` du modèle. À chaque ligne de données traitée, une variable injecte le résultat de son `expression` dans son agrégat, et les expressions peuvent référencer la valeur courante via `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Placez un `textField` avec `"expression": "vars.pageTotal"` dans la bande `pageFooter` pour un sous-total de page, et un autre avec `"expression": "vars.grandTotal"` dans la bande `summary` pour un total général.

**Liste des propriétés (chaque entrée de `variables`)**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom de la variable, référencé depuis les expressions via `vars.name` |
| `expression` | Expression | ✓ | Évaluée pour chaque ligne ; le résultat est injecté dans l'agrégat |
| `calculation` | `'sum'` = total / `'average'` = moyenne / `'count'` = comptage / `'distinctCount'` = comptage des valeurs distinctes / `'min'` = minimum / `'max'` = maximum / `'first'` = première valeur / `'nothing'` = écrasée à chaque ligne (dernière valeur) | ✓ | Méthode d'agrégation |
| `resetType` | `'report'` = continue d'agréger sur tout le rapport (pas de réinitialisation ; défaut) / `'page'` = réinitialisation par page / `'column'` = réinitialisation par colonne / `'group'` = réinitialisation par groupe nommé dans `resetGroup` / `'none'` = ne se réinitialise jamais, comme `'report'`, mais sous évaluation différée (`evaluationTime`) la valeur reste figée au moment où l'élément a été placé (elle n'est pas remplacée plus tard par l'agrégat final) |  | Portée de réinitialisation de l'agrégation |
| `resetGroup` | string |  | Nom du groupe cible lorsque `resetType: 'group'` |
| `incrementCondition` | Expression |  | Si définie, les lignes dont le résultat d'évaluation est falsy ne sont pas injectées dans l'agrégat (agrégation conditionnelle) |
| `initialValue` | Expression |  | Valeur initiale à l'initialisation et à chaque réinitialisation |

Avec `incrementCondition`, une agrégation conditionnelle telle que "ne sommer qu'une catégorie particulière" tient dans une seule variable :

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Pour agréger dans le parent les résultats d'exécution d'un sous-rapport, utilisez les `returnValues` de l'élément `subreport`, qui réécrivent les variables de l'enfant dans les `vars.*` du parent (voir la liste des propriétés de `subreport`).

### Imprimer les numéros de page et le nombre total de pages

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

La clé est `evaluationTime: 'auto'`. Les expressions sont normalement évaluées au moment où un élément est placé, mais à cet instant le nombre total de pages final n'est pas encore connu. Avec `'auto'`, l'expression est analysée statiquement et **chaque référence est évaluée à son propre moment correct** — `PAGE_NUMBER` lorsque la page est finalisée, `TOTAL_PAGES` lorsque le rapport s'achève. Comme `'auto'` doit analyser l'expression, il n'est disponible que pour les expressions chaînes (le spécifier sur une expression callback lève une exception).

### Aller au-delà des expressions chaînes — les expressions callback

Si votre modèle est défini en TypeScript, vous pouvez écrire une fonction directement partout où une `Expression` est acceptée. Elle prend quatre arguments, `(field, vars, param, report)` ; via `report`, vous accédez aux valeurs intégrées telles que `PAGE_NUMBER`, à la fonction `format` et aux `formatters` enregistrés.

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

Appels de méthodes, expressions régulières, fonctions externes — tout ce que vous pouvez écrire en TypeScript est disponible. Il y a deux contreparties : le modèle ne peut plus être enregistré ni transféré en JSON, et `evaluationTime: 'auto'` est indisponible (les valeurs explicites telles que `'report'` fonctionnent toujours).

### Que se passe-t-il lorsqu'une expression échoue

- **Les erreurs de syntaxe et les constructions interdites** (appels de méthodes, etc.) lèvent une `ExpressionLanguageError` avec les informations de position, qui se propage telle quelle jusqu'à l'appelant de `createReport()`. Elle n'est jamais avalée en une cellule vide
- **Les références à des champs ou variables inexistants** ne sont pas des erreurs ; elles s'évaluent en `undefined`. Dans un `textField`, une chaîne vide est imprimée lorsque `blankWhenNull: true` est défini ; sans cela, la chaîne `null` est imprimée
- Pour valider des expressions fournies par l'utilisateur avant exécution, `validateExpressionSource(source)` renvoie le résultat du contrôle syntaxique (une erreur, ou `null`)

## Exemples fonctionnels pour chaque élément

Voici les 16 éléments fournis par `ElementDef`. Chaque élément prend `x`, `y`, `width` et `height` (en pt, 1pt = 1/72 pouce) et se place dans les `elements` d'une bande ou d'un `frame`.

| Ce que vous voulez faire | Élément |
| --- | --- |
| Imprimer un texte fixe | `staticText` |
| Imprimer des données, des variables ou des résultats d'expressions | `textField` |
| Tracer une ligne | `line` |
| Dessiner un rectangle ou un cadre arrondi | `rectangle` |
| Dessiner un cercle ou une ellipse | `ellipse` |
| Dessiner une forme vectorielle arbitraire | `path` |
| Placer une image | `image` |
| Regrouper plusieurs éléments dans une bordure | `frame` |
| Imprimer un tableau | `table` |
| Imprimer un tableau croisé | `crosstab` |
| Incorporer un rapport dans un autre | `subreport` |
| Imprimer un code-barres ou un QR Code | `barcode` |
| Imprimer une formule mathématique | `math` |
| Imprimer du SVG | `svg` |
| Créer un formulaire PDF à remplir | `formField` |
| Forcer un saut de page ou de colonne n'importe où | `break` |
| Imprimer un élément seulement lorsqu'une condition est remplie | `printWhenExpression` (attribut commun à tous les éléments) |

Ci-dessous, chaque élément reçoit une définition à déposer telle quelle dans le tableau `elements` d'une bande, plus des données d'exemple pour les éléments qui utilisent des expressions. À la fin de la section de chaque élément figure la liste des propriétés spécifiques à cet élément. Pour les propriétés communes à tous les éléments (position, couleurs, conditions d'impression, etc.) et les propriétés de style, voir "Référence des propriétés des éléments" plus loin.

### Imprimer un texte fixe — `staticText`

Imprime une chaîne écrite dans le modèle, exactement telle quelle. À utiliser pour les titres et les libellés.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Type d'élément |
| `text` | string | ✓ | La chaîne fixe à imprimer |
| `actualText` | string |  | Texte de substitution lorsque les caractères visibles diffèrent du texte obtenu par copie et recherche (PDF /ActualText). Utilisé principalement par l'import PDF pour préserver le réglage du PDF source |
| `hyperlink` | HyperlinkDef |  | Hyperlien (voir **`HyperlinkDef`** dans la section des propriétés communes) |
| `anchorName` | string |  | Nom d'ancre. Enregistré comme destination pour les signets et les liens internes au document (`hyperlink` de type `'localAnchor'`) |
| `bookmarkLevel` | number |  | Niveau hiérarchique (1 = niveau supérieur, 1–6) pour lister le texte de cet élément dans la table des matières (signets) affichée dans le panneau latéral du lecteur PDF |

Remarque : en outre, toutes les propriétés communes aux éléments et toutes les propriétés `TextProperties` peuvent être spécifiées.

### Imprimer des données et des résultats d'expressions — `textField`

Imprime le résultat de l'évaluation d'`expression`. Elle peut référencer `field.*` (données), `vars.*` (variables), `param.*` (paramètres), `PAGE_NUMBER` et plus, et les littéraux de gabarit permettent de construire des chaînes. Pour le langage d'expressions complet, voir "Maîtriser les expressions". Utilisez `pattern` pour le formatage des nombres/dates et `stretchWithOverflow` pour laisser la hauteur croître avec la quantité de texte.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Données d'exemple :

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Type d'élément |
| `expression` | Expression | ✓ | Expression renvoyant la valeur à imprimer |
| `pattern` | string |  | Motif de format. Un formateur personnalisé enregistré sur le modèle (un nom de `formatters`) a la priorité ; sinon la valeur est formatée avec le formateur intégré |
| `blankWhenNull` | boolean |  | Imprime une chaîne vide lorsque le résultat de l'expression est null/undefined (sans cela, la chaîne `'null'` est imprimée) |
| `stretchWithOverflow` | boolean |  | Lorsque le contenu ne tient pas dans height, étire la hauteur de l'élément pour l'adapter au contenu |
| `evaluationTime` | `'now'` = évaluer immédiatement sur place (défaut) / `'band'` = évaluer à la finalisation de la bande / `'column'` = évaluer à la fin de la colonne / `'page'` = évaluer à la fin de la page / `'group'` = évaluer à la clôture du groupe nommé dans `evaluationGroup` / `'report'` = évaluer à la fin du rapport (TOTAL_PAGES, etc. sont définitifs) / `'auto'` = évaluer individuellement chaque variable et valeur intégrée référencée par l'expression à son propre moment de réinitialisation (expressions chaînes uniquement ; les expressions callback lèvent une exception) |  | Moment d'évaluation de l'expression. Avec toute valeur non défaut, la zone est d'abord réservée vide au placement puis remplie une fois la valeur finalisée au moment correspondant. Usages typiques : afficher un total de groupe avant le groupe (`'group'`), imprimer le nombre total de pages final (`'report'`) |
| `evaluationGroup` | string |  | Nom du groupe cible lorsque `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = les lignes qui ne tiennent pas ne sont pas dessinées (défaut ; identique à `'truncate'` dans l'implémentation actuelle) / `'truncate'` = coupe ligne par ligne le texte qui ne tient pas / `'ellipsisChar'` = tronque la dernière ligne à une frontière de caractère et ajoute `...` / `'ellipsisWord'` = tronque la dernière ligne à une frontière de mot et ajoute `...` |  | Traitement du texte qui ne tient pas dans la hauteur lorsque `stretchWithOverflow` est inactif. Défaut : `none` |
| `hyperlink` | HyperlinkDef |  | Hyperlien (voir **`HyperlinkDef`** dans la section des propriétés communes) |
| `anchorName` | string |  | Nom d'ancre. Enregistré comme destination pour les signets et les liens internes au document (`hyperlink` de type `'localAnchor'`) |
| `bookmarkLevel` | number |  | Niveau hiérarchique (1 = niveau supérieur, 1–6) pour lister le texte de cet élément dans la table des matières (signets) affichée dans le panneau latéral du lecteur PDF |

Remarque : en outre, toutes les propriétés communes aux éléments et toutes les propriétés `TextProperties` peuvent être spécifiées. `isPrintRepeatedValues: false` est honoré par cet élément (supprime l'impression de valeurs identiques consécutives).

### Tracer une ligne — `line`

Cet exemple est une ligne horizontale de hauteur 0. `lineStyle` accepte `dashed` et d'autres valeurs en plus de `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Type d'élément. Le segment est tracé du coin supérieur gauche `(x, y)` de l'élément à son coin inférieur droit `(x+width, y+height)` (`height: 0` donne une ligne horizontale, `width: 0` une ligne verticale, les deux non nuls une diagonale) |
| `lineWidth` | number |  | Épaisseur de ligne (pt). Défaut : 1 |
| `lineStyle` | `'solid'` = plein / `'dashed'` = tirets / `'dotted'` = pointillés |  | Style de ligne. Défaut : plein |
| `lineColor` | string |  | Couleur de ligne. Défaut : le `forecolor` de l'élément, ou `#000000` si lui aussi est absent |

### Dessiner un rectangle ou un cadre arrondi — `rectangle`

`cornerRadii` permet d'arrondir chaque coin individuellement.

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

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Type d'élément |
| `radius` | number |  | Rayon des coins (pt, partagé par tous les coins) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Rayon par coin (pt) |
| `fill` | FillDef |  | Remplissage (voir **`FillDef`** dans la section des propriétés communes). Défaut : le `backcolor` du style (lorsqu'il n'est pas `transparent`) |
| `stroke` | string |  | Couleur de bordure. Défaut : le `forecolor` du style |
| `strokeWidth` | number |  | Épaisseur de bordure (pt). Défaut : 1 |

### Dessiner un cercle ou une ellipse — `ellipse`

Dessine une ellipse inscrite dans la largeur et la hauteur de l'élément.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Type d'élément. Dessine l'ellipse inscrite dans le rectangle englobant de l'élément (centre `(x+width/2, y+height/2)`, rayons `width/2` × `height/2`) |
| `fill` | FillDef |  | Remplissage (voir **`FillDef`** dans la section des propriétés communes). Aucun remplissage si omis |
| `stroke` | string |  | Couleur de bordure. Aucune bordure si omis |
| `strokeWidth` | number |  | Épaisseur de bordure (pt). Défaut : 1 (lorsque `stroke` est défini) |

### Dessiner une forme vectorielle arbitraire — `path`

Placez une syntaxe de chemin SVG dans `d` et son système de coordonnées dans `viewBox`. La forme est mise à l'échelle pour s'ajuster au cadre de l'élément.

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

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Type d'élément |
| `d` | string | ✓ | Données de chemin SVG (M/L/C/Z, etc.). Les coordonnées sont en pt locaux à l'élément |
| `pdfSourceVector` | PdfSourceVectorDef |  | Produit par l'import PDF pour conserver une forme qui apparaît de façon répétée (symboles cartographiques, etc.) sous la forme "une définition + N placements" (voir **`PdfSourceVectorDef`** plus loin). Lorsqu'il est défini, `d` n'est pas analysé. Inutile dans les modèles écrits à la main |
| `affineTransform` | [number, number, number, number, number, number] |  | Matrice de transformation affine projetant les coordonnées du chemin dans les coordonnées locales de l'élément avant le dessin. `[a, b, c, d, e, f]` donne `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. Les coordonnées du chemin sont mises à l'échelle de cette région vers la largeur et la hauteur de l'élément |
| `fill` | FillDef |  | Remplissage (voir **`FillDef`** dans la section des propriétés communes). Aucun remplissage si omis |
| `fillRule` | `'nonzero'` (défaut) / `'evenodd'` |  | Règle déterminant quelles régions comptent comme "intérieur" pour les chemins auto-intersectants ou imbriqués. Pour percer un trou en anneau, `'evenodd'` est le choix fiable |
| `fillOpacity` | number |  | Opacité du remplissage (0.0–1.0) |
| `stroke` | FillDef |  | Trait (couleurs unies mais aussi dégradés et plus). Aucun trait si omis |
| `strokeWidth` | number |  | Épaisseur du trait (pt). Défaut : 1 (lorsque `stroke` est défini) |
| `strokeOpacity` | number |  | Opacité du trait (0.0–1.0) |
| `strokeLinecap` | `'butt'` = coupé à l'extrémité / `'round'` = extrémité arrondie / `'square'` = extrémité carrée (prolongée d'une demi-épaisseur de trait) |  | Forme des extrémités de ligne |
| `strokeLinejoin` | `'miter'` = onglet (pointu) / `'round'` = arrondi / `'bevel'` = biseauté |  | Forme des jonctions de ligne |
| `strokeMiterLimit` | number |  | Limite d'onglet. Défaut : 10 |
| `strokeDasharray` | number[] |  | Motif de tirets (tableau des longueurs de tirets et d'espaces, en pt) |
| `strokeDashoffset` | number |  | Décalage de départ dans le motif de tirets (pt) |

### Placer une image — `image`

Spécifiez l'image avec `sourceExpression` (une expression) ou `source` (une valeur fixe). `scaleMode` contrôle la façon dont l'image s'ajuste au cadre, et `onError` choisit le comportement lorsque l'image est introuvable (`error` = lever une erreur / `blank` = laisser vide / `icon` = afficher une icône).

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

Données d'exemple :

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Type d'élément |
| `source` | string | | Référence d'image fixe (ID d'image). Écrivez tel quel un chemin relatif au fichier `.report`, un chemin absolu, une URL, un data URI, etc. (pour les règles d'ID, voir "Restrictions de chargement des ressources et règles d'ID d'images" plus loin). Utilisé lorsque `sourceExpression` est absent ou que son résultat ne se résout pas |
| `sourceExpression` | Expression | | Expression de source d'image dynamique. Un résultat chaîne est résolu comme ID d'image ; un résultat `Uint8Array` est traité comme les données de l'image elles-mêmes |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Mise à l'échelle de l'image. `'clip'` = place l'image à sa taille naturelle et la rogne au cadre de l'élément / `'fillFrame'` = l'étire pour remplir le cadre, sans respecter les proportions / `'retainShape'` = conserve les proportions et l'agrandit à la plus grande taille tenant dans le cadre / `'realSize'` = taille naturelle plus rognage au cadre (implémenté à l'identique de `'clip'`). Défaut : `'retainShape'`. Lorsque la taille de l'image ne peut pas être déterminée, se comporte comme `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Placement horizontal de l'image dans le cadre (affecte la répartition des marges avec `retainShape` et la position de rognage avec `clip`/`realSize`). Défaut : `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Placement vertical de l'image dans le cadre. Défaut : `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Comportement lorsque la source d'image est indéfinie ou ne se résout pas. `'error'` = lever une exception / `'blank'` = ne rien dessiner / `'icon'` = dessiner un cadre gris de substitution marqué d'un × . Défaut : `'icon'` |
| `lazy` | boolean | | Présent uniquement dans la définition de types ; non référencé par les implémentations actuelles du moteur de mise en page et des moteurs de rendu (hors spécification) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Angle de rotation de l'image (degrés) |
| `affineTransform` | [number, number, number, number, number, number] | | Autre façon de spécifier directement le placement sous forme de matrice. `[a, b, c, d, e, f]` est une transformation projetant l'image du carré unité (0–1) via `x' = a·x + c·y + e`, `y' = b·x + d·y + f` ; lorsqu'elle est définie, le calcul de placement issu de `scaleMode`/`hAlign`/`vAlign`/`rotation` est ignoré. Utilisé principalement par l'import PDF pour préserver le placement d'origine |
| `opacity` | number | | Opacité (0.0–1.0) |
| `interpolate` | boolean | | Demande au lecteur de lisser les frontières de pixels lorsqu'une image basse résolution est agrandie (PDF /Interpolate). À activer pour les photos ; à désactiver pour les images devant rester nettes, comme les codes-barres |
| `alternates` | PdfImageAlternateDef[] |  | Images alternatives PDF (/Alternates) pour utiliser des images différentes à l'écran et à l'impression. Chaque entrée a deux propriétés : `source` = référence de l'image alternative (requise) et `defaultForPrinting` = si celle-ci est utilisée à l'impression |
| `opi` | PdfOpiMetadataDef |  | Informations OPI pour l'imprimerie commerciale, où une image de substitution basse résolution est remplacée par l'image haute résolution au moment de la sortie. Principalement pour la préservation à l'import PDF (voir **`PdfOpiMetadataDef`** plus loin) |
| `measure` | PdfMeasurement |  | Informations d'échelle et de système de coordonnées utilisées par les outils de mesure des lecteurs dans les PDF de plans et de cartes. Principalement pour la préservation à l'import PDF (voir **`PdfMeasurement`** plus loin) |
| `pointData` | PdfPointData[] |  | Données de points (latitude/longitude, etc.) dans les PDF cartographiques. Principalement pour la préservation à l'import PDF (voir **`PdfPointData`** plus loin) |
| `hyperlink` | HyperlinkDef | | Hyperlien (`type` : `'reference'` = URL / `'localAnchor'` = ancre interne au document / `'localPage'` = page interne au document / `'remoteAnchor'`, `'remotePage'` = ancre/page dans un PDF externe ; `target` : expression de la destination du lien ; `remoteDocument?` : expression du chemin du PDF externe) |

### Regrouper plusieurs éléments dans une bordure — `frame`

Regroupe des éléments enfants ; `border` dessine une bordure et `clip` rogne tout débordement. Les coordonnées des éléments enfants prennent pour origine le coin supérieur gauche du cadre.

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

Données d'exemple :

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Type d'élément |
| `clip` | boolean | | Rogner ou non les enfants à la frontière du cadre. Défaut : true |
| `border` | BorderDef | | Bordure (voir **`BorderDef`** dans la section des propriétés communes) |
| `padding` | Padding | | Marge intérieure (`top?`/`bottom?`/`left?`/`right?`, chacune en pt) |
| `rotation` | number | | Angle de rotation du cadre (degrés, sens antihoraire en coordonnées de page) |
| `rotationOriginX` | number | | Origine X de la rotation (relative au cadre, pt). Défaut : 0 |
| `rotationOriginY` | number | | Origine Y de la rotation (relative au cadre, pt). Défaut : 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Matrice affine projetant les coordonnées locales du cadre (Y vers le haut) dans l'espace de coordonnées parent (disposition et signification de la matrice comme pour l'`affineTransform` d'`image`). Utilisée principalement par l'import PDF pour préserver le placement d'origine |
| `pdfForm` | PdfFormXObjectDef |  | À l'import PDF, conserve et réémet le système de coordonnées et les métadonnées portés par un composant (Form XObject) du PDF source (voir **`PdfFormXObjectDef`** plus loin). Inutile dans les modèles écrits à la main |
| `hyperlink` | HyperlinkDef | | Hyperlien (même structure que la propriété homonyme d'`image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Chemin de rognage en syntaxe de chemin SVG. `d` = données de chemin, `fillRule` = règle de remplissage |
| `transparencyGroup` | boolean | | Conserve la frontière du groupe de transparence PDF même lorsque ni `isolated` ni `knockout` n'est activé. La conserver garantit que le résultat composé de l'opacité et des fusions reste le même que si le cadre était composé comme une image aplatie unique (principalement pour la fidélité à l'import PDF) |
| `isolated` | boolean | | Groupe de transparence isolé (PDF /Group /I). Lorsque ceci (ou `knockout` / `softMask`) est défini, le cadre est composé comme une unité avant l'application de l'opacité, des fusions et des masques |
| `knockout` | boolean | | Groupe de transparence knockout (PDF /Group /K). Les enfants qui se chevauchent au sein du groupe ne transparaissent pas les uns à travers les autres ; à chaque position, seul l'enfant le plus haut est composé avec l'arrière-plan |
| `softMask` | FrameSoftMaskDef | | Masque de fusion rendant le cadre partiellement transparent (voir **`FrameSoftMaskDef`** dans le tableau ci-dessous). Utilise le rendu de ses `elements` comme "carte de transparence", permettant des effets tels qu'un fondu progressif le long d'un dégradé |
| `deviceParams` | DeviceParamsDef | | Paramètres pour l'étape de prépresse de l'imprimerie commerciale (voir **`DeviceParamsDef`** dans le tableau ci-dessous). Inutile pour les rapports ordinaires ; utilisé principalement par l'import PDF pour préserver les réglages du PDF source |
| `elements` | ElementDef[] | | Éléments enfants à l'intérieur du cadre |

**`FrameSoftMaskDef`** (structure de `softMask`)
| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Type de masque. `'luminosity'` = plus une zone du masque est claire, plus le cadre est opaque / `'alpha'` = plus une zone du masque est opaque, plus le cadre est opaque |
| `colorSpace` | PdfProcessColorSpaceDef | | Espace colorimétrique de fusion du groupe de transparence du masque |
| `isolated` | boolean | | Indicateur d'isolation du groupe de transparence du masque |
| `knockout` | boolean | | Indicateur knockout du groupe de transparence du masque |
| `backdrop` | [number, number, number] | | Couleur d'arrière-plan /BC pour les masques de luminosité (DeviceRGB 0–1). Défaut : noir |
| `elements` | ElementDef[] | ✓ | Éléments composés en groupe de transparence pour définir le masque |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | Fonction de transfert /SMask /TR remappant les valeurs du masque (0..1) |

**`DeviceParamsDef`** (structure de `deviceParams`. Pour le prépresse d'imprimerie commerciale ; normalement inutile — principalement pour la préservation à l'import PDF)
| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | Fonction de transfert /TR : `'Identity'` / `'Default'` / une fonction unique partagée par toutes les plaques de couleur / un tableau de fonctions, une par plaque des quatre couleurs |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | Fonction de génération du noir /BG (`'Default'` = valeur par défaut du périphérique via /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | Fonction de retrait des sous-couleurs /UCR (`'Default'` = valeur par défaut du périphérique via /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | Trame /HT (trame de type 1 / tableaux de seuils de types 6, 10, 16 / collection par colorant de type 5) |
| `halftoneOrigin` | [number, number] | | Origine de trame PDF 2.0 (/HTO, pixels de l'espace périphérique) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | Contrôle de la compensation du point noir PDF 2.0 (/UseBlackPtComp) |
| `flatness` | number | | Tolérance de planéité (/FL) |
| `smoothness` | number | | Tolérance de lissage des dégradés (/SM) |
| `strokeAdjustment` | boolean | | Ajustement automatique des traits (/SA) |

### Imprimer un tableau — `table`

Un tableau avec lignes d'en-tête, lignes de détail et lignes de pied. Passez un tableau de données de lignes via `dataSourceExpression`, et les lignes de détail se répètent une fois par élément du tableau.

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

Données d'exemple (chaque élément d'`items` devient une ligne de détail du tableau) :

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

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Type d'élément |
| `columns` | TableColumnElementDef[] | ✓ | Tableau des définitions de colonnes. Si la somme des `width` de toutes les colonnes diffère de la largeur de l'élément, toutes les colonnes sont mises à l'échelle proportionnellement pour s'ajuster exactement à la largeur de l'élément |
| `headerRows` | TableRowElementDef[] |  | Tableau des lignes d'en-tête. Lorsque le tableau se scinde sur plusieurs pages, elles sont redessinées en haut de chaque page |
| `detailRows` | TableRowElementDef[] |  | Tableau des lignes de détail. Dessinées de façon répétée, une fois par ligne de données (lignes de données × toutes les lignes de detailRows) |
| `footerRows` | TableRowElementDef[] |  | Tableau des lignes de pied. Lorsque le tableau se scinde sur plusieurs pages, elles ne sont dessinées que sur la dernière page |
| `dataSourceExpression` | Expression |  | Utilise le tableau résultant de l'évaluation de l'expression comme lignes de données de ce tableau. Si omis, les lignes de la source de données principale sont utilisées. Lève une exception lorsque le résultat n'est pas un tableau |

**`TableColumnElementDef`** (chaque entrée de `columns` = une définition de colonne)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `width` | number | ✓ | Largeur de colonne (pt). Si le total de toutes les colonnes ne correspond pas à la largeur de l'élément, les largeurs sont réparties proportionnellement |
| `style` | TableCellStyleDef |  | Style de cellule par défaut pour cette colonne. Lorsqu'une cellule spécifie une propriété homonyme, le réglage de la cellule l'emporte (les bordures sont fusionnées côté par côté) |

**`TableRowElementDef`** (chaque entrée de `headerRows`/`detailRows`/`footerRows` = une définition de ligne)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `height` | number | ✓ | Hauteur de ligne (pt). Traitée comme un minimum : la ligne s'agrandit automatiquement lorsque le texte replié ou les éléments enfants dans les cellules ne tiennent pas (pour les cellules à rowSpan, le débordement de contenu agrandit la dernière ligne de la plage fusionnée) |
| `cells` | TableCellElementDef[] | ✓ | Tableau des définitions de cellules de cette ligne. Les colonnes occupées par un `rowSpan` d'une ligne supérieure sont automatiquement sautées lors du placement |

**`TableCellElementDef`** (chaque entrée de `cells` = une définition de cellule. En plus de ce qui suit, toute propriété de `TableCellStyleDef` peut être spécifiée directement)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `text` | string |  | Texte fixe de la cellule |
| `expression` | Expression |  | Expression de liaison de données. La forme nue `field.name` lit la valeur directement dans la ligne de données ; tout le reste passe par l'évaluation d'expressions du moteur. Prioritaire sur `text` lorsqu'elle est spécifiée |
| `colSpan` | number |  | Nombre de colonnes à fusionner horizontalement. Défaut : 1 |
| `rowSpan` | number |  | Nombre de lignes à fusionner verticalement. Défaut : 1. La hauteur de la cellule est la somme des hauteurs de lignes de la plage fusionnée |
| `elements` | ElementDef[] |  | Tableau d'éléments enfants placés dans la cellule. Lorsqu'il est spécifié, il a la priorité sur le rendu `text`/`expression` et est dessiné rogné à la zone moins le padding. La hauteur de ligne s'agrandit automatiquement à la hauteur nécessaire aux enfants |

**`TableCellStyleDef`** (style de cellule utilisé dans les définitions de cellules et le `style` d'une colonne)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = aligné à gauche / `'center'` = centré / `'right'` = aligné à droite |  | Alignement horizontal du texte |
| `vAlign` | `'top'` = aligné en haut / `'middle'` = centré / `'bottom'` = aligné en bas |  | Alignement vertical du texte |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotation du texte (degrés). Défaut : 0 |
| `backcolor` | string |  | Couleur d'arrière-plan de la cellule |
| `forecolor` | string |  | Couleur du texte. Défaut : `#000000` |
| `fontId` | string |  | ID de police. Défaut : `'default'` |
| `fontSize` | number |  | Taille de police (pt). Défaut : 10 |
| `bold` | boolean |  | Gras |
| `italic` | boolean |  | Italique |
| `underline` | boolean |  | Souligné |
| `strikethrough` | boolean |  | Barré |
| `lineSpacing` | LineSpacingDef |  | Réglages d'interlignage (voir **`LineSpacingDef`** dans la section des propriétés communes) |
| `letterSpacing` | number |  | Espacement des caractères (pt). Ajoute une valeur fixe entre tous les caractères (les valeurs négatives resserrent) |
| `wordSpacing` | number |  | Espacement des mots (pt ; largeur supplémentaire ajoutée aux caractères d'espace) |
| `firstLineIndent` | number |  | Retrait de première ligne (pt) |
| `leftIndent` | number |  | Retrait gauche (pt) |
| `rightIndent` | number |  | Retrait droit (pt) |
| `wrap` | boolean |  | Retour à la ligne du texte. Défaut : true |
| `shrinkToFit` | boolean |  | Réduit automatiquement la taille de police pour que le texte tienne dans la cellule |
| `minFontSize` | number |  | Taille de police minimale (pt) sous `shrinkToFit`. Défaut : 4 |
| `fitWidth` | boolean |  | Ajuste automatiquement la taille de police (dans les deux sens, réduction et agrandissement) pour que la ligne la plus longue s'ajuste exactement à la largeur de la cellule. Une telle cellule ne contribue pas à l'agrandissement automatique de la hauteur de ligne |
| `outlineText` | boolean |  | Dessine le texte vectorisé en contours (tracés) |
| `padding` | number |  | Marge intérieure de la cellule (pt). Défaut : 2 |
| `border` | BorderDef |  | Bordure par cellule (voir **`BorderDef`** dans la section des propriétés communes). Fusionnée avec la bordure du `style` de colonne ; le réglage de la cellule l'emporte |
| `opacity` | number |  | Opacité (0.0–1.0). En dessous de 1, la cellule entière est dessinée comme un groupe d'opacité |

### Imprimer un tableau croisé — `crosstab`

Agrège les données par groupes de lignes × groupes de colonnes. Cet exemple somme `amount` par région × catégorie et produit aussi des sous-totaux et un total général.

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

Données d'exemple :

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

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Type d'élément |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Tableau des définitions de groupes de lignes. Plusieurs entrées forment des niveaux de groupes imbriqués, chaque niveau occupant une colonne d'en-tête de ligne depuis la gauche. Les cellules d'en-tête des groupes externes sont fusionnées verticalement sur leur étendue |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Tableau des définitions de groupes de colonnes. Les groupes externes s'empilent au-dessus et les groupes internes en dessous ; les en-têtes externes sont fusionnés horizontalement sur la largeur de leurs colonnes |
| `measures` | { field, calculation, format? }[] | ✓ | Tableau des définitions de mesures (cellules d'agrégats). Avec plusieurs entrées, elles s'empilent verticalement dans chaque cellule de données, chacune occupant un emplacement (au moins `cellHeight`) et appliquant ses propres `calculation`/`format`. Un tableau vide est traité comme une mesure unique implicite avec `field: ''` et `calculation: 'sum'` |
| `rowHeaderWidth` | number |  | Largeur des en-têtes de lignes (pt), appliquée à chaque niveau des groupes de lignes. Défaut : 80 |
| `columnHeaderHeight` | number |  | Hauteur des en-têtes de colonnes (pt), appliquée à chaque niveau des groupes de colonnes. Défaut : 20 |
| `cellWidth` | number |  | Largeur des cellules de données (pt). Défaut : 60 |
| `cellHeight` | number |  | Hauteur des cellules de données (pt ; la hauteur d'emplacement pour une mesure). S'agrandit automatiquement avec le repli du texte. Défaut : 20 |
| `border` | { color?, width? } |  | Réglages de bordure (voir le tableau ci-dessous). Ce n'est que lorsqu'ils sont spécifiés que le cadre extérieur, les séparateurs de lignes/colonnes et les séparateurs de niveaux d'en-têtes sont dessinés (ils ne traversent jamais une cellule d'en-tête externe fusionnée) |
| `showSubtotals` | boolean |  | Afficher les sous-totaux. Défaut : false. À true, une ligne/colonne de sous-total libellée "Total" est insérée à la fin du bloc de chaque groupe, sauf pour le niveau le plus interne. Les valeurs de sous-totaux sont réagrégées à partir des valeurs brutes avec le `calculation` de chaque mesure |
| `showGrandTotal` | boolean |  | Afficher le total général. Défaut : false. À true, une ligne/colonne de total général libellée "Total" est ajoutée à la fin (non émise lorsqu'il y a zéro ligne de données). Les valeurs du total général sont elles aussi réagrégées à partir des valeurs brutes |
| `dataSourceExpression` | Expression |  | Utilise le tableau résultant de l'évaluation de l'expression comme lignes de données de ce tableau croisé. Si omis (ou lorsque le résultat n'est pas un tableau), les lignes de la source de données principale sont utilisées |

**Définition de groupe de lignes/colonnes (chaque entrée de `rowGroups`/`columnGroups`)**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nom du champ de regroupement. Les groupes apparaissent dans l'ordre de première occurrence dans les données |
| `headerFormat` | string |  | Format d'affichage des valeurs d'en-tête. Un format simple appliqué seulement lorsque la valeur est numérique (`'#,##0'` ou tout motif contenant `,` → séparateurs de milliers ; une spécification décimale telle que `'.00'` → décimales fixes à cette précision ; tout le reste → conversion simple en chaîne) |

**Définition de mesure (chaque entrée de `measures`)**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nom du champ à agréger. Les valeurs non numériques sont converties en nombres ; celles qui ne peuvent pas l'être comptent pour 0 |
| `calculation` | `'sum'` = total / `'count'` = comptage / `'average'` = moyenne / `'min'` = minimum / `'max'` = maximum | ✓ | Méthode d'agrégation. Les sous-totaux et totaux généraux sont eux aussi réagrégés à partir de l'ensemble des valeurs brutes avec la même méthode, si bien que même `average` et consorts sortent corrects |
| `format` | string |  | Format d'affichage des valeurs agrégées (le même format simple que `headerFormat` : `'#,##0'` ou `,` → séparateurs de milliers, `'.NN'` → NN décimales fixes, sinon → conversion simple en chaîne) |

**Réglages de bordure (`border`)**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `color` | string |  | Couleur de ligne. Défaut : `#000000` |
| `width` | number |  | Épaisseur de ligne (pt) du cadre extérieur et des frontières en-tête/données. Défaut : 0.5. Les séparateurs intérieurs de lignes/colonnes sont dessinés à la moitié de cette épaisseur |

### Incorporer un rapport dans un autre — `subreport`

L'idée a été expliquée dans **Notions de base de la mise en page des rapports**. Voici une définition complète qui fonctionne telle quelle. Le sous-rapport s'exécute une fois par ligne de détail du parent, et le tableau passé via `dataSourceExpression` devient les `rows` du sous-rapport.

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

Données d'exemple :

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

Le `subreport.report` incorporé est un modèle indépendant à part entière. Il référence chaque élément des `items` reçus comme des valeurs `field.*` ordinaires et reçoit les paramètres transmis par le parent via `param.*`. Notez que les modèles exécutés comme sous-rapports n'émettent pas leurs bandes `pageHeader`, `pageFooter` ni `background` (la gestion des pages est le travail du rapport parent). Les titres vont dans la bande `title`, comme ceci :

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

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Type d'élément |
| `templateExpression` | Expression | ✓ | Expression renvoyant le nom du modèle enfant. Avec `createReportFromFile()`, il est résolu automatiquement comme chemin de fichier ; en appelant `createReport()` directement, résolvez-le avec l'option `resolveSubreportTemplate` (une fonction recevant le nom et le répertoire de travail et renvoyant `{ template, workingDirectory? }`, ou `null` si elle ne peut pas résoudre) |
| `dataSourceExpression` | Expression | | Expression renvoyant la source de données du rapport enfant (un tableau d'objets lignes). Si omise, les lignes de la source de données du parent sont utilisées telles quelles. Un résultat non tableau est traité comme des données vides |
| `parameters` | SubreportParamDef[] |  | Paramètres passés au rapport enfant (voir **`SubreportParamDef`** dans le tableau ci-dessous). Ils l'emportent sur les entrées homonymes issues de `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Expression renvoyant un objet fusionné dans les paramètres de l'enfant (les `parameters` individuels l'emportent) |
| `returnValues` | ReturnValueDef[] |  | Définitions renvoyant au parent les valeurs de variables du rapport enfant (voir **`ReturnValueDef`** dans le tableau ci-dessous) |
| `usingCache` | boolean | | Au sein d'une même exécution du rapport parent, met en cache et réutilise les modèles enfants résolus par nom de modèle |
| `runToBottom` | boolean | | Après le contenu du sous-rapport, consomme l'espace restant de la page/colonne (repoussant les éléments suivants sous l'espace restant) |

**`SubreportParamDef`** (chaque entrée de `parameters` = un paramètre passé au rapport enfant)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom du paramètre passé au rapport enfant (référencé côté enfant via `param.name`) |
| `expression` | Expression | ✓ | Expression calculant la valeur du paramètre. Évaluée dans le contexte du rapport parent |

**`ReturnValueDef`** (chaque entrée de `returnValues` = une définition renvoyant une valeur de l'enfant au parent)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom de la variable recevant la valeur côté parent. Cette variable est exclue de l'écrasement par le calcul normal des variables du parent |
| `subreportVariable` | string | ✓ | Nom de la variable source côté enfant. À la fin de l'exécution du rapport enfant, sa valeur est propagée au parent |
| `calculation` | `'nothing'` = affecte la valeur de l'enfant telle quelle (écrasée à chaque exécution) / `'count'` = comptage / `'sum'` = total / `'average'` = moyenne / `'min'` = minimum / `'max'` = maximum / `'first'` = conserve la première valeur obtenue | ✓ | Façon dont la valeur est intégrée à la variable du parent. Tout sauf `'nothing'` agrège sur les exécutions lorsque le sous-rapport s'exécute plusieurs fois |

### Imprimer des codes-barres et des QR Codes — `barcode`

`barcodeType` accepte Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417 et plus. `showText` ajoute le texte lisible par l'humain comme référence de lecture.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Données d'exemple :

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Type d'élément |
| `barcodeType` | string | ✓ | Symbologie du code-barres (insensible à la casse). Valeurs admises : `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Toute autre valeur est non prise en charge et dessine un cadre de substitution |
| `expression` | Expression | ✓ | Expression renvoyant les données du code-barres (le résultat d'évaluation est converti en chaîne puis encodé) |
| `showText` | boolean | | Affiche le texte lisible par l'humain sous les codes-barres unidimensionnels (zone de texte de 10pt de haut, taille de police 8pt ; la hauteur des barres se réduit d'autant). Non utilisé pour les codes bidimensionnels (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Niveau de correction d'erreurs du QR Code — la capacité à rester lisible même lorsqu'une partie du code est tachée ou manquante. La résilience croît de `'L'` à `'H'`, au prix d'un motif plus fin. `'Q'` ou `'H'` est recommandé pour les supports d'impression grossiers. Défaut : `'M'`. Effectif pour les QR Codes uniquement (le niveau de correction de PDF417 est choisi automatiquement selon la longueur des données) |

### Imprimer des formules mathématiques — `math`

Compose des formules de style LaTeX. La composition mathématique exige une police dédiée portant des métriques spécifiques aux mathématiques (la table OpenType MATH) ; des exemples librement disponibles incluent STIX Two Math et Latin Modern Math. Une police de texte ordinaire ne peut pas s'y substituer. `formula` est évaluée comme une expression (cet exemple référence le champ `formula` des données).

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

Données d'exemple :

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Lorsque vous utilisez l'élément `math`, enregistrez une police disposant d'une table OpenType MATH à la fois dans `fontMap` et dans les `fonts` de la sortie PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Type d'élément |
| `formula` | Expression | ✓ | Expression renvoyant une chaîne de formule LaTeX (entourez une formule fixe de `'...'` en littéral de chaîne dans l'expression). Rien n'est dessiné lorsque le résultat est une chaîne vide |
| `mathFontFamily` | string | | Police utilisée pour le rendu mathématique (un ID de police enregistré dans fontMap). Défaut : le fontFamily du style de l'élément, ou `'default'` si lui aussi est absent |
| `fontSize` | number | | Taille de police (pt). Défaut : le fontSize du style de l'élément, ou 12 si lui aussi est absent |
| `color` | string | | Couleur du texte. Défaut : résolue dans l'ordre — forecolor de l'élément → forecolor du style → `#000000` |

### Imprimer du SVG — `svg`

Rend un document SVG directement dans le rapport. `svgContent` est évaluée comme une expression (une chaîne SVG fixe peut être fournie via les données ou les paramètres).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Données d'exemple :

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Type d'élément |
| `svgContent` | Expression | ✓ | Expression renvoyant une chaîne de balisage SVG. Le résultat est converti en chaîne et rendu comme SVG à la position et à la taille de l'élément |

### Créer des formulaires PDF à remplir — `formField`

Place des champs de formulaire que quiconque ouvre le PDF peut remplir. `fieldType` accepte `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox` et `signature`.

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

Données d'exemple (deviennent la valeur initiale du formulaire) :

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Type d'élément. Un champ de formulaire interactif. Les moteurs d'aperçu dessinent son apparence initiale, et la sortie PDF l'émet comme un champ véritablement remplissable |
| `fieldType` | `'text'` = champ de saisie de texte (PDF /Tx) / `'checkbox'` = case à cocher (/Btn) / `'radio'` = bouton radio (/Btn ; les widgets partageant le même `fieldName` forment un groupe mutuellement exclusif) / `'pushbutton'` = bouton poussoir (/Btn ; libellé plus action URI optionnelle) / `'dropdown'` = liste déroulante (combo box, /Ch) / `'listbox'` = zone de liste (/Ch) / `'signature'` = champ de signature (/Sig) | ✓ | Type de champ |
| `fieldName` | string | ✓ | Nom de champ pleinement qualifié. Doit être unique dans le document (les doublons lèvent une exception). L'exception est `radio`, où partager le même nom forme un groupe mutuellement exclusif |
| `value` | Expression |  | Valeur initiale (text : la valeur saisie ; dropdown/listbox : la valeur sélectionnée ; pour une listbox `multiSelect`, spécifiez plusieurs valeurs séparées par des sauts de ligne). Évaluée comme une expression. La combiner avec `valueStream` lève une exception |
| `checked` | Expression |  | État coché initial (checkbox/radio). Évalué comme une expression. Pour les radios, l'`exportValue` du bouton coché devient la valeur sélectionnée du groupe |
| `exportValue` | string |  | Chaîne enregistrée comme valeur signifiant que cette case/ce radio est "activé" lorsque la saisie du formulaire est soumise ou extraite (checkbox/radio). Défaut : `'Yes'`. Dans un groupe radio, cette valeur distingue les options individuelles |
| `options` | FormFieldOption[] |  | Tableau d'options (dropdown/listbox). Voir le tableau ci-dessous |
| `editable` | boolean |  | Autorise la saisie libre en plus des options (permet à une liste déroulante d'accepter une saisie de type combo) |
| `multiSelect` | boolean |  | Autorise la sélection multiple (listbox) |
| `caption` | string |  | Libellé du bouton (pushbutton) |
| `action` | string |  | URI ouverte lorsque le bouton poussoir est pressé |
| `multiline` | boolean |  | Saisie multiligne (text) |
| `readOnly` | boolean |  | Rend le champ en lecture seule |
| `required` | boolean |  | Rend le champ obligatoire |
| `noExport` | boolean |  | N'exporte pas la valeur de ce champ à la soumission du formulaire |
| `password` | boolean |  | Saisie de mot de passe (text ; les caractères tapés sont masqués) |
| `fileSelect` | boolean |  | En fait un champ de sélection de fichier (text). La combinaison avec `multiline`/`password` lève une exception |
| `doNotSpellCheck` | boolean |  | Désactive la vérification orthographique (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | Interdit le défilement pour une saisie dépassant la zone visible (text) |
| `comb` | boolean |  | Affiche des cases de caractères régulièrement espacées (peigne) (text). `maxLength` doit être spécifié ; la combinaison avec `multiline`/`password`/`fileSelect` lève une exception |
| `richText` | string |  | Valeur en texte enrichi (PDF /RV) affichée avec mise en forme (gras, couleurs, etc.) dans les lecteurs compatibles. La définir active l'indicateur de texte enrichi du champ. La combiner avec `richTextStream` lève une exception |
| `richTextStream` | Uint8Array |  | Forme flux de `richText`. Pour la préservation au niveau octet lorsque le /RV du PDF source était un flux lors de l'import PDF ; les modèles écrits à la main utilisent normalement `richText`. La combinaison avec `richText` lève une exception |
| `defaultStyle` | string |  | Style par défaut du texte enrichi (PDF /DS). Une chaîne au format proche de CSS (par ex. `font: Helvetica 12pt`) fournissant des valeurs par défaut pour ce que `richText` ne spécifie pas |
| `valueStream` | Uint8Array |  | Pour la préservation à l'import PDF. Lorsque la valeur du champ (/V) du PDF source était un objet flux plutôt qu'une chaîne, réémet ces octets sans perte. Les modèles écrits à la main utilisent normalement `value`. La combinaison avec `value` lève une exception |
| `defaultValue` | string |  | Valeur par défaut à laquelle le champ revient lors d'une réinitialisation du formulaire (/DV) |
| `sort` | boolean |  | Affiche les options triées (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Valide la valeur immédiatement au changement de sélection (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Bascule à l'unisson les boutons radio d'un groupe partageant le même `exportValue` |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Attache au champ des scripts de saisie exécutés dans les lecteurs PDF. K = à chaque frappe (par ex. retirer les non-chiffres), F = formatage d'affichage (par ex. afficher deux décimales), V = validation de valeur (par ex. rejeter les nombres négatifs), C = recalcul (par ex. calculer automatiquement à partir des valeurs d'autres champs). Le contenu est normalement un `PdfActionDef` (décrit plus loin) avec `subtype: 'JavaScript'`. Le moteur central ne fait qu'incorporer les scripts dans le PDF et ne les exécute jamais. Pour un groupe radio, tous les widgets doivent porter des définitions identiques, sinon une exception est levée |
| `calculationOrder` | number |  | Lorsque plusieurs champs ont une action `'C'` (recalcul), ordre dans lequel le lecteur les recalcule (PDF /CO). Ordre croissant d'entiers ≥ 0. Les doublons, valeurs négatives et non-entiers lèvent une exception |
| `maxLength` | number |  | Longueur maximale de saisie (text) |
| `borderColor` | string |  | Couleur de bordure (`#RRGGBB`). Aucune bordure si omis. Dessinée comme un contour de 1pt — circulaire pour les radios, rectangulaire sinon |
| `backgroundColor` | string |  | Couleur d'arrière-plan (`#RRGGBB`). Transparent si omis. Remplie en cercle pour les radios, en rectangle sinon |

**`FormFieldOption`** (chaque entrée d'`options` = une définition d'option)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `value` | string | ✓ | Valeur d'export stockée dans la valeur du champ (/V) |
| `label` | string |  | Libellé d'affichage. Défaut : identique à `value` |

Remarque : en outre, toutes les propriétés communes aux éléments et toutes les propriétés `TextProperties` peuvent être spécifiées (appliquées à la police, à l'alignement, etc. du texte saisi).

### Forcer un saut de page ou de colonne n'importe où — `break`

Force le passage à la page suivante (`"breakType": "page"`) ou à la colonne suivante (`"column"`) au milieu du flux de détail. Placez-le directement dans une bande ; il ne peut pas aller dans un `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Liste des propriétés**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Type d'élément |
| `breakType` | `'page'` \| `'column'` | ✓ | Type de saut. Scinde la bande à la position y de l'élément ; `'page'` = continue sur la page suivante / `'column'` = continue dans la colonne suivante lorsque la mise en page est multicolonne (`columns.count` du modèle à 2 ou plus ; voir **Notions de base de la mise en page des rapports**) et que ce n'est pas la dernière colonne (sinon il agit comme un saut de page) |

### Imprimer un élément seulement lorsqu'une condition est remplie — `printWhenExpression`

`printWhenExpression` n'est pas un type d'élément distinct mais **un attribut commun à tous les éléments**. L'élément n'est imprimé que sur les lignes où l'expression s'évalue en valeur vraie. L'exemple suivant n'imprime "※ 至急" (urgent) que sur les lignes de détail où `urgent` vaut `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Données d'exemple (imprimé uniquement pour la première ligne) :

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

Les bandes acceptent elles aussi un `printWhenExpression` du même nom, supprimant la sortie de toute la bande (par ex. n'émettre une bande de remarques que lorsque `param.showNotes` est défini). Lorsque le modèle est défini en TypeScript, le callback `onBeforeRender` de l'élément offre un contrôle encore plus fin — renvoyez `null` pour sauter l'impression de l'élément, ou renvoyez un `ElementDef` pour imprimer avec des attributs tels que texte, dimensions et couleurs remplacés sur-le-champ.
## Référence des propriétés des éléments

La "Liste des propriétés" jointe à l'exemple de chaque élément ne couvre que les propriétés spécifiques à cet élément. En outre, chaque élément accepte des propriétés communes pour la position, la taille, les conditions d'impression, les couleurs et plus. Cette section récapitule les propriétés communes à tous les éléments et les propriétés des styles définis dans les `styles` du modèle.

### Propriétés communes à tous les éléments

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `id` | string |  | Identifiant permettant de rechercher et de modifier un élément avant le rendu avec `findElementById()`. N'affecte pas le contenu imprimé lui-même. Gardez uniques dans le modèle les ID utilisés comme cibles de modification (en cas de doublon, le premier élément dans l'ordre de parcours est renvoyé) |
| `x` | number | ✓ | Coordonnée X au sein de la bande/du conteneur parent (pt) |
| `y` | number | ✓ | Coordonnée Y au sein de la bande/du conteneur parent (pt) |
| `width` | number | ✓ | Largeur (pt) |
| `height` | number | ✓ | Hauteur (pt) |
| `style` | string |  | Nom du style à appliquer (référence le `name` d'un `StyleDef` défini dans `styles` ; à défaut, le style `isDefault` est appliqué) |
| `positionType` | `'float'` = descend de la quantité dont les éléments au-dessus se sont étirés / `'fixRelativeToTop'` = fixe la position depuis le bord supérieur de la bande (défaut) / `'fixRelativeToBottom'` = conserve la distance au bord inférieur de la bande (descend de la quantité d'étirement de la bande) |  | Règle de positionnement lorsque la bande s'étire. Défaut : `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = ne s'étire pas (défaut) / `'containerHeight'` = fait correspondre la hauteur de l'élément à la hauteur effective de la bande / `'containerBottom'` = étire le bord inférieur de l'élément jusqu'au bas effectif de la bande (ne change que la hauteur) |  | Règle d'étirement de l'élément lorsque la bande s'étire. Défaut : `noStretch` |
| `printWhenExpression` | Expression \| null |  | Lorsque le résultat d'évaluation est falsy, cet élément n'est pas imprimé |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback invoqué juste avant le rendu : `(elem, field, vars, param, report) => ElementDef \| null`. Renvoyer `null` saute l'impression (un sur-ensemble de `printWhenExpression`) ; renvoyer un `ElementDef` rend avec cette définition (remplaçant dynamiquement n'importe quel attribut). Ordre d'évaluation : `onBeforeRender` → `printWhenExpression` (évalué contre la définition remplacée) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Lorsque l'élément n'est pas imprimé, si aucun autre élément imprimé ne chevauche la bande verticale qu'occupe l'élément, supprime cette bande et remonte les éléments situés en dessous, rétrécissant la bande |
| `isPrintRepeatedValues` | boolean |  | À `false`, l'impression est supprimée lorsque la valeur (textField) est identique à la précédente (pendant la suppression, l'élément est traité comme de hauteur 0 si `isRemoveLineWhenBlank` est vrai) |
| `isPrintWhenDetailOverflows` | boolean |  | Réimprime cet élément sur chaque segment de page/colonne sur lequel la bande déborde |
| `mode` | `'opaque'` = remplit l'arrière-plan avec `backcolor` / `'transparent'` = ne remplit pas l'arrière-plan |  | Mode d'affichage. Défaut : `transparent` (résolu élément d'abord, puis style) |
| `forecolor` | string |  | Couleur de premier plan (`#RRGGBB` ou `#RRGGBBAA`) |
| `backcolor` | string |  | Couleur d'arrière-plan (dessinée lorsque `mode` est `opaque`) |
| `border` | BorderDef |  | Bordure (voir **`BorderDef`** ci-dessous). Pour les éléments line/rectangle/ellipse/path, la bordure n'est pas dessinée (qu'elle provienne d'un style ou soit spécifiée directement sur l'élément ; ces éléments spécifient leurs lignes via leurs propres propriétés `stroke` et similaires) |
| `padding` | Padding |  | Marge intérieure (voir **`Padding`** ci-dessous) |
| `blendMode` | BlendModeDef |  | Façon dont les couleurs de cet élément sont composées avec le contenu déjà dessiné en dessous (voir **`BlendModeDef`** ci-dessous). Exemple typique : spécifier `'multiply'` sur une image de sceau ou de tampon la superpose en translucidité sans masquer le texte en dessous |
| `overprintFill` | boolean |  | Pour le prépresse d'imprimerie commerciale. Spécifie la surimpression des remplissages (les faces du texte et des formes) : ils sont imprimés par-dessus les plaques de couleur sous-jacentes sans les évider |
| `overprintStroke` | boolean |  | Pour le prépresse d'imprimerie commerciale. Réglage de surimpression des lignes (traits) |
| `overprintMode` | 0 \| 1 |  | Sélectionne le comportement lorsque `overprintFill`/`overprintStroke` sont activés (PDF /OPM). `0` = chaque composante de couleur écrase la couleur sous-jacente (défaut) / `1` = les composantes de couleur à 0 laissent la couleur sous-jacente intacte |
| `renderingIntent` | `'AbsoluteColorimetric'` = fidèle colorimétriquement / `'RelativeColorimetric'` = fidèle après alignement des points blancs / `'Saturation'` = privilégie l'éclat / `'Perceptual'` = privilégie une apparence naturelle |  | Politique de priorité pour convertir les couleurs qui ne tiennent pas dans le gamut du périphérique de sortie (intention de rendu PDF). Destinée à l'imprimerie commerciale et à la gestion des couleurs ; normalement inutile à spécifier |
| `alphaIsShape` | boolean |  | Contrôle fin de la composition de transparence PDF (interprète l'opacité et les masques comme une "forme" ; /AIS). Normalement inutile à spécifier ; sert principalement à la réémission fidèle de PDF importés |
| `textKnockout` | boolean |  | Lorsque des caractères translucides se chevauchent, évite la double composition des chevauchements au sein du même texte (PDF /TK). Défaut : `true`. Normalement inutile à spécifier |
| `optionalContent` | OptionalContentDef |  | Place cet élément sur un "calque" PDF. La visibilité et l'impression peuvent être basculées depuis le panneau des calques du lecteur (par ex. afficher un filigrane à l'écran mais le supprimer à l'impression). Voir **`OptionalContentDef`** ci-dessous |
| `opacity` | number |  | Opacité de l'élément (0.0–1.0). Pour les éléments à enfants, appliquée après leur composition en groupe |

**`BlendModeDef`** (modes de fusion spécifiables pour `blendMode`)

Les éléments peignent normalement par-dessus ce qui a été dessiné en dessous (`'normal'`). Spécifier un mode de fusion combine par calcul les couleurs supérieure et inférieure. Dans les documents commerciaux, les usages typiques sont la superposition d'un sceau personnel ou d'entreprise sur du texte (`'multiply'`) et la production d'un effet de type réserve blanche sur fond sombre (`'screen'`).

| Constante | Effet |
| --- | --- |
| `'normal'` | Peint avec la couleur supérieure sans fusion (équivalent au défaut) |
| `'multiply'` | Produit. Les chevauchements deviennent toujours plus sombres. Pour les sceaux, tampons et surlignages |
| `'screen'` | Produit inverse. Les chevauchements deviennent toujours plus clairs |
| `'overlay'` | Multiplie où la base est sombre, éclaircit où elle est claire. Accentue le contraste |
| `'darken'` | Prend la plus sombre des deux couleurs |
| `'lighten'` | Prend la plus claire des deux couleurs |
| `'color-dodge'` | Éclaircit (surexpose) la base selon la couleur supérieure |
| `'color-burn'` | Assombrit (brûle) la base selon la couleur supérieure |
| `'hard-light'` | Bascule entre produit et produit inverse selon la clarté de la couleur supérieure (effet d'éclairage fort) |
| `'soft-light'` | Version atténuée de `'hard-light'` (effet d'éclairage doux) |
| `'difference'` | Valeur absolue de la différence entre les deux couleurs |
| `'exclusion'` | Version à contraste réduit de `'difference'` |
| `'hue'` | Teinte supérieure + saturation et luminosité inférieures |
| `'saturation'` | Saturation supérieure + teinte et luminosité inférieures |
| `'color'` | Teinte et saturation supérieures + luminosité inférieure (pour teinter une base monochrome) |
| `'luminosity'` | Luminosité supérieure + teinte et saturation inférieures |

**`Expression`** (voir "Maîtriser les expressions" pour les détails)
| Forme | Description |
| --- | --- |
| string | Mini-langage d'expressions. Exemples : `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Une fonction TypeScript `(field, vars, param, report) => unknown`. `report` (ReportContext) fournit `PAGE_NUMBER` (numéro de page courant, à partir de 1), `COLUMN_NUMBER` (numéro de colonne courant, à partir de 1), `REPORT_COUNT` (nombre d'enregistrements traités), `TOTAL_PAGES` (nombre total de pages ; finalisé avec evaluationTime=report), `RETURN_VALUE` (présent dans la définition de types mais toujours undefined dans l'implémentation actuelle — les valeurs de retour des sous-rapports sont reçues via `vars.*`), `format` (fonctions de formatage intégrées) et `formatters` (formateurs personnalisés enregistrés sur le modèle) |

**`BorderDef`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `width` | number |  | Épaisseur de ligne (pt). Défaut partagé par tous les côtés |
| `color` | string |  | Couleur de ligne. Défaut partagé par tous les côtés |
| `style` | `'solid'` = ligne pleine / `'dashed'` = ligne en tirets / `'dotted'` = ligne pointillée |  | Style de ligne. Défaut partagé par tous les côtés |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Réglages par côté (voir **`BorderSideDef`** ci-dessous). Ils l'emportent sur les réglages tous-côtés ; `null` masque ce côté |

**`BorderSideDef`** (utilisé dans les `top`/`bottom`/`left`/`right` de `BorderDef`)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `width` | number | ✓ | Épaisseur de ligne (pt) |
| `color` | string | ✓ | Couleur de ligne |
| `style` | `'solid'` = ligne pleine / `'dashed'` = ligne en tirets / `'dotted'` = ligne pointillée | ✓ | Style de ligne |

**`Padding`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Marge intérieure de chaque côté (pt) |

**`HyperlinkDef`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'reference'` = URL externe / `'localAnchor'` = vers une ancre du même document / `'localPage'` = vers un numéro de page du même document / `'remoteAnchor'` = vers une ancre d'un autre document PDF / `'remotePage'` = vers une page d'un autre document PDF | ✓ | Type de lien |
| `target` | Expression | ✓ | Destination du lien (une URL, un nom d'ancre ou une expression de numéro de page) |
| `remoteDocument` | Expression |  | Chemin du fichier PDF distant (pour remotePage / remoteAnchor) |

**`TextProperties`** (propriétés de texte et de paragraphe de staticText / textField / formField)
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `markup` | `'none'` = texte brut / `'styled'` = balisage stylé (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>`, etc.) / `'html'` = sous-ensemble HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Type de balisage |
| `hAlign` | `'left'` = aligné à gauche / `'center'` = centré / `'right'` = aligné à droite / `'justify'` = justifié |  | Alignement horizontal |
| `vAlign` | `'top'` = aligné en haut / `'middle'` = aligné au milieu / `'bottom'` = aligné en bas |  | Alignement vertical |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotation du texte (degrés) |
| `lineSpacing` | LineSpacingDef |  | Réglages d'interlignage (voir **`LineSpacingDef`** ci-dessous) |
| `letterSpacing` | number |  | Espacement des caractères (pt). Ajoute une valeur fixe entre tous les caractères (les valeurs négatives resserrent) |
| `tracking` | number |  | Autre forme d'ajustement de l'espacement des caractères. Là où `letterSpacing` ajoute une valeur fixe uniforme, celui-ci utilise la table d'ajustement d'espacement intégrée à la police elle-même (la table AAT `trak`) pour resserrer ou élargir l'espacement selon des valeurs de conception dépendant de la taille de police. Le nombre est la "valeur de track" de la table : 0 = normal, négatif = plus serré, positif = plus large (les valeurs intermédiaires sont interpolées). Sans effet sur les polices dépourvues de table `trak` |
| `wordSpacing` | number |  | Espacement des mots (pt ; largeur supplémentaire ajoutée aux caractères d'espace) |
| `horizontalScale` | number |  | Facteur d'échelle étirant horizontalement les formes des glyphes (inférieur à 1 = condensé, réduisant la largeur ; supérieur à 1 = étendu, l'élargissant). Le repli et l'avance de ligne sont calculés à partir des largeurs mises à l'échelle. Défaut : 1 |
| `baselineOffset` | number |  | Fixe explicitement la position de la ligne de base (la ligne de référence sur laquelle reposent les caractères) en pt depuis le bord supérieur de l'élément. Normalement calculée automatiquement, donc inutile à spécifier (définie principalement par l'import PDF pour reproduire les positions de texte d'origine) |
| `firstLineIndent` | number |  | Retrait de première ligne (pt) |
| `leftIndent` | number |  | Retrait gauche (pt) |
| `rightIndent` | number |  | Retrait droit (pt) |
| `padding` | Padding |  | Marge intérieure |
| `direction` | `'ltr'` = de gauche à droite / `'rtl'` = de droite à gauche / `'auto'` = détecté automatiquement à partir du contenu (analyse bidirectionnelle du texte) |  | Direction du texte |
| `openTypeScript` | string |  | Tag OpenType spécifiant les règles de quel système d'écriture de la police sont utilisées lors de la conversion du texte en formes de glyphes (mise en forme) (par ex. `'latn'` = écriture latine, `'arab'` = écriture arabe). Normalement inutile à spécifier (géré automatiquement à partir du contenu du texte) |
| `openTypeLanguage` | string |  | Tag OpenType explicitant la langue pour les polices qui varient les formes de glyphes selon la langue au sein d'un même système d'écriture. Normalement inutile à spécifier |
| `openTypeFeatures` | Record<string, number> |  | Active ou désactive les fonctionnalités de commutation de glyphes intégrées à la police. Exemples : `{ "palt": 1 }` = resserrer l'espacement des caractères japonais, `{ "liga": 0 }` = désactiver les ligatures, `{ "zero": 1 }` = zéro barré. Valeurs : 0 = inactif / 1 = actif ; pour les fonctionnalités de sélection de glyphes, un numéro de glyphe alternatif à partir de 1 |
| `shrinkToFit` | boolean |  | Réduction automatique : diminue la taille de police pour que le texte tienne dans la largeur et la hauteur de l'élément |
| `minFontSize` | number |  | Taille de police minimale (pt) pour `shrinkToFit`. Défaut : 4 |
| `fitWidth` | boolean |  | Ajuste automatiquement la taille de police pour que la ligne la plus longue s'ajuste exactement à la largeur de contenu de l'élément (dans les deux sens, réduction et agrandissement) |
| `outlineText` | boolean |  | Vectorise le texte en contours (tracés). Défaut : `false` |
| `pdfFontMode` | `'embedded'` = incorpore le programme de police / `'reference'` = émet une référence aux polices système sans incorporation |  | Traitement du programme de police dans le PDF |
| `textPaintMode` | `'fill'` = remplissage / `'stroke'` = contour seul / `'fillStroke'` = remplissage + contour |  | Sémantique de peinture du texte préservée via l'import PDF. Défaut : `fill` |
| `textStrokeColor` | string |  | Couleur de trait pour stroke / fillStroke |
| `textStrokeWidth` | number |  | Épaisseur du trait de contour du texte (pt) |
| `tabStops` | TabStopDef[] |  | Définitions de taquets de tabulation (voir **`TabStopDef`** ci-dessous) |
| `tabStopWidth` | number |  | Intervalle de tabulation par défaut (pt). 40pt si non spécifié |
| `wrap` | boolean |  | Retour à la ligne du texte. Défaut : `true` (undefined signifie que le repli est activé) |

**`LineSpacingDef`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'single'` = interligne simple / `'1.5'` = 1,5 ligne / `'double'` = double / `'proportional'` = proportionnel / `'fixed'` = valeur fixe / `'minimum'` = valeur minimale | ✓ | Type d'interlignage |
| `value` | number |  | Valeur pour fixed / minimum / proportional |

**`TabStopDef`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `position` | number | ✓ | Position du taquet (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Alignement du taquet. Défaut : `left` |

**`FillDef`** (l'union des types acceptés par le remplissage (`fill`) et le trait (`stroke`) de `path` et par le remplissage (`fill`) de `rectangle`/`ellipse`. Le `stroke` de `rectangle`/`ellipse` n'accepte qu'une chaîne de couleur unie)
| Forme | Description |
| --- | --- |
| string | Couleur unie (`#RRGGBB` ou `#RRGGBBAA`) |
| PdfSpecialColorDef | Ton direct (Separation/DeviceN). Spécification de couleur pour des encres particulières telles que l'or, l'argent ou les couleurs d'entreprise (voir le tableau ci-dessous) |
| LinearGradientDef | Dégradé linéaire — les couleurs changent le long d'un axe reliant deux points (voir le tableau ci-dessous) |
| RadialGradientDef | Dégradé radial — les couleurs changent vers l'extérieur depuis un centre (voir le tableau ci-dessous) |
| MeshGradientDef | Dégradé maillé — les couleurs changent le long de formes libres (voir le tableau ci-dessous) |
| TilingPatternDef | Motif de pavage — remplit en répétant un petit motif en mosaïque (voir le tableau ci-dessous) |
| FunctionShadingDef | Ombrage par fonction — les couleurs sont calculées à partir des coordonnées par une formule (voir le tableau ci-dessous) |

**`GradientStopDef`** (arrêts de couleur d'un dégradé ; utilisés dans les `stops` de chaque dégradé)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Position le long de l'axe du dégradé, sous forme de rapport de 0 à 1 (0 = point de départ, 1 = point d'arrivée) |
| `color` | string | ✓ | Couleur à cette position (`#RRGGBB`) |
| `opacity` | number |  | Opacité à cette position (0–1). Défaut : 1 |

**`LinearGradientDef`** (dégradé linéaire — un remplissage dont les couleurs changent le long d'un axe reliant deux points)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Discriminant indiquant un dégradé linéaire |
| `x1` | number |  | Coordonnée X du point de départ, **sous forme de rapport à la largeur de la boîte englobante de l'élément** (0 = bord gauche, 1 = bord droit). Défaut : 0 |
| `y1` | number |  | Coordonnée Y du point de départ, **sous forme de rapport à la hauteur de la boîte englobante de l'élément** (0 = bord supérieur, 1 = bord inférieur). Défaut : 0 |
| `x2` | number |  | Coordonnée X du point d'arrivée (rapport à la largeur). Défaut : 1 (avec les valeurs par défaut inchangées, un dégradé horizontal de gauche à droite) |
| `y2` | number |  | Coordonnée Y du point d'arrivée (rapport à la hauteur). Défaut : 0 |
| `stops` | GradientStopDef[] | ✓ | Tableau des arrêts de couleur (voir le tableau ci-dessus) |
| `spreadMethod` | `'pad'` = remplit avec les couleurs des extrémités / `'reflect'` = répète en miroir / `'repeat'` = répète tel quel |  | Manière de peindre en dehors de la plage du dégradé. Défaut : `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Métadonnées de préservation permettant de réémettre sans perte un dégradé issu d'un PDF importé. Inutile de le spécifier dans les modèles écrits à la main |

**`RadialGradientDef`** (dégradé radial — un remplissage dont les couleurs changent vers l'extérieur depuis un centre)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Discriminant indiquant un dégradé radial |
| `cx` | number |  | Coordonnée X du centre du cercle extérieur (rapport à la largeur de la boîte englobante de l'élément). Défaut : 0.5 |
| `cy` | number |  | Coordonnée Y du centre du cercle extérieur (rapport à la hauteur). Défaut : 0.5 |
| `r` | number |  | Rayon du cercle extérieur, **sous forme de rapport à la plus grande des deux dimensions, largeur ou hauteur**. Défaut : 0.5 |
| `fx` | number |  | Coordonnée X du point focal (où commence le dégradé) (rapport à la largeur). Défaut : `cx` |
| `fy` | number |  | Coordonnée Y du point focal (rapport à la hauteur). Défaut : `cy` |
| `fr` | number |  | Rayon du cercle focal (rapport à la plus grande des deux dimensions). Défaut : 0 |
| `stops` | GradientStopDef[] | ✓ | Tableau des arrêts de couleur |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Manière de peindre en dehors de la plage (identique à `LinearGradientDef`). Défaut : `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Métadonnées pour la réémission sans perte de l'import PDF. Inutile de le spécifier dans les modèles écrits à la main |

**`MeshGradientDef`** (dégradé maillé — un remplissage qui attribue des couleurs aux sommets de treillis ou de triangles et fait varier les couleurs le long de formes libres)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Discriminant indiquant un dégradé maillé |
| `patches` | MeshPatchDef[] |  | Tableau de carreaux de surface. Chaque carreau possède `points` (un maillage 4×4 de points de contrôle exprimé par 32 nombres dans l'ordre x,y ; **les coordonnées sont en pt locaux à l'élément**) et `colors` (les couleurs des 4 coins) |
| `triangles` | MeshTriangleDef[] |  | Tableau de triangles de dégradé. Chaque triangle possède `points` (x0,y0,x1,y1,x2,y2 ; pt locaux à l'élément) et `colors` (les couleurs des 3 sommets) ; les couleurs sont interpolées entre les sommets |
| `lattice` | MeshLatticeDef |  | Maillage en treillis. Possède `columns` (nombre de sommets par rangée, 2 ou plus), `points` (suite des coordonnées des sommets ; pt locaux à l'élément) et `colors` (une couleur par sommet, dans le même ordre que `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Représentation compacte de données de maillage natives importées depuis un PDF. Inutile de le spécifier dans les modèles écrits à la main |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Idem ci-dessus, pour les triangles de dégradé |
| `pdfShading` | PdfMeshShadingDef |  | Métadonnées pour la réémission sans perte de l'import PDF. Inutile de le spécifier dans les modèles écrits à la main |

**`TilingPatternDef`** (motif de pavage — remplit en pavant un petit motif ; pour les hachures, les damiers, les logos répétés et autres)

L'« espace du motif » évoqué dans le tableau est le système de coordonnées propre au motif. Si `matrix` n'est pas spécifiée, il coïncide avec les coordonnées en pt locales à l'élément.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Discriminant indiquant un motif de pavage |
| `bbox` | [number, number, number, number] | ✓ | Boîte englobante d'un motif unitaire (la cellule du motif), en coordonnées de l'espace du motif |
| `xStep` | number | ✓ | Intervalle de répétition horizontal de la cellule (espace du motif) |
| `yStep` | number | ✓ | Intervalle de répétition vertical de la cellule (espace du motif) |
| `graphics` | TileGraphicDef[] | ✓ | Tableau des graphiques dessinés à l'intérieur de la cellule, discriminés par `kind` : `'path'` (données de chemin SVG + fill/stroke) / `'image'` (référence l'ID d'une ressource image via `source`) / `'text'` (texte avec police, taille et couleur) / `'group'` (groupe imbriqué avec transformation, détourage, opacité, etc.). Toutes les coordonnées sont dans l'espace du motif |
| `tilingType` | 1 = espacement constant (les cellules peuvent être légèrement déformées pour s'adapter au périphérique de sortie) \| 2 = aucune déformation (l'espacement peut varier légèrement) \| 3 = espacement constant avec pavage rapide |  | Mode de précision du pavage. Défaut : 1 |
| `paintType` | `'colored'` = le motif porte ses propres couleurs / `'uncolored'` = teinté d'une seule couleur avec le `color` du consommateur |  | Manière dont la couleur est portée. Défaut : `'colored'` |
| `color` | string |  | Couleur de teinte lors de l'utilisation d'un motif `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | Matrice de transformation affine de l'espace du motif vers l'espace local à l'élément. Défaut : matrice identité |

**`FunctionShadingDef`** (ombrage par fonction — un remplissage dont la couleur est calculée par une formule à partir des coordonnées (x, y) ; apparaît principalement lors de l'import PDF)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Discriminant indiquant un ombrage par fonction. Il existe deux variantes : une forme formule avec `expression` et une forme échantillonnée avec `sampled` |
| `domain` | [number, number, number, number] | ✓ | Domaine d'entrée `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (forme formule uniquement) | Expression de calculatrice PostScript (PDF FunctionType 4). Prend x, y et renvoie r, g, b. Exemple : `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (forme échantillonnée uniquement) | Données de fonction échantillonnée (PDF FunctionType 0). Possède `size` (dimensions de la grille d'échantillons), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (plage de sortie), `samples` (valeurs d'échantillon par point de grille) et, en option, `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | Matrice de correspondance du domaine d'entrée vers les **pt locaux à l'élément**. Défaut : matrice identité |
| `background` | [number, number, number] |  | Couleur de fond en dehors du domaine (composantes DeviceRGB, 0–1) |
| `bbox` | [number, number, number, number] |  | Boîte englobante limitant la peinture |
| `antiAlias` | boolean |  | Indication d'anticrénelage |
| `paintOperator` | `'pattern'` = peint comme un motif (défaut) / `'sh'` = dessiné directement sous le détourage courant |  | Méthode de peinture pour la sortie PDF |

**`PdfSpecialColorDef`** (remplissage en ton direct — spécification de couleur pour l'impression avec des encres particulières, telles que l'or, l'argent ou les couleurs d'entreprise, que le mélange CMJN ordinaire ne peut reproduire)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Discriminant indiquant un remplissage en ton direct |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | Espace colorimétrique du ton direct. Une encre unique utilise `kind: 'separation'` avec `name` (nom de l'encre), `alternate` (l'espace de couleur de process utilisé à la place dans les environnements dépourvus de l'encre en ton direct ; voir le tableau ci-dessous) et `tintTransform` (spécifie la conversion de la teinte vers la couleur alternative sous forme de fonction PDF, par ex. `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = blanc à la teinte 0 et bleu à 1). Plusieurs encres utilisent `kind: 'deviceN'` avec `names` (tableau des noms d'encres), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = standard / `'NChannel'` = forme étendue pouvant porter des informations d'attribut par encre), `colorants` (une table associant chaque nom d'encre à une définition d'encre unique), `process` et `mixingHints` |
| `components` | number[] | ✓ | Valeur de teinte de chaque encre (0–1) |
| `displayColor` | string | ✓ | Couleur utilisée à la place pour l'affichage à l'écran et les prévisualisations, qui ne disposent pas de l'encre en ton direct |

**`PdfProcessColorSpaceDef`** (espace de couleur de process — l'espace colorimétrique des « couleurs ordinaires » exprimées par le mélange d'encres standard telles que le CMJN. Utilisé dans l'`alternate` d'un ton direct et le `colorSpace` d'un masque de fusion, discriminé par `kind`)

| Variante (`kind`) | Propriétés supplémentaires | Description |
| --- | --- | --- |
| `'gray'` | Aucune | Niveaux de gris (DeviceGray) |
| `'rgb'` | Aucune | RVB (DeviceRGB) |
| `'cmyk'` | Aucune | CMJN (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (tous requis) | Gris calibré colorimétriquement (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (par composante), `matrix` (3×3) (tous requis) | RVB calibré colorimétriquement (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (tous requis) | Espace colorimétrique L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (octets du profil ICC) (tous requis) | Espace colorimétrique basé sur un profil ICC |

`whitePoint`/`blackPoint` se spécifient sous forme de tableaux `[x, y, z]` dans l'espace colorimétrique CIE XYZ.

### Propriétés des bandes (`bands`) et des groupes (`groups`)

Les dix sortes de bandes spécifiées dans les `bands` du modèle (voir « Une page est un empilement de "bandes" ») se définissent toutes avec le `BandDef` suivant (seul `details` est un tableau de `BandDef`).

**`BandDef`**

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `height` | number | ✓ | Hauteur minimale de la bande (pt). Croît à mesure que les éléments s'étirent |
| `elements` | ElementDef[] |  | Éléments placés sur la bande |
| `startNewPage` | boolean |  | Démarre toujours cette bande sur une nouvelle page |
| `spacingBefore` | number |  | Espace avant la bande (pt) |
| `spacingAfter` | number |  | Espace après la bande (pt) |
| `splitType` | `'stretch'` = imprime tout ce qui tient sur la page et poursuit le reste sur la page suivante (défaut) / `'prevent'` = ne scinde pas ; envoie la bande entière sur la page suivante (elle est scindée si elle ne tient pas non plus sur la nouvelle page) / `'immediate'` = scinde immédiatement à la position courante, même au milieu d'un élément |  | Manière de scinder la bande lorsqu'elle ne tient pas à une limite de page |
| `printWhenExpression` | Expression \| null |  | Lorsque le résultat de l'évaluation est falsy, cette bande n'est pas émise |

**`GroupDef`** (chaque entrée de `groups`)

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom du groupe. Référencé depuis le `resetGroup` d'une variable et l'`evaluationGroup` d'un textField |
| `expression` | Expression | ✓ | Clé du groupe. Évaluée pour chaque ligne ; partout où la valeur change, le groupe précédent est clos et un nouveau groupe commence |
| `header` | BandDef |  | Bande émise au début du groupe |
| `footer` | BandDef |  | Bande émise à la fin du groupe |
| `keepTogether` | boolean |  | Lorsque le groupe entier ne tient pas dans l'espace restant mais tiendrait sur une nouvelle page, le démarre après un saut de page |
| `minHeightToStartNewPage` | number |  | Démarre le groupe sur une nouvelle page lorsque la hauteur restante de la page est inférieure à cette valeur (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Lorsque le groupe s'étend sur plusieurs pages, réimprime l'en-tête sur chaque page de continuation |
| `resetPageNumber` | boolean |  | Réinitialise `PAGE_NUMBER` à 1 au démarrage du groupe |
| `startNewPage` | boolean |  | Démarre chaque groupe sur une nouvelle page |
| `startNewColumn` | boolean |  | Démarre chaque groupe dans une nouvelle colonne |
| `footerPosition` | `'normal'` = émis immédiatement après les lignes de détail (défaut) / `'stackAtBottom'` = empilé vers le bas de la page / `'forceAtBottom'` = toujours placé tout en bas de la page, en consommant l'espace restant intermédiaire / `'collateAtBottom'` = s'aligne en bas uniquement lorsque le pied d'un autre groupe est aligné en bas (identique à `'normal'` sinon) |  | Position verticale du pied de groupe |

### Propriétés disponibles dans les styles (`styles`)

Les styles se définissent dans le tableau `styles` du modèle et se référencent par `name` depuis la propriété `style` d'un élément. Les polices, l'alignement du texte, les couleurs et les autres réglages liés au texte se font principalement via les styles.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom du style (référencé depuis le `style` des éléments) |
| `parentStyle` | string |  | Nom du style parent. Hérite des propriétés du parent et les remplace par ses propres réglages (les références circulaires sont ignorées) |
| `isDefault` | boolean |  | Un style avec `true` est appliqué par défaut aux éléments dépourvus de `style` |
| `fontFamily` | string |  | Famille de police. Défaut : `'default'` |
| `fontSize` | number |  | Taille de police (pt). Défaut : 10 |
| `bold` | boolean |  | Gras. Défaut : `false` |
| `italic` | boolean |  | Italique. Défaut : `false` |
| `underline` | boolean |  | Souligné. Défaut : `false` |
| `strikethrough` | boolean |  | Barré. Défaut : `false` |
| `forecolor` | string |  | Couleur de premier plan (`#RRGGBB` ou `#RRGGBBAA`). Défaut : `#000000` |
| `backcolor` | string |  | Couleur d'arrière-plan. Défaut : `transparent` |
| `hAlign` | `'left'` = aligné à gauche / `'center'` = centré / `'right'` = aligné à droite / `'justify'` = justifié |  | Alignement horizontal. Défaut : `left` |
| `vAlign` | `'top'` = aligné en haut / `'middle'` = aligné au milieu / `'bottom'` = aligné en bas |  | Alignement vertical. Défaut : `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotation du texte (degrés) |
| `padding` | Padding |  | Marge intérieure |
| `border` | BorderDef |  | Bordure |
| `mode` | `'opaque'` = remplit l'arrière-plan avec `backcolor` / `'transparent'` = ne remplit pas l'arrière-plan |  | Mode d'affichage |
| `opacity` | number |  | Opacité (0.0–1.0) |
| `variation` | Record<string, number> |  | Valeurs des axes d'une police variable (par ex. `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = écriture horizontale / `'vertical-rl'` = écriture verticale avec des lignes progressant de droite à gauche / `'vertical-lr'` = écriture verticale avec des lignes progressant de gauche à droite |  | Direction d'écriture |
| `conditionalStyles` | ConditionalStyleDef[] |  | Styles conditionnels (voir le tableau ci-dessous). Lorsqu'une condition est remplie, les propriétés correspondantes sont remplacées |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Direction du texte (ltr = de gauche à droite / rtl = de droite à gauche / auto = détectée automatiquement à partir du contenu) |
| `openTypeScript` | string |  | Balise OpenType spécifiant quelles règles de système d'écriture de la police sont utilisées lors de la conversion du texte en formes de glyphes (shaping) (par ex. `'latn'` = écriture latine, `'arab'` = écriture arabe). Normalement inutile à spécifier (géré automatiquement à partir du contenu du texte) |
| `openTypeLanguage` | string |  | Balise OpenType explicitant la langue pour les polices qui font varier les formes de glyphes selon la langue au sein d'un même système d'écriture. Normalement inutile à spécifier |
| `openTypeFeatures` | Record<string, number> |  | Active ou désactive les fonctionnalités de substitution de glyphes intégrées à la police. Exemples : `{ "palt": 1 }` = resserrer l'espacement des caractères japonais, `{ "liga": 0 }` = désactiver les ligatures, `{ "zero": 1 }` = zéro barré. Valeurs : 0 = désactivé / 1 = activé ; pour les fonctionnalités de sélection de glyphe, un numéro de glyphe alternatif commençant à 1 |

**`ConditionalStyleDef`**
| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Condition d'application. Lorsqu'elle est truthy, les propriétés ci-dessous remplacent celles du style |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Mêmes types que les propriétés StyleDef de même nom |  | Valeurs remplacées lorsque la condition est remplie (les significations sont identiques à celles des propriétés StyleDef correspondantes) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Mêmes types que les propriétés StyleDef de même nom |  | Déclarées dans la définition de type, mais l'implémentation actuelle n'applique pas leur remplacement lorsque la condition est remplie |

### Types pour l'import PDF et les fonctionnalités PDF avancées

Les types énumérés ici servent deux objectifs : (1) des types de « préservation » permettant de réémettre un PDF importé sans en perdre un seul octet, et (2) des types permettant d'utiliser des fonctionnalités avancées telles que les calques PDF, les scripts de formulaire et les réglages de prépresse pour l'impression commerciale. Vous ne les spécifierez presque jamais en écrivant un rapport ordinaire à la main. Les types décrits comme « définis par l'import PDF » apparaissent au sein des éléments générés par `importPdfPage()`.

**`OptionalContentDef`** (fonctionnalité de calques PDF)

Le PDF peut placer du contenu sur des « calques » (groupes de contenu optionnel, OCG), dont la visibilité et l'impression sont commutables depuis le panneau des calques de la visionneuse. Spécifier ceci dans l'`optionalContent` d'un élément place cet élément sur un calque. Exemple : placer un filigrane « Confidentiel » sur un calque qui n'apparaît qu'à l'impression.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nom du calque affiché dans le panneau des calques de la visionneuse |
| `visible` | boolean |  | Visibilité initiale à l'écran. Défaut : true |
| `print` | boolean |  | État d'impression initial. Défaut : suit `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Défini par l'import PDF. Préserve la définition de calque du PDF source (OCG) ou une définition d'appartenance (OCMD) qui décide de la visibilité à partir d'une combinaison de plusieurs calques. Une appartenance possède `groups` (les calques visés), `policy` (`'AllOn'` = visible lorsque tous sont activés / `'AnyOn'` = lorsque au moins un est activé / `'AnyOff'` = lorsque au moins un est désactivé / `'AllOff'` = lorsque tous sont désactivés) et, en option, une expression de logique de visibilité `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | Défini par l'import PDF. Préserve la configuration des calques à l'échelle du document (la liste de tous les calques, la configuration par défaut, l'arborescence d'ordre d'affichage du panneau des calques, les groupes de sélection mutuellement exclusifs, le verrouillage, etc.) |

**`PdfRawValueDef`** (« valeurs brutes » PDF)

Bon nombre des propriétés de préservation transportent des données internes au PDF sous forme de « valeurs brutes », sans les interpréter. Une valeur brute est une valeur JavaScript de la forme suivante : `null`, les booléens et les nombres tels quels ; un nom PDF s'écrit `{ kind: 'name', value: 'DeviceRGB' }` ; une chaîne s'écrit `{ kind: 'string', bytes: Uint8Array }` ; un tableau s'écrit `{ kind: 'array', items: [...] }` ; un dictionnaire s'écrit `{ kind: 'dictionary', entries: { ... } }` ; un flux s'écrit `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (actions exécutées par une visionneuse PDF)

Utilisé dans les `additionalActions` des champs de formulaire et ailleurs, ce type définit « ce que la visionneuse doit faire ». Le contenu est uniquement sérialisé et importé — **le moteur core ne l'exécute jamais** (l'exécution est le fait d'une visionneuse qui le prend en charge).

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Type d'action. `'JavaScript'` = exécuter un script (le formatage, la validation et le calcul automatique des saisies de formulaire l'utilisent) / `'GoTo'` = aller à une destination au sein du document / `'GoToR'` = aller à un autre document / `'GoToE'` = aller à un document incorporé / `'URI'` = ouvrir une URL / `'Launch'` = lancer une application ou un fichier / `'Named'` = commande prédéfinie (page suivante, etc.) / `'SubmitForm'` = soumettre le formulaire / `'ResetForm'` = réinitialiser le formulaire / `'ImportData'` = importer des données / `'Hide'` = commuter la visibilité d'une annotation / `'SetOCGState'` = commuter la visibilité d'un calque / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = autres actions PDF standard |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Dictionnaire contenant les réglages de chaque type d'action sous forme de valeurs brutes (voir **`PdfRawValueDef`** ci-dessus). Exemple : pour `'JavaScript'`, `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Destination pour la famille `'GoTo'`. Soit nommée (`{ kind: 'named', name, representation: 'name' \| 'string' }`), soit explicite (page cible + manière d'ajuster la vue) |
| `structureDestination` | PdfStructureDestinationDef |  | Destination basée sur un élément de structure du document (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Spécifie l'annotation visée par les actions média |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Suite des calques et des opérations (`'ON'` / `'OFF'` / `'Toggle'`) commutés par `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Spécifie les noms de champs visés par `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Spécification de fichier incorporé pour `'GoToE'` (structure récursive) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Paramètres spécifiques à la plateforme pour `'Launch'`. Uniquement préservés, jamais exécutés |
| `articleTarget` | PdfArticleActionTargetDef |  | Spécification de fil d'article pour `'Thread'` |
| `documentPartIndex` | number |  | Numéro de la partie de document de destination pour `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Numéro d'instance de média enrichi |
| `next` | PdfActionDef \| PdfActionDef[] |  | Action(s) à exécuter ensuite (chaînage) |

**`PdfFormXObjectDef`** (préservation des métadonnées des composants PDF importés)

Au sein d'un PDF, un contenu de dessin utilisé de façon répétée peut être empaqueté dans des composants appelés « Form XObjects ». L'import PDF convertit un tel composant en élément `frame` et conserve le système de coordonnées et les métadonnées du composant dans ce type, afin de pouvoir les restaurer lors de la réémission. Inutile de le spécifier dans les modèles écrits à la main.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Boîte englobante du composant (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Matrice de transformation du système de coordonnées du composant (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Transformation de coordonnées en vigueur lorsque ce composant a été dessiné dans le PDF source |
| `formType` | 1 |  | Numéro de type de forme du composant (la spécification PDF n'en définit que 1) |
| `group` | Record<string, PdfRawValueDef> |  | Préservation en valeurs brutes du dictionnaire de groupe de transparence |
| `reference` | Record<string, PdfRawValueDef> |  | Préservation en valeurs brutes du dictionnaire de référence PDF externe |
| `metadata` | Forme flux de PdfRawValueDef (`kind: 'stream'`) |  | Préserve le flux de métadonnées |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Préserve les données spécifiques à l'application créatrice (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Préserve l'horodatage de dernière modification |
| `structParent` / `structParents` | number |  | Préserve les clés de correspondance vers le PDF balisé (structure du document, telle que l'ordre de lecture) |
| `opi` | PdfOpiMetadataDef |  | Préserve les informations OPI (voir le tableau ci-dessous) |
| `name` | string |  | Nom du composant |
| `measure` | PdfMeasurement |  | Préserve les informations de mesure (voir le tableau ci-dessous) |
| `pointData` | PdfPointData[] |  | Préserve les données de nuage de points (voir le tableau ci-dessous) |

**`PdfSourceVectorDef`** (définitions partagées de formes répétées importées)

Lors de l'import d'un PDF dans lequel une même forme se répète en grand nombre — comme des symboles cartographiques —, les données de contour de la forme sont préservées sous la forme « une définition + N placements ». Cela apparaît dans le `pdfSourceVector` d'un élément `path` ; lorsque ce champ est spécifié, aucune analyse de `d` n'est effectuée. Inutile de le spécifier dans les modèles écrits à la main.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Tableau des définitions de formes réutilisables. Chaque définition possède `commands` (0 = aller au point de départ [2 coordonnées], 1 = ligne droite [2], 2 = courbe de Bézier cubique [6], 3 = fermer le chemin [0]) et `coords` (un tableau aplati de coordonnées dans l'ordre des commandes) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Tableau des placements des définitions. Chaque placement possède `definitionIndex` (numéro de définition) et `matrix` (matrice affine à 6 éléments) |

**`PdfOpiMetadataDef`** (informations de remplacement d'image pour l'impression commerciale)

L'OPI (Open Prepress Interface) est un mécanisme d'impression commerciale dans lequel une image légère et à basse résolution est utilisée pendant l'édition, puis échangée contre l'image haute résolution lorsque l'imprimeur produit la sortie. Préservé lorsque le PDF importé portait cette spécification.

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | Version OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Contient le contenu du dictionnaire OPI sous forme de valeurs brutes PDF (nom du fichier source du remplacement, zone de recadrage, etc.) |

**`PdfMeasurement`** (informations de mesure pour les plans et les cartes)

Dans les PDF de plans et de cartes, les outils de mesure de la visionneuse peuvent mesurer distances et surfaces à une échelle telle que « 1 cm sur le papier correspond à 1 m dans le monde réel ». Ce type préserve ces informations d'échelle et de système de coordonnées, et se décline en une forme rectilinéaire (`kind: 'rectilinear'`) et une forme géospatiale (`kind: 'geospatial'`).

| Propriété (`'rectilinear'`) | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Discriminant pour la mesure rectilinéaire |
| `scaleRatio` | string | ✓ | Texte d'affichage de l'échelle (par ex. `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` est optionnel) | Chaîne de formats d'affichage des nombres pour les directions X/Y (libellés d'unités, facteurs de conversion, affichage décimal/fractionnaire, etc.). Lorsque `y` est omis, `x` est utilisé |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Formats d'affichage des nombres pour la distance/la surface |
| `angle` / `slope` | PdfNumberFormat[] |  | Formats d'affichage des nombres pour l'angle/la pente |
| `origin` | [number, number] |  | Origine de la mesure |
| `yToX` | number |  | Facteur de conversion des unités Y vers les unités X |

| Propriété (`'geospatial'`) | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Discriminant pour la mesure géospatiale |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Système de coordonnées géodésiques. Un code EPSG ou une chaîne WKT est requis |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Points de contrôle en coordonnées géodésiques et points de contrôle locaux correspondants au sein de l'image ou du composant (même nombre) |
| `dimension` | 2 \| 3 |  | Dimension des coordonnées. Défaut : 2 |
| `bounds` | [number, number][] |  | Polygone de la zone mesurable |
| `displayCoordinateSystem` | Identique à `coordinateSystem` |  | Système de coordonnées pour l'affichage |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Unités d'affichage préférées pour la distance, la surface et l'angle |
| `projectedCoordinateSystemMatrix` | n-uplet de 12 nombres |  | Matrice affine 4×4 pour le système de coordonnées projeté (12 éléments dans l'ordre des lignes, la quatrième colonne constante étant omise) |

**`PdfPointData`** (données de nuage de points cartographiques)

Pour préserver les tables de données de points incorporées dans les PDF cartographiques, avec des colonnes nommées telles que `LAT` (latitude), `LON` (longitude) et `ALT` (altitude).

| Propriété | Type / valeurs admises | Requis | Description |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Tableau des noms de colonnes (uniques et non vides ; les colonnes `LAT`/`LON`/`ALT` doivent être numériques) |
| `rows` | PdfRawValueDef[][] | ✓ | Valeurs de chaque ligne. La longueur de la ligne correspond à `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (fonctions de transfert de tons pour le prépresse)

Fonctions utilisées dans les `deviceParams` d'un `frame` et dans `softMask`, qui font correspondre une valeur (0–1) à une autre valeur. En prépresse, elles expriment des courbes de tons — « une encre de telle densité est imprimée à telle densité ». Un `TransferFunctionDef` est soit un `CalculatorFunctionDef` (une expression de calculatrice PostScript, par ex. `{ expression: '{ 1 exch sub }' }` = inverser le noir et le blanc), soit un `PdfFunctionDef` (un objet fonction PDF : une table de valeurs échantillonnées, une interpolation exponentielle ou une combinaison de celles-ci) ; là où il est utilisé, `'Identity'` (aucune transformation) peut également être spécifié.

**`HalftoneDef`** (définition de trame pour le prépresse)

Les presses d'imprimerie expriment les dégradés de tons par la taille de petits points (points de trame). Ceci spécifie la manière dont ces points sont construits, et sert à la préservation lors de l'import PDF ainsi qu'à la création de données de prépresse. `type` distingue cinq formes :

| Forme | Propriétés principales | Description |
| --- | --- | --- |
| type 1 (screen) | `frequency` (linéature) ✓, `angle` (angle) ✓, `spotFunction` (forme du point ; un nom prédéfini tel que `'Round'` ou une expression de calculatrice) ✓, `accurateScreens` (demande une construction de trame haute précision ; optionnel) | Forme standard définissant la trame par la linéature, l'angle et la forme du point (`type` peut être omis) |
| type 6 (tableau de seuils) | `width` ✓, `height` ✓, `thresholds` (width × height valeurs, 0–255) ✓ | Définit la trame directement à l'aide d'une table de seuils |
| type 10 (seuils inclinés) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Définition par seuils avec des cellules inclinées |
| type 16 (seuils 16 bits) | `width` ✓, `height` ✓, `thresholds` (valeurs 16 bits) ✓, second rectangle optionnel | Définition par seuils haute précision |
| type 5 (collection par plaque) | `halftones` (tableau de `{ colorant: nom de l'encre, halftone: n'importe laquelle des formes ci-dessus }`) ✓ | Attribue une trame différente à chaque plaque de couleur, telle que le cyan et le magenta |

Les quatre formes autres que le type 5 peuvent porter un `transferFunction` optionnel (`'Identity'` ou un `TransferFunctionDef`) (pour le type 5, chaque définition de trame interne par plaque porte le sien).

## API principale

Les API les plus fréquemment utilisées, énumérées une par une avec un exemple minimal, pour que vous puissiez les retrouver par « ce que vous voulez faire ». On suppose que `template`, `dataSource`, `fontMap` et `fonts` sont exactement ceux construits dans le tutoriel.

### Construire un rapport

#### Construire un rapport à partir d'un modèle et de données — `createReport()`

Met en page le modèle et les données, et renvoie un `RenderDocument` orienté pages. Les expressions utilisent un langage d'expressions intégré et sûr, capable de référencer `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` et plus encore — ni `eval` ni `Function` ne sont utilisés. Les expressions callback TypeScript sont également une option.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // nombre de pages mises en page
```

#### Rechercher et modifier des éléments du modèle par ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Les deux API renvoient des références vers les éléments du modèle d'origine. Effectuez vos modifications avant d'appeler `createReport()`. `getElementChildren()` ne renvoie des éléments enfants que pour `frame` et `table` (les éléments contenus dans les cellules) ; pour les autres éléments, elle renvoie un tableau vide. Pour les détails sur la portée de la recherche, voir « Rechercher des éléments par ID et les modifier avant le rendu ».

#### Construire un rapport à partir d'un fichier `.report` — `createReportFromFile()` (Node.js)

Lit un modèle JSON et résout les chemins relatifs des images et des sous-rapports par rapport au répertoire du modèle.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Combiner plusieurs rapports en un seul volume — `createReportBook()`

Concatène plusieurs modèles — une couverture, un corps, etc. — en un unique `RenderDocument` à numérotation de pages continue.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Concaténer des `RenderDocument` déjà construits — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

Les ID d'images en collision sont renommés automatiquement.

#### Générer automatiquement une page de table des matières — `insertTableOfContents()`

Collecte les entrées de table des matières à partir des ancres (`anchorName`) du rapport et insère les pages de table des matières en tête.

```ts
const withToc = insertTableOfContents(
  document,
  // Taille de page et marges de la table des matières en pt (cet exemple : A4 portrait)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // ID de police (clé de fontMap) utilisé pour le texte de la table des matières
  { title: '目次' },
)
```

#### Obtenir le nombre de pages d'un PDF existant — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Importer un PDF existant comme éléments de rapport — `importPdfPage()`

Pour les détails, voir **Convertir un PDF existant en éléments de rapport (import PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Rendu et sortie

#### Émettre un PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Prévisualiser une seule page — `renderPage()`

Rendu page par page. Utilisez-le pour ne dessiner que la page actuellement affichée dans une prévisualisation navigateur.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Rendre le rapport entier vers n'importe quel backend — `render()`

Rend toutes les pages vers n'importe quelle cible de sortie qui implémente l'interface `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Dessiner sur un Canvas HTML — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### Émettre du SVG — `SvgBackend`

Génère une chaîne `<svg>` autonome par page.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // tableau de chaînes <svg>, une par page
```

#### Contrôle fin de la génération du PDF — `PdfBackend`

Les options propres au PDF, telles que les vignettes de page, se passent au constructeur.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` s'applique à la i-ème page. Pour `thumbnailImageId` (l'image de vignette affichée dans la liste des pages), spécifiez un ID d'image existant dans `document.images`.

#### Fusionner des PDF finalisés — `mergePdfFiles()`

Fusionne plusieurs PDF en un seul à l'aide d'un analyseur PDF en TypeScript pur.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Travailler avec les polices

#### Charger un fichier de police — `Font.load()`

Analyse les formats TTF, OTF, TTC, OTC, WOFF, WOFF2 et EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Mesurer la largeur d'un texte — `TextMeasurer`

Mesure de texte rapide, adossée au cache de glyphes de `Font`. Enregistré dans le `fontMap`, il sert également à la mise en page.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Convertir une chaîne en séquence de glyphes — `font.shapeText()`

Utilise les informations OpenType / AAT (la spécification d'extension des polices de la lignée Apple) / Graphite (la spécification d'extension des polices de la lignée SIL) pour obtenir une séquence de glyphes (numéros de glyphes accompagnés de leurs positions et chasses), avec la sélection de glyphes, les ligatures et les ajustements de positionnement appliqués.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Détecter les glyphes manquants avant l'impression — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Utiliser de manière autonome les codes-barres, le SVG, les formules mathématiques et les images

#### Générer un code-barres de manière autonome — `renderBarcode()`

Génère directement les nœuds de dessin d'un code-barres, sans passer par un élément de rapport.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### Analyser et rendre du SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Composer une formule mathématique de manière autonome — `parseMathLaTeX()` / `layoutMathFormula()`

Requiert une police incluant les informations de dimensions pour les formules mathématiques (la table OpenType MATH) — par exemple STIX Two Math ou Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// arguments : formule analysée, objet Font, ID de police (clé de fontMap), taille de police en pt, couleur du texte
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box est le résultat mis en page ; les éléments math des modèles exécutent en interne cette même mise en page
```

#### Obtenir les dimensions d'une image — `getImageDimensions()`

Prend en charge PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Décoder un PNG — `decodePng()`

Un décodeur PNG en TypeScript pur.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Émettre dans le navigateur un PDF contenant du WebP/AVIF — `prepareBrowserPdfImageResources()`

Le JPEG est stocké directement dans le PDF, et le PNG est traité par le décodeur intégré. Lors de la génération dans le navigateur d'un PDF contenant du WebP/AVIF, `tsreport-core/browser` décode d'abord, à l'aide des codecs standard du navigateur, uniquement les images effectivement référencées par le `RenderDocument`, puis transmet les résultats à la génération du PDF. Les images non référencées sont conservées telles quelles et ne sont pas décodées.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages : octets d'images fournis au moment du rendu ; catalog : réglages du
// catalogue du document PDF ; collection : réglages du portfolio PDF — omettez ceux que vous n'utilisez pas
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Pour décoder le WebP/AVIF sous Node.js, utilisez `createNodeExternalRasterImageDecoder()` de `tsreport-core/node`.

## Restrictions de chargement des ressources et règles d'ID d'image

Règles détaillées à consulter lorsqu'elles deviennent pertinentes pour l'exploitation d'un serveur ou l'intégration dans une bibliothèque.

### Restreindre les répertoires depuis lesquels les images et les modèles sont chargés

Le chargement des fichiers image peut être confiné à des répertoires explicitement autorisés.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` résout par défaut les chemins relatifs par rapport au répertoire du modèle principal, mais, par compatibilité ascendante, ne restreint pas implicitement la portée du chargement elle-même. Lorsque `resources.fileRoot` est spécifié, la même restriction s'applique indifféremment aux images, au modèle principal et aux sous-rapports. Les images manquantes sont traitées selon le réglage `onError` de chaque élément, et les références pointant en dehors du répertoire autorisé (y compris via des liens symboliques) provoquent toujours une erreur.

### Règles d'ID d'image

Chaque image d'un `RenderDocument` se recherche dans `RenderDocument.images` en utilisant `RenderImage.imageId` (de même pour l'`imageId` d'une variante) comme clé. **Les consommateurs doivent utiliser cet ID comme clé exactement tel quel et ne doivent pas reconstituer les clés par jointure de chemins ou procédé analogue.** Les ID sont attribués selon les règles suivantes.

- Charger une image via un chemin relatif ne remplace pas l'ID par le chemin absolu du serveur ni par le chemin résolu des liens symboliques. La référence telle qu'écrite dans le modèle demeure la clé (si elle est écrite sous forme de chemin absolu, cette valeur est conservée telle quelle)
- Le chemin physique résolu des liens symboliques ne sert en interne qu'à décider si deux références désignent le même fichier. Même lorsque les répertoires de base diffèrent, les images pointant vers le même fichier physique réutilisent le même ID
- Dans les configurations où le rapport racine diffère une image à une fourniture au moment du rendu — en utilisant `createReport()` directement sans faire non plus passer l'image en question par `resources`, de sorte que la référence écrite dans le modèle devienne l'ID telle quelle et que les octets soient fournis plus tard via `renderToPdf(document, { images })` —, les images locales chargées par chemin relatif par les sous-rapports se voient toujours attribuer des ID internes indépendants de l'hôte. Comme les références figurant dans les expressions et les sous-rapports dynamiques ne peuvent pas être énumérées à l'avance, cela ne dépend ni du fait qu'un nom soit réellement entré en collision, ni de l'ordre de mise en page. En conséquence, l'image locale d'un sous-rapport ne peut jamais détourner un ID de fourniture au moment du rendu portant le même nom

### Fourniture d'images au moment du rendu et variantes

Lorsqu'une variante n'a pas pu être résolue au moment de la mise en page, l'ID de l'image d'origine est conservé. Les prévisualisations Canvas/SVG ne s'interrompent donc pas, et les octets peuvent être fournis plus tard via `renderToPdf(document, { images })`. Les `images` passées explicitement sont fusionnées dans `document.images`, la valeur passée explicitement l'emportant pour un même ID. Lors de la génération du PDF également, les variantes non fournies sont simplement exclues des variantes candidates — ni le rendu de l'image principale ni le rapport dans son ensemble ne s'interrompent.

### Portée de la collecte des références d'images

La collecte des références d'images traite non seulement les éléments `image` ordinaires, mais aussi les variantes, les masques de fusion de groupe et les motifs de pavage des remplissages (fill/stroke) ainsi que leurs masques de fusion imbriqués, le tout par le même mécanisme. Lorsque vous utilisez dans le navigateur les vignettes de page propres au PDF, les vignettes de dossier de collection ou les images Web Capture, transmettez les mêmes `catalog`, `collection` et `pageOptions` à la fois à `prepareBrowserPdfImageResources(document, options)` et à `renderToPdf(document, options)` (avec l'API primitive, passez les mêmes options à `new PdfBackend(options)` et appelez `render(document, backend)`). Ces images WebP/AVIF, elles aussi, ne sont décodées qu'en cas de besoin avant la génération du PDF.

## Prérequis d'exécution

- Node.js 18 ou version ultérieure
- ES Modules / CommonJS
- Navigateurs modernes
- Aucun paquet de dépendance à l'exécution

La compression et la décompression Brotli du WOFF2 utilisent l'implémentation en TypeScript pur intégrée à tsreport-core, aussi bien sous Node.js que dans les navigateurs. Aucun paquet externe, WASM ou bibliothèque native n'est requis.

## Licence

tsreport-core est disponible, à votre choix, sous [licence MIT](./LICENSE-MIT) ou sous [licence Apache 2.0](./LICENSE-APACHE) (SPDX : `MIT OR Apache-2.0`). Pour les mentions de copyright et les termes de licence du code et des données tiers, voir [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
