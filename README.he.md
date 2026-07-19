# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | עברית

**מיפנית, סינית וקוריאנית ועד הכתב הערבי — מנוע דוחות שהופך את מערכות הכתב של העולם לקובצי PDF יפים, ב-TypeScript טהור.**

‎`tsreport-core` מטפל בניתוח גופני OpenType, בעימוד טקסט (סידור תווים על העמוד עם צורות הגליפים, הרוחבים והמיקומים הנכונים), בפריסת דוחות מבוססת רצועות (bands), בתצוגה מקדימה ב-Canvas/SVG וביצירת PDF — הכול דרך מודל רינדור אחיד אחד. אין לו שום תלות בזמן ריצה. ללא מודולים נייטיביים וללא WASM, החבילה האחת הזו רצה גם על Node.js וגם על דפדפנים מודרניים.

דוגמאות הקוד במסמך זה משתמשות בכוונה בנתונים עסקיים יפניים (הצעות מחיר, חשבוניות): הן משמשות בו-זמנית כהדגמה חיה של יכולות עימוד ה-CJK של המנוע.

```bash
npm install tsreport-core
```

קובץ README זה מלא בדוגמאות שאפשר להעתיק ולהריץ כפי שהן, והוא מכסה הכול — מיצירת ה-PDF הראשון שלכם ועד כל 16 רכיבי הדוח, כתיבה אנכית, עימוד רב-לשוני, הטמעת גופנים והמרת טקסט לקווי מתאר, ותצוגה מקדימה בדפדפן. אם כלי דוחות חדשים לכם, התחילו ב**יסודות פריסת דוחות** כדי לקבל תחושה של המושגים, ואז בנו את ה-PDF הראשון שלכם עם המדריך.

## עימוד נכון של מערכות הכתב של העולם, במנוע אחד

דוח רב-לשוני אינו יכול להיות מוצג נכון פשוט על ידי כתיבת מחרוזות ישירות לתוך PDF. בחירת גליפים, מדידת רוחבי תווים, מיקום, שבירת שורות, כתיבה אנכית והטמעת גופנים לתוך ה-PDF — רק כאשר כל שרשרת העיבוד הזו משתלבת יחד מתקבל העמוד שציפיתם לו.

‎`tsreport-core` לוקח על עצמו את כל הזרימה הזו, מניתוח הגופן ועד יצירת ה-PDF.

- **יפנית, סינית וקוריאנית** — סינית מפושטת ומסורתית, האנגול, טיפול בסימני פיסוק וגליפים לכתיבה אנכית — כולם מעומדים נכון על בסיס נתוני Unicode ו-OpenType
- **הכתב הערבי ועימוד מימין לשמאל (RTL)** — עיצוב גליפים תלוי-הקשר, חיבור אותיות וליגטורות (מספר תווים המתמזגים לצורת גליף אחת), ועיבוד דו-כיווני של Unicode (בקרת סדר כאשר טקסט מימין-לשמאל מעורבב עם ספרות ואותיות לטיניות) — כולם מטופלים באותו צינור פריסה כמו כל כתב אחר
- **מערכות כתב מורכבות** — החלפת גליפים ומיקומם על פי כללי העימוד המובנים בגופן (OpenType Layout), תווים מצטרפים, וריאנטים של גליפים (עיצובים חלופיים של אותו תו) ותכונות עימוד לכל שפה — כולם נתמכים
- **כתיבה אנכית** — טיפול ב-`vertical-rl` / ‎`vertical-lr`, גליפים לכתיבה אנכית, מטריקות אנכיות (נתוני ממדים כגון רוחבי התקדמות ייחודיים לטקסט אנכי) וסיבוב תווים
- **הטמעת תת-קבוצת גופן אוטומטית** — רק הגליפים שנעשה בהם שימוש בפועל (נתוני הצורה לכל תו השמורים בגופן) מוטמעים ב-PDF, כך שהמסמך נראה אותו דבר גם במחשבים שבהם הגופן אינו מותקן
- **המרת טקסט לקווי מתאר** — לכל רכיב בנפרד, ניתן לפלוט טקסט כנתיבים וקטוריים שאינם תלויים בגופן
- **הפניות לגופני מערכת** — לתהליכי עבודה המסתמכים על הגופנים של הצופה, ניתן גם להפיק קובצי PDF קלים ללא גופנים מוטמעים
- **זיהוי טקסט משובש לפני שהוא קורה** — ‎`checkGlyphCoverage()`‎ מסמן תווים החסרים בגופן, לפי עמוד ולפי תו, עוד לפני הפלט

ועימוד הטקסט הזה פועל כיחידה אחת עם מנוע פריסה שנבנה במיוחד עבור דוחות — כי היכולת לסדר תווים נכון והיכולת לעמד עמודים נכון אינן ניתנות להפרדה.

- **פריסה המגיבה לכמות הטקסט** — שורות נמתחות עם כמות הטקסט (`stretchWithOverflow`) וגובהי הרצועות מתכווננים אוטומטית. שמות מוצרים ארוכים לעולם אינם נקטעים
- **מעברי עמוד אוטומטיים המונעים על ידי כמות הנתונים** — כאשר שורות הפירוט גולשות, המנוע פותח עמוד חדש ופולט מחדש את הכותרת העליונה ואת שורת הכותרות אוטומטית. סיכומי ביניים לכל קבוצה ומעברי עמוד אינם דורשים יותר מהצהרה
- **פריסה מקוננת** — אפילו דוחות מורכבים המשלבים טבלאות, טבלאות מוצלבות ותת-דוחות ממוקמים באופן עקבי על ידי אותו מנוע פריסה
- **WYSIWYG (תצוגה מקדימה = הדפסה)** — רכיבים מקובעים בדיוק בקואורדינטות ה-pt שציינתם, והתצוגה המקדימה ב-Canvas/SVG חולקת תוצאת פריסה זהה עם פלט ה-PDF. מה שאתם רואים על המסך הוא מה שתקבלו על הנייר

## למה tsreport-core

tsreport-core צמח משלוש נקודות מוצא.

**ל-TypeScript אין פתרון דוחות רציני.** הפקת הצעות מחיר וחשבוניות היא צורך עסקי בסיסי, ובכל זאת באקוסיסטם של TypeScript/Node.js — שיש בו ספריות לציור PDF ברמה נמוכה — לא היה דבר שראוי להיקרא "מנוע דוחות": פריסת רצועות, מעברי עמוד אוטומטיים, צבירה (aggregation) ונאמנות תצוגה-מקדימה-להדפסה בחבילה אחת. רצינו לשים סוף לנוהג של גרירת סביבת ריצה של שפה אחרת או מוצר שרת חיצוני רק בשביל דוחות.

**הפקת דוחות היא יכולת יסוד, וכולם צריכים להיות מסוגלים להשתמש בה בחינם.** פלט דוחות אינו פיצ'ר פרימיום השמור למוצרים יקרים ספורים; הוא חלק מהתשתית של כל מערכת עסקית. ללא רישיונות מסחריים לרכישה וללא תשלום לפי שימוש, כולם — מכלים אישיים ועד מוצרים מסחריים — צריכים להיות מסוגלים להשתמש באותו מנוע כפי שהוא. tsreport-core מפרסם את כל יכולותיו תחת רישיון כפול MIT OR Apache-2.0 כהתגלמות של אמונה זו.

**מעט פתרונות מתמודדים חזיתית עם תמיכה רב-לשונית — כתבים אסייתיים, הכתב הערבי ומעבר לכך.** רוב כלי הדוחות וה-PDF מתוכננים סביב טקסט לטיני, ומתייחסים לעימוד יפני, סיני וקוריאני או לכתב הערבי מימין-לשמאל כאל מחשבה שלאחר מעשה. עבור tsreport-core, ‏"עימוד נכון של מערכות הכתב של העולם, במנוע אחד" היה יעד תכנון מהיום הראשון, עם מימוש עצמי של הכול — מניתוח גופנים ועד עימוד והטמעה ב-PDF.

מניעים אלה מתגבשים לשלוש חוזקות.

### ממנוע הפריסה ועד יצירת ה-PDF, הכול שלם בחבילה אחת

כאשר עמודים מורכבים מתבנית ונתונים, התוצאה נלכדת במודל רינדור יחיד בשם `RenderDocument`. אותו מודל עצמו ניתן לרינדור ל-PDF, ל-Canvas או ל-SVG, כך שאין צורך לתחזק לוגיקת פריסה כפולה לתצוגה מקדימה על המסך ולהדפסה — ה-PDF נראה בדיוק כמו מה שראיתם על המסך. אין צורך לחווט יחד מנוע דוחות עם פריסת רצועות וספריית PDF.

### TypeScript טהור עם אפס תלויות בזמן ריצה

ניתוח גופנים, עימוד טקסט, יצירת PDF, דחיסת DEFLATE, הצפנה, פענוח PNG ויצירת ברקודים — כולם ממומשים ב-TypeScript טהור. ללא מודולים נייטיביים וללא תהליכים חיצוניים, הוא מתנהג באופן זהה בכל סביבה, וביקורת הקוד שרץ במהלך יצירת דוח משמעה קריאה של חבילה אחת זו בלבד.

### כל מה שדוח צריך, מובנה

- פריסת רצועות עם title, page header, detail, group, summary ועוד
- טבלאות, טבלאות מוצלבות, תת-דוחות, משתנים, ביטויים, מעברי עמוד, תוכן עניינים, מיזוג של מספר דוחות
- ייבוא קובצי PDF קיימים — המרת עמודי PDF לרכיבי דוח (`ElementDef`), סגנונות, תמונות ומידע על גופנים
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, מעברי צבע (gradients), חיתוך (clipping), שקיפות, עימוד מתמטי, תמונות
- הצפנת PDF, ‏PDF/A-1b, 2b ו-3b (תקנים בינלאומיים לארכוב לטווח ארוך), PDF/X-1a (תקן בינלאומי להגשה לדפוס), סימניות, קישורים, טפסים, הערות (annotations)
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, גופנים משתנים (variable fonts — גופנים שצירי המשקל, הרוחב ועוד משתנים בהם ברציפות) וגופני צבע

## יסודות פריסת דוחות

לקוראים שמנועי דוחות חדשים להם, פרק זה עובר על מושגי היסוד לפי הסדר.

### נקודת המוצא: דוח נבנה מ"תבנית" ועוד "נתונים"

ב-tsreport-core, דוח נבנה משני חלקים: **תבנית** (הגדרת הפריסה) ו**נתונים** (JSON).

התבנית אינה מכילה ערכים ממשיים. היא מגדירה רק את המסגרות — "שם הפריט נכנס כאן; הסכום שם, ברוחב הזה ובפורמט הזה" — והפניות ל**איזה שדה נתונים להציג** בכל אחת מהן (נכתב כ-`field.item`, כלומר השדה `item` של הנתונים).

הערכים הממשיים מועברים כנתוני JSON. כל איבר במערך `rows` הוא שורת פירוט אחת.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

כאשר הדוח נוצר, המנוע עובר על `rows` מלמעלה למטה ופולט את פריסת הפירוט פעם אחת לכל שורה. בדוגמה לעיל מודפסות שלוש שורות פירוט, ו-`field.item` נפתר בתורו ל-りんご, ‏みかん ו-ぶどう. אם הנתונים גדלים ל-10,000 שורות, הדוח נעשה באורך 10,000 שורות בלי לשנות ולו תו אחד בתבנית. חלוקת העבודה הזו — הפריסה קבועה, מספר השורות עוקב אחר הנתונים — היא נקודת הפתיחה של כל מנוע דוחות.

### עמוד הוא ערימה של "רצועות"

בצד התבנית, אתם מעצבים את העמוד כערימה של פסים אופקיים הנקראים **רצועות** (bands). במקום לחשב קואורדינטות Y בעצמכם ולמקם רכיבים על העמוד, אתם מצהירים רק "איזו רצועה מכילה מה", והמנוע מרכיב את העמודים אוטומטית בהתאם למספר שורות הנתונים. לעמוד אחד יש את המבנה הבא.

```text
┌──────────────────────────┐
│ title                    │ ← פעם אחת בתחילת הדוח (כותרת, נמען, ...)
├──────────────────────────┤
│ pageHeader               │ ← בראש כל עמוד (שם החברה, תאריך ההנפקה, ...)
├──────────────────────────┤
│ columnHeader             │ ← שורת הכותרות של שורות הפירוט (פריט, כמות, סכום, ...)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ פעם אחת לכל שורה של rows,
│ details                  │ │ חוזר כמספר השורות הקיימות
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← סוגר את שורות הפירוט (לכל עמוד/טור)
├──────────────────────────┤
│ pageFooter               │ ← בתחתית כל עמוד (מספרי עמודים, ...)
└──────────────────────────┘
```

בעמוד האחרון, אחרי ה-`details` האחרון, ‏`summary` (סכומים כוללים לדוח כולו וכדומה) נפלט בדיוק פעם אחת. מעבר לאלה קיימים `background`, המונח מתחת לכל עמוד; `lastPageFooter`, המשמש רק בעמוד האחרון; ו-`noData`, המופיע רק כאשר לנתונים אפס שורות — בסך הכול ניתן להגדיר ב-`bands` עשרה סוגי רצועות.

| רצועה | מתי היא נפלטת | שימוש אופייני |
| --- | --- | --- |
| `background` | רקע של כל עמוד | סימני מים, מסגרות דקורטיביות |
| `title` | פעם אחת בתחילת הדוח | כותרת, נמען |
| `pageHeader` | בראש כל עמוד | שם החברה, תאריך ההנפקה |
| `columnHeader` | לפני שורות הפירוט (לכל עמוד/טור) | שורת הכותרות של הפירוט |
| `details` | פעם אחת לכל שורת נתונים (`rows`) | שורות פירוט |
| `columnFooter` | אחרי שורות הפירוט (לכל עמוד/טור) | אזור סיכומי ביניים |
| `pageFooter` | בתחתית כל עמוד | מספרי עמודים |
| `lastPageFooter` | בתחתית העמוד האחרון (מחליף את `pageFooter` כאשר הוא מוגדר) | הערות סיום |
| `summary` | פעם אחת אחרי כל שורות הפירוט | סכום כולל, הערות |
| `noData` | כאשר לנתונים אפס שורות | "אין נתונים תואמים" |

אם תגדירו בנוסף `groups`, כותרות עליונות ותחתונות של קבוצה מוכנסות אוטומטית בכל מקום שבו מפתח הקבוצה משתנה, מה שנותן לכם פריסות כמו "סיכום ביניים לכל מחלקה, ואז פתיחת עמוד חדש."

אפשר גם לציין `columns` בתבנית (`count` = מספר הטורים, `spacing` = הרווח בין הטורים ב-pt) כדי להזרים את אזור הפירוט למספר **טורים** אנכיים, בסגנון עיתון. ברירת המחדל היא טור אחד, ובמקרה זה כל דבר שמתואר במסמך זה כ"לכל טור" משמעו זהה ל"לכל עמוד". המעבר לטור הבא מכונה "מעבר טור".

### מעברי עמוד מתרחשים אוטומטית

כאשר שורות הפירוט כבר אינן נכנסות בעמוד, המנוע סוגר אוטומטית את העמוד (ופולט `pageFooter`), פותח את הבא, פולט שוב `pageHeader` ו-`columnHeader`, ואז ממשיך להזרים את שורות הפירוט הנותרות. לעולם אינכם צריכים לספור שורות או לחשב את הגובה שנותר בעמוד.

רק כאשר תרצו שליטה, תושיטו יד לאמצעים הבאים.

- הרכיב `break` — כפיית מעבר עמוד או מעבר טור בכל מיקום
- ‏`startNewPage` של רצועה — הרצועה תמיד תתחיל בעמוד חדש
- ‏`splitType` של רצועה — כאשר אין מספיק גובה, בחירה אם הרצועה רשאית להתפצל בין עמודים באמצעה (`stretch`) או חייבת לעבור לעמוד הבא בשלמותה (`prevent`)

### תת-דוח = דוח נוסף המוטמע בתוך דוח

הרכיב `subreport` מטמיע קובץ `.report` נפרד שלם בתוך הפריסה של דוח האב. "הדפס רשימת הזמנות, ובתוך כל הזמנה הדפס את שורותיה כטבלה" — זהו המנגנון לפריסת **נתונים מקוננים** כאלה.

נניח שכל שורה ב-`rows` של האב (הזמנה אחת) נושאת מערך `items` של שורות פריטים.

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

מקמו רכיב `subreport` ברצועת ה-`details` של האב והעבירו את "ה-`items` של ההזמנה הזו" דרך `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

‎`templateExpression` הוא, כפי ששמו מרמז, ביטוי. כדי להעביר שם קובץ קבוע, עטפו אותו ב-`'...'` כליטרל מחרוזת בתוך הביטוי (אפשר גם להחליף אותו דינמית עם ביטוי כגון `"field.templatePath"`).

התת-דוח **רץ אז פעם אחת עבור כל שורת פירוט של האב**, וה-`items` המועברים אליו מטופלים כ-`rows` של התת-דוח עצמו. התת-דוח (`order-items.report`) הוא תבנית עצמאית בזכות עצמה: יש לה הגדרות רצועות משלה והיא מפנה לכל שורת פריט דרך `field.name` ו-`field.qty`. על העמוד זה נפרש כך.

```text
┌──────────────────────────────┐
│ details                      │ ← ‏rows של האב, שורה 1 (הזמנה A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← מקבל את ה-items של ההזמנה הזו (2 שורות)
│   │   details              │ │ ← ‏items שורה 1 (りんご 10)
│   │   details              │ │ ← ‏items שורה 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← ‏rows של האב, שורה 2 (הזמנה A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← מקבל את ה-items של ההזמנה הזו (שורה 1)
│   │   details              │ │ ← ‏items שורה 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

טבלת השורות שבתוך חשבונית, בלוק פירוט החוזר לכל לקוח — "דוחות קטנים בתוך דוח" ניתנים לחילוץ כקומפוננטות ולשימוש חוזר. אפשר גם להוריד פרמטרים (מחרוזות כותרת וכדומה) מן האב. הפרק המאוחר יותר **דוגמאות עובדות לכל רכיב** מכיל דוגמה שלמה ומוכנה להרצה של בדיוק המבנה הזה (רכיב האב בתוספת התבנית של צד התת-דוח).

## יצירת PDF מקובץ `.report` ונתוני JSON

קובץ `.report` הוא תבנית דוח: ‏`ReportTemplate` הכתוב כ-JSON. מכיוון שזהו JSON רגיל, אפשר לעקוב אחר הבדלים (diffs) ב-Git ולייצר אותו מכל שפה או כלי.

התצורה המינימלית היא שלושת הקבצים הבאים.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

שני שמות קובצי הגופן מניחים את המשקלים Regular / Bold של גופן יפני (למשל Noto Sans JP). החליפו בגופנים שיש בידיכם. טיפול בשפות מרובות בדוח יחיד מכוסה בהמשך בפרק **בניית דוחות רב-לשוניים**.

### 1. כתיבת התבנית, `quotation.report`

קואורדינטות, ממדים, שוליים וגודלי גופן — כולם ב-**pt (נקודות, ‏1pt = 1/72 אינץ' ≈ 0.353 מ"מ)**, יחידת המידה התקנית של PDF. ‏`"size": "A4"` מטופל כ-595 × 842pt (ממדי ה-ISO של ‏210×297 מ"מ מומרים ל-pt ומעוגלים לשלמים), והשוליים של 36pt בדוגמה זו הם כ-12.7 מ"מ.

עוד הנחת יסוד אחת: ‏`fontFamily` שב-`styles` אינו שם של קובץ גופן אלא **מפתח (שם לוגי)** שתרשמו מאוחר יותר ב-`fontMap` וב-`fonts` שבקוד זמן הריצה. השימוש באותם שמות בתבנית ובקוד (`jp` ו-`jpBold` בדוגמה זו) הוא מה שקושר ביניהם.

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

ה-`pattern` שבשימוש בשורות הפירוט הוא מפרט פורמט למספרים/תאריכים (`#,##0` = מפרידי אלפים, ‏`¥#,##0` = מפרידי אלפים עם סימן ין; לפרטים ראו "עיצוב מספרים ותאריכים" בהמשך המסמך).

### 2. הכנת הנתונים, `quotation.test-data.json`

כל שורה ב-`rows` נקשרת ל-`field.*` ברצועת הפירוט, ו-`parameters` נקשר ל-`param.*` עבור הדוח כולו.

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

הקשירות ממופות כדלקמן.

| JSON | ביטוי ב-`.report` | מטרה |
| --- | --- | --- |
| `rows[n].item` | `field.item` | שורת הפירוט הנוכחית |
| `parameters.title` | `param.title` | ארגומנט ברמת הדוח כולו |
| המשתנה `grandTotal` | `vars.grandTotal` | משתני דוח לסכומים, ספירות וכדומה |
| הקשר עמוד | `PAGE_NUMBER` / `TOTAL_PAGES` | מספר עמוד, מספר עמודים כולל |

### 3. טעינת ה-`.report` ויצירת ה-PDF

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
  // אובייקטי Buffer של Node.js עשויים לחלוק מאגר זיכרון גדול יותר; העבירו ל-Font.load
  // ‏ArrayBuffer חתוך בדיוק לבתים של הקובץ הזה
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

אותם גופנים נרשמים פעמיים, גם ב-`fontMap` וגם ב-`fonts`, כי לשניים תפקידים שונים: ‏`fontMap` משמש למדידת רוחבי תווים בזמן הפריסה (`TextMeasurer`), ואילו `fonts` משמש להטמעת גופנים בזמן יצירת ה-PDF. רשמו את אותו גופן בשניהם, תחת אותם שמות מפתח כמו ה-`fontFamily` של התבנית.

‎`createReportFromFile()`‎ פותר נתיבים יחסיים של תמונות ותת-דוחות ביחס לתיקייה של קובץ ה-`.report` הראשי. אם תציינו `workingDirectory`, אותה תיקייה תהפוך לבסיס במקום זאת. כדי להגביל מה מותר לקרוא, הכריזו במפורש על השורש המותר ב-`resources.fileRoot`; הפניות יחסיות החורגות מן השורש, וקישורים סימבוליים המצביעים אל מחוצה לו, נדחים.

## הגדרת תבניות ישירות ב-TypeScript

במקום להשתמש בקובץ `.report`, אפשר לכתוב את התבנית כאובייקט TypeScript. עם בדיקת טיפוסים והשלמה בהישג יד, זה מתאים ליצירת תבניות מתוך קוד. התוכן הוא אותה הצעת מחיר כמו במדריך. קואורדינטות וממדים ב-pt.

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

### איתור רכיבים לפי ID ושינויָם לפני הרינדור

תנו לרכיב `id` שרירותי ותוכלו לאחזר אותו עם `findElementById()`, לא משנה כמה עמוק הוא יושב בתוך רצועות או מסגרות. הערך המוחזר אינו העתק אלא הרכיב שבתוך `template` עצמו, כך שכל שינוי שנעשה לפני `createReport()` משתקף בפריסה וברינדור.

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

‎`findElementById()`‎ מחפש ברצועות רגילות, ברצועות פירוט, בכותרות עליונות/תחתונות של קבוצות, במסגרות, במסכות רכות (soft masks) ובתאי טבלה — בסריקת עומק-תחילה. כאשר אותו ID מופיע יותר מפעם אחת, הוא מחזיר את הרכיב הראשון בסדר החיפוש, ולכן שמרו על כל ID שבכוונתכם לשנות כייחודי בתוך התבנית. הרכיבים במערך המוחזר על ידי `getElementChildren()` הם אף הם הפניות אל תוך התבנית המקורית.

> קובצי גופן אינם מצורפים לחבילה. בחרו גופנים שרישיונם מתאים לתרחיש השימוש, לשיטת ההפצה ולהרשאות ההטמעה שלכם. סגנון אחד יכול לנקוב בגופן אחד בלבד. כדי לערבב תווים של מספר שפות בתוך רכיב יחיד, דרוש גופן Pan-CJK המכסה את כולן בקובץ אחד (גופן המאגד תווים יפניים, סיניים וקוריאניים; למשל Source Han Sans, ‏Noto Sans CJK). כדי להשתמש בגופן נפרד לכל שפה, פצלו רכיבים לפי שפה והחליפו סגנונות, כמו בפרק הבא, "בניית דוחות רב-לשוניים".

## בניית דוחות רב-לשוניים

כל סגנון יכול לנקוב בגופן אחד בדיוק, ואין נסיגה (fallback) אוטומטית בין גופנים. דפוס הבסיס לדוח רב-לשוני הוא לפיכך **לטעון גופן לכל שפה ולהחיל את הסגנון של כל שפה על הרכיבים של אותה שפה**.

הקטע הבא לקוח מהצעת מחיר המציגה יפנית וסינית מפושטת זו לצד זו. ראשית, טענו גופן לכל שפה.

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

בתבנית, החילו את הסגנון `ja` על הניסוח היפני ואת הסגנון `zh` על הניסוח הסיני, תוך פיצול הרכיבים לפי שפה.

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

הנתונים נושאים אף הם שדה לכל שפה.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

היוצא מן הכלל הוא **שדה יחיד שאין לדעת את שפתו עד זמן הריצה**, כגון תיבת הערות חופשית. מכיוון שאי אפשר לפצל שדה כזה לרכיבים לפי שפה, הפתרון המעשי הוא להקצות — לסגנון הזה בלבד — גופן Pan-CJK המכסה מערכות כתב רבות בקובץ אחד (Source Han Sans, ‏Noto Sans CJK וכדומה). כך או כך, ‏`checkGlyphCoverage()`‎ מזהה כל פער בכיסוי הגופן לפני הפלט.

## בחירת מצב פלט גופן לכל רכיב טקסט

אפילו בתוך דוח אחד, אפשר לציין את מצב הפלט לכל `staticText` או `textField`: טקסט מוטמע וניתן לחיפוש בגוף המסמך, קווי מתאר בלוגו, הפניות לגופני מערכת בטקסט קבוע.

| מצב | איך מציינים | המצב ב-PDF | מתאים ל- |
| --- | --- | --- | --- |
| הטמעת תת-קבוצה | `pdfFontMode: 'embedded'` (ברירת מחדל) | מטמיע את הגליפים שבשימוש בתוספת תוכנית הגופן. הטקסט ניתן לבחירה ולחיפוש | הפצה, ארכוב לטווח ארוך, הדפסה, דוחות רב-לשוניים |
| המרה לקווי מתאר | `outlineText: true` | ממיר את צורות הגליפים לנתיבים וקטוריים. אינו נושא מידע על הגופן | לוגואים, גרפיקה מוכנה לדפוס — טקסט שצורותיו חייבות להיות מוקפאות במדויק |
| הפניה לגופן מערכת | `pdfFontMode: 'reference'` | אינו מטמיע גופן; רושם רק את שם הגופן והתווים | קובצי PDF קלים להפצה פנימית כאשר סביבת הגופנים בשליטה |

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

הטמעת תת-קבוצה היא המצב המומלץ לשימור צורות הגליפים בלי תלות בסביבת היעד. הפניות לגופני מערכת דורשות גופן תואם בכל מקום שבו ה-PDF נפתח, והמראה עשוי להשתנות מסביבה לסביבה. טקסט שהומר לקווי מתאר אינו ניתן לבחירה או לחיפוש כטקסט רגיל.

## כתיבה אנכית

פשוט ציינו `writingMode` על סגנון, והטקסט מעומד אנכית תוך שימוש בגליפים לכתיבה אנכית ובנתוני ממדים ייעודיים לאנכי (מטריקות אנכיות — רוחבי התקדמות וכדומה). ‏`vertical-rl` מקדם שורות מימין לשמאל; ‏`vertical-lr` מקדם אותן משמאל לימין.

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

## תצוגה מקדימה של בדיוק אותו דוח בדפדפן

ה-`RenderDocument` שבניתם עבור PDF ניתן לרינדור ישירות גם ל-Canvas. התצוגה המקדימה וההדפסה חולקות את אותה תוצאת פריסה, ולכן "המסך והנייר נראים שונה" פשוט לא יכול לקרות. יחד עם הפריסה הקבועה מבוססת ה-pt, זהו הבסיס לחוויית תצוגה מקדימה ועריכה בסגנון WYSIWYG (הטמעת גופנים היא ברירת המחדל; רק מצב ההפניה לגופן מערכת תלוי בסביבת הצפייה לצורך מראהו). קריאה אחת ל-`renderPage()` מציירת את העמוד, כולל הכנת העמוד וסגירתו.

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
  scale: 1.5, // קנה מידה לתצוגה: ‏1.0 מצייר 1pt כ-1px
  devicePixelRatio: window.devicePixelRatio, // שומר על חדות הטקסט והקווים בתצוגות High-DPI
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

אם אתם בונים ממשק תצוגה מקדימה ב-React, זמינה גם החבילה `tsreport-react`.

## שימוש במנוע הגופנים בפני עצמו

גם בלי לבנות דוח, אפשר להשתמש בכל יכולת בנפרד: ניתוח גופנים, ‏shaping (המרת מחרוזת לרצף ולמיקומים של הגליפים המצוירים בפועל), מדידת טקסט ויצירת תת-קבוצות.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: רוחב המחרוזת ב-pt בגודל 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // מזהי גליפים ומיקומים אחרי shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: נתוני נתיב בזייה

console.log(measurement.width, shaped, glyph.outline)
```

## המרת PDF קיים לרכיבי דוח (ייבוא PDF)

‎`importPdfPage()`‎ מנתח עמוד של PDF קיים וממיר אותו למערך של רכיבי דוח של tsreport-core ‏(`ElementDef`). זה אינו סתם צופה (viewer): טקסט נכנס כ-`staticText`, תמונות כ-`image`, צורות כ-`path` — קומפוננטות שאפשר לערוך ולסדר מחדש ישירות במנוע הדוחות הזה.

קחו את ה-PDF של טופס שהרצתם עד כה על נייר, או PDF שהופק על ידי מערכת אחרת, והשתמשו בו כבסיס — בהוספת שדות מיזוג נתונים, בסידור מחדש של הפריסה. זוהי נקודת הכניסה ל**הפיכת נכסי דוחות קיימים לתבניות**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: מערך של רכיבי דוח (staticText / image / path, ...)
// page.styles:   הגדרות סגנונות טקסט שהרכיבים מפנים אליהן
// page.images:   נתוני תמונה שהרכיבים מפנים אליהם
// page.fonts:    מידע על הגופנים שהופנו אליהם
console.log(pageCount, page.width, page.height, page.elements.length)
```

את ה-`elements` וה-`styles` המיובאים אפשר למקם ישירות ברצועות של תבנית. סיסמאות לקובצי PDF מוצפנים, ייבוא הערות (annotations), המרת טקסט מיובא לקווי מתאר ועוד — נשלטים דרך `PdfImportOptions`.
## שליטה מלאה בביטויים

כל דבר "דינמי" בדוח נכתב כביטוי: התוכן ש-`textField` מדפיס, תנאי ההדפסה ב-`printWhenExpression`, נתוני ברקוד, נתיבי תמונות, נתונים המועברים לתת-דוח — כל פרופרטי שהטיפוס שלו הוא `Expression` מקבל את אותה שפת ביטויים.

ביטויים באים בשתי צורות.

- **ביטויי מחרוזת** — מחרוזות כגון `"field.price * field.quantity"`. הם תת-קבוצה בטוחה של JavaScript המפורשת על ידי מפרש ייעודי; ‏`eval` ו-`new Function` לעולם אינם בשימוש. התבניות נשארות ניתנות לשמירה כ-JSON (קובצי `.report`)
- **ביטויי callback** — פונקציות TypeScript בצורה `(field, vars, param, report) => …`. אתם מקבלים את מלוא כוחה של השפה, אך התבנית אינה ניתנת עוד לשמירה כ-JSON (זה מניח שאתם מחזיקים תבניות ב-TypeScript)

אנו ממליצים לבדוק תחילה כמה רחוק ביטויי מחרוזת מביאים אתכם, ולעבור ל-callbacks רק כשהם אינם מספיקים.

### ערכים שאפשר להפנות אליהם בביטויים

| שם | תיאור |
| --- | --- |
| `field.*` | שורת הנתונים הנוכחית. גישה מקוננת כגון `field.customer.name` נתמכת |
| `vars.*` | משתנים (ערכי צבירה המוגדרים ב-`variables`, מתואר בהמשך). ‏`var.*` פועל באותו אופן |
| `param.*` | ערכים ברמת הדוח כולו: ערכים שהועברו דרך `parameters` של מקור הנתונים וערכי ה-`defaultValue` של ה-`parameters` בתבנית. בתת-דוח, גם פרמטרים שהועברו מהאב מופיעים כאן |
| `PAGE_NUMBER` | מספר העמוד הנוכחי (מתחיל ב-1) |
| `COLUMN_NUMBER` | מספר הטור הנוכחי (מתחיל ב-1) |
| `REPORT_COUNT` | מספר שורות הנתונים שעובדו |
| `TOTAL_PAGES` | מספר העמודים הכולל. **בהפניה כפי-שהיא הוא מניב את "מספר העמודים עד כה"**, לכן כדי להדפיס את מספר העמודים הכולל הסופי שלבו אותו עם `evaluationTime: 'report'` או `'auto'` (מתואר בהמשך) |

הפניה לשדה שאינו קיים אינה זורקת שגיאה; היא מוערכת ל-`undefined` (אפילו כאשר חלק ביניים של `field.a.b` הוא `null`, מוחזר `null` בבטחה).

### תחביר זמין בביטויי מחרוזת

| קטגוריה | זמין |
| --- | --- |
| ליטרלים | מספרים (`1200`, ‏`0.5`), מחרוזות (`'見積'` או `"見積"`, עם escapes כגון `\n`), ‏`true` / `false` / `null` / `undefined` |
| ליטרלי תבנית | `` `合計 ${vars.total} 円` `` — ביטוי מלא רשאי להופיע בתוך `${}` |
| אריתמטיקה | `+` (חיבור מספרי ושרשור מחרוזות), `-`, `*`, `/` |
| השוואה | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| לוגיים | `&&`, `\|\|`, `!` (הערכת קצר, כמו ב-JavaScript) |
| איחוד null (nullish coalescing) | `??` — מחזיר את צד ימין כאשר צד שמאל הוא null/undefined |
| תנאי (טרנרי) | `condition ? valueIfTrue : valueIfFalse` |
| אחר | `-` / `+` אונריים, סוגריים `( )`, גישה לאיברים בסימון נקודה (שמות פרופרטי יכולים להיות ביפנית: `field.顧客名`) |
| פונקציות מובנות | `format(value, pattern)` = עיצוב (מתואר בהמשך) / `round(value, digits?)` = עיגול חצי-כלפי-מעלה / `roundUp`, ‏`roundDown`, ‏`roundHalfEven` (עיגול בנקאי), `ceil`, ‏`floor`, ‏`trunc` (בכל אחת, הארגומנט השני הוא מספר הספרות אחרי הנקודה, ‏0 כשמושמט) / `now()` = הזמן הנוכחי |

**לא זמינים**: ‏`==` / `!=` (השתמשו ב-`===` / `!==`), ‏`%` ו-`**`, סימון סוגריים מרובעים (`field['a-b']`) ואינדוקס מערכים, קריאות למתודות (`field.name.toUpperCase()` נכשל בזמן ההערכה — הפונקציות היחידות הניתנות לקריאה הן המובנות שלעיל), השמה, הגדרת פונקציות, `new`, שרשור אופציונלי (`?.` — ממילא מיותר, שכן ערכי null בדרך לעולם אינם זורקים שגיאה). כשאתם זקוקים לאחד מאלה, השתמשו בביטוי callback.

ההגבלות האלה קיימות למען הבטיחות. ביטויי מחרוזת מפורשים על ידי מפרש ייעודי ולעולם אינם מורצים כקוד, כך שתבנית שהתקבלה מבחוץ אינה יכולה להגניב קוד שרירותי.

### הדפסת תוצאה מחושבת

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

נתוני דוגמה:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

זה מדפיס `¥3,960`.

### בניית מחרוזות

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

ערכים המשובצים ב-`${}` של ליטרל תבנית עוברים המרה למחרוזת ושרשור. **null הופך למחרוזת `"null"`**, ולכן הוסיפו `?? ''` לערכים שעלולים להיות חסרים, כמו בדוגמה.

### החלפת תוכן על פי תנאי

השתמשו באופרטור הטרנרי כדי להחליף את מה שמודפס.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

כשאתם רוצים לשנות *אם* משהו מוצג ולא *מה* מוצג, השתמשו ב-`printWhenExpression` המשותף לכל הרכיבים (ראו "הדפסת רכיב רק כאשר תנאי מתקיים"). כדי להחליף עיצוב (צבע, הדגשה) על פי תנאי, ציינו ביטוי תנאי באותה צורה ב-`conditionalStyles` של הגדרת הסגנון.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### עיצוב מספרים ותאריכים — `format` ו-`pattern`

‎`textField` יכול לעצב את תוצאת הביטוי בזמן ההדפסה דרך הפרופרטי `pattern`. כדי לעצב חלק מערך בתוך ביטוי, השתמשו בפונקציה המובנית `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

תבניות מספרים משלבות `#` (הצג את הספרה אם קיימת), `0` (ריפוד באפסים) ו-`,` (מפריד אלפים), ויכולות לשאת קידומת וסיומת. העיגול הוא חצי-כלפי-מעלה.

| תבנית | קלט | פלט |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

אסימוני תבנית התאריך הם `yyyy` (שנה בת 4 ספרות), `MM` / `M` (חודש מרופד באפס / חודש), `dd` / `d` (יום מרופד באפס / יום), `HH` (שעה מרופדת באפס, שעון 24 שעות), `mm` (דקות) ו-`ss` (שניות). ערך null/undefined מפיק מחרוזת ריקה.

לפורמטים מעבר לאלה (תאריכי תקופות יפניות, שמות ימי השבוע, טיפול בספרות מטבע וכדומה), רשמו פונקציות TypeScript בעלות שם ב-`formatters` של התבנית וכתבו את השם ב-`pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// בצד הרכיב: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

‎`pattern` מחפש תחילה formatter רשום בשם הזה, ומפורש כפורמט מובנה אם לא נמצא כזה. ‏Formatters הם פונקציות, ולכן תבניות המשתמשות ביכולת זו מוחזקות ב-TypeScript ולא ב-JSON.

### הדפסת סכומים, ממוצעים וספירות — משתנים (`variables`)

צבירה החוצה שורות פירוט מוגדרת ב-`variables` של התבנית. בכל פעם ששורת נתונים מעובדת, משתנה מזין את תוצאת ה-`expression` שלו לתוך הצבירה שלו, וביטויים יכולים להפנות לערך הנוכחי כ-`vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

מקמו `textField` עם `"expression": "vars.pageTotal"` ברצועת `pageFooter` לסיכום ביניים של עמוד, ואחד עם `"expression": "vars.grandTotal"` ברצועת `summary` לסכום כולל.

**רשימת פרופרטי (כל רשומה ב-`variables`)**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם המשתנה, מופנה מביטויים כ-`vars.name` |
| `expression` | Expression | ✓ | מוערך עבור כל שורה; התוצאה מוזנת לצבירה |
| `calculation` | `'sum'` = סכום / `'average'` = ממוצע / `'count'` = ספירה / `'distinctCount'` = ספירת ערכים ייחודיים / `'min'` = מינימום / `'max'` = מקסימום / `'first'` = הערך הראשון / `'nothing'` = נדרס בכל שורה (הערך האחרון) | ✓ | שיטת הצבירה |
| `resetType` | `'report'` = המשך צבירה על פני הדוח כולו (ללא איפוס; ברירת מחדל) / `'page'` = איפוס לכל עמוד / `'column'` = איפוס לכל טור / `'group'` = איפוס לכל קבוצה הנקובה ב-`resetGroup` / `'none'` = לעולם אינו מתאפס, כמו `'report'`, אך תחת הערכה דחויה (`evaluationTime`) הערך נשאר קבוע כפי שהיה ברגע מיקום הרכיב (הוא אינו מוחלף מאוחר יותר בצבירה הסופית) |  | טווח האיפוס של הצבירה |
| `resetGroup` | string |  | שם קבוצת היעד כאשר `resetType: 'group'` |
| `incrementCondition` | Expression |  | כשמוגדר, שורות שתוצאת ההערכה שלהן היא falsy אינן מוזנות לצבירה (צבירה מותנית) |
| `initialValue` | Expression |  | ערך התחלתי באתחול ובכל איפוס |

עם `incrementCondition`, צבירה מותנית כגון "סכום רק קטגוריה מסוימת" נכנסת במשתנה אחד:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

כדי לצבור אצל האב תוצאות הרצה של תת-דוח, השתמשו ב-`returnValues` של הרכיב `subreport`, הכותב את משתני הילד בחזרה אל `vars.*` של האב (ראו את רשימת הפרופרטי של `subreport`).

### הדפסת מספרי עמודים ומספר העמודים הכולל

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

המפתח הוא `evaluationTime: 'auto'`. ביטויים מוערכים בדרך כלל ברגע שרכיב ממוקם, אך באותה נקודה מספר העמודים הכולל הסופי עדיין אינו ידוע. עם `'auto'`, הביטוי מנותח סטטית ו**כל הפניה מוערכת בתזמון הנכון שלה** — ‏`PAGE_NUMBER` כשהעמוד מסוכם, ‏`TOTAL_PAGES` כשהדוח מסתיים. מכיוון ש-`'auto'` צריך לנתח את הביטוי, הוא זמין רק לביטויי מחרוזת (ציונו על ביטוי callback זורק שגיאה).

### מעבר לביטויי מחרוזת — ביטויי callback

אם התבנית שלכם מוגדרת ב-TypeScript, אפשר לכתוב פונקציה ישירות בכל מקום שבו מתקבל `Expression`. היא מקבלת ארבעה ארגומנטים, ‏`(field, vars, param, report)`; דרך `report` אפשר להגיע לערכים מובנים כגון `PAGE_NUMBER`, לפונקציה `format` ול-`formatters` הרשומים.

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

קריאות למתודות, ביטויים רגולריים, פונקציות חיצוניות — כל מה שאפשר לכתוב ב-TypeScript זמין. ישנן שתי עלויות: התבנית אינה ניתנת עוד לשמירה או להעברה כ-JSON, ו-`evaluationTime: 'auto'` אינו זמין (ערכים מפורשים כגון `'report'` עדיין עובדים).

### מה קורה כשביטוי נכשל

- **שגיאות תחביר ומבנים אסורים** (קריאות למתודות וכדומה) זורקים `ExpressionLanguageError` עם מידע מיקום, המתפשט כפי שהוא אל הקורא של `createReport()`. הוא לעולם אינו נבלע לתוך תא ריק
- **הפניות לשדות או משתנים שאינם קיימים** אינן שגיאות; הן מוערכות ל-`undefined`. ב-`textField`, מודפסת מחרוזת ריקה כאשר `blankWhenNull: true` מוגדר; בלעדיו, מודפסת המחרוזת `null`
- כדי לאמת ביטויים שסופקו על ידי משתמש לפני ההרצה, ‏`validateExpressionSource(source)` מחזיר את תוצאת בדיקת התחביר (שגיאה, או `null`)

## דוגמאות עובדות לכל רכיב

הנה כל 16 הרכיבים ש-`ElementDef` מספק. כל רכיב מקבל `x`, ‏`y`, ‏`width` ו-`height` (ב-pt, ‏1pt = 1/72 אינץ') וממוקם בתוך ה-`elements` של רצועה או של `frame`.

| מה אתם רוצים לעשות | רכיב |
| --- | --- |
| הדפסת טקסט קבוע | `staticText` |
| הדפסת נתונים, משתנים או תוצאות ביטויים | `textField` |
| ציור קו | `line` |
| ציור מלבן או תיבה מעוגלת | `rectangle` |
| ציור עיגול או אליפסה | `ellipse` |
| ציור צורה וקטורית שרירותית | `path` |
| מיקום תמונה | `image` |
| קיבוץ מספר רכיבים בתוך מסגרת | `frame` |
| הדפסת טבלה | `table` |
| הדפסת טבלה מוצלבת | `crosstab` |
| הטמעת דוח אחד בתוך אחר | `subreport` |
| הדפסת ברקוד או קוד QR | `barcode` |
| הדפסת נוסחה מתמטית | `math` |
| הדפסת SVG | `svg` |
| יצירת טופס PDF הניתן למילוי | `formField` |
| כפיית מעבר עמוד או טור בכל מקום | `break` |
| הדפסת רכיב רק כאשר תנאי מתקיים | `printWhenExpression` (מאפיין משותף לכל הרכיבים) |

להלן, כל רכיב מקבל הגדרה אחת שאפשר לשים ישירות במערך `elements` של רצועה, בתוספת נתוני דוגמה לרכיבים המשתמשים בביטויים. בסוף הפרק של כל רכיב נמצאת רשימת הפרופרטי הייחודית לאותו רכיב. לפרופרטי המשותפים לכל הרכיבים (מיקום, צבעים, תנאי הדפסה וכדומה) ולפרופרטי הסגנון, ראו "רפרנס פרופרטי של רכיבים" בהמשך.

### הדפסת טקסט קבוע — `staticText`

מדפיס מחרוזת הכתובה בתבנית, בדיוק כפי שהיא. השתמשו בו לכותרות ולתוויות.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | סוג הרכיב |
| `text` | string | ✓ | המחרוזת הקבועה להדפסה |
| `actualText` | string |  | טקסט חלופי למקרה שהתווים הנראים שונים מהטקסט המתקבל בהעתקה ובחיפוש (PDF ‏/ActualText). משמש בעיקר את ייבוא ה-PDF כדי לשמר את ההגדרה של ה-PDF המקורי |
| `hyperlink` | HyperlinkDef |  | היפר-קישור (ראו **`HyperlinkDef`** בפרק הפרופרטי המשותפים) |
| `anchorName` | string |  | שם עוגן. נרשם כיעד לסימניות ולקישורים פנימיים במסמך (`hyperlink` מסוג `'localAnchor'`) |
| `bookmarkLevel` | number |  | רמת ההיררכיה (1 = הרמה העליונה, ‏1–6) לרישום הטקסט של רכיב זה בתוכן העניינים (סימניות) המוצג בסרגל הצד של צופה ה-PDF |

הערה: בנוסף, אפשר לציין את כל הפרופרטי המשותפים לרכיבים ואת כל פרופרטי `TextProperties`.

### הדפסת נתונים ותוצאות ביטויים — `textField`

מדפיס את תוצאת ההערכה של `expression`. הוא יכול להפנות ל-`field.*` (נתונים), ‏`vars.*` (משתנים), ‏`param.*` (פרמטרים), ‏`PAGE_NUMBER` ועוד, וליטרלי תבנית מאפשרים לבנות מחרוזות. לשפת הביטויים המלאה, ראו "שליטה מלאה בביטויים". השתמשו ב-`pattern` לעיצוב מספרים/תאריכים וב-`stretchWithOverflow` כדי לאפשר לגובה לגדול עם כמות הטקסט.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

נתוני דוגמה:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | סוג הרכיב |
| `expression` | Expression | ✓ | ביטוי המחזיר את הערך להדפסה |
| `pattern` | string |  | תבנית פורמט. ‏formatter מותאם הרשום על התבנית (שם מ-`formatters`) מקבל קדימות; אחרת הערך מעוצב עם ה-formatter המובנה |
| `blankWhenNull` | boolean |  | הדפסת מחרוזת ריקה כשתוצאת הביטוי היא null/undefined (בלעדיו, מודפסת המחרוזת `'null'`) |
| `stretchWithOverflow` | boolean |  | כשהתוכן אינו נכנס בתוך height, מתיחת גובה הרכיב כך שיתאים לתוכן |
| `evaluationTime` | `'now'` = הערכה מיידית במקום (ברירת מחדל) / `'band'` = הערכה כשהרצועה מסוכמת / `'column'` = הערכה בסוף הטור / `'page'` = הערכה בסוף העמוד / `'group'` = הערכה כשהקבוצה הנקובה ב-`evaluationGroup` נסגרת / `'report'` = הערכה בסוף הדוח (TOTAL_PAGES וכדומה סופיים) / `'auto'` = הערכת כל משתנה וערך מובנה שהביטוי מפנה אליהם בנפרד, כל אחד בתזמון האיפוס שלו (ביטויי מחרוזת בלבד; ביטויי callback זורקים שגיאה) |  | מתי הביטוי מוערך. עם כל ערך שאינו ברירת המחדל, השטח נשמר תחילה ריק בזמן המיקום ומתמלא ברגע שהערך מסוכם בתזמון המתאים. שימושים אופייניים: הצגת סכום קבוצה לפני הקבוצה (`'group'`), הדפסת מספר העמודים הכולל הסופי (`'report'`) |
| `evaluationGroup` | string |  | שם קבוצת היעד כאשר `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = שורות שאינן נכנסות אינן מצוירות (ברירת מחדל; זהה ל-`'truncate'` במימוש הנוכחי) / `'truncate'` = קטיעת טקסט שאינו נכנס שורה-שורה / `'ellipsisChar'` = קיצוץ השורה האחרונה בגבול תו והוספת `...` / `'ellipsisWord'` = קיצוץ השורה האחרונה בגבול מילה והוספת `...` |  | טיפול בטקסט שאינו נכנס בגובה כאשר `stretchWithOverflow` כבוי. ברירת מחדל: ‏`none` |
| `hyperlink` | HyperlinkDef |  | היפר-קישור (ראו **`HyperlinkDef`** בפרק הפרופרטי המשותפים) |
| `anchorName` | string |  | שם עוגן. נרשם כיעד לסימניות ולקישורים פנימיים במסמך (`hyperlink` מסוג `'localAnchor'`) |
| `bookmarkLevel` | number |  | רמת ההיררכיה (1 = הרמה העליונה, ‏1–6) לרישום הטקסט של רכיב זה בתוכן העניינים (סימניות) המוצג בסרגל הצד של צופה ה-PDF |

הערה: בנוסף, אפשר לציין את כל הפרופרטי המשותפים לרכיבים ואת כל פרופרטי `TextProperties`. ‏`isPrintRepeatedValues: false` מכובד על ידי רכיב זה (מדכא הדפסה של ערכים זהים עוקבים).

### ציור קו — `line`

הדוגמה כאן היא קו אופקי בגובה 0. ‏`lineStyle` מקבל `dashed` ואחרים מלבד `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | סוג הרכיב. הקטע מצויר מהפינה השמאלית-עליונה של הרכיב `(x, y)` אל הימנית-תחתונה `(x+width, y+height)` ‏(`height: 0` נותן קו אופקי, ‏`width: 0` קו אנכי, שניהם שונים מאפס — אלכסון) |
| `lineWidth` | number |  | עובי הקו (pt). ברירת מחדל: 1 |
| `lineStyle` | `'solid'` = רציף / `'dashed'` = מקווקו / `'dotted'` = מנוקד |  | סגנון הקו. ברירת מחדל: solid |
| `lineColor` | string |  | צבע הקו. ברירת מחדל: ה-`forecolor` של הרכיב, או `#000000` אם גם הוא חסר |

### ציור מלבן או תיבה מעוגלת — `rectangle`

‎`cornerRadii` מאפשר לעגל כל פינה בנפרד.

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

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | סוג הרכיב |
| `radius` | number |  | רדיוס פינה (pt, משותף לכל הפינות) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | רדיוס לכל פינה (pt) |
| `fill` | FillDef |  | מילוי (ראו **`FillDef`** בפרק הפרופרטי המשותפים). ברירת מחדל: ה-`backcolor` של הסגנון (כשהוא אינו `transparent`) |
| `stroke` | string |  | צבע מסגרת. ברירת מחדל: ה-`forecolor` של הסגנון |
| `strokeWidth` | number |  | עובי מסגרת (pt). ברירת מחדל: 1 |

### ציור עיגול או אליפסה — `ellipse`

מצייר אליפסה החסומה ברוחב ובגובה של הרכיב.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | סוג הרכיב. מצייר את האליפסה החסומה בתיבת התוחם של הרכיב (מרכז `(x+width/2, y+height/2)`, רדיוסים `width/2` × `height/2`) |
| `fill` | FillDef |  | מילוי (ראו **`FillDef`** בפרק הפרופרטי המשותפים). ללא מילוי כשמושמט |
| `stroke` | string |  | צבע מסגרת. ללא מסגרת כשמושמט |
| `strokeWidth` | number |  | עובי מסגרת (pt). ברירת מחדל: 1 (כאשר `stroke` מוגדר) |

### ציור צורה וקטורית שרירותית — `path`

שימו תחביר נתיב SVG ב-`d` ואת מערכת הקואורדינטות שלו ב-`viewBox`. הצורה מותאמת בקנה מידה למסגרת הרכיב.

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

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | סוג הרכיב |
| `d` | string | ✓ | נתוני נתיב SVG ‏(M/L/C/Z וכדומה). הקואורדינטות הן pt מקומיות לרכיב |
| `pdfSourceVector` | PdfSourceVectorDef |  | מופק על ידי ייבוא PDF כדי לשמר צורה החוזרת שוב ושוב (סמלי מפה וכדומה) כ"הגדרה אחת + N מיקומים" (ראו **`PdfSourceVectorDef`** בהמשך). כשמוגדר, ‏`d` אינו מנותח. אין בו צורך בתבניות הנכתבות ידנית |
| `affineTransform` | [number, number, number, number, number, number] |  | מטריצת טרנספורמציה אפינית הממפה את קואורדינטות הנתיב לקואורדינטות מקומיות לרכיב לפני הציור. ‏`[a, b, c, d, e, f]` נותן `x' = a·x + c·y + e`, ‏`y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. קואורדינטות הנתיב מותאמות בקנה מידה מאזור זה לרוחב ולגובה של הרכיב |
| `fill` | FillDef |  | מילוי (ראו **`FillDef`** בפרק הפרופרטי המשותפים). ללא מילוי כשמושמט |
| `fillRule` | `'nonzero'` (ברירת מחדל) / `'evenodd'` |  | הכלל המכריע אילו אזורים נחשבים "בפנים" בנתיבים החוצים את עצמם או מקוננים. כדי לנקב חור בסגנון דונאט, ‏`'evenodd'` הוא הבחירה האמינה |
| `fillOpacity` | number |  | אטימות המילוי (0.0–1.0) |
| `stroke` | FillDef |  | קו מתאר (צבעים אחידים וגם מעברי צבע ועוד). ללא קו מתאר כשמושמט |
| `strokeWidth` | number |  | עובי קו המתאר (pt). ברירת מחדל: 1 (כאשר `stroke` מוגדר) |
| `strokeOpacity` | number |  | אטימות קו המתאר (0.0–1.0) |
| `strokeLinecap` | `'butt'` = חיתוך בקצה / `'round'` = קצה מעוגל / `'square'` = קצה מרובע (מוארך בחצי עובי הקו) |  | צורת קצה הקו |
| `strokeLinejoin` | `'miter'` = חיבור חד (miter) / `'round'` = מעוגל / `'bevel'` = קטום |  | צורת חיבור הקווים |
| `strokeMiterLimit` | number |  | מגבלת miter. ברירת מחדל: 10 |
| `strokeDasharray` | number[] |  | תבנית קווקוו (מערך של אורכי קו ורווח, ‏pt) |
| `strokeDashoffset` | number |  | היסט התחלתי לתוך תבנית הקווקוו (pt) |

### מיקום תמונה — `image`

ציינו את התמונה עם `sourceExpression` (ביטוי) או `source` (ערך קבוע). ‏`scaleMode` שולט באופן שבו התמונה מתאימה למסגרת, ו-`onError` בוחר את ההתנהגות כשהתמונה אינה נמצאת (`error` = זריקת שגיאה / `blank` = השארה ריקה / `icon` = הצגת אייקון).

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

נתוני דוגמה:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | סוג הרכיב |
| `source` | string | | הפניית תמונה קבועה (מזהה תמונה). כתבו נתיב יחסי לקובץ ה-`.report`, נתיב מוחלט, URL, ‏data URI וכדומה כפי שהם (לכללי המזהים, ראו "הגבלות טעינת משאבים וכללי מזהי תמונה" בהמשך). משמש כאשר `sourceExpression` חסר או שתוצאתו אינה נפתרת |
| `sourceExpression` | Expression | | ביטוי מקור תמונה דינמי. תוצאת מחרוזת נפתרת כמזהה תמונה; תוצאת `Uint8Array` מטופלת כנתוני התמונה עצמם |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | כיצד התמונה מותאמת בקנה מידה. ‏`'clip'` = מיקום התמונה בגודלה הטבעי וחיתוך למסגרת הרכיב / `'fillFrame'` = מתיחה למילוי המסגרת תוך התעלמות מיחס הממדים / `'retainShape'` = שמירת יחס הממדים והתאמה לגודל הגדול ביותר הנכנס במסגרת / `'realSize'` = גודל טבעי בתוספת חיתוך למסגרת (ממומש זהה ל-`'clip'`). ברירת מחדל: ‏`'retainShape'`. כשלא ניתן לקבוע את גודל התמונה, ההתנהגות היא כמו `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | מיקום אופקי של התמונה בתוך המסגרת (משפיע על מיקום השוליים עם `retainShape` ועל מיקום החיתוך עם `clip`/`realSize`). ברירת מחדל: ‏`'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | מיקום אנכי של התמונה בתוך המסגרת. ברירת מחדל: ‏`'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | התנהגות כשמקור התמונה אינו מוגדר או נכשל בפתרון. ‏`'error'` = זריקת חריגה / `'blank'` = לא לצייר דבר / `'icon'` = ציור תיבת placeholder אפורה עם סימן ×. ברירת מחדל: ‏`'icon'` |
| `lazy` | boolean | | קיים בהגדרת הטיפוס בלבד; אינו מופנה על ידי מימושי מנוע הפריסה או הרנדרר הנוכחיים (אינו מכוסה במפרט) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | זווית סיבוב התמונה (מעלות) |
| `affineTransform` | [number, number, number, number, number, number] | | דרך חלופית לציין מיקום ישירות כמטריצה. ‏`[a, b, c, d, e, f]` היא טרנספורמציה הממפה את תמונת ריבוע-היחידה (0–1) דרך `x' = a·x + c·y + e`, ‏`y' = b·x + d·y + f`; כשמוגדרת, חישוב המיקום מ-`scaleMode`/`hAlign`/`vAlign`/`rotation` מדולג. משמש בעיקר את ייבוא ה-PDF לשימור המיקום המקורי |
| `opacity` | number | | אטימות (0.0–1.0) |
| `interpolate` | boolean | | הנחיה לצופה להחליק גבולות פיקסלים כשתמונה ברזולוציה נמוכה מוגדלת (PDF ‏/Interpolate). הפעילו לתצלומים; כבו לתמונות שחייבות להישאר חדות, כגון ברקודים |
| `alternates` | PdfImageAlternateDef[] |  | תמונות חלופיות של PDF ‏(/Alternates) לשימוש בתמונות שונות על המסך ובהדפסה. לכל רשומה שני פרופרטי: ‏`source` = הפניה לתמונה החלופית (חובה) ו-`defaultForPrinting` = האם זו שבשימוש בעת הדפסה |
| `opi` | PdfOpiMetadataDef |  | מידע OPI לדפוס מסחרי, שבו תמונת placeholder ברזולוציה נמוכה מוחלפת בתמונה ברזולוציה גבוהה בזמן הפלט. בעיקר לשימור בייבוא PDF (ראו **`PdfOpiMetadataDef`** בהמשך) |
| `measure` | PdfMeasurement |  | מידע קנה מידה ומערכת קואורדינטות המשמש את כלי המדידה של הצופה בקובצי PDF של שרטוטים ומפות. בעיקר לשימור בייבוא PDF (ראו **`PdfMeasurement`** בהמשך) |
| `pointData` | PdfPointData[] |  | נתוני נקודות (קו רוחב/אורך וכדומה) בקובצי PDF של מפות. בעיקר לשימור בייבוא PDF (ראו **`PdfPointData`** בהמשך) |
| `hyperlink` | HyperlinkDef | | היפר-קישור (`type`: ‏`'reference'` = URL / ‏`'localAnchor'` = עוגן פנימי במסמך / `'localPage'` = עמוד פנימי במסמך / `'remoteAnchor'`, ‏`'remotePage'` = עוגן/עמוד בתוך PDF חיצוני; ‏`target`: ביטוי ליעד הקישור; ‏`remoteDocument?`: ביטוי לנתיב ה-PDF החיצוני) |

### קיבוץ מספר רכיבים בתוך מסגרת — `frame`

מקבץ רכיבי ילד; ‏`border` מצייר מסגרת ו-`clip` חותך כל גלישה. קואורדינטות רכיבי הילד משתמשות בפינה השמאלית-עליונה של המסגרת כראשית שלהן.

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

נתוני דוגמה:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | סוג הרכיב |
| `clip` | boolean | | האם לחתוך ילדים בגבול המסגרת. ברירת מחדל: true |
| `border` | BorderDef | | מסגרת (ראו **`BorderDef`** בפרק הפרופרטי המשותפים) |
| `padding` | Padding | | ריפוד פנימי (`top?`/`bottom?`/`left?`/`right?`, כל אחד ב-pt) |
| `rotation` | number | | זווית סיבוב המסגרת (מעלות, נגד כיוון השעון בקואורדינטות העמוד) |
| `rotationOriginX` | number | | ראשית סיבוב X (יחסית למסגרת, ‏pt). ברירת מחדל: 0 |
| `rotationOriginY` | number | | ראשית סיבוב Y (יחסית למסגרת, ‏pt). ברירת מחדל: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | מטריצה אפינית הממפה קואורדינטות מקומיות למסגרת (Y מצביע מעלה) אל מרחב הקואורדינטות של ההורה (מבנה המטריצה ומשמעותה כמו ב-`affineTransform` של `image`). משמש בעיקר את ייבוא ה-PDF לשימור המיקום המקורי |
| `pdfForm` | PdfFormXObjectDef |  | בייבוא PDF, משמר ופולט מחדש את מערכת הקואורדינטות והמטא-נתונים שקומפוננטה (Form XObject) של ה-PDF המקורי נשאה (ראו **`PdfFormXObjectDef`** בהמשך). אין בו צורך בתבניות הנכתבות ידנית |
| `hyperlink` | HyperlinkDef | | היפר-קישור (מבנה זהה לפרופרטי בעל אותו שם ב-`image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | נתיב חיתוך בתחביר נתיב SVG. ‏`d` = נתוני הנתיב, ‏`fillRule` = כלל המילוי |
| `transparencyGroup` | boolean | | שומר על גבול קבוצת השקיפות של ה-PDF גם כאשר לא `isolated` ולא `knockout` מופעלים. השמירה מבטיחה שהתוצאה המורכבת של אטימות ומיזוג תישאר זהה לזו שהייתה מתקבלת אילו המסגרת הורכבה כתמונה שטוחה יחידה (בעיקר לנאמנות ייבוא PDF) |
| `isolated` | boolean | | קבוצת שקיפות מבודדת (PDF ‏/Group /I). כשזה (או `knockout` / `softMask`) מוגדר, המסגרת מורכבת כיחידה לפני החלת אטימות, מיזוג ומסכות |
| `knockout` | boolean | | קבוצת שקיפות knockout ‏(PDF ‏/Group /K). ילדים חופפים בתוך הקבוצה אינם נראים זה דרך זה; בכל מיקום רק הילד העליון מורכב עם הרקע |
| `softMask` | FrameSoftMaskDef | | מסכה רכה ההופכת את המסגרת לשקופה חלקית (ראו **`FrameSoftMaskDef`** בטבלה שלהלן). משתמשת ברינדור של ה-`elements` שלה כ"מפת שקיפות", ומאפשרת אפקטים כגון דהייה הדרגתית לאורך מעבר צבע |
| `deviceParams` | DeviceParamsDef | | פרמטרים לשלב ההכנה לדפוס (prepress) של דפוס מסחרי (ראו **`DeviceParamsDef`** בטבלה שלהלן). אין בהם צורך בדוחות רגילים; משמשים בעיקר את ייבוא ה-PDF לשימור הגדרות ה-PDF המקורי |
| `elements` | ElementDef[] | | רכיבי הילד בתוך המסגרת |

**‏`FrameSoftMaskDef`** (מבנה `softMask`)
| שדה | טיפוס | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | סוג המסכה. ‏`'luminosity'` = ככל שאזור מסכה בהיר יותר, המסגרת אטומה יותר / `'alpha'` = ככל שאזור מסכה אטום יותר, המסגרת אטומה יותר |
| `colorSpace` | PdfProcessColorSpaceDef | | מרחב הצבע למיזוג של קבוצת השקיפות של המסכה הרכה |
| `isolated` | boolean | | דגל בידוד של קבוצת השקיפות של המסכה הרכה |
| `knockout` | boolean | | דגל knockout של קבוצת השקיפות של המסכה הרכה |
| `backdrop` | [number, number, number] | | צבע רקע /BC למסכות luminosity ‏(DeviceRGB ‏0–1). ברירת מחדל: שחור |
| `elements` | ElementDef[] | ✓ | רכיבים המורכבים כקבוצת שקיפות להגדרת המסכה |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | פונקציית העברה ‎/SMask /TR הממפה מחדש ערכי מסכה (0..1) |

**‏`DeviceParamsDef`** (מבנה `deviceParams`. להכנה לדפוס מסחרי ובדרך כלל אין בו צורך — בעיקר לשימור בייבוא PDF)
| שדה | טיפוס | חובה | תיאור |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | פונקציית העברה /TR: ‏`'Identity'` / `'Default'` / פונקציה יחידה משותפת לכל לוחות הצבע / מערך פונקציות, אחת לכל לוח מארבעת הצבעים |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | פונקציית יצירת שחור /BG ‏(`'Default'` = ברירת מחדל של ההתקן דרך /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | פונקציית הסרת צבע תחתון /UCR ‏(`'Default'` = ברירת מחדל של ההתקן דרך /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | רשת דפוס /HT ‏(מסך type 1 / מערכי סף type 6, 10, 16 / אוסף לפי-צבען type 5) |
| `halftoneOrigin` | [number, number] | | ראשית רשת הדפוס של PDF 2.0 ‏(/HTO, פיקסלים במרחב ההתקן) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | בקרת פיצוי נקודת שחור של PDF 2.0 ‏(/UseBlackPtComp) |
| `flatness` | number | | סבילות שטיחות (/FL) |
| `smoothness` | number | | סבילות חלקות ההצללה (/SM) |
| `strokeAdjustment` | boolean | | התאמת קו אוטומטית (/SA) |

### הדפסת טבלה — `table`

טבלה עם שורות כותרת, שורות פירוט ושורות סיכום. העבירו מערך של נתוני שורות דרך `dataSourceExpression`, ושורות הפירוט חוזרות פעם אחת לכל איבר במערך.

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

נתוני דוגמה (כל איבר ב-`items` הופך לשורת פירוט אחת של הטבלה):

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

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | סוג הרכיב |
| `columns` | TableColumnElementDef[] | ✓ | מערך הגדרות טורים. אם סכום ה-`width` של כל הטורים שונה מרוחב הרכיב, כל הטורים מותאמים פרופורציונלית כך שיתאימו בדיוק לרוחב הרכיב |
| `headerRows` | TableRowElementDef[] |  | מערך שורות כותרת. כשהטבלה מתפצלת בין עמודים, הן מצוירות שוב בראש כל עמוד |
| `detailRows` | TableRowElementDef[] |  | מערך שורות פירוט. מצוירות שוב ושוב, פעם אחת לכל שורת נתונים (שורות נתונים × כל השורות ב-detailRows) |
| `footerRows` | TableRowElementDef[] |  | מערך שורות סיכום. כשהטבלה מתפצלת בין עמודים, מצוירות רק בעמוד האחרון |
| `dataSourceExpression` | Expression |  | שימוש במערך שהביטוי מוערך אליו כשורות הנתונים של טבלה זו. כשמושמט, נעשה שימוש בשורות של מקור הנתונים הראשי. זורק חריגה כשהתוצאה אינה מערך |

**‏`TableColumnElementDef`** (כל רשומה ב-`columns` = הגדרת טור)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `width` | number | ✓ | רוחב הטור (pt). אם הסכום על פני כל הטורים אינו תואם את רוחב הרכיב, הרוחבים מחולקים פרופורציונלית |
| `style` | TableCellStyleDef |  | סגנון תא ברירת מחדל לטור זה. כשתא מציין פרופרטי בעל אותו שם, ההגדרה של התא גוברת (מסגרות ממוזגות צלע-צלע) |

**‏`TableRowElementDef`** (כל רשומה ב-`headerRows`/`detailRows`/`footerRows` = הגדרת שורה)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `height` | number | ✓ | גובה השורה (pt). מטופל כמינימום: השורה מתרחבת אוטומטית כשטקסט עם גלישת שורות או רכיבי ילד בתוך התא אינם נכנסים (בתאי rowSpan, גלישת תוכן מרחיבה את השורה האחרונה של הטווח הממוזג) |
| `cells` | TableCellElementDef[] | ✓ | מערך הגדרות תאים לשורה זו. טורים התפוסים על ידי `rowSpan` משורה מעל מדולגים אוטומטית בזמן המיקום |

**‏`TableCellElementDef`** (כל רשומה ב-`cells` = הגדרת תא. בנוסף לבאים, אפשר לציין ישירות כל פרופרטי של `TableCellStyleDef`)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `text` | string |  | טקסט תא קבוע |
| `expression` | Expression |  | ביטוי קשירת נתונים. הצורה החשופה `field.name` קוראת את הערך ישירות משורת הנתונים; כל צורה אחרת נפתרת דרך הערכת הביטויים של המנוע. גובר על `text` כשמצוין |
| `colSpan` | number |  | מספר הטורים למיזוג אופקי. ברירת מחדל: 1 |
| `rowSpan` | number |  | מספר השורות למיזוג אנכי. ברירת מחדל: 1. גובה התא הוא סכום גובהי השורות על פני הטווח הממוזג |
| `elements` | ElementDef[] |  | מערך רכיבי ילד הממוקמים בתוך התא. כשמצוין, הוא גובר על רינדור `text`/`expression` ומצויר חתוך לשטח בניכוי הריפוד. גובה השורה מתרחב אוטומטית לגובה שהילדים צריכים |

**‏`TableCellStyleDef`** (סגנון תא המשמש בהגדרות תאים וב-`style` של טור)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = יישור לשמאל / `'center'` = מרכוז / `'right'` = יישור לימין |  | יישור טקסט אופקי |
| `vAlign` | `'top'` = יישור לראש / `'middle'` = מרכוז / `'bottom'` = יישור לתחתית |  | יישור טקסט אנכי |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | סיבוב טקסט (מעלות). ברירת מחדל: 0 |
| `backcolor` | string |  | צבע רקע התא |
| `forecolor` | string |  | צבע הטקסט. ברירת מחדל: ‏`#000000` |
| `fontId` | string |  | מזהה גופן. ברירת מחדל: ‏`'default'` |
| `fontSize` | number |  | גודל גופן (pt). ברירת מחדל: 10 |
| `bold` | boolean |  | מודגש |
| `italic` | boolean |  | נטוי |
| `underline` | boolean |  | קו תחתי |
| `strikethrough` | boolean |  | קו חוצה |
| `lineSpacing` | LineSpacingDef |  | הגדרות ריווח שורות (ראו **‏`LineSpacingDef`** בפרק הפרופרטי המשותפים) |
| `letterSpacing` | number |  | ריווח אותיות (pt). מוסיף כמות קבועה בין כל התווים (ערכים שליליים מצמצמים) |
| `wordSpacing` | number |  | ריווח מילים (pt; רוחב נוסף המתווסף לתווי רווח) |
| `firstLineIndent` | number |  | הזחת שורה ראשונה (pt) |
| `leftIndent` | number |  | הזחה משמאל (pt) |
| `rightIndent` | number |  | הזחה מימין (pt) |
| `wrap` | boolean |  | גלישת שורות. ברירת מחדל: true |
| `shrinkToFit` | boolean |  | הקטנת גודל הגופן אוטומטית כדי שהטקסט ייכנס לתא |
| `minFontSize` | number |  | גודל הגופן המזערי (pt) תחת `shrinkToFit`. ברירת מחדל: 4 |
| `fitWidth` | boolean |  | התאמת גודל הגופן אוטומטית (בשני הכיוונים, הקטנה והגדלה) כך שהשורה הארוכה ביותר תמלא בדיוק את רוחב התא. תא כזה אינו תורם להתרחבות האוטומטית של גובה השורה |
| `outlineText` | boolean |  | ציור הטקסט לאחר המרה לקווי מתאר (נתיבים) |
| `padding` | number |  | ריפוד התא (pt). ברירת מחדל: 2 |
| `border` | BorderDef |  | מסגרת לכל תא (ראו **‏`BorderDef`** בפרק הפרופרטי המשותפים). ממוזגת עם המסגרת של `style` הטור; ההגדרה של התא גוברת |
| `opacity` | number |  | אטימות (0.0–1.0). מתחת ל-1, התא כולו מצויר כקבוצת אטימות |

### הדפסת טבלה צולבת — `crosstab`

מצברת נתונים לפי קבוצות שורות × קבוצות טורים. הדוגמה הזו מסכמת את `amount` לפי אזור × קטגוריה ומוציאה גם סיכומי ביניים וסך כולל.

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

נתוני דוגמה:

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

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | סוג הרכיב |
| `rowGroups` | { field, headerFormat? }[] | ✓ | מערך הגדרות קבוצות שורות. רשומות מרובות יוצרות רמות קיבוץ מקוננות, וכל רמה תופסת טור אחד של כותרות שורה משמאל. תאי הכותרת של קבוצות חיצוניות ממוזגים אנכית על פני הטווח שלהן |
| `columnGroups` | { field, headerFormat? }[] | ✓ | מערך הגדרות קבוצות טורים. קבוצות חיצוניות נערמות מעל והפנימיות מתחת; כותרות חיצוניות ממוזגות אופקית על פני רוחב הטורים שלהן |
| `measures` | { field, calculation, format? }[] | ✓ | מערך הגדרות מדדים (תאי צבירה). עם רשומות מרובות, הם נערמים אנכית בתוך כל תא נתונים, כל אחד תופס משבצת אחת (לפחות `cellHeight`) ומחיל את ה-`calculation`/`format` שלו. מערך ריק מטופל כמדד יחיד משתמע עם `field: ''` ו-`calculation: 'sum'` |
| `rowHeaderWidth` | number |  | רוחב כותרת השורה (pt), מוחל על כל רמה של קבוצות השורות. ברירת מחדל: 80 |
| `columnHeaderHeight` | number |  | גובה כותרת הטור (pt), מוחל על כל רמה של קבוצות הטורים. ברירת מחדל: 20 |
| `cellWidth` | number |  | רוחב תא נתונים (pt). ברירת מחדל: 60 |
| `cellHeight` | number |  | גובה תא נתונים (pt; גובה המשבצת של מדד אחד). מתרחב אוטומטית עם גלישת שורות. ברירת מחדל: 20 |
| `border` | { color?, width? } |  | הגדרות מסגרת (ראו הטבלה שלהלן). רק כשמצוין, מצוירים המסגרת החיצונית, מפרידי השורות/הטורים ומפרידי רמות הכותרות (הם לעולם אינם חוצים תא כותרת חיצוני ממוזג) |
| `showSubtotals` | boolean |  | הצגת סיכומי ביניים. ברירת מחדל: false. כשהערך true, שורת/טור סיכום ביניים המסומנים "Total" מוכנסים בסוף הבלוק של כל קבוצה, למעט הרמה הפנימית ביותר. ערכי סיכום הביניים מחושבים מחדש מהערכים הגולמיים לפי ה-`calculation` של כל מדד |
| `showGrandTotal` | boolean |  | הצגת הסך הכולל. ברירת מחדל: false. כשהערך true, שורת/טור סך כולל המסומנים "Total" מתווספים בסוף (אינם נפלטים כשאין שורות נתונים כלל). גם ערכי הסך הכולל מחושבים מחדש מהערכים הגולמיים |
| `dataSourceExpression` | Expression |  | משתמש במערך שאליו מוערך הביטוי כשורות הנתונים של הטבלה הצולבת הזו. כשמושמט (או כשהתוצאה אינה מערך), נעשה שימוש בשורות של מקור הנתונים הראשי |

**הגדרת קבוצת שורות/טורים (כל רשומה ב-`rowGroups`/`columnGroups`)**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `field` | string | ✓ | שם השדה לקיבוץ לפיו. הקבוצות מופיעות בסדר ההופעה הראשונה שלהן בנתונים |
| `headerFormat` | string |  | פורמט תצוגה לערכי כותרת. פורמט פשוט המוחל רק כשהערך מספרי (`'#,##0'` או כל דבר המכיל `,` ← מפרידי אלפים; מפרט עשרוני כגון `'.00'` ← מספר קבוע של ספרות עשרוניות בדיוק זה; כל דבר אחר ← המרה פשוטה למחרוזת) |

**הגדרת מדד (כל רשומה ב-`measures`)**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `field` | string | ✓ | שם השדה לצבירה. ערכים לא-מספריים מומרים למספרים; ערכים שאי אפשר להמיר נחשבים כ-0 |
| `calculation` | `'sum'` = סכום / `'count'` = ספירה / `'average'` = ממוצע / `'min'` = מזערי / `'max'` = מרבי | ✓ | שיטת הצבירה. גם סיכומי הביניים והסך הכולל מחושבים מחדש מקבוצת הערכים הגולמיים באותה שיטה, כך שאפילו `average` וכדומה יוצאים נכונים |
| `format` | string |  | פורמט תצוגה לערכי הצבירה (אותו פורמט פשוט כמו `headerFormat`: ‏`'#,##0'` או `,` ← מפרידי אלפים, ‏`'.NN'` ← NN ספרות עשרוניות קבועות, ללא ← המרה פשוטה למחרוזת) |

**הגדרות מסגרת (`border`)**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `color` | string |  | צבע הקו. ברירת מחדל: ‏`#000000` |
| `width` | number |  | עובי הקו (pt) של המסגרת החיצונית ושל גבולות הכותרת/הנתונים. ברירת מחדל: 0.5. מפרידי השורות/הטורים הפנימיים מצוירים במחצית העובי הזה |

### הטמעת דוח אחד בתוך אחר — `subreport`

הרעיון הוסבר ב"יסודות פריסת דוחות". הנה הגדרה מלאה שעובדת כמות שהיא. תת-הדוח רץ פעם אחת לכל שורת פירוט של האב, והמערך המועבר דרך `dataSourceExpression` הופך ל-`rows` של תת-הדוח.

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

נתוני דוגמה:

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

ה-`subreport.report` המוטמע הוא תבנית עצמאית לכל דבר. הוא מפנה לכל איבר של ה-`items` שקיבל כערכי `field.*` רגילים ומקבל את הפרמטרים שהועברו מהאב דרך `param.*`. שימו לב שתבניות המורצות כתת-דוחות אינן פולטות את הרצועות `pageHeader`, ‏`pageFooter` או `background` שלהן (ניהול העמודים הוא תפקידו של דוח האב). כותרות נכנסות לרצועת `title`, כך:

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

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | סוג הרכיב |
| `templateExpression` | Expression | ✓ | ביטוי המחזיר את שם תבנית הילד. בשימוש ב-`createReportFromFile()` הוא נפתר אוטומטית כנתיב קובץ; בקריאה ישירה ל-`createReport()`, פתרו אותו באמצעות האופציה `resolveSubreportTemplate` (פונקציה המקבלת את השם ואת ספריית העבודה ומחזירה `{ template, workingDirectory? }`, או `null` כשאינה מצליחה לפתור) |
| `dataSourceExpression` | Expression | | ביטוי המחזיר את מקור הנתונים של דוח הילד (מערך של אובייקטי שורה). כשמושמט, נעשה שימוש בשורות מקור הנתונים של האב כמות שהן. תוצאה שאינה מערך מטופלת כנתונים ריקים |
| `parameters` | SubreportParamDef[] |  | פרמטרים המועברים לדוח הילד (ראו **‏`SubreportParamDef`** בטבלה שלהלן). הם גוברים על רשומות בעלות אותו שם מ-`parametersMapExpression` |
| `parametersMapExpression` | Expression | | ביטוי המחזיר אובייקט הממוזג לתוך פרמטרי הילד (`parameters` בודדים גוברים) |
| `returnValues` | ReturnValueDef[] |  | הגדרות המחזירות ערכי משתנים של דוח הילד אל האב (ראו **‏`ReturnValueDef`** בטבלה שלהלן) |
| `usingCache` | boolean | | בתוך הרצה אחת של דוח האב, שמירת תבניות ילד שנפתרו במטמון ושימוש חוזר בהן לפי שם התבנית |
| `runToBottom` | boolean | | לאחר תוכן תת-הדוח, לצרוך את המקום הנותר של העמוד/הטור (ודוחף את הרכיבים הבאים אל מתחת למקום הנותר) |

**‏`SubreportParamDef`** (כל רשומה ב-`parameters` = פרמטר המועבר לדוח הילד)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם הפרמטר המועבר לדוח הילד (מופנה בצד הילד כ-`param.name`) |
| `expression` | Expression | ✓ | ביטוי המחשב את ערך הפרמטר. מוערך בהקשר של דוח האב |

**‏`ReturnValueDef`** (כל רשומה ב-`returnValues` = הגדרה המחזירה ערך מהילד אל האב)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם המשתנה המקבל את הערך בצד האב. משתנה זה מוחרג מדריסה על ידי חישוב המשתנים הרגיל של האב |
| `subreportVariable` | string | ✓ | שם משתנה המקור בצד הילד. כשדוח הילד מסיים לרוץ, ערכו מופץ אל האב |
| `calculation` | `'nothing'` = השמת ערך הילד כמות שהוא (נדרס בכל הרצה) / `'count'` = ספירה / `'sum'` = סכום / `'average'` = ממוצע / `'min'` = מזערי / `'max'` = מרבי / `'first'` = שמירת הערך הראשון שהתקבל | ✓ | האופן שבו הערך מקופל לתוך משתנה האב. כל דבר מלבד `'nothing'` צובר על פני ההרצות כשתת-הדוח מתבצע מספר פעמים |

### הדפסת ברקודים וקודי QR — `barcode`

`barcodeType` מקבל Code 39/93/128, ‏EAN, ‏UPC, ‏ITF, ‏Codabar, ‏MSI, ‏QR Code (`qrcode`), ‏Data Matrix, ‏PDF417 ועוד. ‏`showText` מוסיף את הטקסט הקריא לאדם לצורך התייחסות בסריקה.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

נתוני דוגמה:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | סוג הרכיב |
| `barcodeType` | string | ✓ | סימבולוגיית הברקוד (ללא רגישות לאותיות גדולות/קטנות). ערכים מותרים: ‏`'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. כל ערך אחר אינו נתמך ומצייר ממלא מקום |
| `expression` | Expression | ✓ | ביטוי המחזיר את נתוני הברקוד (תוצאת ההערכה מומרת למחרוזת ומקודדת) |
| `showText` | boolean | | הצגת טקסט קריא לאדם מתחת לברקודים חד-ממדיים (גובה אזור הטקסט 10pt, גודל גופן 8pt; גובה הפסים מתכווץ בהתאם). אינו בשימוש עבור קודים דו-ממדיים (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | רמת תיקון השגיאות של QR Code — היכולת להישאר קריא גם כשחלק מהקוד מרוח או חסר. העמידות עולה מ-`'L'` ל-`'H'`, במחיר תבנית עדינה יותר. ‏`'Q'` או `'H'` מומלצות למדיות הדפסה גסות. ברירת מחדל: ‏`'M'`. אפקטיבי עבור קודי QR בלבד (רמת תיקון השגיאות של PDF417 נבחרת אוטומטית לפי אורך הנתונים) |

### הדפסת נוסחאות מתמטיות — `math`

מסדרת נוסחאות בסגנון LaTeX. סידור מתמטי דורש גופן ייעודי הנושא מטריקות ייחודיות למתמטיקה (טבלת OpenType MATH); דוגמאות זמינות באופן חופשי כוללות את STIX Two Math ואת Latin Modern Math. גופן טקסט רגיל אינו יכול להחליף אותם. ‏`formula` מוערך כביטוי (הדוגמה הזו מפנה לשדה `formula` של הנתונים).

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

נתוני דוגמה:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

בשימוש ברכיב `math`, רשמו גופן בעל טבלת OpenType MATH גם ב-`fontMap` וגם ב-`fonts` של פלט ה-PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | סוג הרכיב |
| `formula` | Expression | ✓ | ביטוי המחזיר מחרוזת נוסחת LaTeX (עטפו נוסחה קבועה ב-`'...'` כליטרל מחרוזת בתוך הביטוי). דבר אינו מצויר כשהתוצאה היא מחרוזת ריקה |
| `mathFontFamily` | string | | הגופן המשמש לרינדור מתמטי (מזהה גופן הרשום ב-fontMap). ברירת מחדל: ה-fontFamily של סגנון הרכיב, או `'default'` אם גם הוא נעדר |
| `fontSize` | number | | גודל הגופן (pt). ברירת מחדל: ה-fontSize של סגנון הרכיב, או 12 אם גם הוא נעדר |
| `color` | string | | צבע הטקסט. ברירת מחדל: נפתר לפי הסדר — ה-forecolor של הרכיב ← ה-forecolor של הסגנון ← `#000000` |

### הדפסת SVG — `svg`

מרנדר מסמך SVG ישירות אל תוך הדוח. ‏`svgContent` מוערך כביטוי (מחרוזת SVG קבועה יכולה להיות מסופקת דרך נתונים או פרמטרים).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

נתוני דוגמה:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | סוג הרכיב |
| `svgContent` | Expression | ✓ | ביטוי המחזיר מחרוזת סימון SVG. התוצאה מומרת למחרוזת ומרונדרת כ-SVG במיקום ובגודל של הרכיב |

### יצירת טפסי PDF הניתנים למילוי — `formField`

ממקם שדות טופס שכל מי שפותח את ה-PDF יכול למלא. ‏`fieldType` מקבל `text`, ‏`checkbox`, ‏`radio`, ‏`pushbutton`, ‏`dropdown`, ‏`listbox` ו-`signature`.

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

נתוני דוגמה (הופכים לערך ההתחלתי של הטופס):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | סוג הרכיב. שדה טופס אינטראקטיבי. בקאנדים של תצוגה מקדימה מציירים את המראה ההתחלתי שלו, ופלט PDF פולט אותו כשדה שניתן למלא באמת |
| `fieldType` | `'text'` = שדה קלט טקסט (PDF /Tx) / `'checkbox'` = תיבת סימון (/Btn) / `'radio'` = לחצן רדיו (/Btn; ווידג'טים החולקים את אותו `fieldName` יוצרים קבוצה אחת של בחירה בלעדית) / `'pushbutton'` = לחצן דחיפה (/Btn; כיתוב ובנוסף פעולת URI אופציונלית) / `'dropdown'` = רשימה נפתחת (תיבה משולבת, /Ch) / `'listbox'` = תיבת רשימה (/Ch) / `'signature'` = שדה חתימה (/Sig) | ✓ | סוג השדה |
| `fieldName` | string | ✓ | שם השדה המלא והמוסמך. חייב להיות ייחודי בתוך המסמך (כפילויות זורקות שגיאה). היוצא מן הכלל הוא `radio`, שבו שיתוף אותו שם יוצר קבוצה אחת של בחירה בלעדית |
| `value` | Expression |  | ערך התחלתי (text: ערך הקלט; dropdown/listbox: הערך הנבחר; עבור listbox עם `multiSelect`, ציינו מספר ערכים מופרדים בשורות חדשות). מוערך כביטוי. שילוב עם `valueStream` זורק שגיאה |
| `checked` | Expression |  | מצב סימון התחלתי (checkbox/radio). מוערך כביטוי. עבור רדיו, ה-`exportValue` של הלחצן המסומן הופך לערך הנבחר של הקבוצה |
| `exportValue` | string |  | המחרוזת הנרשמת כערך שמשמעותו שתיבת סימון/רדיו זו היא "דלוקה" כשהקלט של הטופס נשלח או מחולץ (checkbox/radio). ברירת מחדל: ‏`'Yes'`. בקבוצת רדיו, ערך זה מבחין בין האפשרויות הבודדות |
| `options` | FormFieldOption[] |  | מערך אפשרויות (dropdown/listbox). ראו הטבלה שלהלן |
| `editable` | boolean |  | לאפשר קלט חופשי בנוסף לאפשרויות (גורם לרשימה נפתחת לקבל הקלדה בסגנון תיבה משולבת) |
| `multiSelect` | boolean |  | לאפשר בחירה מרובה (listbox) |
| `caption` | string |  | כיתוב הלחצן (pushbutton) |
| `action` | string |  | ה-URI הנפתח כשלחצן הדחיפה נלחץ |
| `multiline` | boolean |  | קלט רב-שורתי (text) |
| `readOnly` | boolean |  | להפוך את השדה לקריאה בלבד |
| `required` | boolean |  | להפוך את השדה לחובה |
| `noExport` | boolean |  | לא לייצא את ערך השדה הזה בשליחת הטופס |
| `password` | boolean |  | קלט סיסמה (text; התווים המוקלדים ממוסכים) |
| `fileSelect` | boolean |  | להפוך אותו לשדה בחירת קובץ (text). שילוב עם `multiline`/`password` זורק שגיאה |
| `doNotSpellCheck` | boolean |  | להשבית בדיקת איות (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | לא לאפשר גלילה עבור קלט החורג מהאזור הנראה (text) |
| `comb` | boolean |  | להציג כתיבות תווים במרווחים אחידים (comb) (text). חובה לציין `maxLength`; שילוב עם `multiline`/`password`/`fileSelect` זורק שגיאה |
| `richText` | string |  | ערך טקסט עשיר (PDF /RV) המוצג עם עיצוב (מודגש, צבעים וכדומה) במציגים תומכים. הגדרתו מרימה את דגל הטקסט העשיר של השדה. שילוב עם `richTextStream` זורק שגיאה |
| `richTextStream` | Uint8Array |  | צורת הזרם של `richText`. לשימור ברמת הבייטים כאשר ה-/RV של ה-PDF המקורי היה זרם בעת ייבוא PDF; תבניות הנכתבות ביד משתמשות בדרך כלל ב-`richText`. שילוב עם `richText` זורק שגיאה |
| `defaultStyle` | string |  | סגנון ברירת מחדל לטקסט עשיר (PDF /DS). מחרוזת פורמט דמוית CSS (למשל `font: Helvetica 12pt`) המספקת ברירות מחדל לכל מה ש-`richText` אינו מציין |
| `valueStream` | Uint8Array |  | לשימור בייבוא PDF. כשערך השדה (/V) של ה-PDF המקורי היה אובייקט זרם ולא מחרוזת, פולט את הבייטים הללו מחדש ללא אובדן. תבניות הנכתבות ביד משתמשות בדרך כלל ב-`value`. שילוב עם `value` זורק שגיאה |
| `defaultValue` | string |  | ערך ברירת המחדל שאליו השדה חוזר באיפוס הטופס (/DV) |
| `sort` | boolean |  | להציג את האפשרויות ממוינות (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | לקבע את הערך מיד כשהבחירה משתנה (dropdown/listbox) |
| `radiosInUnison` | boolean |  | להדליק ולכבות בתיאום לחצני רדיו בתוך קבוצה החולקים את אותו `exportValue` |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | מצרף לשדה סקריפטי קלט הרצים במציגי PDF. ‏K = בכל הקשה (למשל הסרת תווים שאינם ספרות), ‏F = עיצוב תצוגה (למשל הצגת שתי ספרות עשרוניות), ‏V = אימות ערך (למשל דחיית מספרים שליליים), ‏C = חישוב מחדש (למשל חישוב אוטומטי מערכים של שדות אחרים). התוכן הוא בדרך כלל `PdfActionDef` (מתואר בהמשך) עם `subtype: 'JavaScript'`. מנוע הליבה רק מטמיע את הסקריפטים ב-PDF ולעולם אינו מריץ אותם. עבור קבוצת רדיו, כל הווידג'טים חייבים לשאת הגדרות זהות אחרת נזרקת שגיאה |
| `calculationOrder` | number |  | כשלמספר שדות יש פעולת `'C'` (חישוב מחדש), הסדר שבו המציג מחשב אותם מחדש (PDF /CO). סדר עולה של מספרים שלמים ≥ 0. כפילויות, ערכים שליליים וערכים שאינם שלמים זורקים שגיאה |
| `maxLength` | number |  | אורך הקלט המרבי (text) |
| `borderColor` | string |  | צבע המסגרת (`#RRGGBB`). ללא מסגרת כשמושמט. מצויר כקו מתאר בעובי 1pt — עגול עבור רדיו, מלבני אחרת |
| `backgroundColor` | string |  | צבע הרקע (`#RRGGBB`). שקוף כשמושמט. ממולא כעיגול עבור רדיו, כמלבן אחרת |

**‏`FormFieldOption`** (כל רשומה ב-`options` = הגדרת אפשרות)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `value` | string | ✓ | ערך הייצוא הנשמר בערך השדה (/V) |
| `label` | string |  | תווית התצוגה. ברירת מחדל: זהה ל-`value` |

הערה: בנוסף, אפשר לציין את כל הפרופרטי המשותפים לרכיבים ואת כל פרופרטי `TextProperties` (מוחלים על הגופן, היישור וכדומה של טקסט הקלט).

### כפיית מעבר עמוד או טור בכל מקום — `break`

כופה מעבר לעמוד הבא (`"breakType": "page"`) או לטור הבא (`"column"`) באמצע זרימת הפירוט. מקמו אותו ישירות ברצועה; הוא אינו יכול להיכנס לתוך `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**רשימת פרופרטי**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | סוג הרכיב |
| `breakType` | `'page'` \| `'column'` | ✓ | סוג המעבר. מפצל את הרצועה במיקום ה-y של הרכיב; ‏`'page'` = המשך בעמוד הבא / `'column'` = המשך בטור הבא כשהפריסה רב-טורית (`columns.count` של התבנית 2 או יותר; ראו "יסודות פריסת דוחות") וזה אינו הטור האחרון (אחרת הוא פועל כמעבר עמוד) |

### הדפסת רכיב רק כשמתקיים תנאי — `printWhenExpression`

`printWhenExpression` אינו סוג רכיב נפרד אלא **מאפיין המשותף לכל הרכיבים**. הרכיב מודפס רק בשורות שבהן הביטוי מוערך לערך אמיתי. הדוגמה הבאה מדפיסה "※ 至急" (דחוף) רק בשורות פירוט שבהן `urgent` הוא `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

נתוני דוגמה (מודפס רק עבור השורה הראשונה):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

גם רצועות מקבלות `printWhenExpression` בעל אותו שם, המדכא את הפלט של הרצועה כולה (למשל פליטת רצועת הערות רק כאשר `param.showNotes` מוגדר). כשהתבנית מוגדרת ב-TypeScript, ה-callback ‏`onBeforeRender` של הרכיב נותן שליטה עדינה עוד יותר — החזירו `null` כדי לדלג על הדפסת הרכיב, או החזירו `ElementDef` כדי להדפיס עם מאפיינים כגון טקסט, מידות וצבעים הנדרסים במקום.
## רפרנס פרופרטי של רכיבים

"רשימת הפרופרטי" הנלווית לדוגמה של כל רכיב מכסה רק את הפרופרטי הייחודיים לאותו רכיב. בנוסף, כל רכיב מקבל פרופרטי משותפים למיקום, גודל, תנאי הדפסה, צבעים ועוד. הפרק הזה מסכם את הפרופרטי המשותפים לכל הרכיבים ואת הפרופרטי של הסגנונות המוגדרים ב-`styles` של התבנית.

### פרופרטי המשותפים לכל הרכיבים

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `id` | string |  | מזהה לאיתור ולשינוי רכיב לפני הרינדור באמצעות `findElementById()`. אינו משפיע על התוכן המודפס עצמו. שמרו על ייחודיות המזהים המשמשים כיעדי שינוי בתוך התבנית (בכפילות, מוחזר הרכיב הראשון בסדר החיפוש) |
| `x` | number | ✓ | קואורדינטת X בתוך הרצועה/המכל האב (pt) |
| `y` | number | ✓ | קואורדינטת Y בתוך הרצועה/המכל האב (pt) |
| `width` | number | ✓ | רוחב (pt) |
| `height` | number | ✓ | גובה (pt) |
| `style` | string |  | שם הסגנון להחלה (מפנה ל-`name` של `StyleDef` המוגדר ב-`styles`; כשלא מצוין, מוחל הסגנון בעל `isDefault`) |
| `positionType` | `'float'` = נע מטה בכמות שהרכיבים שמעליו התמתחו / `'fixRelativeToTop'` = מקבע את המיקום מהקצה העליון של הרצועה (ברירת מחדל) / `'fixRelativeToBottom'` = שומר על המרחק מהקצה התחתון של הרצועה (נע מטה בכמות המתיחה של הרצועה) |  | כלל המיקום כשהרצועה מתמתחת. ברירת מחדל: ‏`fixRelativeToTop` |
| `stretchType` | `'noStretch'` = אינו מתמתח (ברירת מחדל) / `'containerHeight'` = משווה את גובה הרכיב לגובה האפקטיבי של הרצועה / `'containerBottom'` = מותח את הקצה התחתון של הרכיב אל התחתית האפקטיבית של הרצועה (משנה רק את הגובה) |  | כלל המתיחה של הרכיב כשהרצועה מתמתחת. ברירת מחדל: ‏`noStretch` |
| `printWhenExpression` | Expression \| null |  | כשתוצאת ההערכה שקרית, הרכיב הזה אינו מודפס |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback הנקרא מיד לפני הרינדור: ‏`(elem, field, vars, param, report) => ElementDef \| null`. החזרת `null` מדלגת על ההדפסה (על-קבוצה של `printWhenExpression`); החזרת `ElementDef` מרנדרת עם ההגדרה הזו (דורסת דינמית כל מאפיין). סדר ההערכה: ‏`onBeforeRender` ← `printWhenExpression` (מוערך מול ההגדרה הנדרסת) ← `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | כשהרכיב אינו מודפס, אם אף רכיב מודפס אחר אינו חופף לרצועה האנכית שהרכיב תופס, מסירה את הרצועה הזו ומושכת מעלה את הרכיבים שמתחתיה, ומכווצת את הרצועה |
| `isPrintRepeatedValues` | boolean |  | כשמוגדר `false`, ההדפסה מדוכאת כשהערך (textField) זהה לקודם (בזמן הדיכוי, הרכיב מטופל כבעל גובה 0 אם `isRemoveLineWhenBlank` אמיתי) |
| `isPrintWhenDetailOverflows` | boolean |  | מדפיס מחדש את הרכיב הזה בכל מקטע עמוד/טור שאליו הרצועה גולשת |
| `mode` | `'opaque'` = ממלא את הרקע ב-`backcolor` / `'transparent'` = אינו ממלא את הרקע |  | מצב תצוגה. ברירת מחדל: ‏`transparent` (נפתר תחילה מהרכיב, אחר כך מהסגנון) |
| `forecolor` | string |  | צבע קדמה (`#RRGGBB` או `#RRGGBBAA`) |
| `backcolor` | string |  | צבע רקע (מצויר כאשר `mode` הוא `opaque`) |
| `border` | BorderDef |  | מסגרת (ראו **‏`BorderDef`** להלן). עבור רכיבי line/rectangle/ellipse/path המסגרת אינה מצוירת (בין אם היא מגיעה מסגנון ובין אם מצוינת ישירות על הרכיב; רכיבים אלה מציינים קווים דרך `stroke` ופרופרטי דומים משלהם) |
| `padding` | Padding |  | ריפוד (ראו **‏`Padding`** להלן) |
| `blendMode` | BlendModeDef |  | האופן שבו צבעי הרכיב הזה מורכבים עם התוכן שכבר צויר מתחתיו (ראו **‏`BlendModeDef`** להלן). דוגמה טיפוסית: ציון `'multiply'` על תמונת חותם או חותמת מניח אותה בשקיפות חלקית מבלי להסתיר את הטקסט שמתחת |
| `overprintFill` | boolean |  | להכנה לדפוס מסחרי. מציין הדפסת-על עבור מילויים (פני הטקסט והצורות): הם מודפסים מעל לוחות הצבע שמתחת מבלי לחרוץ אותם |
| `overprintStroke` | boolean |  | להכנה לדפוס מסחרי. הגדרת הדפסת-על עבור קווים (משיחות) |
| `overprintMode` | 0 \| 1 |  | בוחר את ההתנהגות כאשר `overprintFill`/`overprintStroke` מופעלים (PDF /OPM). ‏`0` = כל רכיב צבע דורס את הצבע שמתחת (ברירת מחדל) / `1` = רכיבי צבע בעלי ערך 0 משאירים את הצבע שמתחת ללא שינוי |
| `renderingIntent` | `'AbsoluteColorimetric'` = נאמן קולורימטרית / `'RelativeColorimetric'` = נאמן לאחר התאמת נקודות לבן / `'Saturation'` = מעדיף חיוניות / `'Perceptual'` = מעדיף מראה טבעי |  | מדיניות העדיפות להמרת צבעים שאינם נכנסים לגאמוט של התקן הפלט (PDF rendering intent). מיועד לדפוס מסחרי ולניהול צבע; בדרך כלל אין צורך לציין |
| `alphaIsShape` | boolean |  | שליטה עדינה בהרכבת השקיפות של PDF (מפרש אטימות ומסכות כ"צורה"; /AIS). בדרך כלל אין צורך לציין; משמש בעיקר לפליטה מחדש נאמנה של קובצי PDF מיובאים |
| `textKnockout` | boolean |  | כשתווים שקופים למחצה חופפים, נמנע מהרכבה כפולה של החפיפות בתוך אותו טקסט (PDF /TK). ברירת מחדל: ‏`true`. בדרך כלל אין צורך לציין |
| `optionalContent` | OptionalContentDef |  | ממקם את הרכיב הזה על "שכבת" PDF. אפשר להחליף את הנראות וההדפסה מלוח השכבות של המציג (למשל להציג סימן מים על המסך אך להשמיטו בהדפסה). ראו **‏`OptionalContentDef`** להלן |
| `opacity` | number |  | אטימות הרכיב (0.0–1.0). עבור רכיבים בעלי ילדים, מוחלת לאחר הרכבתם כקבוצה |

**‏`BlendModeDef`** (מצבי מיזוג שאפשר לציין עבור `blendMode`)

רכיבים צובעים בדרך כלל מעל כל מה שצויר מתחתיהם (`'normal'`). ציון מצב מיזוג משלב את הצבע העליון והתחתון חישובית. במסמכים עסקיים, השימושים הטיפוסיים הם הנחת חותם אישי או חברה מעל טקסט (`'multiply'`) והפקת אפקט דמוי חריצה לבנה על רקע כהה (`'screen'`).

| קבוע | אפקט |
| --- | --- |
| `'normal'` | צובע בצבע העליון ללא מיזוג (שקול לברירת המחדל) |
| `'multiply'` | הכפלה. החפיפות תמיד נעשות כהות יותר. לחותמות, חותמים והנחות בסגנון מדגש |
| `'screen'` | הכפלה הפוכה. החפיפות תמיד נעשות בהירות יותר |
| `'overlay'` | מכפיל היכן שהבסיס כהה, מבצע screen היכן שהוא בהיר. מדגיש ניגודיות |
| `'darken'` | לוקח את הכהה מבין שני הצבעים |
| `'lighten'` | לוקח את הבהיר מבין שני הצבעים |
| `'color-dodge'` | מבהיר (שורף החוצה) את הבסיס בהתאם לצבע העליון |
| `'color-burn'` | מכהה (שורף) את הבסיס בהתאם לצבע העליון |
| `'hard-light'` | מחליף בין הכפלה להכפלה הפוכה על פי בהירות הצבע העליון (אפקט תאורה חזק) |
| `'soft-light'` | גרסה חלשה יותר של `'hard-light'` (אפקט תאורה רך) |
| `'difference'` | ערך מוחלט של ההפרש בין שני הצבעים |
| `'exclusion'` | גרסה בעלת ניגודיות נמוכה יותר של `'difference'` |
| `'hue'` | גוון עליון + רוויה ובהירות תחתונות |
| `'saturation'` | רוויה עליונה + גוון ובהירות תחתונים |
| `'color'` | גוון ורוויה עליונים + בהירות תחתונה (לגיוון בסיס מונוכרומטי) |
| `'luminosity'` | בהירות עליונה + גוון ורוויה תחתונים |

**‏`Expression`** (ראו "שליטה מלאה בביטויים" לפרטים)
| צורה | תיאור |
| --- | --- |
| string | שפת-מיני של ביטויים. דוגמאות: ‏`'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | פונקציית TypeScript ‏`(field, vars, param, report) => unknown`. ‏`report` (ReportContext) מספק את `PAGE_NUMBER` (מספר העמוד הנוכחי, מבוסס 1), ‏`COLUMN_NUMBER` (מספר הטור הנוכחי, מבוסס 1), ‏`REPORT_COUNT` (מספר הרשומות שעובדו), ‏`TOTAL_PAGES` (מספר העמודים הכולל; מקובע עם evaluationTime=report), ‏`RETURN_VALUE` (קיים בהגדרת הטיפוס אך תמיד undefined במימוש הנוכחי — ערכי החזרה של תת-דוחות מתקבלים דרך `vars.*`), ‏`format` (פונקציות עיצוב מובנות) ו-`formatters` (מעצבים מותאמים אישית הרשומים על התבנית) |

**‏`BorderDef`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `width` | number |  | עובי הקו (pt). ברירת מחדל המשותפת לכל הצלעות |
| `color` | string |  | צבע הקו. ברירת מחדל המשותפת לכל הצלעות |
| `style` | `'solid'` = קו רציף / `'dashed'` = קו מקווקו / `'dotted'` = קו מנוקד |  | סגנון הקו. ברירת מחדל המשותפת לכל הצלעות |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | הגדרות לכל צלע (ראו **‏`BorderSideDef`** להלן). הן גוברות על הגדרות כל-הצלעות; ‏`null` מסתיר את אותה צלע |

**‏`BorderSideDef`** (בשימוש ב-`top`/`bottom`/`left`/`right` של `BorderDef`)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `width` | number | ✓ | עובי הקו (pt) |
| `color` | string | ✓ | צבע הקו |
| `style` | `'solid'` = קו רציף / `'dashed'` = קו מקווקו / `'dotted'` = קו מנוקד | ✓ | סגנון הקו |

**‏`Padding`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | ריפוד בכל צלע (pt) |

**‏`HyperlinkDef`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'reference'` = כתובת URL חיצונית / `'localAnchor'` = לעוגן בתוך אותו מסמך / `'localPage'` = למספר עמוד בתוך אותו מסמך / `'remoteAnchor'` = לעוגן במסמך PDF אחר / `'remotePage'` = לעמוד במסמך PDF אחר | ✓ | סוג הקישור |
| `target` | Expression | ✓ | יעד הקישור (כתובת URL, שם עוגן, או ביטוי מספר עמוד) |
| `remoteDocument` | Expression |  | נתיב קובץ ה-PDF המרוחק (עבור remotePage / remoteAnchor) |

**‏`TextProperties`** (פרופרטי טקסט ופסקה של staticText / textField / formField)
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `markup` | `'none'` = טקסט רגיל / `'styled'` = סימון מסוגנן (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>` וכדומה) / `'html'` = תת-קבוצה של HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | סוג הסימון |
| `hAlign` | `'left'` = יישור לשמאל / `'center'` = מרכוז / `'right'` = יישור לימין / `'justify'` = יישור לשני הצדדים |  | יישור אופקי |
| `vAlign` | `'top'` = יישור לראש / `'middle'` = יישור לאמצע / `'bottom'` = יישור לתחתית |  | יישור אנכי |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | סיבוב הטקסט (מעלות) |
| `lineSpacing` | LineSpacingDef |  | הגדרות ריווח שורות (ראו **‏`LineSpacingDef`** להלן) |
| `letterSpacing` | number |  | ריווח אותיות (pt). מוסיף כמות קבועה בין כל התווים (ערכים שליליים מצמצמים) |
| `tracking` | number |  | סוג אחר של התאמת ריווח אותיות. בעוד `letterSpacing` מוסיף כמות קבועה באופן אחיד, זה משתמש בטבלת התאמת הריווח המובנית בגופן עצמו (טבלת AAT ‏`trak`) כדי לצמצם או להרחיב את הריווח בערכי עיצוב התלויים בגודל הגופן. המספר הוא "ערך המסלול" של הטבלה: 0 = רגיל, שלילי = צפוף יותר, חיובי = רחב יותר (ערכי ביניים מאונטרפלים). ללא השפעה על גופנים ללא טבלת `trak` |
| `wordSpacing` | number |  | ריווח מילים (pt; רוחב נוסף המתווסף לתווי רווח) |
| `horizontalScale` | number |  | מקדם קנה מידה המותח את צורות הגליפים אופקית (מתחת ל-1 = מצומצם, מצר את הרוחב; מעל 1 = מורחב, מרחיב אותו). הגלישה וקידום השורה מחושבים מהרוחבים המוקטנים/המוגדלים. ברירת מחדל: 1 |
| `baselineOffset` | number |  | מגדיר במפורש את מיקום קו הבסיס (הקו שעליו יושבים התווים) ב-pt מהקצה העליון של הרכיב. מחושב בדרך כלל אוטומטית, כך שאין צורך לציין (מוגדר בעיקר על ידי ייבוא PDF כדי לשחזר את מיקומי הטקסט המקוריים) |
| `firstLineIndent` | number |  | הזחת שורה ראשונה (pt) |
| `leftIndent` | number |  | הזחה משמאל (pt) |
| `rightIndent` | number |  | הזחה מימין (pt) |
| `padding` | Padding |  | ריפוד |
| `direction` | `'ltr'` = משמאל לימין / `'rtl'` = מימין לשמאל / `'auto'` = מזוהה אוטומטית מהתוכן (ניתוח טקסט דו-כיווני) |  | כיוון הטקסט |
| `openTypeScript` | string |  | תג OpenType המציין באילו כללים של מערכת כתיבה בגופן נעשה שימוש בעת המרת טקסט לצורות גליפים (shaping) (למשל `'latn'` = כתב לטיני, `'arab'` = כתב ערבי). בדרך כלל אין צורך לציין (מטופל אוטומטית לפי תוכן הטקסט) |
| `openTypeLanguage` | string |  | תג OpenType המבהיר את השפה עבור גופנים המשנים צורות גליפים לפי שפה בתוך אותה מערכת כתיבה. בדרך כלל אין צורך לציין |
| `openTypeFeatures` | Record<string, number> |  | מדליק או מכבה את תכונות החלפת הגליפים המובנות בגופן. דוגמאות: ‏`{ "palt": 1 }` = צמצום ריווח האותיות היפני, `{ "liga": 0 }` = השבתת ליגטורות, `{ "zero": 1 }` = אפס עם קו נטוי. ערכים: 0 = כבוי / 1 = דלוק; עבור תכונות בחירת גליפים, מספר גליף חלופי מבוסס 1 |
| `shrinkToFit` | boolean |  | הקטנה אוטומטית: מקטין את גודל הגופן כך שהטקסט ייכנס לרוחב ולגובה של הרכיב |
| `minFontSize` | number |  | גודל הגופן המזערי (pt) עבור `shrinkToFit`. ברירת מחדל: 4 |
| `fitWidth` | boolean |  | מתאים אוטומטית את גודל הגופן כך שהשורה הארוכה ביותר תמלא בדיוק את רוחב התוכן של הרכיב (בשני הכיוונים, הקטנה והגדלה) |
| `outlineText` | boolean |  | ממיר את הטקסט לקווי מתאר (נתיבים). ברירת מחדל: ‏`false` |
| `pdfFontMode` | `'embedded'` = מטמיע את תוכנית הגופן / `'reference'` = פולט הפניה לגופן מערכת ללא הטמעה |  | האופן שבו מטופלת תוכנית גופן ה-PDF |
| `textPaintMode` | `'fill'` = מילוי / `'stroke'` = קו מתאר בלבד / `'fillStroke'` = מילוי + קו מתאר |  | סמנטיקת צביעת הטקסט הנשמרת דרך ייבוא PDF. ברירת מחדל: ‏`fill` |
| `textStrokeColor` | string |  | צבע המשיחה עבור stroke / fillStroke |
| `textStrokeWidth` | number |  | עובי משיחת קו המתאר של הטקסט (pt) |
| `tabStops` | TabStopDef[] |  | הגדרות עצירות טאב (ראו **‏`TabStopDef`** להלן) |
| `tabStopWidth` | number |  | מרווח הטאב שהוא ברירת מחדל (pt). ‏40pt כשלא מצוין |
| `wrap` | boolean |  | גלישת שורות. ברירת מחדל: ‏`true` (undefined משמעו שהגלישה מופעלת) |

**‏`LineSpacingDef`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'single'` = שורה בודדת / `'1.5'` = 1.5 שורות / `'double'` = כפול / `'proportional'` = יחס / `'fixed'` = ערך קבוע / `'minimum'` = ערך מזערי | ✓ | סוג ריווח השורות |
| `value` | number |  | הערך עבור fixed / minimum / proportional |

**‏`TabStopDef`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `position` | number | ✓ | מיקום הטאב (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | יישור הטאב. ברירת מחדל: ‏`left` |

**‏`FillDef`** (איחוד הטיפוסים המתקבלים על ידי המילוי (`fill`) והמשיחה (`stroke`) של `path` ועל ידי המילוי (`fill`) של `rectangle`/`ellipse`. ה-`stroke` של `rectangle`/`ellipse` מקבל מחרוזת צבע אחיד בלבד)
| צורה | תיאור |
| --- | --- |
| string | צבע אחיד (`#RRGGBB` או `#RRGGBBAA`) |
| PdfSpecialColorDef | צבע ספוט (Separation/DeviceN). ציון צבע עבור דיו מסוים כגון זהב, כסף או צבעי תאגיד (ראו הטבלה שלהלן) |
| LinearGradientDef | מדרג ליניארי — הצבעים משתנים לאורך ציר המחבר שתי נקודות (ראו הטבלה שלהלן) |
| RadialGradientDef | מדרג רדיאלי — הצבעים משתנים כלפי חוץ ממרכז (ראו הטבלה שלהלן) |
| MeshGradientDef | מדרג רשת — הצבעים משתנים לאורך צורות חופשיות (ראו הטבלה שלהלן) |
| TilingPatternDef | תבנית ריצוף — ממלאת על ידי ריצוף מוטיב קטן (ראו הטבלה שלהלן) |
| FunctionShadingDef | הצללת פונקציה — הצבעים מחושבים מהקואורדינטות באמצעות נוסחה (ראו הטבלה שלהלן) |

**‏`GradientStopDef`** (עצירות צבע של מדרג; בשימוש ב-`stops` של כל מדרג)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `offset` | number | ✓ | המיקום לאורך ציר המדרג, כיחס מ-0 עד 1 (0 = נקודת ההתחלה, 1 = נקודת הסיום) |
| `color` | string | ✓ | הצבע במיקום הזה (`#RRGGBB`) |
| `opacity` | number |  | האטימות במיקום הזה (0–1). ברירת מחדל: 1 |

**‏`LinearGradientDef`** (מדרג ליניארי — מילוי שצבעיו משתנים לאורך ציר המחבר שתי נקודות)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | מבחין המציין מדרג ליניארי |
| `x1` | number |  | קואורדינטת X של נקודת ההתחלה, **כיחס מרוחב תיבת התוחם של הרכיב** (0 = הקצה השמאלי, 1 = הקצה הימני). ברירת מחדל: 0 |
| `y1` | number |  | קואורדינטת Y של נקודת ההתחלה, **כיחס מגובה תיבת התוחם של הרכיב** (0 = הקצה העליון, 1 = הקצה התחתון). ברירת מחדל: 0 |
| `x2` | number |  | קואורדינטת X של נקודת הסיום (יחס מהרוחב). ברירת מחדל: 1 (עם ברירות המחדל ללא שינוי, מדרג אופקי משמאל לימין) |
| `y2` | number |  | קואורדינטת Y של נקודת הסיום (יחס מהגובה). ברירת מחדל: 0 |
| `stops` | GradientStopDef[] | ✓ | מערך עצירות צבע (ראו הטבלה שלמעלה) |
| `spreadMethod` | `'pad'` = ממלא בצבעי הקצה / `'reflect'` = חוזר תוך שיקוף / `'repeat'` = חוזר כמות שהוא |  | כיצד לצבוע מחוץ לטווח המדרג. ברירת מחדל: ‏`'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | מטא-נתוני שימור לפליטה מחדש של מדרג PDF מיובא ללא אובדן. אין צורך לציין בתבניות הנכתבות ביד |

**‏`RadialGradientDef`** (מדרג רדיאלי — מילוי שצבעיו משתנים כלפי חוץ ממרכז)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | מבחין המציין מדרג רדיאלי |
| `cx` | number |  | קואורדינטת X של מרכז המעגל החיצוני (יחס מרוחב תיבת התוחם של הרכיב). ברירת מחדל: 0.5 |
| `cy` | number |  | קואורדינטת Y של מרכז המעגל החיצוני (יחס מהגובה). ברירת מחדל: 0.5 |
| `r` | number |  | רדיוס המעגל החיצוני, **כיחס מהגדול מבין הרוחב והגובה**. ברירת מחדל: 0.5 |
| `fx` | number |  | קואורדינטת X של נקודת המוקד (המקום שבו המדרג מתחיל) (יחס מהרוחב). ברירת מחדל: ‏`cx` |
| `fy` | number |  | קואורדינטת Y של נקודת המוקד (יחס מהגובה). ברירת מחדל: ‏`cy` |
| `fr` | number |  | רדיוס מעגל המוקד (יחס מהגדול מבין הרוחב והגובה). ברירת מחדל: 0 |
| `stops` | GradientStopDef[] | ✓ | מערך עצירות צבע |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | כיצד לצבוע מחוץ לטווח (זהה ל-`LinearGradientDef`). ברירת מחדל: ‏`'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | מטא-נתונים לפליטה מחדש ללא אובדן של ייבוא PDF. אין צורך לציין בתבניות הנכתבות ביד |

**‏`MeshGradientDef`** (מדרג רשת — מילוי המקצה צבעים לקודקודים של סריגים או משולשים ומשנה צבעים לאורך צורות חופשיות)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | מבחין המציין מדרג רשת |
| `patches` | MeshPatchDef[] |  | מערך של טלאי משטח. לכל טלאי יש `points` (רשת נקודות בקרה 4×4 המבוטאת כ-32 מספרים בסדר x,y; **הקואורדינטות הן ב-pt מקומיים לרכיב**) ו-`colors` (צבעי 4 הפינות) |
| `triangles` | MeshTriangleDef[] |  | מערך משולשי מדרג. לכל משולש יש `points` (x0,y0,x1,y1,x2,y2; ‏pt מקומיים לרכיב) ו-`colors` (צבעי 3 הקודקודים); הצבעים מאונטרפלים בין הקודקודים |
| `lattice` | MeshLatticeDef |  | רשת בצורת סריג. יש לה `columns` (מספר הקודקודים בכל שורה, 2 או יותר), `points` (רצף קואורדינטות קודקוד; ‏pt מקומיים לרכיב) ו-`colors` (צבע אחד לכל קודקוד, באותו סדר כמו `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | ייצוג קומפקטי של נתוני רשת מקוריים המיובאים מ-PDF. אין צורך לציין בתבניות הנכתבות ביד |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | כנ"ל, עבור משולשי מדרג |
| `pdfShading` | PdfMeshShadingDef |  | מטא-נתונים לפליטה מחדש ללא אובדן של ייבוא PDF. אין צורך לציין בתבניות הנכתבות ביד |

**‏`TilingPatternDef`** (תבנית ריצוף — ממלאת על ידי ריצוף מוטיב קטן; לקווקוו, לוחות שחמט, לוגואים חוזרים וכדומה)

"מרחב התבנית" בטבלה הוא מערכת הקואורדינטות של התבנית עצמה. אם `matrix` אינו מצוין, הוא מתלכד עם קואורדינטות ה-pt המקומיות לרכיב.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | מבחין המציין תבנית ריצוף |
| `bbox` | [number, number, number, number] | ✓ | תיבת התוחם של מוטיב אחד (תא התבנית), בקואורדינטות מרחב התבנית |
| `xStep` | number | ✓ | מרווח החזרה האופקי של התא (מרחב התבנית) |
| `yStep` | number | ✓ | מרווח החזרה האנכי של התא (מרחב התבנית) |
| `graphics` | TileGraphicDef[] | ✓ | מערך הגרפיקות המצוירות בתוך התא, מובחנות לפי `kind`: ‏`'path'` (נתוני נתיב SVG + מילוי/משיחה) / `'image'` (מפנה למזהה משאב תמונה דרך `source`) / `'text'` (טקסט עם גופן, גודל וצבע) / `'group'` (קבוצה מקוננת עם טרנספורמציה, חיתוך, אטימות וכדומה). כל הקואורדינטות הן במרחב התבנית |
| `tilingType` | 1 = ריווח קבוע (התאים עשויים להתעוות מעט כדי להתאים להתקן הפלט) \| 2 = ללא עיוות (הריווח עשוי להשתנות מעט) \| 3 = ריווח קבוע עם ריצוף מהיר |  | מצב דיוק הריצוף. ברירת מחדל: 1 |
| `paintType` | `'colored'` = התבנית נושאת צבעים משלה / `'uncolored'` = מגוונת כצבע אחד עם ה-`color` של הצרכן |  | האופן שבו הצבע נישא. ברירת מחדל: ‏`'colored'` |
| `color` | string |  | צבע הגיוון בשימוש בתבנית `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | מטריצת טרנספורמציה אפינית ממרחב התבנית אל המרחב המקומי לרכיב. ברירת מחדל: מטריצת הזהות |

**‏`FunctionShadingDef`** (הצללת פונקציה — מילוי שצבעו מחושב על ידי נוסחה מהקואורדינטות (x, y); מופיע בעיקר בייבוא PDF)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | מבחין המציין הצללת פונקציה. יש שתי וריאנטות: צורת נוסחה עם `expression` וצורת דגימה עם `sampled` |
| `domain` | [number, number, number, number] | ✓ | תחום הקלט `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (צורת הנוסחה בלבד) | ביטוי מחשבון PostScript‏ (PDF FunctionType 4). מקבל x, y ומחזיר r, g, b. דוגמה: ‏`'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (צורת הדגימה בלבד) | נתוני פונקציה דגומה (PDF FunctionType 0). יש לה `size` (מידות רשת הדגימה), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (טווח הפלט), `samples` (ערכי הדגימה לכל נקודת רשת), ובאופן אופציונלי `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | מטריצת מיפוי מתחום הקלט אל **pt מקומיים לרכיב**. ברירת מחדל: מטריצת הזהות |
| `background` | [number, number, number] |  | צבע הרקע מחוץ לתחום (רכיבי DeviceRGB, ‏0–1) |
| `bbox` | [number, number, number, number] |  | תיבת תוחם המגבילה את הצביעה |
| `antiAlias` | boolean |  | רמז להחלקת קצוות |
| `paintOperator` | `'pattern'` = נצבע כתבנית (ברירת מחדל) / `'sh'` = מצויר ישירות תחת החיתוך הנוכחי |  | שיטת הצביעה עבור פלט PDF |

**‏`PdfSpecialColorDef`** (מילוי צבע ספוט — ציון צבע להדפסה בדיו מסוים, כגון זהב, כסף או צבעי תאגיד, שערבוב CMYK רגיל אינו יכול לשחזר)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | מבחין המציין מילוי צבע ספוט |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | מרחב הצבע של צבע הספוט. דיו יחיד משתמש ב-`kind: 'separation'` עם `name` (שם הדיו), `alternate` (מרחב צבע התהליך המשמש במקומו בסביבות ללא דיו הספוט; ראו הטבלה שלהלן), ו-`tintTransform` (מציין את ההמרה מגוון לצבע החלופי כפונקציית PDF, למשל `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = לבן בגוון 0 וכחול ב-1). דיו מרובה משתמש ב-`kind: 'deviceN'` עם `names` (מערך שמות דיו), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = תקני / `'NChannel'` = צורה מורחבת היכולה לשאת מידע מאפיינים לכל דיו), `colorants` (מפה משם כל דיו להגדרת דיו יחיד), `process` ו-`mixingHints` |
| `components` | number[] | ✓ | ערך הגוון של כל דיו (0–1) |
| `displayColor` | string | ✓ | הצבע המשמש במקום עבור תצוגה על המסך ותצוגות מקדימות, שאין להן את דיו הספוט |

**‏`PdfProcessColorSpaceDef`** (מרחב צבע תהליך — מרחב הצבע של "צבעים רגילים" המבוטאים על ידי ערבוב דיו תקני כגון CMYK. בשימוש ב-`alternate` של צבע ספוט וב-`colorSpace` של מסכה רכה, מובחן לפי `kind`)

| וריאנטה (`kind`) | פרופרטי נוספים | תיאור |
| --- | --- | --- |
| `'gray'` | אין | גווני אפור (DeviceGray) |
| `'rgb'` | אין | RGB (DeviceRGB) |
| `'cmyk'` | אין | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (כולם חובה) | אפור מכויל קולורימטרית (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (לכל רכיב), `matrix` (3×3) (כולם חובה) | RGB מכויל קולורימטרית (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (כולם חובה) | מרחב הצבע L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (בייטים של פרופיל ICC) (כולם חובה) | מרחב צבע המבוסס על פרופיל ICC |

`whitePoint`/`blackPoint` מצוינים כמערכי `[x, y, z]` במרחב הצבע CIE XYZ.

### פרופרטי של רצועות (`bands`) וקבוצות (`groups`)

עשרת סוגי הרצועות המצוינים ב-`bands` של התבנית (ראו "עמוד הוא ערימה של רצועות") מוגדרים כולם עם ה-`BandDef` הבא (רק `details` הוא מערך של `BandDef`).

**‏`BandDef`**

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `height` | number | ✓ | הגובה המזערי של הרצועה (pt). גדל כשרכיבים מתמתחים |
| `elements` | ElementDef[] |  | הרכיבים הממוקמים על הרצועה |
| `startNewPage` | boolean |  | תמיד מתחיל את הרצועה הזו בעמוד חדש |
| `spacingBefore` | number |  | רווח לפני הרצועה (pt) |
| `spacingAfter` | number |  | רווח אחרי הרצועה (pt) |
| `splitType` | `'stretch'` = מדפיס כמה שנכנס בעמוד וממשיך את היתר בעמוד הבא (ברירת מחדל) / `'prevent'` = אינו מפצל; שולח את הרצועה כולה לעמוד הבא (היא מפוצלת אם אינה נכנסת גם בעמוד החדש) / `'immediate'` = מפצל מיד במיקום הנוכחי, אפילו באמצע רכיב |  | האופן שבו הרצועה מפוצלת כשאינה נכנסת בגבול עמוד |
| `printWhenExpression` | Expression \| null |  | כשתוצאת ההערכה שקרית, הרצועה הזו אינה נפלטת |

**‏`GroupDef`** (כל רשומה ב-`groups`)

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם הקבוצה. מופנה מ-`resetGroup` של משתנה ומ-`evaluationGroup` של textField |
| `expression` | Expression | ✓ | מפתח הקבוצה. מוערך עבור כל שורה; בכל מקום שבו הערך משתנה, הקבוצה הקודמת נסגרת וקבוצה חדשה מתחילה |
| `header` | BandDef |  | הרצועה הנפלטת בתחילת הקבוצה |
| `footer` | BandDef |  | הרצועה הנפלטת בסוף הקבוצה |
| `keepTogether` | boolean |  | כשהקבוצה כולה אינה נכנסת במקום הנותר אך הייתה נכנסת בעמוד חדש, מתחיל אותה לאחר מעבר עמוד |
| `minHeightToStartNewPage` | number |  | מתחיל את הקבוצה בעמוד חדש כשהגובה הנותר של העמוד קטן מהערך הזה (pt) |
| `reprintHeaderOnEachPage` | boolean |  | כשהקבוצה משתרעת על מספר עמודים, מדפיס מחדש את הכותרת בכל עמוד המשך |
| `resetPageNumber` | boolean |  | מאפס את `PAGE_NUMBER` ל-1 כשהקבוצה מתחילה |
| `startNewPage` | boolean |  | מתחיל כל קבוצה בעמוד חדש |
| `startNewColumn` | boolean |  | מתחיל כל קבוצה בטור חדש |
| `footerPosition` | `'normal'` = נפלט מיד אחרי שורות הפירוט (ברירת מחדל) / `'stackAtBottom'` = נערם לכיוון תחתית העמוד / `'forceAtBottom'` = תמיד ממוקם ממש בתחתית העמוד, וצורך את המקום הנותר שביניהם / `'collateAtBottom'` = מסתדר בתחתית רק כאשר הכותרת התחתונה של קבוצה אחרת מיושרת לתחתית (זהה ל-`'normal'` בפני עצמו) |  | המיקום האנכי של הכותרת התחתונה של הקבוצה |

### פרופרטי הזמינים בסגנונות (`styles`)

הסגנונות מוגדרים במערך `styles` של התבנית ומופנים לפי `name` מהפרופרטי `style` של רכיב. גופנים, יישור טקסט, צבעים והגדרות אחרות הקשורות לטקסט נעשים בעיקר דרך סגנונות.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם הסגנון (מופנה מ-`style` של רכיבים) |
| `parentStyle` | string |  | שם סגנון האב. יורש את הפרופרטי של האב ודורס אותם בהגדרות שלו (הפניות מעגליות מתעלמים מהן) |
| `isDefault` | boolean |  | סגנון בעל `true` מוחל כברירת מחדל על רכיבים ללא `style` |
| `fontFamily` | string |  | משפחת הגופן. ברירת מחדל: ‏`'default'` |
| `fontSize` | number |  | גודל הגופן (pt). ברירת מחדל: 10 |
| `bold` | boolean |  | מודגש. ברירת מחדל: ‏`false` |
| `italic` | boolean |  | נטוי. ברירת מחדל: ‏`false` |
| `underline` | boolean |  | קו תחתי. ברירת מחדל: ‏`false` |
| `strikethrough` | boolean |  | קו חוצה. ברירת מחדל: ‏`false` |
| `forecolor` | string |  | צבע קדמה (`#RRGGBB` או `#RRGGBBAA`). ברירת מחדל: ‏`#000000` |
| `backcolor` | string |  | צבע רקע. ברירת מחדל: ‏`transparent` |
| `hAlign` | `'left'` = יישור לשמאל / `'center'` = מרכוז / `'right'` = יישור לימין / `'justify'` = יישור לשני הצדדים |  | יישור אופקי. ברירת מחדל: ‏`left` |
| `vAlign` | `'top'` = יישור לראש / `'middle'` = יישור לאמצע / `'bottom'` = יישור לתחתית |  | יישור אנכי. ברירת מחדל: ‏`top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | סיבוב הטקסט (מעלות) |
| `padding` | Padding |  | ריפוד |
| `border` | BorderDef |  | מסגרת |
| `mode` | `'opaque'` = ממלא את הרקע ב-`backcolor` / `'transparent'` = אינו ממלא את הרקע |  | מצב תצוגה |
| `opacity` | number |  | אטימות (0.0–1.0) |
| `variation` | Record<string, number> |  | ערכי צירים של גופן משתנה (למשל `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = כתיבה אופקית / `'vertical-rl'` = כתיבה אנכית שבה השורות מתקדמות מימין לשמאל / `'vertical-lr'` = כתיבה אנכית שבה השורות מתקדמות משמאל לימין |  | כיוון הכתיבה |
| `conditionalStyles` | ConditionalStyleDef[] |  | סגנונות מותנים (ראו הטבלה שלהלן). כשתנאי מתקיים, הפרופרטי המתאימים נדרסים |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | כיוון הטקסט (ltr = משמאל לימין / rtl = מימין לשמאל / auto = מזוהה אוטומטית מהתוכן) |
| `openTypeScript` | string |  | תג OpenType המציין באילו כללים של מערכת כתיבה בגופן נעשה שימוש בעת המרת טקסט לצורות גליפים (shaping) (למשל `'latn'` = כתב לטיני, `'arab'` = כתב ערבי). בדרך כלל אין צורך לציין (מטופל אוטומטית לפי תוכן הטקסט) |
| `openTypeLanguage` | string |  | תג OpenType המבהיר את השפה עבור גופנים המשנים צורות גליפים לפי שפה בתוך אותה מערכת כתיבה. בדרך כלל אין צורך לציין |
| `openTypeFeatures` | Record<string, number> |  | מדליק או מכבה את תכונות החלפת הגליפים המובנות בגופן. דוגמאות: ‏`{ "palt": 1 }` = צמצום ריווח האותיות היפני, `{ "liga": 0 }` = השבתת ליגטורות, `{ "zero": 1 }` = אפס עם קו נטוי. ערכים: 0 = כבוי / 1 = דלוק; עבור תכונות בחירת גליפים, מספר גליף חלופי מבוסס 1 |

**‏`ConditionalStyleDef`**
| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | התנאי להחלה. כשהוא אמיתי, הפרופרטי שלהלן דורסים את הסגנון |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | טיפוסים זהים לפרופרטי StyleDef בעלי אותם שמות |  | ערכים הנדרסים כשהתנאי מתקיים (המשמעויות זהות לפרופרטי StyleDef המתאימים) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | טיפוסים זהים לפרופרטי StyleDef בעלי אותם שמות |  | מוצהרים בהגדרת הטיפוס, אך המימוש הנוכחי אינו מחיל את הדריסות שלהם כשהתנאי מתקיים |

### טיפוסים לייבוא PDF ולתכונות PDF מתקדמות

הטיפוסים המפורטים כאן משרתים שתי מטרות: (1) טיפוסי "שימור" לפליטה מחדש של PDF מיובא מבלי לאבד ולו בייט אחד, ו-(2) טיפוסים לשימוש בתכונות מתקדמות כגון שכבות PDF, סקריפטים של טפסים והגדרות הכנה לדפוס מסחרי. כמעט לעולם לא תציינו אותם בעת כתיבת דוח רגיל ביד. טיפוסים המתוארים כ"מוגדרים על ידי ייבוא PDF" מופיעים בתוך הרכיבים הנוצרים על ידי `importPdfPage()`.

**‏`OptionalContentDef`** (תכונת שכבות PDF)

PDF יכול למקם תוכן על "שכבות" (קבוצות תוכן אופציונלי, OCG), שאת הנראות וההדפסה שלהן אפשר להחליף מלוח השכבות של המציג. ציון זה ב-`optionalContent` של רכיב ממקם את הרכיב הזה על שכבה. דוגמה: הנחת סימן מים "סודי" על שכבה המופיעה רק בהדפסה.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `name` | string | ✓ | שם השכבה המוצג בלוח השכבות של המציג |
| `visible` | boolean |  | הנראות ההתחלתית על המסך. ברירת מחדל: true |
| `print` | boolean |  | מצב ההדפסה ההתחלתי. ברירת מחדל: עוקב אחרי `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | מוגדר על ידי ייבוא PDF. משמר את הגדרת השכבה של ה-PDF המקורי (OCG) או הגדרת חברוּת (OCMD) המחליטה על הנראות מצירוף של מספר שכבות. לחברוּת יש `groups` (השכבות היעד), `policy` (`'AllOn'` = נראה כשכולן דלוקות / `'AnyOn'` = כשאחת כלשהי דלוקה / `'AnyOff'` = כשאחת כלשהי כבויה / `'AllOff'` = כשכולן כבויות), וביטוי לוגיקת נראות אופציונלי `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | מוגדר על ידי ייבוא PDF. משמר את תצורת השכבות ברמת המסמך כולו (רשימת כל השכבות, תצורת ברירת המחדל, עץ סדר התצוגה של לוח השכבות, קבוצות בחירה בלעדית, נעילה וכדומה) |

**‏`PdfRawValueDef`** ("ערכים גולמיים" של PDF)

רבים מפרופרטי השימור נושאים נתונים פנימיים של PDF כ"ערכים גולמיים", מבלי לפרש אותם. ערך גולמי הוא ערך JavaScript בעל הצורה הבאה: ‏`null`, בוליאנים ומספרים כמות שהם; שם PDF הוא `{ kind: 'name', value: 'DeviceRGB' }`; מחרוזת היא `{ kind: 'string', bytes: Uint8Array }`; מערך הוא `{ kind: 'array', items: [...] }`; מילון הוא `{ kind: 'dictionary', entries: { ... } }`; זרם הוא `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**‏`PdfActionDef`** (פעולות המבוצעות על ידי מציג PDF)

בשימוש ב-`additionalActions` של שדות טופס ובמקומות אחרים, זה מגדיר "מה המציג צריך לעשות". התכנים רק עוברים סריאליזציה וייבוא — **מנוע הליבה לעולם אינו מריץ אותם** (ההרצה נעשית על ידי מציג התומך בהם).

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | סוג הפעולה. ‏`'JavaScript'` = הרצת סקריפט (עיצוב קלט טופס, אימות וחישוב אוטומטי משתמשים בזה) / `'GoTo'` = מעבר ליעד בתוך המסמך / `'GoToR'` = מעבר למסמך אחר / `'GoToE'` = מעבר למסמך מוטמע / `'URI'` = פתיחת כתובת URL / `'Launch'` = הפעלת יישום או קובץ / `'Named'` = פקודה מוגדרת מראש (עמוד הבא וכדומה) / `'SubmitForm'` = שליחת הטופס / `'ResetForm'` = איפוס הטופס / `'ImportData'` = ייבוא נתונים / `'Hide'` = החלפת נראות הערות / `'SetOCGState'` = החלפת נראות שכבות / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = פעולות PDF תקניות אחרות |
| `entries` | Record<string, PdfRawValueDef> | ✓ | מילון המחזיק את ההגדרות של כל סוג פעולה כערכים גולמיים (ראו **‏`PdfRawValueDef`** למעלה). דוגמה: עבור `'JavaScript'`, ‏`{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | היעד עבור משפחת `'GoTo'`. או בעל שם (`{ kind: 'named', name, representation: 'name' \| 'string' }`) או מפורש (עמוד היעד + האופן שבו התצוגה מותאמת) |
| `structureDestination` | PdfStructureDestinationDef |  | יעד המבוסס על רכיב מבנה מסמך (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | מציין את ההערה שאליה מכוונות פעולות מדיה |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | רצף השכבות והפעולות (`'ON'` / `'OFF'` / `'Toggle'`) המוחלפות על ידי `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | מציין את שמות השדות שאליהם מכוונות `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | ציון קובץ מוטמע עבור `'GoToE'` (מבנה רקורסיבי) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | פרמטרים ייחודיים לפלטפורמה עבור `'Launch'`. משומרים בלבד, לעולם אינם מורצים |
| `articleTarget` | PdfArticleActionTargetDef |  | ציון שרשור מאמר עבור `'Thread'` |
| `documentPartIndex` | number |  | מספר חלק המסמך היעד עבור `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | מספר מופע של מדיה עשירה |
| `next` | PdfActionDef \| PdfActionDef[] |  | הפעולה/ות להרצה בהמשך (שרשור) |

**‏`PdfFormXObjectDef`** (שימור מטא-נתונים עבור רכיבי PDF מיובאים)

בתוך PDF, אפשר לארוז תוכן ציור שנעשה בו שימוש חוזר לתוך רכיבים הנקראים "Form XObjects". ייבוא PDF ממיר רכיב כזה לרכיב `frame` ושומר את מערכת הקואורדינטות ואת המטא-נתונים של הרכיב בטיפוס הזה כך שאפשר יהיה לשחזר אותם בפליטה מחדש. אין צורך לציין בתבניות הנכתבות ביד.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | תיבת התוחם של הרכיב (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | מטריצת הטרנספורמציה של מערכת הקואורדינטות של הרכיב (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | טרנספורמציית הקואורדינטות שהייתה בתוקף כשהרכיב הזה צויר ב-PDF המקורי |
| `formType` | 1 |  | מספר סוג הטופס של הרכיב (מפרט ה-PDF מגדיר רק 1) |
| `group` | Record<string, PdfRawValueDef> |  | שימור בערכים גולמיים של מילון קבוצת השקיפות |
| `reference` | Record<string, PdfRawValueDef> |  | שימור בערכים גולמיים של מילון ההפניה ל-PDF חיצוני |
| `metadata` | צורת זרם של PdfRawValueDef (`kind: 'stream'`) |  | משמר את זרם המטא-נתונים |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | משמר נתונים ייחודיים ליישום היוצר (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | משמר את חותמת הזמן של השינוי האחרון |
| `structParent` / `structParents` | number |  | משמר את מפתחות ההתאמה אל PDF מתויג (מבנה מסמך כגון סדר קריאה) |
| `opi` | PdfOpiMetadataDef |  | משמר מידע OPI (ראו הטבלה שלהלן) |
| `name` | string |  | שם הרכיב |
| `measure` | PdfMeasurement |  | משמר מידע מדידה (ראו הטבלה שלהלן) |
| `pointData` | PdfPointData[] |  | משמר נתוני ענן נקודות (ראו הטבלה שלהלן) |

**‏`PdfSourceVectorDef`** (הגדרות משותפות של צורות חוזרות מיובאות)

בעת ייבוא PDF שבו אותה צורה חוזרת בכמויות גדולות — כמו סמלי מפה — נתוני קו המתאר של הצורה משומרים בצורת "הגדרה אחת + N מיקומים". זה מופיע ב-`pdfSourceVector` של רכיב `path`; כשמצוין, לא מתבצע ניתוח של `d`. אין צורך לציין בתבניות הנכתבות ביד.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | מערך הגדרות צורה הניתנות לשימוש חוזר. לכל הגדרה יש `commands` (0 = מעבר לנקודת ההתחלה [2 קואורדינטות], 1 = קו ישר [2], 2 = עקומת בזייה קובית [6], 3 = סגירת נתיב [0]) ו-`coords` (מערך שטוח של קואורדינטות בסדר הפקודות) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | מערך המיקומים של ההגדרות. לכל מיקום יש `definitionIndex` (מספר ההגדרה) ו-`matrix` (מטריצה אפינית בת 6 איברים) |

**‏`PdfOpiMetadataDef`** (מידע החלפת תמונות לדפוס מסחרי)

OPI‏ (Open Prepress Interface) הוא מנגנון של דפוס מסחרי שבו נעשה שימוש בתמונה קלה ברזולוציה נמוכה בזמן העריכה, והיא מוחלפת בתמונה ברזולוציה גבוהה כשבית הדפוס מפיק את הפלט. משומר כאשר ה-PDF המיובא נשא את המפרט הזה.

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | גרסת OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | מחזיק את תכני מילון ה-OPI כערכים גולמיים של PDF (שם קובץ המקור להחלפה, אזור החיתוך וכדומה) |

**‏`PdfMeasurement`** (מידע מדידה לשרטוטים ולמפות)

בקובצי PDF של שרטוטים ומפות, כלי המדידה של המציג יכולים למדוד מרחקים ושטחים בקנה מידה כגון "1 ס"מ על הנייר מתאים ל-1 מ' בעולם האמיתי". הטיפוס הזה משמר את קנה המידה הזה ואת מידע מערכת הקואורדינטות, ובא בצורה ישרת-קווים (`kind: 'rectilinear'`) ובצורה גיאו-מרחבית (`kind: 'geospatial'`).

| פרופרטי (`'rectilinear'`) | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | מבחין למדידה ישרת-קווים |
| `scaleRatio` | string | ✓ | טקסט התצוגה של קנה המידה (למשל `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` אופציונלי) | שרשרת של פורמטי תצוגת מספרים עבור כיווני X/Y (תוויות יחידה, מקדמי המרה, תצוגה עשרונית/שברית וכדומה). כש-`y` מושמט, נעשה שימוש ב-`x` |
| `distance` / `area` | PdfNumberFormat[] | ✓ | פורמטי תצוגת מספרים עבור מרחק/שטח |
| `angle` / `slope` | PdfNumberFormat[] |  | פורמטי תצוגת מספרים עבור זווית/שיפוע |
| `origin` | [number, number] |  | ראשית המדידה |
| `yToX` | number |  | מקדם ההמרה מיחידות Y ליחידות X |

| פרופרטי (`'geospatial'`) | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | מבחין למדידה גיאו-מרחבית |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | מערכת קואורדינטות גיאודטית. נדרש או קוד EPSG או מחרוזת WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | נקודות בקרה בקואורדינטות גיאודטיות ונקודות הבקרה המקומיות המתאימות בתוך התמונה או הרכיב (מספר זהה) |
| `dimension` | 2 \| 3 |  | ממד הקואורדינטות. ברירת מחדל: 2 |
| `bounds` | [number, number][] |  | המצולע של האזור הניתן למדידה |
| `displayCoordinateSystem` | זהה ל-`coordinateSystem` |  | מערכת הקואורדינטות לתצוגה |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | יחידות התצוגה המועדפות למרחק, לשטח ולזווית |
| `projectedCoordinateSystemMatrix` | טאפל מספרים בן 12 איברים |  | מטריצה אפינית 4×4 עבור מערכת הקואורדינטות המוקרנת (12 איברים בסדר שורות, כשהעמודה הרביעית הקבועה מושמטת) |

**‏`PdfPointData`** (נתוני ענן נקודות של מפה)

לשימור טבלאות נתוני נקודות המוטמעות בקובצי PDF של מפות, עם טורים בעלי שמות כגון `LAT` (קו רוחב), `LON` (קו אורך) ו-`ALT` (גובה).

| פרופרטי | טיפוס / ערכים מותרים | חובה | תיאור |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | מערך שמות הטורים (ייחודיים ולא ריקים; הטורים `LAT`/`LON`/`ALT` חייבים להיות מספריים) |
| `rows` | PdfRawValueDef[][] | ✓ | הערכים של כל שורה. אורך השורה תואם את `names` |

**‏`TransferFunctionDef`** / **‏`CalculatorFunctionDef`** (פונקציות העברת גוונים להכנה לדפוס)

פונקציות המשמשות ב-`deviceParams` וב-`softMask` של `frame`, הממפות ערך (0–1) לערך אחר. בהכנה לדפוס הן מבטאות עקומות גוון — "דיו בצפיפות זו מודפס בצפיפות ההיא". ‏`TransferFunctionDef` הוא או `CalculatorFunctionDef` (ביטוי מחשבון PostScript, למשל `{ expression: '{ 1 exch sub }' }` = היפוך שחור ולבן) או `PdfFunctionDef` (אובייקט פונקציית PDF: טבלה של ערכים דגומים, אינטרפולציה מעריכית, או שילוב שלהם); במקום שבו הוא בשימוש, אפשר לציין גם `'Identity'` (ללא טרנספורמציה).

**‏`HalftoneDef`** (הגדרת רשת גוונים להכנה לדפוס)

מכונות דפוס מבטאות מדרג גוונים באמצעות גודלן של נקודות קטנות (נקודות רשת). זה מציין כיצד הנקודות הללו בנויות, ומשמש לשימור בייבוא PDF וליצירת נתוני הכנה לדפוס. ‏`type` מבחין בין חמש צורות:

| צורה | פרופרטי עיקריים | תיאור |
| --- | --- | --- |
| type 1 (מסך) | `frequency` (צפיפות המסך) ✓, `angle` (זווית) ✓, `spotFunction` (צורת הנקודה; שם מוגדר מראש כגון `'Round'` או ביטוי מחשבון) ✓, `accurateScreens` (מבקש בניית מסך בדיוק גבוה; אופציונלי) | צורה תקנית המגדירה את רשת הגוונים לפי צפיפות, זווית וצורת נקודה (אפשר להשמיט את `type`) |
| type 6 (מערך ספים) | `width` ✓, `height` ✓, `thresholds` (width × height ערכים, 0–255) ✓ | מגדיר את רשת הגוונים ישירות בטבלת ספים |
| type 10 (ספים בזווית) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | הגדרת ספים עם תאים בזווית |
| type 16 (ספים 16 סיביות) | `width` ✓, `height` ✓, `thresholds` (ערכי 16 סיביות) ✓, מלבן שני אופציונלי | הגדרת ספים בדיוק גבוה |
| type 5 (אוסף לכל לוח) | `halftones` (מערך של `{ colorant: שם הדיו, halftone: כל אחת מהצורות שלמעלה }`) ✓ | מקצה רשת גוונים שונה לכל לוח צבע, כגון ציאן ומגנטה |

ארבע הצורות מלבד type 5 יכולות לשאת `transferFunction` אופציונלי (`'Identity'` או `TransferFunctionDef`) (עבור type 5, כל הגדרת רשת גוונים פנימית לכל לוח נושאת אחד משלה).

## API הליבה

ה-API הנפוצים ביותר, מפורטים אחד-אחד עם דוגמה מזערית כך שתוכלו לחפש אותם לפי "מה שאתם רוצים לעשות". ‏`template`, `dataSource`, `fontMap` ו-`fonts` מונחים כמדויקים לאלה שנבנו במדריך.

### בניית דוח

#### בניית דוח מתבנית ומנתונים — `createReport()`

פורס את התבנית והנתונים ומחזיר `RenderDocument` מכוון-עמודים. הביטויים משתמשים בשפת ביטויים מובנית ובטוחה היכולה להפנות אל `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` ועוד — לא נעשה שימוש ב-`eval` או ב-`Function`. ביטויי callback של TypeScript הם אפשרות נוספת.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // מספר העמודים שנפרסו
```

#### איתור ושינוי רכיבי תבנית לפי ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

שני ה-API מחזירים הפניות לרכיבים של התבנית המקורית. בצעו את השינויים שלכם לפני הקריאה ל-`createReport()`. ‏`getElementChildren()` מחזיר רכיבי ילד רק עבור `frame` ו-`table` (רכיבים בתוך תאים); עבור רכיבים אחרים הוא מחזיר מערך ריק. לפרטים על טווח החיפוש, ראו "איתור רכיבים לפי ID ושינויָם לפני הרינדור".

#### בניית דוח מקובץ `.report` — `createReportFromFile()` (Node.js)

קורא תבנית JSON ופותר נתיבים יחסיים לתמונות ולתת-דוחות ביחס לספריית התבנית.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### שילוב מספר דוחות לכרך אחד — `createReportBook()`

משרשר מספר תבניות — עמוד שער, גוף וכן הלאה — ל-`RenderDocument` יחיד עם מספור עמודים רציף.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### שרשור `RenderDocument`-ים שכבר נבנו — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

מזהי תמונות מתנגשים משתנים אוטומטית.

#### יצירת עמוד תוכן עניינים אוטומטית — `insertTableOfContents()`

אוסף רשומות תוכן עניינים מעוגנים (`anchorName`) בדוח ומכניס את עמודי תוכן העניינים בהתחלה.

```ts
const withToc = insertTableOfContents(
  document,
  // גודל עמוד תוכן העניינים והשוליים ב-pt (בדוגמה הזו: A4 לאורך)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // מזהה הגופן (מפתח fontMap) המשמש לטקסט תוכן העניינים
  { title: '目次' },
)
```

#### קבלת מספר העמודים של PDF קיים — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### ייבוא PDF קיים כרכיבי דוח — `importPdfPage()`

לפרטים, ראו **המרת PDF קיים לרכיבי דוח (ייבוא PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### רינדור ופלט

#### הפקת PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### תצוגה מקדימה של עמוד יחיד — `renderPage()`

רינדור עמוד-אחר-עמוד. השתמשו בו כדי לצייר רק את העמוד המוצג כרגע בתצוגה מקדימה בדפדפן.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### רינדור הדוח כולו לכל בקאנד — `render()`

מרנדר את כל העמודים לכל יעד פלט המממש את הממשק `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### ציור אל HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### הפקת SVG — `SvgBackend`

מייצר מחרוזת `<svg>` עצמאית אחת לכל עמוד.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // מערך של מחרוזות <svg>, אחת לכל עמוד
```

#### שליטה עדינה ביצירת PDF — `PdfBackend`

אופציות ייחודיות ל-PDF כגון תמונות ממוזערות של עמודים מועברות לבנאי.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` מוחל על העמוד ה-i. עבור `thumbnailImageId` (התמונה הממוזערת המוצגת ברשימת העמודים), ציינו מזהה תמונה הקיים ב-`document.images`.

#### מיזוג קובצי PDF מוגמרים — `mergePdfFiles()`

ממזג מספר קובצי PDF לאחד באמצעות מנתח PDF ב-TypeScript טהור.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### עבודה עם גופנים

#### טעינת קובץ גופן — `Font.load()`

מנתח TTF, ‏OTF, ‏TTC, ‏OTC, ‏WOFF, ‏WOFF2 ו-EOT.

```ts
const font = Font.load(fontBuffer)
```

#### מדידת רוחב טקסט — `TextMeasurer`

מדידת טקסט מהירה הנתמכת על ידי מטמון הגליפים של `Font`. הרשום ב-`fontMap`, הוא משמש גם לפריסה.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### המרת מחרוזת לרצף גליפים — `font.shapeText()`

משתמש במידע OpenType / AAT (מפרט ההרחבה של גופנים ממשפחת Apple) / Graphite (מפרט ההרחבה של גופנים ממשפחת SIL) כדי להשיג רצף גליפים (מספרי גליפים עם מיקומים וקידומים) שעליו הוחלו בחירת גליפים, ליגטורות והתאמות מיקום.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### זיהוי גליפים חסרים לפני ההדפסה — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### שימוש בברקודים, ב-SVG, בנוסחאות מתמטיות ובתמונות בפני עצמם

#### יצירת ברקוד בפני עצמו — `renderBarcode()`

מייצר צמתי ציור של ברקוד ישירות, מבלי לעבור דרך רכיב דוח.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### ניתוח ורינדור של SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### סידור נוסחה מתמטית בפני עצמה — `parseMathLaTeX()` / `layoutMathFormula()`

דורש גופן הכולל מידע מידות עבור נוסחאות מתמטיות (טבלת OpenType MATH) — למשל STIX Two Math או Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// הארגומנטים: הנוסחה המנותחת, אובייקט Font, מזהה גופן (מפתח fontMap), גודל גופן ב-pt, צבע הטקסט
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box הוא התוצאה הפרוסה; רכיבי math של תבניות מריצים את אותה פריסה עצמה בפנים
```

#### קבלת מידות תמונה — `getImageDimensions()`

תומך ב-PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### פענוח PNG — `decodePng()`

מפענח PNG ב-TypeScript טהור.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### הפקת PDF המכיל WebP/AVIF בדפדפן — `prepareBrowserPdfImageResources()`

JPEG נשמר לתוך ה-PDF ישירות, ו-PNG מטופל על ידי המפענח המובנה. בעת יצירת PDF המכיל WebP/AVIF בדפדפן, ‏`tsreport-core/browser` מפענח תחילה רק את התמונות שאליהן ה-`RenderDocument` באמת מפנה, באמצעות הקודקים התקניים של הדפדפן, ומעביר את התוצאות ליצירת ה-PDF. תמונות שלא הופנו אליהן נשמרות כמות שהן ואינן מפוענחות.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: בתי תמונה המסופקים בזמן הרינדור; catalog: הגדרות קטלוג
// מסמך ה-PDF; collection: הגדרות תיק PDF — השמיטו כל אחד מאלה שאינכם משתמשים בו
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

כדי לפענח WebP/AVIF ב-Node.js, השתמשו ב-`createNodeExternalRasterImageDecoder()` מ-`tsreport-core/node`.

## הגבלות טעינת משאבים וכללי מזהי תמונות

כללים מפורטים שיש להיוועץ בהם כשהם נעשים רלוונטיים להפעלת שרת או להטמעה כספרייה.

### הגבלת הספריות שמהן נטענות תמונות ותבניות

אפשר לתחום את טעינת קובצי התמונה לספריות המותרות במפורש.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` פותר נתיבים יחסיים ביחס לספרייה של התבנית הראשית כברירת מחדל, אך לשם תאימות לאחור הוא אינו מגביל במשתמע את טווח הטעינה עצמו. כש-`resources.fileRoot` מצוין, אותה הגבלה חלה על תמונות, על התבנית הראשית ועל תת-דוחות כאחד. תמונות חסרות מטופלות על פי הגדרת ה-`onError` של כל רכיב, והפניות המצביעות אל מחוץ לספרייה המותרת (לרבות דרך קישורים סימבוליים) תמיד מסתיימות בשגיאה.

### כללי מזהי תמונות

כל תמונה של `RenderDocument` מאותרת מתוך `RenderDocument.images` באמצעות `RenderImage.imageId` (וכך גם ה-`imageId` של חלופה) כמפתח. **הצרכנים חייבים להשתמש במזהה הזה כמפתח בדיוק כמות שהוא ואסור להם להרכיב מחדש מפתחות באמצעות חיבור נתיבים או כדומה.** המזהים מוקצים לפי הכללים הבאים.

- טעינת תמונה דרך נתיב יחסי אינה מחליפה את המזהה בנתיב המוחלט של השרת או בנתיב שנפתר מקישור סימבולי. ההפניה כפי שנכתבה בתבנית נשארת המפתח (אם נכתבה כנתיב מוחלט, הערך הזה נשמר כמות שהוא)
- הנתיב הפיזי שנפתר מקישור סימבולי משמש פנימית רק כדי להחליט אם שתי הפניות הן אותו קובץ. אפילו כשספריות הבסיס שונות, תמונות המצביעות על אותו קובץ פיזי עושות שימוש חוזר באותו מזהה
- בתצורות שבהן דוח השורש דוחה תמונה לאספקה בזמן רינדור — בשימוש ישיר ב-`createReport()` מבלי להעביר את התמונה המדוברת גם דרך `resources`, כך שההפניה הכתובה בתבנית הופכת למזהה כמות שהיא והבתים מסופקים מאוחר יותר דרך `renderToPdf(document, { images })` — תמונות מקומיות בנתיב יחסי הנטענות על ידי תת-דוחות מקבלות תמיד מזהים פנימיים שאינם תלויי מארח. מכיוון שאי אפשר למנות מראש הפניות בביטויים ובתת-דוחות דינמיים, זה אינו תלוי בשאלה אם שם התנגש בפועל או בסדר הפריסה. כתוצאה מכך, תמונה מקומית של תת-דוח לעולם אינה יכולה לחטוף מזהה של אספקה בזמן רינדור בעל אותו שם

### אספקת תמונות בזמן רינדור וחלופות

כשלא ניתן היה לפתור חלופה בזמן הפריסה, מזהה התמונה המקורי נשמר. לפיכך תצוגות מקדימות ב-Canvas/SVG אינן נעצרות, ואפשר לספק את הבתים מאוחר יותר דרך `renderToPdf(document, { images })`. ‏`images` המועברים במפורש ממוזגים לתוך `document.images`, כשהערך המועבר במפורש גובר עבור אותו מזהה. גם במהלך יצירת ה-PDF, חלופות שלא סופקו רק מוחרגות ממועמדות החלופה — לא הרינדור של התמונה הראשית ולא הדוח כולו נעצרים.

### היקף איסוף ההפניות לתמונות

איסוף ההפניות לתמונות מטפל לא רק ברכיבי `image` רגילים אלא גם בחלופות, במסכות רכות של קבוצות ובתבניות הריצוף של מילויים (fill/stroke) יחד עם המסכות הרכות המקוננות שלהן, הכול דרך אותו מנגנון. בשימוש בתמונות ממוזערות של עמודים הייחודיות ל-PDF, בתמונות ממוזערות של תיקיות אוסף או בתמונות Web Capture בדפדפן, העבירו את אותם `catalog`, `collection` ו-`pageOptions` גם ל-`prepareBrowserPdfImageResources(document, options)` וגם ל-`renderToPdf(document, options)` (עם ה-API הפרימיטיבי, העבירו את אותן אופציות ל-`new PdfBackend(options)` וקראו ל-`render(document, backend)`). גם תמונות WebP/AVIF אלה מפוענחות רק לפי הצורך לפני יצירת ה-PDF.

## דרישות סביבת הריצה

- Node.js 18 ומעלה
- ES Modules / CommonJS
- דפדפנים מודרניים
- ללא חבילות תלות בזמן ריצה

דחיסת Brotli ופריסתה עבור WOFF2 משתמשות במימוש ה-TypeScript הטהור המובנה ב-tsreport-core גם ב-Node.js וגם בדפדפנים. אין צורך בחבילות חיצוניות, ב-WASM או בספריות מקוריות.

## רישיון

tsreport-core זמין, לבחירתכם, תחת [רישיון MIT](./LICENSE-MIT) או [רישיון Apache 2.0](./LICENSE-APACHE)‏ (SPDX: `MIT OR Apache-2.0`). להודעות זכויות יוצרים ולתנאי רישיון של קוד ונתונים של צד שלישי, ראו [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
