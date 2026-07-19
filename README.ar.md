# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | العربية | [עברית](./README.he.md)

**من اليابانية والصينية والكورية إلى الكتابة العربية — محرك تقارير يحوّل أنظمة الكتابة في العالم إلى ملفات PDF جميلة، مكتوب بلغة TypeScript خالصة.**

يتولى `tsreport-core` تحليل خطوط OpenType، وتنضيد النصوص (ترتيب الحروف على الصفحة بأشكال الغليفات وعروضها ومواضعها الصحيحة)، وتخطيط التقارير القائم على الأشرطة (bands)، والمعاينة عبر Canvas/SVG، وتوليد ملفات PDF — كل ذلك من خلال نموذج عرض واحد متّسق. وهو خالٍ تمامًا من أي تبعيات وقت التشغيل. وبدون وحدات أصلية (native) وبدون WASM، تعمل هذه الحزمة الواحدة على Node.js وعلى المتصفحات الحديثة على حد سواء.

عينات الشيفرة في هذا المستند تستخدم عمدًا بيانات أعمال يابانية (عروض أسعار وفواتير): فهي تؤدي في الوقت نفسه دور عرض حي لقدرات هذا المحرك في تنضيد نصوص اللغات الصينية واليابانية والكورية (CJK).

```bash
npm install tsreport-core
```

هذا الملف التعريفي مليء بعينات يمكنك نسخها وتشغيلها كما هي، وتغطي كل شيء من توليد أول ملف PDF لك وصولًا إلى جميع عناصر التقارير الستة عشر، والكتابة العمودية، والتنضيد متعدد اللغات، وتضمين الخطوط وتحويل النص إلى مسارات (outlines)، والمعاينة في المتصفح. إذا كانت أدوات التقارير جديدة عليك، فابدأ بقسم **أساسيات تخطيط التقارير** لتكوين إحساس بالمفاهيم، ثم أنشئ أول ملف PDF لك مع الدرس التطبيقي.

## تنضيد أنظمة الكتابة في العالم تنضيدًا صحيحًا بمحرك واحد

لا يمكن عرض تقرير متعدد اللغات عرضًا صحيحًا بمجرد كتابة السلاسل النصية مباشرة في ملف PDF. فاختيار الغليفات، وقياس عرض الحروف، وتحديد المواضع، وكسر الأسطر، والكتابة العمودية، وتضمين الخطوط في ملف PDF — لا تحصل على الصفحة التي تتوقعها إلا عندما تتشابك سلسلة المعالجة هذه بأكملها معًا.

يتكفّل `tsreport-core` بهذا التدفق بأكمله، من تحليل الخط إلى توليد PDF.

- **اليابانية والصينية والكورية** — الصينية المبسطة والتقليدية، والهانغل، ومعالجة علامات الترقيم، وغليفات الكتابة العمودية، كلها تُنضَّد تنضيدًا صحيحًا استنادًا إلى بيانات Unicode وOpenType
- **الكتابة العربية والتنضيد من اليمين إلى اليسار (RTL)** — تشكيل الغليفات السياقي، والاتصال والحروف المركّبة (ligatures، اندماج عدة حروف في شكل غليف واحد)، ومعالجة Unicode ثنائية الاتجاه (التحكم في الترتيب عند اختلاط النص المكتوب من اليمين إلى اليسار بالأرقام والحروف اللاتينية) — كلها تُعالَج بنفس خط أنابيب التخطيط المستخدم لكل نظام كتابة آخر
- **أنظمة الكتابة المعقدة** — استبدال الغليفات وتحديد مواضعها وفق قواعد التنضيد المدمجة في الخط (OpenType Layout)، والحروف المركِّبة (combining characters)، والأشكال البديلة للغليفات (تصاميم بديلة للحرف نفسه)، وميزات التنضيد الخاصة بكل لغة، كلها مدعومة
- **الكتابة العمودية** — التعامل مع `vertical-rl` / `vertical-lr`، وغليفات الكتابة العمودية، والمقاييس العمودية (بيانات الأبعاد كعروض التقدّم الخاصة بالنص العمودي)، وتدوير الحروف
- **تضمين تلقائي لمجموعة جزئية من الخط** — تُضمَّن في ملف PDF الغليفات المستخدمة فعلًا فقط (بيانات الأشكال المخزنة في الخط لكل حرف)، بحيث يبدو المستند كما هو حتى على الأجهزة التي لا يتوفر فيها الخط
- **تحويل النص إلى مسارات (outlines)** — يمكن، لكل عنصر على حدة، إخراج النص كمسارات متجهية مستقلة عن الخط
- **الإحالة إلى خطوط النظام** — لسير العمل الذي يعتمد على خطوط جهاز القارئ، يمكنك أيضًا إنتاج ملفات PDF خفيفة بلا خطوط مضمّنة
- **اكتشاف تشوّه النص قبل حدوثه** — تُعلِم `checkGlyphCoverage()` بالحروف المفقودة من الخط، لكل صفحة ولكل حرف، قبل الإخراج

ويعمل هذا التنضيد النصي كوحدة واحدة مع محرك تخطيط مبني خصيصًا للتقارير — لأن القدرة على رصّ الحروف رصًّا صحيحًا والقدرة على تقسيم الصفحات تقسيمًا صحيحًا لا يمكن فصلهما.

- **تخطيط يستجيب لحجم النص** — تتمدد الصفوف مع كمية النص (`stretchWithOverflow`) وتتكيف ارتفاعات الأشرطة تلقائيًا. أسماء المنتجات الطويلة لا تُقتطع أبدًا
- **فواصل صفحات تلقائية يقودها حجم البيانات** — عندما تفيض صفوف التفاصيل، يبدأ المحرك صفحة جديدة ويعيد إخراج الترويسة وصف العناوين تلقائيًا. المجاميع الفرعية لكل مجموعة وفواصل الصفحات لا تتطلب أكثر من مجرد تصريح
- **تخطيط متداخل** — حتى التقارير المعقدة التي تجمع بين الجداول والجداول التقاطعية والتقارير الفرعية تُوضَع على نحو متّسق بواسطة محرك التخطيط نفسه
- **المعاينة مطابقة للطباعة (WYSIWYG)** — تُثبَّت العناصر عند إحداثيات pt التي تحددها بالضبط، وتتشارك معاينة Canvas/SVG نتيجة التخطيط ذاتها مع مخرجات PDF. ما تراه على الشاشة هو ما تحصل عليه على الورق

## لماذا tsreport-core

نشأ tsreport-core من ثلاثة هموم.

**لا يوجد حل تقارير جاد في TypeScript.** إنتاج عروض الأسعار والفواتير حاجة عمل أساسية، ومع ذلك فإن منظومة TypeScript/Node.js — رغم امتلاكها مكتبات للرسم منخفض المستوى في PDF — لم يكن فيها شيء يستحق أن يُسمى «محرك تقارير»: تخطيط الأشرطة، وفواصل الصفحات التلقائية، والتجميع، وتطابق المعاينة مع الطباعة في حزمة واحدة. أردنا إنهاء ممارسة جرّ بيئة تشغيل لغة أخرى أو منتج خادم خارجي لمجرد إخراج التقارير.

**إخراج التقارير قدرة أساسية، وينبغي أن يتمكن الجميع من استخدامها مجانًا.** إخراج التقارير ليس ميزة فاخرة محجوزة لقلة من المنتجات باهظة الثمن؛ بل هو جزء من أساس أي نظام أعمال. بلا تراخيص تجارية تُشترى وبلا رسوم حسب الاستخدام، ينبغي أن يتمكن الجميع — من الأدوات الشخصية إلى المنتجات التجارية — من استخدام المحرك نفسه كما هو. ينشر tsreport-core جميع ميزاته برخصة مزدوجة MIT OR Apache-2.0 تجسيدًا لهذا الاعتقاد.

**قلّة من الحلول تواجه الدعم متعدد اللغات — الكتابات الآسيوية والكتابة العربية وغيرها — مواجهة مباشرة.** معظم أدوات التقارير وPDF مصممة حول النص اللاتيني، وتعامل تنضيد اليابانية والصينية والكورية أو الكتابة العربية من اليمين إلى اليسار كأمور ثانوية. جعل tsreport-core «تنضيد أنظمة الكتابة في العالم تنضيدًا صحيحًا بمحرك واحد» هدفًا تصميميًا منذ اليوم الأول، فنفّذ داخليًا كل شيء من تحليل الخطوط إلى التنضيد والتضمين في PDF.

تتجسد هذه الدوافع في ثلاث نقاط قوة.

### من محرك التخطيط إلى توليد PDF، مكتمل في حزمة واحدة

عندما تُجمَّع الصفحات من قالب وبيانات، تُلتقط النتيجة في نموذج عرض واحد يسمى `RenderDocument`. ويمكن عرض النموذج نفسه إلى PDF أو Canvas أو SVG، فلا حاجة إلى صيانة منطق تخطيط مكرر للمعاينة على الشاشة وللطباعة — يبدو ملف PDF تمامًا كما رأيته على الشاشة. ولا حاجة إلى ربط محرك تقارير بتخطيط الأشرطة مع مكتبة PDF منفصلة.

### TypeScript خالص بلا أي تبعيات وقت التشغيل

تحليل الخطوط، وتنضيد النصوص، وتوليد PDF، وضغط DEFLATE، والتشفير، وفك ترميز PNG، وتوليد الباركود — كلها منفذة بلغة TypeScript خالصة. وبدون وحدات أصلية وبدون عمليات خارجية، يتصرف بشكل متطابق في كل بيئة، وتدقيق الشيفرة التي تعمل أثناء توليد التقرير يعني قراءة هذه الحزمة الواحدة فقط.

### كل ما يحتاجه التقرير، مدمج

- تخطيط أشرطة يشمل العنوان وترويسة الصفحة والتفاصيل والمجموعات والملخص وغير ذلك
- الجداول، والجداول التقاطعية، والتقارير الفرعية، والمتغيرات، والتعبيرات، وفواصل الصفحات، وجدول المحتويات، ودمج تقارير متعددة
- استيراد ملفات PDF الموجودة — تحويل صفحات PDF إلى عناصر تقرير (`ElementDef`) وأنماط وصور ومعلومات خطوط
- Code 39/93/128، وEAN، وUPC، وITF، وCodabar، وMSI، وQR Code، وData Matrix، وPDF417
- SVG، والتدرجات اللونية، والقصّ (clipping)، والشفافية، والتنضيد الرياضي، والصور
- تشفير PDF، وPDF/A-1b و2b و3b (معايير دولية للأرشفة طويلة الأمد)، وPDF/X-1a (معيار دولي لتسليم ملفات الطباعة)، والإشارات المرجعية، والروابط، والنماذج، والتعليقات التوضيحية
- TTF، وOTF، وTTC، وOTC، وWOFF، وWOFF2، وEOT، والخطوط المتغيرة (خطوط تتغير أوزانها وعروضها ومحاورها الأخرى تغيرًا متصلًا)، والخطوط الملونة

## أساسيات تخطيط التقارير

لمن هم جدد على محركات التقارير، يشرح هذا القسم المفاهيم التأسيسية بالترتيب.

### المنطلق: التقرير يُبنى من «قالب» زائد «بيانات»

في tsreport-core، يُبنى التقرير من جزأين: **قالب** (تعريف التخطيط) و**بيانات** (JSON).

لا يحتوي القالب على أي قيم فعلية. فهو يعرّف الإطارات فقط — «اسم الصنف يوضع هنا؛ والمبلغ هناك، بهذا العرض وبهذا التنسيق» — مع إشارات إلى **أي حقل بيانات يُعرض** في كل منها (تُكتب على شكل `field.item`، أي الحقل `item` من البيانات).

أما القيم الفعلية فتُمرَّر كبيانات JSON. كل عنصر في المصفوفة `rows` هو صف تفاصيل واحد.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

عند توليد التقرير، يمشي المحرك على `rows` من الأعلى إلى الأسفل، مُخرِجًا تخطيط التفاصيل مرة لكل صف. في المثال أعلاه تُطبع ثلاثة صفوف تفاصيل، ويتحوّل `field.item` إلى りんご ثم みかん ثم ぶどう على التوالي. وإذا نمت البيانات إلى 10,000 صف، يصبح التقرير بطول 10,000 صف دون تغيير حرف واحد في القالب. هذا التقسيم للأدوار — التخطيط ثابت، وعدد الصفوف يتبع البيانات — هو نقطة الانطلاق لكل محرك تقارير.

### الصفحة عبارة عن رصّة من «الأشرطة»

على جانب القالب، تصمّم الصفحة بعد ذلك كرصّة من شرائح أفقية تسمى **الأشرطة (bands)**. فبدلًا من حساب إحداثيات Y بنفسك ووضع العناصر على الصفحة، تصرّح فقط بـ«أي شريط يحمل ماذا»، ويجمّع المحرك الصفحات تلقائيًا وفقًا لعدد صفوف البيانات. للصفحة الواحدة البنية التالية.

```text
┌──────────────────────────┐
│ title                    │ ← مرة واحدة في بداية التقرير (العنوان، المرسل إليه، …)
├──────────────────────────┤
│ pageHeader               │ ← أعلى كل صفحة (اسم الشركة، تاريخ الإصدار، …)
├──────────────────────────┤
│ columnHeader             │ ← صف العناوين لصفوف التفاصيل (الصنف، الكمية، المبلغ، …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ مرة لكل صف من صفوف rows،
│ details                  │ │ وتتكرر بعدد ما يوجد من صفوف
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← يُغلق صفوف التفاصيل (لكل صفحة/عمود)
├──────────────────────────┤
│ pageFooter               │ ← أسفل كل صفحة (أرقام الصفحات، …)
└──────────────────────────┘
```

في الصفحة الأخيرة، بعد آخر `details`، يُخرَج `summary` (المجاميع الكلية للتقرير بأكمله ونحوها) مرة واحدة بالضبط. وإلى جانب هذه الأشرطة هناك `background` الذي يوضع تحت كل صفحة؛ و`lastPageFooter` الذي يُستخدم في الصفحة الأخيرة فقط؛ و`noData` الذي يظهر فقط عندما تكون البيانات بلا صفوف — يمكن تعريف عشرة أنواع من الأشرطة إجمالًا في `bands`.

| الشريط | متى يُخرَج | الاستخدام النموذجي |
| --- | --- | --- |
| `background` | خلفية كل صفحة | العلامات المائية، الحدود الزخرفية |
| `title` | مرة واحدة في بداية التقرير | العنوان، المرسل إليه |
| `pageHeader` | أعلى كل صفحة | اسم الشركة، تاريخ الإصدار |
| `columnHeader` | قبل صفوف التفاصيل (لكل صفحة/عمود) | صف عناوين التفاصيل |
| `details` | مرة لكل صف من البيانات (`rows`) | صفوف التفاصيل |
| `columnFooter` | بعد صفوف التفاصيل (لكل صفحة/عمود) | منطقة المجموع الفرعي |
| `pageFooter` | أسفل كل صفحة | أرقام الصفحات |
| `lastPageFooter` | أسفل الصفحة الأخيرة (يحل محل `pageFooter` عند تحديده) | ملاحظات ختامية |
| `summary` | مرة واحدة بعد كل صفوف التفاصيل | المجموع الكلي، الملاحظات |
| `noData` | عندما تكون البيانات بلا صفوف | «لا توجد بيانات مطابقة» |

إذا عرّفت إضافةً إلى ذلك `groups`، تُدرَج ترويسات المجموعات وتذييلاتها تلقائيًا حيثما يتغير مفتاح المجموعة، فتحصل على تخطيطات مثل «مجموع فرعي لكل قسم، ثم بدء صفحة جديدة».

يمكنك أيضًا تحديد `columns` في القالب (`count` = عدد الأعمدة، و`spacing` = الفجوة بين الأعمدة بوحدة pt) لتدفّق منطقة التفاصيل في عدة **أعمدة** رأسية على طريقة الصحف. الوضع الافتراضي هو عمود واحد، وفي هذه الحالة فإن كل ما يوصف في هذا المستند بأنه «لكل عمود» يعني «لكل صفحة». ويشار إلى الانتقال إلى العمود التالي بـ«فاصل الأعمدة».

### فواصل الصفحات تحدث تلقائيًا

عندما لا تعود صفوف التفاصيل تتسع في الصفحة، يقوم المحرك تلقائيًا بإغلاق تلك الصفحة (مخرِجًا `pageFooter`)، ويبدأ الصفحة التالية، ويخرِج `pageHeader` و`columnHeader` مجددًا، ثم يواصل تدفّق صفوف التفاصيل المتبقية. لا تحتاج أبدًا إلى عدّ الصفوف أو حساب الارتفاع المتبقي في الصفحة.

لا تلجأ إلى ما يلي إلا عندما تريد التحكم بنفسك.

- العنصر `break` — فرض فاصل صفحات أو فاصل أعمدة في أي موضع
- خاصية `startNewPage` للشريط — بدء ذلك الشريط دائمًا في صفحة جديدة
- خاصية `splitType` للشريط — عند عدم كفاية الارتفاع، اختيار ما إذا كان يجوز للشريط أن يمتد عبر الصفحات في منتصفه (`stretch`) أو يجب نقله إلى الصفحة التالية دون تقسيم (`prevent`)

### التقرير الفرعي = تقرير آخر مضمَّن داخل تقرير

يضمّن العنصر `subreport` ملف `.report` منفصلًا بأكمله داخل تخطيط التقرير الأب. «اطبع قائمة طلبات، وداخل كل طلب اطبع بنوده كجدول» — إنه الآلية لتخطيط **البيانات المتداخلة** من هذا القبيل.

افترض أن كل صف من `rows` الأب (طلب واحد) يحمل مصفوفة `items` من البنود.

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

ضع عنصر `subreport` في شريط `details` الخاص بالأب ومرّر «`items` هذا الطلب» عبر `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` هو، كما يقول اسمه، تعبير. لتمرير اسم ملف ثابت، لفّه بـ `'...'` كسلسلة نصية حرفية داخل التعبير (يمكنك أيضًا تبديله ديناميكيًا بتعبير مثل `"field.templatePath"`).

بعدها **يعمل التقرير الفرعي مرة واحدة لكل صف تفاصيل في الأب**، وتُعامَل `items` الممرَّرة إليه على أنها `rows` الخاصة بالتقرير الفرعي نفسه. والتقرير الفرعي (`order-items.report`) قالب مستقل بحد ذاته: له تعريفات أشرطته الخاصة ويشير إلى كل بند عبر `field.name` و`field.qty`. وعلى الصفحة يتكشّف هكذا.

```text
┌──────────────────────────────┐
│ details                      │ ← الصف 1 من rows الأب (الطلب A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← يستقبل items هذا الطلب (صفان)
│   │   details              │ │ ← الصف 1 من items ‏(りんご 10)
│   │   details              │ │ ← الصف 2 من items ‏(みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← الصف 2 من rows الأب (الطلب A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← يستقبل items هذا الطلب (صف واحد)
│   │   details              │ │ ← الصف 1 من items ‏(ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

جدول البنود داخل فاتورة، وكتلة تفاصيل تتكرر لكل عميل — «تقارير صغيرة داخل تقرير» يمكن اقتطاعها كمكوّنات وإعادة استخدامها. ويمكن أيضًا تمرير معاملات (سلاسل العناوين ونحوها) من الأب إلى الأسفل. يحتوي القسم اللاحق **عينات عاملة لكل عنصر** على مثال كامل جاهز للتشغيل لهذا الإعداد بالضبط (عنصر الأب بالإضافة إلى قالب جانب التقرير الفرعي).

## توليد PDF من ملف `.report` وبيانات JSON

ملف `.report` هو قالب تقرير: كائن `ReportTemplate` مكتوب بصيغة JSON. ولأنه JSON عادي، يمكنك تتبع الفروقات في Git وتوليده من أي لغة أو أداة.

الإعداد الأدنى هو هذه الملفات الثلاثة.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

يفترض اسما ملفي الخط وزني Regular / Bold لخط ياباني (مثل Noto Sans JP). استبدلهما بالخطوط المتوفرة لديك. أما التعامل مع لغات متعددة في تقرير واحد فيُغطى لاحقًا في **بناء تقارير متعددة اللغات**.

### 1. اكتب القالب `quotation.report`

الإحداثيات والأبعاد والهوامش وأحجام الخطوط كلها بوحدة **pt (النقطة، 1pt = 1/72 بوصة ≈ 0.353mm)**، وهي الوحدة القياسية في PDF. يُعامَل `"size": "A4"` على أنه 595 × 842pt (أبعاد ISO البالغة 210×297mm محوّلة إلى pt ومقرّبة إلى أعداد صحيحة)، وهوامش 36pt في هذا المثال تعادل نحو 12.7mm.

منطلق آخر: `fontFamily` في `styles` ليس اسم ملف خط بل **مفتاح (اسم منطقي)** ستسجّله لاحقًا في `fontMap` و`fonts` في شيفرة وقت التشغيل. استخدام الأسماء نفسها في القالب وفي الشيفرة (`jp` و`jpBold` في هذا المثال) هو ما يربطهما معًا.

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

قيمة `pattern` المستخدمة في صفوف التفاصيل هي محدِّد تنسيق للأرقام/التواريخ (`#,##0` = فواصل الآلاف، و`¥#,##0` = فواصل الآلاف مع علامة الين؛ راجع «تنسيق الأرقام والتواريخ» لاحقًا في هذا المستند للتفاصيل).

### 2. جهّز البيانات `quotation.test-data.json`

يُربط كل صف في `rows` بـ `field.*` في شريط التفاصيل، وتُربط `parameters` بـ `param.*` على مستوى التقرير كله.

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

تُربط القيم على النحو التالي.

| JSON | التعبير في `.report` | الغرض |
| --- | --- | --- |
| `rows[n].item` | `field.item` | صف التفاصيل الحالي |
| `parameters.title` | `param.title` | وسيط على مستوى التقرير كله |
| المتغير `grandTotal` | `vars.grandTotal` | متغيرات التقرير للمجاميع والأعداد وغيرها |
| سياق الصفحة | `PAGE_NUMBER` / `TOTAL_PAGES` | رقم الصفحة، إجمالي عدد الصفحات |

### 3. حمّل ملف `.report` وولّد ملف PDF

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
  // قد تتشارك كائنات Buffer في Node.js مجمّع ذاكرة أكبر؛ مرّر إلى Font.load
  // كائن ArrayBuffer مقتطعًا على بايتات هذا الملف بالضبط
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

تُسجَّل الخطوط نفسها مرتين، في `fontMap` وفي `fonts`، لأن الاثنين يؤديان دورين مختلفين: يُستخدم `fontMap` لقياس عرض الحروف وقت التخطيط (`TextMeasurer`)، بينما يُستخدم `fonts` لتضمين الخطوط وقت توليد PDF. سجّل الخط نفسه في كليهما، وتحت أسماء المفاتيح نفسها المستخدمة في `fontFamily` في القالب.

تحلّ `createReportFromFile()` المسارات النسبية للصور والتقارير الفرعية بالنسبة إلى مجلد ملف `.report` الرئيسي. وإذا حددت `workingDirectory`، يصبح ذلك المجلد هو الأساس بدلًا منه. ولتقييد ما يمكن قراءته، صرّح بالجذر المسموح به صراحةً في `resources.fileRoot`؛ فتُرفض الإشارات النسبية التي تهرب من الجذر، والروابط الرمزية التي تشير إلى خارجه.

## تعريف القوالب مباشرة في TypeScript

بدلًا من استخدام ملف `.report`، يمكنك كتابة القالب ككائن TypeScript. ومع فحص الأنواع والإكمال التلقائي في متناول يدك، يناسب هذا الأسلوب توليد القوالب من الشيفرة. المحتوى هو عرض السعر نفسه الوارد في الدرس التطبيقي. الإحداثيات والأبعاد بوحدة pt.

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

### البحث عن العناصر بالمعرّف وتعديلها قبل العرض

امنح عنصرًا معرّف `id` اختياريًا وستتمكن من استرجاعه بواسطة `findElementById()` مهما كان عمق موضعه داخل الأشرطة أو الإطارات. القيمة المعادة ليست نسخة بل هي العنصر الموجود داخل `template` نفسه، لذا فإن أي تغييرات تُجرى قبل `createReport()` تنعكس على التخطيط والعرض.

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

تبحث `findElementById()` في الأشرطة العادية، وأشرطة التفاصيل، وترويسات/تذييلات المجموعات، والإطارات، والأقنعة الناعمة (soft masks)، وخلايا الجداول بحثًا بالعمق أولًا. وعندما يظهر المعرّف نفسه أكثر من مرة، تعيد أول عنصر في ترتيب البحث، لذا أبقِ أي معرّف تنوي تعديله فريدًا داخل القالب. وعناصر المصفوفة التي تعيدها `getElementChildren()` هي بالمثل إشارات إلى داخل القالب الأصلي.

> ملفات الخطوط غير مرفقة مع الحزمة. اختر خطوطًا تناسب تراخيصُها حالةَ استخدامك وطريقة توزيعك وأذونات التضمين. النمط الواحد لا يمكنه تسمية سوى خط واحد. ولمزج حروف من لغات متعددة داخل عنصر واحد، تحتاج إلى خط Pan-CJK يغطيها كلها في ملف واحد (خط يجمع الحروف اليابانية والصينية والكورية؛ مثل Source Han Sans وNoto Sans CJK). ولاستخدام خط منفصل لكل لغة، قسّم العناصر حسب اللغة وبدّل الأنماط، كما في القسم التالي «بناء تقارير متعددة اللغات».

## بناء تقارير متعددة اللغات

يمكن لكل نمط أن يسمّي خطًا واحدًا بالضبط، ولا يوجد تراجع (fallback) تلقائي بين الخطوط. لذا فإن النمط الأساسي للتقرير متعدد اللغات هو **تحميل خط لكل لغة وتطبيق نمط كل لغة على عناصر تلك اللغة**.

المقتطف التالي من عرض سعر يعرض اليابانية والصينية المبسطة جنبًا إلى جنب. أولًا، حمّل خطًا لكل لغة.

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

في القالب، طبّق النمط `ja` على الصياغة اليابانية والنمط `zh` على الصياغة الصينية، مقسّمًا العناصر حسب اللغة.

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

وتحمل البيانات بالمثل حقلًا لكل لغة.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

الاستثناء هو **حقل واحد لا تُعرف لغته حتى وقت التشغيل**، مثل مربع ملاحظات حر. وبما أن ذلك الحقل لا يمكن تقسيمه إلى عناصر لكل لغة، فالحل العملي هو أن تخصص — لذلك النمط وحده — خط Pan-CJK يغطي أنظمة كتابة عديدة في ملف واحد (Source Han Sans وNoto Sans CJK ونحوهما). وفي كلتا الحالتين، تكتشف `checkGlyphCoverage()` أي ثغرات في تغطية الخط قبل الإخراج.

## اختيار وضع إخراج الخط لكل عنصر نصي

حتى داخل التقرير الواحد، يمكنك تحديد وضع الإخراج لكل عنصر `staticText` أو `textField` على حدة: نص مضمَّن قابل للبحث لمتن التقرير، ومسارات (outlines) للشعار، وإحالات إلى خطوط النظام للنصوص النمطية.

| الوضع | طريقة التحديد | الحالة في ملف PDF | مناسب لـ |
| --- | --- | --- | --- |
| تضمين مجموعة جزئية | `pdfFontMode: 'embedded'` (الافتراضي) | يضمّن الغليفات المستخدمة مع برنامج الخط. يمكن تحديد النص والبحث فيه | التوزيع، الأرشفة طويلة الأمد، الطباعة، التقارير متعددة اللغات |
| التحويل إلى مسارات | `outlineText: true` | يحوّل أشكال الغليفات إلى مسارات متجهية. لا يحمل أي معلومات خط | الشعارات والأعمال الجاهزة للطباعة — النصوص التي يجب تجميد أشكالها بدقة |
| الإحالة إلى خط النظام | `pdfFontMode: 'reference'` | لا يضمّن أي خط؛ يسجل اسم الخط والحروف فقط | ملفات PDF خفيفة للتوزيع الداخلي حيث تكون بيئة الخطوط تحت السيطرة |

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

تضمين المجموعة الجزئية هو الوضع الموصى به للحفاظ على أشكال الغليفات بصرف النظر عن البيئة الوجهة. أما الإحالات إلى خطوط النظام فتتطلب خطًا متوافقًا حيثما يُفتح ملف PDF، وقد يختلف المظهر من بيئة إلى أخرى. والنص المحوَّل إلى مسارات لا يمكن تحديده أو البحث فيه كنص عادي.

## الكتابة العمودية

حدّد `writingMode` على نمط فحسب، فيُنضَّد النص عموديًا باستخدام غليفات الكتابة العمودية وبيانات الأبعاد الخاصة بالوضع العمودي (المقاييس العمودية — عروض التقدّم ونحوها). يتقدم `vertical-rl` بالأسطر من اليمين إلى اليسار؛ ويتقدم `vertical-lr` بها من اليسار إلى اليمين.

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

## معاينة التقرير نفسه بالضبط في المتصفح

يمكن عرض `RenderDocument` الذي بنيته من أجل PDF مباشرةً على Canvas أيضًا. تتشارك المعاينة والطباعة نتيجة التخطيط نفسها، لذا فإن «اختلاف الشاشة عن الورق» ببساطة لا يمكن أن يحدث. وبالاقتران مع التخطيط الثابت القائم على pt، فهذا هو الأساس لتجربة معاينة وتحرير مطابقة للناتج (WYSIWYG) — تضمين الخطوط هو الافتراضي؛ وحده وضع الإحالة إلى خطوط النظام يعتمد مظهره على بيئة العرض. استدعاء واحد لـ `renderPage()` يرسم الصفحة، بما في ذلك تهيئة الصفحة وإنهاؤها.

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
  scale: 1.5, // مقياس العرض: القيمة 1.0 ترسم 1pt كـ 1px
  devicePixelRatio: window.devicePixelRatio, // يحافظ على حدة النص والخطوط على الشاشات عالية الكثافة
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

إذا كنت تبني واجهة معاينة في React، فحزمة `tsreport-react` متاحة أيضًا.

## استخدام محرك الخطوط وحده

حتى دون بناء تقرير، يمكنك استخدام كل قدرة على حدة: تحليل الخطوط، والتشكيل (تحويل سلسلة نصية إلى تسلسل الغليفات المرسومة فعلًا ومواضعها)، وقياس النص، وتوليد المجموعات الجزئية.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: عرض السلسلة بوحدة pt عند حجم 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // معرّفات الغليفات ومواضعها بعد التشكيل
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: بيانات مسار بيزييه

console.log(measurement.width, shaped, glyph.outline)
```

## تحويل ملف PDF موجود إلى عناصر تقرير (استيراد PDF)

تحلّل `importPdfPage()` صفحة من ملف PDF موجود وتحوّلها إلى مصفوفة من عناصر تقارير tsreport-core (‏`ElementDef`). هذا ليس مجرد عارض: يدخل النص كعناصر `staticText`، والصور كعناصر `image`، والأشكال كعناصر `path` — مكوّنات يمكنك تحريرها وإعادة ترتيبها مباشرة في محرك التقارير هذا.

خذ ملف PDF لنموذج كنت تديره ورقيًا، أو ملف PDF أنتجه نظام آخر، واستخدمه كأساس — مضيفًا حقول دمج البيانات ومعيدًا ترتيب التخطيط. إنه نقطة الدخول لـ**تحويل أصول التقارير الموجودة إلى قوالب**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: مصفوفة عناصر التقرير (staticText / image / path، …)
// page.styles:   تعريفات أنماط النص التي تشير إليها العناصر
// page.images:   بيانات الصور التي تشير إليها العناصر
// page.fonts:    معلومات عن الخطوط المُشار إليها
console.log(pageCount, page.width, page.height, page.elements.length)
```

يمكن وضع `elements` و`styles` المستوردة مباشرة في أشرطة القالب. أما كلمات مرور ملفات PDF المشفرة، واستيراد التعليقات التوضيحية، وتحويل النص المستورد إلى مسارات، وغير ذلك، فيُتحكم فيها عبر `PdfImportOptions`.
## إتقان التعبيرات

كل ما هو «ديناميكي» في التقرير يُكتب كتعبير: المحتوى الذي يطبعه `textField`، وشرط الطباعة في `printWhenExpression`، وبيانات الباركود، ومسارات الصور، والبيانات الممرَّرة إلى تقرير فرعي — كل خاصية نوعها `Expression` تقبل لغة التعبيرات نفسها.

تأتي التعبيرات في شكلين.

- **التعبيرات النصية** — سلاسل مثل `"field.price * field.quantity"`. وهي مجموعة جزئية آمنة من JavaScript يفسّرها محلّل مخصص؛ ولا يُستخدم `eval` ولا `new Function` أبدًا. وتبقى القوالب قابلة للحفظ كملفات JSON (ملفات `.report`)
- **تعبيرات دوال الاستدعاء (callback)** — دوال TypeScript بالشكل `(field, vars, param, report) => …`. تحصل على كامل قوة اللغة، لكن القالب لا يعود قابلًا للحفظ كـ JSON (يفترض هذا أنك تحتفظ بالقوالب في TypeScript)

نوصي بأن ترى أولًا إلى أي مدى تكفيك التعبيرات النصية، وألا تنتقل إلى دوال الاستدعاء إلا عندما تعجز.

### القيم التي يمكن الإشارة إليها في التعبيرات

| الاسم | الوصف |
| --- | --- |
| `field.*` | صف البيانات الحالي. الوصول المتداخل مثل `field.customer.name` مدعوم |
| `vars.*` | المتغيرات (القيم التجميعية المعرّفة في `variables`، الموضحة لاحقًا). ويعمل `var.*` بالطريقة نفسها |
| `param.*` | القيم على مستوى التقرير: القيم الممرَّرة عبر `parameters` في مصدر البيانات وقيم `defaultValue` في `parameters` القالب. وفي التقرير الفرعي، تظهر هنا أيضًا المعاملات الممرَّرة من الأب |
| `PAGE_NUMBER` | رقم الصفحة الحالي (يبدأ من 1) |
| `COLUMN_NUMBER` | رقم العمود الحالي (يبدأ من 1) |
| `REPORT_COUNT` | عدد صفوف البيانات المعالجة |
| `TOTAL_PAGES` | إجمالي عدد الصفحات. **إذا أُشير إليه كما هو أعطى «عدد الصفحات حتى الآن»**، لذا لطباعة العدد الإجمالي النهائي للصفحات اجمعه مع `evaluationTime: 'report'` أو `'auto'` (الموضحة لاحقًا) |

الإشارة إلى حقل غير موجود لا ترمي استثناءً؛ بل تُقيَّم إلى `undefined` (وحتى عندما يكون جزء وسيط من `field.a.b` قيمته `null`، تُعاد `null` بأمان).

### الصياغة المتاحة في التعبيرات النصية

| الفئة | المتاح |
| --- | --- |
| القيم الحرفية | الأرقام (`1200`، `0.5`)، والسلاسل (`'見積'` أو `"見積"` مع محارف الهروب مثل `\n`)، و`true` / `false` / `null` / `undefined` |
| قوالب السلاسل النصية | `` `合計 ${vars.total} 円` `` — يجوز أن يظهر تعبير كامل داخل `${}` |
| الحساب | `+` (جمع الأرقام ووصل السلاسل)، `-`، `*`، `/` |
| المقارنة | `>`، `>=`، `<`، `<=`، `===`، `!==` |
| المنطق | `&&`، `\|\|`، `!` (تقييم قصير الدارة، كما في JavaScript) |
| الدمج الصفري | `??` — يعيد الطرف الأيمن عندما يكون الأيسر null/undefined |
| الشرطي (الثلاثي) | `condition ? valueIfTrue : valueIfFalse` |
| أخرى | `-` / `+` الأحاديان، الأقواس `( )`، الوصول إلى الأعضاء بالنقطة (يجوز أن تكون أسماء الخصائص يابانية: `field.顧客名`) |
| الدوال المدمجة | `format(value, pattern)` = التنسيق (موضح لاحقًا) / `round(value, digits?)` = تقريب النصف إلى الأعلى / `roundUp`، `roundDown`، `roundHalfEven` (تقريب المصرفيين)، `ceil`، `floor`، `trunc` (لكل منها، الوسيط الثاني هو عدد المنازل العشرية، و0 عند الحذف) / `now()` = الوقت الحالي |

**غير متاح**: `==` / `!=` (استخدم `===` / `!==`)، و`%` و`**`، والوصول بالأقواس المعقوفة (`field['a-b']`) وفهرسة المصفوفات، واستدعاء الدوال الأعضاء (`field.name.toUpperCase()` يفشل وقت التقييم — الدوال الوحيدة القابلة للاستدعاء هي المدمجة أعلاه)، والإسناد، وتعريف الدوال، و`new`، والسلسلة الاختيارية (`?.` — وهي غير ضرورية على أي حال، لأن القيم الفارغة الوسيطة لا ترمي استثناءً أبدًا). عندما تحتاج إلى أي من هذه، استخدم تعبير دالة استدعاء.

هذه القيود موجودة من أجل الأمان. تُفسَّر التعبيرات النصية بمحلّل مخصص ولا تُنفَّذ كشيفرة أبدًا، لذا لا يمكن لقالب مُستلَم من الخارج أن يهرّب شيفرة عشوائية.

### طباعة نتيجة محسوبة

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

بيانات العينة:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

هذا يطبع `¥3,960`.

### بناء السلاسل النصية

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

القيم المضمّنة داخل `${}` في قالب السلسلة تُحوَّل إلى نص وتُوصَل. **قيمة null تصبح السلسلة `"null"`**، لذا ألحق `?? ''` بالقيم التي قد تكون غائبة، كما في المثال.

### تبديل المحتوى حسب شرط

استخدم العامل الثلاثي لتبديل ما يُطبع.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

عندما تريد تغيير *هل* يظهر الشيء لا *ما* يظهر، استخدم خاصية `printWhenExpression` المشتركة بين العناصر (راجع «طباعة عنصر فقط عند تحقق شرط»). ولتبديل التنسيق (اللون، الغامق) حسب شرط، حدّد تعبير شرط بالشكل نفسه في `conditionalStyles` ضمن تعريف النمط.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### تنسيق الأرقام والتواريخ — `format` و`pattern`

يستطيع `textField` تنسيق نتيجة التعبير وقت الطباعة عبر الخاصية `pattern`. ولتنسيق جزء من قيمة داخل تعبير، استخدم الدالة المدمجة `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

تجمع أنماط الأرقام بين `#` (إظهار الرقم إن وُجد) و`0` (الحشو بالأصفار) و`,` (فاصل الآلاف)، ويجوز أن تحمل بادئة ولاحقة. التقريب هو تقريب النصف إلى الأعلى.

| النمط | المدخل | المخرج |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

رموز نمط التاريخ هي `yyyy` (السنة بأربعة أرقام)، و`MM` / `M` (الشهر بحشو صفري / الشهر)، و`dd` / `d` (اليوم بحشو صفري / اليوم)، و`HH` (الساعة بحشو صفري، بنظام 24 ساعة)، و`mm` (الدقائق)، و`ss` (الثواني). القيمة null/undefined تنتج سلسلة فارغة.

للتنسيقات التي تتجاوز هذه (تواريخ الحقب اليابانية، أسماء أيام الأسبوع، معالجة خانات العملة، وما إلى ذلك)، سجّل دوال TypeScript مسماة في `formatters` القالب واكتب الاسم في `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// على جانب العنصر: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

يبحث `pattern` أولًا عن مُنسِّق مسجَّل بذلك الاسم، ويُفسَّر كتنسيق مدمج إن لم يوجد. المُنسِّقات دوال، لذا تُحفظ القوالب التي تستخدم هذه الميزة في TypeScript بدلًا من JSON.

### طباعة المجاميع والمتوسطات والأعداد — المتغيرات (`variables`)

يُعرَّف التجميع الذي يمتد عبر صفوف التفاصيل في `variables` القالب. في كل مرة يُعالَج فيها صف بيانات، يغذّي المتغير نتيجة `expression` الخاص به في تجميعه، ويمكن للتعبيرات الإشارة إلى القيمة الحالية بـ `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

ضع عنصر `textField` بقيمة `"expression": "vars.pageTotal"` في شريط `pageFooter` لمجموع فرعي للصفحة، وآخر بقيمة `"expression": "vars.grandTotal"` في شريط `summary` للمجموع الكلي.

**قائمة الخصائص (كل مُدخل في `variables`)**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم المتغير، ويُشار إليه من التعبيرات بـ `vars.name` |
| `expression` | Expression | ✓ | يُقيَّم لكل صف؛ وتُغذَّى النتيجة في التجميع |
| `calculation` | `'sum'` = المجموع / `'average'` = المتوسط / `'count'` = العدد / `'distinctCount'` = عدد القيم المتمايزة / `'min'` = الحد الأدنى / `'max'` = الحد الأقصى / `'first'` = القيمة الأولى / `'nothing'` = يُستبدل مع كل صف (القيمة الأخيرة) | ✓ | طريقة التجميع |
| `resetType` | `'report'` = مواصلة التجميع عبر التقرير كله (بلا تصفير؛ الافتراضي) / `'page'` = تصفير لكل صفحة / `'column'` = تصفير لكل عمود / `'group'` = تصفير لكل مجموعة مسماة في `resetGroup` / `'none'` = لا يُصفَّر أبدًا، مثل `'report'`، لكن مع التقييم المؤجل (`evaluationTime`) تبقى القيمة مثبتة كما كانت لحظة وضع العنصر (ولا تُستبدل لاحقًا بالتجميع النهائي) |  | نطاق تصفير التجميع |
| `resetGroup` | string |  | اسم المجموعة المستهدفة عند `resetType: 'group'` |
| `incrementCondition` | Expression |  | عند تحديده، لا تُغذَّى في التجميع الصفوف التي تكون نتيجة تقييمها falsy (تجميع مشروط) |
| `initialValue` | Expression |  | القيمة الابتدائية عند التهيئة وعند كل تصفير |

مع `incrementCondition`، يتّسع التجميع المشروط مثل «اجمع فئة معينة فقط» في متغير واحد:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

لتجميع نتائج تنفيذ التقارير الفرعية في الأب، استخدم `returnValues` في العنصر `subreport`، التي تكتب متغيرات الابن عائدةً إلى `vars.*` في الأب (راجع قائمة خصائص `subreport`).

### طباعة أرقام الصفحات وإجمالي عدد الصفحات

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

المفتاح هو `evaluationTime: 'auto'`. تُقيَّم التعبيرات عادةً لحظة وضع العنصر، لكن في تلك اللحظة لا يكون إجمالي عدد الصفحات النهائي معروفًا بعد. مع `'auto'`، يُحلَّل التعبير تحليلًا ساكنًا و**تُقيَّم كل إشارة في توقيتها الصحيح الخاص بها** — `PAGE_NUMBER` عند اكتمال الصفحة، و`TOTAL_PAGES` عند اكتمال التقرير. ولأن `'auto'` يحتاج إلى تحليل التعبير، فهو متاح فقط للتعبيرات النصية (تحديده على تعبير دالة استدعاء يرمي استثناءً).

### تجاوز حدود التعبيرات النصية — تعبيرات دوال الاستدعاء

إذا كان قالبك معرّفًا في TypeScript، يمكنك كتابة دالة مباشرةً في أي مكان يقبل `Expression`. تأخذ أربعة وسائط `(field, vars, param, report)`؛ وعبر `report` تصل إلى القيم المدمجة مثل `PAGE_NUMBER` ودالة `format` والمُنسِّقات المسجلة في `formatters`.

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

استدعاءات الدوال الأعضاء، والتعبيرات النمطية، والدوال الخارجية — كل ما يمكنك كتابته في TypeScript متاح. وهناك مقايضتان: لا يعود القالب قابلًا للحفظ أو النقل كـ JSON، ويصبح `evaluationTime: 'auto'` غير متاح (القيم الصريحة مثل `'report'` ما زالت تعمل).

### ماذا يحدث عندما يفشل تعبير

- **أخطاء الصياغة والتراكيب المحظورة** (استدعاءات الدوال الأعضاء وغيرها) ترمي `ExpressionLanguageError` مع معلومات الموضع، وينتشر كما هو إلى مستدعي `createReport()`. ولا يُبتلع أبدًا في خلية فارغة
- **الإشارات إلى حقول أو متغيرات غير موجودة** ليست أخطاء؛ بل تُقيَّم إلى `undefined`. وفي `textField` تُطبع سلسلة فارغة عند تعيين `blankWhenNull: true`؛ وبدونها تُطبع السلسلة `null`
- للتحقق من صحة التعبيرات المقدَّمة من المستخدم قبل التنفيذ، تعيد `validateExpressionSource(source)` نتيجة فحص الصياغة (خطأ، أو `null`)

## عينات عاملة لكل عنصر

إليك جميع العناصر الستة عشر التي يوفرها `ElementDef`. يأخذ كل عنصر `x` و`y` و`width` و`height` (بوحدة pt، 1pt = 1/72 بوصة) ويوضع في `elements` الخاصة بشريط أو بعنصر `frame`.

| ما تريد فعله | العنصر |
| --- | --- |
| طباعة نص ثابت | `staticText` |
| طباعة البيانات أو المتغيرات أو نتائج التعبيرات | `textField` |
| رسم خط | `line` |
| رسم مستطيل أو صندوق بزوايا مستديرة | `rectangle` |
| رسم دائرة أو قطع ناقص | `ellipse` |
| رسم شكل متجهي اعتباطي | `path` |
| وضع صورة | `image` |
| تجميع عدة عناصر داخل إطار | `frame` |
| طباعة جدول | `table` |
| طباعة جدول تقاطعي | `crosstab` |
| تضمين تقرير داخل آخر | `subreport` |
| طباعة باركود أو رمز QR | `barcode` |
| طباعة صيغة رياضية | `math` |
| طباعة SVG | `svg` |
| إنشاء نموذج PDF قابل للتعبئة | `formField` |
| فرض فاصل صفحة أو عمود في أي مكان | `break` |
| طباعة عنصر فقط عند تحقق شرط | `printWhenExpression` (سمة مشتركة بين جميع العناصر) |

فيما يلي، يحصل كل عنصر على تعريف واحد يمكنك إسقاطه مباشرة في مصفوفة `elements` لأحد الأشرطة، مع بيانات عينة للعناصر التي تستخدم التعبيرات. وفي نهاية قسم كل عنصر توجد قائمة الخصائص الخاصة بذلك العنصر. وللاطلاع على الخصائص المشتركة بين جميع العناصر (الموضع والألوان وشروط الطباعة وما إلى ذلك) وخصائص الأنماط، راجع «مرجع خصائص العناصر» أدناه.

### طباعة نص ثابت — `staticText`

يطبع سلسلة نصية مكتوبة في القالب كما هي بالضبط. استخدمه للعناوين والتسميات.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | نوع العنصر |
| `text` | string | ✓ | السلسلة الثابتة المراد طباعتها |
| `actualText` | string |  | نص بديل لحالات اختلاف الحروف المرئية عن النص الناتج عن النسخ والبحث (PDF /ActualText). يُستخدم أساسًا في استيراد PDF للحفاظ على إعداد ملف PDF المصدر |
| `hyperlink` | HyperlinkDef |  | رابط تشعبي (راجع **`HyperlinkDef`** في قسم الخصائص المشتركة) |
| `anchorName` | string |  | اسم المرساة. يُسجَّل كوجهة للإشارات المرجعية والروابط داخل المستند (`hyperlink` من نوع `'localAnchor'`) |
| `bookmarkLevel` | number |  | مستوى التسلسل الهرمي (1 = المستوى الأعلى، 1–6) لإدراج نص هذا العنصر في جدول المحتويات (الإشارات المرجعية) المعروض في الشريط الجانبي لعارض PDF |

ملاحظة: إضافة إلى ذلك، يجوز تحديد جميع الخصائص المشتركة بين العناصر وكل خصائص `TextProperties`.

### طباعة البيانات ونتائج التعبيرات — `textField`

يطبع نتيجة تقييم `expression`. يمكنه الإشارة إلى `field.*` (البيانات) و`vars.*` (المتغيرات) و`param.*` (المعاملات) و`PAGE_NUMBER` وغيرها، وتتيح قوالب السلاسل النصية بناء السلاسل. للاطلاع على لغة التعبيرات كاملة، راجع «إتقان التعبيرات». استخدم `pattern` لتنسيق الأرقام/التواريخ و`stretchWithOverflow` للسماح للارتفاع بالنمو مع كمية النص.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

بيانات العينة:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | نوع العنصر |
| `expression` | Expression | ✓ | تعبير يعيد القيمة المراد طباعتها |
| `pattern` | string |  | نمط التنسيق. المُنسِّق المخصص المسجَّل على القالب (اسم في `formatters`) له الأولوية؛ وإلا تُنسَّق القيمة بالمُنسِّق المدمج |
| `blankWhenNull` | boolean |  | طباعة سلسلة فارغة عندما تكون نتيجة التعبير null/undefined (بدونها تُطبع السلسلة `'null'`) |
| `stretchWithOverflow` | boolean |  | عندما لا يتسع المحتوى ضمن height، يُمدَّد ارتفاع العنصر ليلائم المحتوى |
| `evaluationTime` | `'now'` = التقييم فورًا في الموضع (الافتراضي) / `'band'` = التقييم عند اكتمال الشريط / `'column'` = التقييم في نهاية العمود / `'page'` = التقييم في نهاية الصفحة / `'group'` = التقييم عند إغلاق المجموعة المسماة في `evaluationGroup` / `'report'` = التقييم في نهاية التقرير (تكون TOTAL_PAGES وأمثالها نهائية) / `'auto'` = تقييم كل متغير وقيمة مدمجة يشير إليها التعبير فرديًا في توقيت تصفيره الخاص (للتعبيرات النصية فقط؛ تعبيرات دوال الاستدعاء ترمي استثناءً) |  | متى يُقيَّم التعبير. مع أي قيمة غير الافتراضية، تُحجز المنطقة فارغة أولًا وقت الوضع وتُملأ حالما تصبح القيمة نهائية في التوقيت المقابل. استخدامات نموذجية: عرض مجموع المجموعة قبل المجموعة (`'group'`)، وطباعة العدد الإجمالي النهائي للصفحات (`'report'`) |
| `evaluationGroup` | string |  | اسم المجموعة المستهدفة عند `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = الأسطر التي لا تتسع لا تُرسم (الافتراضي؛ مطابق لـ `'truncate'` في التنفيذ الحالي) / `'truncate'` = اقتطاع النص غير المتسع سطرًا سطرًا / `'ellipsisChar'` = تشذيب السطر الأخير عند حدود الحرف وإلحاق `...` / `'ellipsisWord'` = تشذيب السطر الأخير عند حدود الكلمة وإلحاق `...` |  | التعامل مع النص الذي لا يتسع في الارتفاع عندما يكون `stretchWithOverflow` معطلًا. الافتراضي: `none` |
| `hyperlink` | HyperlinkDef |  | رابط تشعبي (راجع **`HyperlinkDef`** في قسم الخصائص المشتركة) |
| `anchorName` | string |  | اسم المرساة. يُسجَّل كوجهة للإشارات المرجعية والروابط داخل المستند (`hyperlink` من نوع `'localAnchor'`) |
| `bookmarkLevel` | number |  | مستوى التسلسل الهرمي (1 = المستوى الأعلى، 1–6) لإدراج نص هذا العنصر في جدول المحتويات (الإشارات المرجعية) المعروض في الشريط الجانبي لعارض PDF |

ملاحظة: إضافة إلى ذلك، يجوز تحديد جميع الخصائص المشتركة بين العناصر وكل خصائص `TextProperties`. يحترم هذا العنصر `isPrintRepeatedValues: false` (يكبت طباعة القيم المتطابقة المتتالية).

### رسم خط — `line`

هذا المثال خط أفقي ارتفاعه 0. يقبل `lineStyle` القيمة `dashed` وغيرها إلى جانب `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | نوع العنصر. يُرسم القطع المستقيم من الزاوية العلوية اليسرى للعنصر `(x, y)` إلى زاويته السفلية اليمنى `(x+width, y+height)` (‏`height: 0` يعطي خطًا أفقيًا، و`width: 0` خطًا رأسيًا، وكلاهما غير صفري يعطي خطًا قطريًا) |
| `lineWidth` | number |  | عرض الخط (pt). الافتراضي: 1 |
| `lineStyle` | `'solid'` = متصل / `'dashed'` = متقطع / `'dotted'` = منقّط |  | نمط الخط. الافتراضي: solid |
| `lineColor` | string |  | لون الخط. الافتراضي: `forecolor` العنصر، أو `#000000` إن كان ذلك غائبًا أيضًا |

### رسم مستطيل أو صندوق بزوايا مستديرة — `rectangle`

يتيح لك `cornerRadii` تدوير كل زاوية على حدة.

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

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | نوع العنصر |
| `radius` | number |  | نصف قطر الزوايا (pt، مشترك بين جميع الزوايا) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | نصف قطر لكل زاوية (pt) |
| `fill` | FillDef |  | التعبئة (راجع **`FillDef`** في قسم الخصائص المشتركة). الافتراضي: `backcolor` النمط (عندما لا يكون `transparent`) |
| `stroke` | string |  | لون الحدود. الافتراضي: `forecolor` النمط |
| `strokeWidth` | number |  | عرض الحدود (pt). الافتراضي: 1 |

### رسم دائرة أو قطع ناقص — `ellipse`

يرسم قطعًا ناقصًا محاطًا داخل عرض العنصر وارتفاعه.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | نوع العنصر. يرسم القطع الناقص المحاط داخل الصندوق المحيط للعنصر (المركز `(x+width/2, y+height/2)` ونصفا القطر `width/2` × `height/2`) |
| `fill` | FillDef |  | التعبئة (راجع **`FillDef`** في قسم الخصائص المشتركة). لا تعبئة عند الحذف |
| `stroke` | string |  | لون الحدود. لا حدود عند الحذف |
| `strokeWidth` | number |  | عرض الحدود (pt). الافتراضي: 1 (عند تعيين `stroke`) |

### رسم شكل متجهي اعتباطي — `path`

ضع صياغة مسار SVG في `d` ونظام إحداثياتها في `viewBox`. يُغيَّر مقياس الشكل ليلائم إطار العنصر.

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

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | نوع العنصر |
| `d` | string | ✓ | بيانات مسار SVG (‏M/L/C/Z وغيرها). الإحداثيات بوحدة pt محلية للعنصر |
| `pdfSourceVector` | PdfSourceVectorDef |  | يُنتجه استيراد PDF للحفاظ على شكل يتكرر ظهوره (رموز الخرائط وغيرها) على هيئة «تعريف واحد + N من عمليات الوضع» (راجع **`PdfSourceVectorDef`** لاحقًا). عند تعيينه لا يُحلَّل `d`. غير مطلوب في القوالب المكتوبة يدويًا |
| `affineTransform` | [number, number, number, number, number, number] |  | مصفوفة تحويل أفيني تحوّل إحداثيات المسار إلى الإحداثيات المحلية للعنصر قبل الرسم. `[a, b, c, d, e, f]` تعطي `x' = a·x + c·y + e` و`y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. تُحوَّل إحداثيات المسار قياسًا من هذه المنطقة إلى عرض العنصر وارتفاعه |
| `fill` | FillDef |  | التعبئة (راجع **`FillDef`** في قسم الخصائص المشتركة). لا تعبئة عند الحذف |
| `fillRule` | `'nonzero'` (الافتراضي) / `'evenodd'` |  | القاعدة التي تحدد أي المناطق تُعد «داخلية» للمسارات المتقاطعة ذاتيًا أو المتداخلة. لثقب فتحة على شكل كعكة، `'evenodd'` هو الخيار الموثوق |
| `fillOpacity` | number |  | عتامة التعبئة (0.0–1.0) |
| `stroke` | FillDef |  | الحد (الألوان المصمتة وكذلك التدرجات وغيرها). لا حد عند الحذف |
| `strokeWidth` | number |  | عرض الحد (pt). الافتراضي: 1 (عند تعيين `stroke`) |
| `strokeOpacity` | number |  | عتامة الحد (0.0–1.0) |
| `strokeLinecap` | `'butt'` = قطع عند النهاية / `'round'` = طرف مستدير / `'square'` = طرف مربع (ممدود بنصف عرض الخط) |  | شكل طرف الخط |
| `strokeLinejoin` | `'miter'` = زاوية حادة / `'round'` = مستدير / `'bevel'` = مشطوف |  | شكل وصلة الخط |
| `strokeMiterLimit` | number |  | حد الزاوية الحادة. الافتراضي: 10 |
| `strokeDasharray` | number[] |  | نمط التقطيع (مصفوفة أطوال الشرطات والفجوات، pt) |
| `strokeDashoffset` | number |  | الإزاحة الابتدائية في نمط التقطيع (pt) |

### وضع صورة — `image`

حدّد الصورة بـ `sourceExpression` (تعبير) أو `source` (قيمة ثابتة). يتحكم `scaleMode` في كيفية ملاءمة الصورة للإطار، ويختار `onError` السلوك عند تعذّر العثور على الصورة (`error` = إثارة خطأ / `blank` = ترك المكان فارغًا / `icon` = عرض أيقونة).

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

بيانات العينة:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | نوع العنصر |
| `source` | string | | إشارة صورة ثابتة (معرّف صورة). اكتب مسارًا نسبيًا إلى ملف `.report`، أو مسارًا مطلقًا، أو URL، أو data URI، وغير ذلك كما هو (لقواعد المعرّفات، راجع «قيود تحميل الموارد وقواعد معرّفات الصور» لاحقًا). يُستخدم عند غياب `sourceExpression` أو عندما لا تُحلّ نتيجته |
| `sourceExpression` | Expression | | تعبير مصدر صورة ديناميكي. النتيجة النصية تُحل كمعرّف صورة؛ ونتيجة `Uint8Array` تُعامل على أنها بيانات الصورة نفسها |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | كيفية تحجيم الصورة. `'clip'` = وضع الصورة بحجمها الطبيعي وقصّها على إطار العنصر / `'fillFrame'` = مطّها لملء الإطار متجاهلًا نسبة الأبعاد / `'retainShape'` = الحفاظ على نسبة الأبعاد والتحجيم إلى أكبر حجم يتسع في الإطار / `'realSize'` = الحجم الطبيعي مع قصّ الإطار (منفذ بشكل مطابق لـ `'clip'`). الافتراضي: `'retainShape'`. عند تعذّر تحديد حجم الصورة يتصرف مثل `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | الموضع الأفقي للصورة داخل الإطار (يؤثر على موضع الهامش مع `retainShape` وموضع القص مع `clip`/`realSize`). الافتراضي: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | الموضع الرأسي للصورة داخل الإطار. الافتراضي: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | السلوك عندما يكون مصدر الصورة غير معرّف أو يفشل حلّه. `'error'` = رمي استثناء / `'blank'` = عدم رسم شيء / `'icon'` = رسم صندوق رمادي بديل بعلامة ×. الافتراضي: `'icon'` |
| `lazy` | boolean | | موجود في تعريف النوع فقط؛ لا يشير إليه محرك التخطيط الحالي ولا تنفيذات المعرض (غير مشمول بالمواصفة) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | زاوية تدوير الصورة (بالدرجات) |
| `affineTransform` | [number, number, number, number, number, number] | | طريقة بديلة لتحديد الوضع مباشرة كمصفوفة. `[a, b, c, d, e, f]` تحويل يمرّر صورة المربع الواحدي (0–1) عبر `x' = a·x + c·y + e` و`y' = b·x + d·y + f`؛ عند تعيينها يُتخطى حساب الوضع من `scaleMode`/`hAlign`/`vAlign`/`rotation`. يستخدمه استيراد PDF أساسًا للحفاظ على الوضع الأصلي |
| `opacity` | number | | العتامة (0.0–1.0) |
| `interpolate` | boolean | | جعل العارض ينعّم حدود البكسلات عند تكبير صورة منخفضة الدقة (PDF /Interpolate). فعّله للصور الفوتوغرافية؛ وعطّله للصور التي يجب أن تبقى حادة، مثل الباركود |
| `alternates` | PdfImageAlternateDef[] |  | صور PDF بديلة (/Alternates) لاستخدام صور مختلفة على الشاشة وفي الطباعة. لكل مُدخل خاصيتان: `source` = إشارة إلى الصورة البديلة (مطلوبة) و`defaultForPrinting` = ما إذا كانت هذه هي المستخدمة عند الطباعة |
| `opi` | PdfOpiMetadataDef |  | معلومات OPI للطباعة التجارية، حيث تُستبدل صورة بديلة منخفضة الدقة بالصورة عالية الدقة وقت الإخراج. أساسًا للحفاظ عليها عند استيراد PDF (راجع **`PdfOpiMetadataDef`** لاحقًا) |
| `measure` | PdfMeasurement |  | معلومات المقياس ونظام الإحداثيات التي تستخدمها أدوات القياس في العارض لملفات PDF الخاصة بالرسوم الهندسية والخرائط. أساسًا للحفاظ عليها عند استيراد PDF (راجع **`PdfMeasurement`** لاحقًا) |
| `pointData` | PdfPointData[] |  | بيانات النقاط (خط العرض/الطول وغيرها) في ملفات PDF الخاصة بالخرائط. أساسًا للحفاظ عليها عند استيراد PDF (راجع **`PdfPointData`** لاحقًا) |
| `hyperlink` | HyperlinkDef | | رابط تشعبي (`type`: ‏`'reference'` = عنوان URL / `'localAnchor'` = مرساة داخل المستند / `'localPage'` = صفحة داخل المستند / `'remoteAnchor'` و`'remotePage'` = مرساة/صفحة داخل ملف PDF خارجي؛ `target`: تعبير لوجهة الرابط؛ `remoteDocument?`: تعبير لمسار ملف PDF الخارجي) |

### تجميع عدة عناصر داخل إطار — `frame`

يجمّع العناصر الأبناء؛ يرسم `border` إطارًا ويقصّ `clip` أي فائض. تستخدم إحداثيات العناصر الأبناء الزاوية العلوية اليسرى للإطار أصلًا لها.

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

بيانات العينة:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | نوع العنصر |
| `clip` | boolean | | ما إذا كان يُقص الأبناء عند حدود الإطار. الافتراضي: true |
| `border` | BorderDef | | الحدود (راجع **`BorderDef`** في قسم الخصائص المشتركة) |
| `padding` | Padding | | الحشو الداخلي (`top?`/`bottom?`/`left?`/`right?`، كل منها بوحدة pt) |
| `rotation` | number | | زاوية تدوير الإطار (بالدرجات، عكس عقارب الساعة في إحداثيات الصفحة) |
| `rotationOriginX` | number | | نقطة أصل التدوير X (نسبةً إلى الإطار، pt). الافتراضي: 0 |
| `rotationOriginY` | number | | نقطة أصل التدوير Y (نسبةً إلى الإطار، pt). الافتراضي: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | مصفوفة أفينية تحوّل الإحداثيات المحلية للإطار (بمحور Y متجه إلى الأعلى) إلى فضاء إحداثيات الأب (تخطيط المصفوفة ومعناها كما في `affineTransform` الخاصة بـ `image`). يستخدمها استيراد PDF أساسًا للحفاظ على الوضع الأصلي |
| `pdfForm` | PdfFormXObjectDef |  | عند استيراد PDF، يحتفظ بنظام الإحداثيات والبيانات الوصفية التي كان يحملها مكوّن (Form XObject) في ملف PDF المصدر ويعيد إخراجها (راجع **`PdfFormXObjectDef`** لاحقًا). غير مطلوب في القوالب المكتوبة يدويًا |
| `hyperlink` | HyperlinkDef | | رابط تشعبي (البنية نفسها للخاصية المماثلة الاسم في `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | مسار قصّ بصياغة مسار SVG. ‏`d` = بيانات المسار، و`fillRule` = قاعدة التعبئة |
| `transparencyGroup` | boolean | | يحافظ على حدود مجموعة الشفافية في PDF حتى عندما لا يكون `isolated` ولا `knockout` مفعّلًا. الحفاظ عليها يضمن بقاء نتيجة تركيب العتامة والمزج كما لو رُكّب الإطار كصورة واحدة مسطّحة (أساسًا لدقة استيراد PDF) |
| `isolated` | boolean | | مجموعة شفافية معزولة (PDF /Group /I). عند تعيين هذا (أو `knockout` / `softMask`) يُركّب الإطار كوحدة قبل تطبيق العتامة والمزج والأقنعة |
| `knockout` | boolean | | مجموعة شفافية إسقاطية (PDF /Group /K). الأبناء المتراكبون داخل المجموعة لا يظهر بعضهم عبر بعض؛ في كل موضع يُركّب الابن الأعلى فقط مع الخلفية |
| `softMask` | FrameSoftMaskDef | | قناع ناعم يجعل الإطار شفافًا جزئيًا (راجع **`FrameSoftMaskDef`** في الجدول أدناه). يستخدم رسم `elements` الخاصة به بمثابة «خريطة شفافية»، مما يتيح تأثيرات مثل التلاشي التدريجي على امتداد تدرّج لوني |
| `deviceParams` | DeviceParamsDef | | معاملات مرحلة تجهيز الطباعة للطباعة التجارية (راجع **`DeviceParamsDef`** في الجدول أدناه). غير مطلوبة للتقارير العادية؛ يستخدمها استيراد PDF أساسًا للحفاظ على إعدادات ملف PDF المصدر |
| `elements` | ElementDef[] | | العناصر الأبناء داخل الإطار |

**`FrameSoftMaskDef`** (بنية `softMask`)
| الحقل | النوع | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | نوع القناع. `'luminosity'` = كلما كانت منطقة القناع أكثر سطوعًا كان الإطار أكثر عتامة / `'alpha'` = كلما كانت منطقة القناع أكثر عتامة كان الإطار أكثر عتامة |
| `colorSpace` | PdfProcessColorSpaceDef | | فضاء ألوان المزج لمجموعة شفافية القناع الناعم |
| `isolated` | boolean | | راية العزل لمجموعة شفافية القناع الناعم |
| `knockout` | boolean | | راية الإسقاط لمجموعة شفافية القناع الناعم |
| `backdrop` | [number, number, number] | | لون الخلفية /BC لأقنعة الإضاءة (DeviceRGB 0–1). الافتراضي: الأسود |
| `elements` | ElementDef[] | ✓ | العناصر المركّبة كمجموعة شفافية لتعريف القناع |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | دالة النقل /SMask /TR التي تعيد تعيين قيم القناع (0..1) |

**`DeviceParamsDef`** (بنية `deviceParams`. لتجهيز الطباعة التجارية وغير مطلوبة عادةً — أساسًا للحفاظ عليها عند استيراد PDF)
| الحقل | النوع | مطلوب | الوصف |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | دالة النقل /TR: ‏`'Identity'` / `'Default'` / دالة واحدة مشتركة بين كل صفائح الألوان / مصفوفة دوال، واحدة لكل صفيحة من الألوان الأربعة |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | دالة توليد الأسود /BG (‏`'Default'` = الافتراضي للجهاز عبر /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | دالة إزالة اللون التحتي /UCR (‏`'Default'` = الافتراضي للجهاز عبر /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | التظليل النقطي /HT (شاشة من النوع 1 / مصفوفات عتبة من الأنواع 6 و10 و16 / تجميعة من النوع 5 لكل مكوّن لوني) |
| `halftoneOrigin` | [number, number] | | نقطة أصل التظليل النقطي في PDF 2.0 (‏/HTO، بكسلات فضاء الجهاز) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | التحكم في تعويض نقطة السواد في PDF 2.0 (‏/UseBlackPtComp) |
| `flatness` | number | | سماحية التسطيح (/FL) |
| `smoothness` | number | | سماحية نعومة التظليل (/SM) |
| `strokeAdjustment` | boolean | | الضبط التلقائي للحدود (/SA) |

### طباعة جدول — `table`

جدول بصفوف ترويسة وصفوف تفاصيل وصفوف تذييل. مرّر مصفوفة بيانات الصفوف عبر `dataSourceExpression`، فتتكرر صفوف التفاصيل مرة لكل عنصر من المصفوفة.

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

بيانات العينة (يصبح كل عنصر من `items` صف تفاصيل واحدًا في الجدول):

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

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | نوع العنصر |
| `columns` | TableColumnElementDef[] | ✓ | مصفوفة تعريفات الأعمدة. إذا اختلف مجموع قيم `width` لجميع الأعمدة عن عرض العنصر، تُحجَّم جميع الأعمدة تناسبيًا لتلائم عرض العنصر بالضبط |
| `headerRows` | TableRowElementDef[] |  | مصفوفة صفوف الترويسة. عندما ينقسم الجدول عبر الصفحات، تُرسم مجددًا أعلى كل صفحة |
| `detailRows` | TableRowElementDef[] |  | مصفوفة صفوف التفاصيل. تُرسم تكرارًا، مرة لكل صف بيانات (صفوف البيانات × جميع الصفوف في detailRows) |
| `footerRows` | TableRowElementDef[] |  | مصفوفة صفوف التذييل. عندما ينقسم الجدول عبر الصفحات، تُرسم في الصفحة الأخيرة فقط |
| `dataSourceExpression` | Expression |  | يستخدم المصفوفة التي يُقيَّم إليها التعبير كصفوف بيانات هذا الجدول. عند الحذف تُستخدم صفوف مصدر البيانات الرئيسي. يرمي استثناءً عندما لا تكون النتيجة مصفوفة |

**`TableColumnElementDef`** (كل مُدخل في `columns` = تعريف عمود)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `width` | number | ✓ | عرض العمود (pt). إذا لم يطابق الإجمالي عبر جميع الأعمدة عرضَ العنصر، تُوزَّع العروض تناسبيًا |
| `style` | TableCellStyleDef |  | نمط الخلايا الافتراضي لهذا العمود. عندما تحدد خلية خاصية بالاسم نفسه، يفوز إعداد الخلية (تُدمج الحدود حافةً حافةً) |

**`TableRowElementDef`** (كل مُدخل في `headerRows`/`detailRows`/`footerRows` = تعريف صف)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `height` | number | ✓ | ارتفاع الصف (pt). يُعامل كحد أدنى: يتمدد الصف تلقائيًا عندما لا يتسع النص الملتف أو العناصر الأبناء داخل الخلية (لخلايا rowSpan، يمدد فائضُ المحتوى الصفَّ الأخير من النطاق المدموج) |
| `cells` | TableCellElementDef[] | ✓ | مصفوفة تعريفات خلايا هذا الصف. الأعمدة التي يشغلها `rowSpan` من صف أعلى تُتخطى تلقائيًا أثناء الوضع |

**`TableCellElementDef`** (كل مُدخل في `cells` = تعريف خلية. إضافة إلى ما يلي، يجوز تحديد كل خصائص `TableCellStyleDef` مباشرةً)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `text` | string |  | نص الخلية الثابت |
| `expression` | Expression |  | تعبير ربط البيانات. الشكل المجرد `field.name` يقرأ القيمة مباشرة من صف البيانات؛ وأي شيء آخر يُحل عبر تقييم التعبيرات في المحرك. له الأولوية على `text` عند تحديده |
| `colSpan` | number |  | عدد الأعمدة المراد دمجها أفقيًا. الافتراضي: 1 |
| `rowSpan` | number |  | عدد الصفوف المراد دمجها رأسيًا. الافتراضي: 1. ارتفاع الخلية هو مجموع ارتفاعات الصفوف عبر النطاق المدموج |
| `elements` | ElementDef[] |  | مصفوفة العناصر الأبناء الموضوعة داخل الخلية. عند تحديدها تكون لها الأولوية على عرض `text`/`expression` وتُرسم مقصوصة على المساحة ناقص الحشو. يتمدد ارتفاع الصف تلقائيًا إلى الارتفاع الذي يحتاجه الأبناء |

**`TableCellStyleDef`** (نمط الخلية المستخدم في تعريفات الخلايا وفي `style` العمود)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = محاذاة إلى اليسار / `'center'` = توسيط / `'right'` = محاذاة إلى اليمين |  | محاذاة النص الأفقية |
| `vAlign` | `'top'` = محاذاة إلى الأعلى / `'middle'` = توسيط / `'bottom'` = محاذاة إلى الأسفل |  | محاذاة النص الرأسية |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | تدوير النص (بالدرجات). الافتراضي: 0 |
| `backcolor` | string |  | لون خلفية الخلية |
| `forecolor` | string |  | لون النص. الافتراضي: `#000000` |
| `fontId` | string |  | معرّف الخط. الافتراضي: `'default'` |
| `fontSize` | number |  | حجم الخط (pt). الافتراضي: 10 |
| `bold` | boolean |  | غامق |
| `italic` | boolean |  | مائل |
| `underline` | boolean |  | تسطير |
| `strikethrough` | boolean |  | يتوسطه خط |
| `lineSpacing` | LineSpacingDef |  | إعدادات تباعد الأسطر (راجع **`LineSpacingDef`** في قسم الخصائص المشتركة) |
| `letterSpacing` | number |  | تباعد الحروف (pt). يضيف مقدارًا ثابتًا بين جميع الحروف (القيم السالبة تضيّق) |
| `wordSpacing` | number |  | تباعد الكلمات (pt؛ عرض إضافي يُضاف إلى محارف المسافة) |
| `firstLineIndent` | number |  | إزاحة السطر الأول (pt) |
| `leftIndent` | number |  | الإزاحة اليسرى (pt) |
| `rightIndent` | number |  | الإزاحة اليمنى (pt) |
| `wrap` | boolean |  | التفاف النص. الافتراضي: true |
| `shrinkToFit` | boolean |  | تصغير حجم الخط تلقائيًا بحيث يتسع النص في الخلية |
| `minFontSize` | number |  | الحد الأدنى لحجم الخط (pt) مع `shrinkToFit`. الافتراضي: 4 |
| `fitWidth` | boolean |  | ضبط حجم الخط تلقائيًا (في الاتجاهين، تصغيرًا وتكبيرًا) بحيث يلائم أطول سطر عرضَ الخلية بالضبط. مثل هذه الخلية لا تسهم في التمديد التلقائي لارتفاع الصف |
| `outlineText` | boolean |  | رسم النص محوَّلًا إلى مسارات (outlines) |
| `padding` | number |  | حشو الخلية (pt). الافتراضي: 2 |
| `border` | BorderDef |  | حدود لكل خلية (راجع **`BorderDef`** في قسم الخصائص المشتركة). تُدمج مع حدود `style` العمود؛ ويفوز إعداد الخلية |
| `opacity` | number |  | العتامة (0.0–1.0). دون 1 تُرسم الخلية بأكملها كمجموعة عتامة |

### طباعة جدول تقاطعي — `crosstab`

يجمّع البيانات حسب مجموعات الصفوف × مجموعات الأعمدة. يجمع هذا المثال `amount` حسب المنطقة × الفئة ويخرج أيضًا المجاميع الفرعية والمجموع الكلي.

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

بيانات العينة:

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

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | نوع العنصر |
| `rowGroups` | { field, headerFormat? }[] | ✓ | مصفوفة تعريفات مجموعات الصفوف. المُدخلات المتعددة تشكّل مستويات مجموعات متداخلة، يشغل كل مستوى عمود ترويسة صفوف واحدًا من اليسار. خلايا ترويسة المجموعات الخارجية تُدمج رأسيًا عبر نطاقها |
| `columnGroups` | { field, headerFormat? }[] | ✓ | مصفوفة تعريفات مجموعات الأعمدة. المجموعات الخارجية تتراكم في الأعلى والداخلية تحتها؛ وتُدمج ترويسات المجموعات الخارجية أفقيًا عبر عرض أعمدتها |
| `measures` | { field, calculation, format? }[] | ✓ | مصفوفة تعريفات المقاييس (خلايا التجميع). مع مُدخلات متعددة تُرصّ رأسيًا داخل كل خلية بيانات، يأخذ كل منها فتحة واحدة (على الأقل `cellHeight`) ويطبّق `calculation`/`format` الخاصين به. المصفوفة الفارغة تُعامل كمقياس واحد ضمني بـ `field: ''` و`calculation: 'sum'` |
| `rowHeaderWidth` | number |  | عرض ترويسة الصفوف (pt)، مطبَّق على كل مستوى من مجموعات الصفوف. الافتراضي: 80 |
| `columnHeaderHeight` | number |  | ارتفاع ترويسة الأعمدة (pt)، مطبَّق على كل مستوى من مجموعات الأعمدة. الافتراضي: 20 |
| `cellWidth` | number |  | عرض خلية البيانات (pt). الافتراضي: 60 |
| `cellHeight` | number |  | ارتفاع خلية البيانات (pt؛ ارتفاع الفتحة لمقياس واحد). يتمدد تلقائيًا مع التفاف النص. الافتراضي: 20 |
| `border` | { color?, width? } |  | إعدادات الحدود (راجع الجدول أدناه). لا تُرسم الأطر الخارجية وفواصل الصفوف/الأعمدة وفواصل مستويات الترويسة إلا عند تحديدها (ولا تعبر أبدًا خلية ترويسة خارجية مدموجة) |
| `showSubtotals` | boolean |  | إظهار المجاميع الفرعية. الافتراضي: false. عند true يُدرج صف/عمود مجموع فرعي بعنوان «Total» في نهاية كتلة كل مجموعة، باستثناء المستوى الأعمق. تُعاد تجميع قيم المجاميع الفرعية من القيم الخام باستخدام `calculation` كل مقياس |
| `showGrandTotal` | boolean |  | إظهار المجموع الكلي. الافتراضي: false. عند true يُلحق صف/عمود مجموع كلي بعنوان «Total» في النهاية (لا يُخرَج عندما تكون صفوف البيانات صفرًا). قيم المجموع الكلي تُعاد تجميعها أيضًا من القيم الخام |
| `dataSourceExpression` | Expression |  | يستخدم المصفوفة التي يُقيَّم إليها التعبير كصفوف بيانات هذا الجدول التقاطعي. عند الحذف (أو عندما لا تكون النتيجة مصفوفة) تُستخدم صفوف مصدر البيانات الرئيسي |

**تعريف مجموعة الصفوف/الأعمدة (كل مُدخل في `rowGroups`/`columnGroups`)**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `field` | string | ✓ | اسم الحقل المراد التجميع حسبه. تظهر المجموعات بترتيب أول ظهور في البيانات |
| `headerFormat` | string |  | تنسيق عرض قيم الترويسة. تنسيق بسيط يطبَّق فقط عندما تكون القيمة رقمية (`'#,##0'` أو أي شيء يحتوي `,` ← فواصل الآلاف؛ ومواصفة عشرية مثل `'.00'` ← منازل عشرية ثابتة بتلك الدقة؛ وأي شيء آخر ← تحويل نصي عادي) |

**تعريف المقياس (كل مُدخل في `measures`)**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `field` | string | ✓ | اسم الحقل المراد تجميعه. القيم غير الرقمية تُحوَّل إلى أرقام؛ والقيم غير القابلة للتحويل تُحسب 0 |
| `calculation` | `'sum'` = المجموع / `'count'` = العدد / `'average'` = المتوسط / `'min'` = الحد الأدنى / `'max'` = الحد الأقصى | ✓ | طريقة التجميع. تُعاد تجميع المجاميع الفرعية والكلية أيضًا من مجموعة القيم الخام بالطريقة نفسها، لذا حتى `average` وأمثالها تخرج صحيحة |
| `format` | string |  | تنسيق عرض قيم التجميع (التنسيق البسيط نفسه المستخدم في `headerFormat`: ‏`'#,##0'` أو `,` ← فواصل الآلاف، و`'.NN'` ← NN منزلة عشرية ثابتة، ولا شيء ← تحويل نصي عادي) |

**إعدادات الحدود (`border`)**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `color` | string |  | لون الخط. الافتراضي: `#000000` |
| `width` | number |  | عرض الخط (pt) للإطار الخارجي وحدود الترويسة/البيانات. الافتراضي: 0.5. تُرسم الفواصل الداخلية للصفوف/الأعمدة بنصف هذا العرض |

### تضمين تقرير داخل آخر — `subreport`

شُرحت الفكرة في **أساسيات تخطيط التقارير**. إليك تعريفًا كاملًا يعمل كما هو. يعمل التقرير الفرعي مرة لكل صف تفاصيل في الأب، وتصبح المصفوفة الممرَّرة عبر `dataSourceExpression` هي `rows` الخاصة بالتقرير الفرعي.

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

بيانات العينة:

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

ملف `subreport.report` المضمَّن قالب مستقل بحد ذاته. يشير إلى كل عنصر من `items` المستلمة كقيم `field.*` عادية ويستقبل المعاملات الممرَّرة من الأب عبر `param.*`. لاحظ أن القوالب المنفَّذة كتقارير فرعية لا تُخرج أشرطتها `pageHeader` و`pageFooter` و`background` (إدارة الصفحات مهمة التقرير الأب). توضع العناوين في شريط `title`، هكذا:

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

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | نوع العنصر |
| `templateExpression` | Expression | ✓ | تعبير يعيد اسم قالب الابن. عند استخدام `createReportFromFile()` يُحل تلقائيًا كمسار ملف؛ وعند استدعاء `createReport()` مباشرة، حُلّه بالخيار `resolveSubreportTemplate` (دالة تستقبل الاسم ومجلد العمل وتعيد `{ template, workingDirectory? }`، أو `null` عند تعذّر الحل) |
| `dataSourceExpression` | Expression | | تعبير يعيد مصدر بيانات تقرير الابن (مصفوفة كائنات صفوف). عند الحذف تُستخدم صفوف مصدر بيانات الأب كما هي. النتيجة غير المصفوفية تُعامل كبيانات فارغة |
| `parameters` | SubreportParamDef[] |  | المعاملات الممرَّرة إلى تقرير الابن (راجع **`SubreportParamDef`** في الجدول أدناه). لها الأولوية على المُدخلات المماثلة الاسم من `parametersMapExpression` |
| `parametersMapExpression` | Expression | | تعبير يعيد كائنًا يُدمج في معاملات الابن (تفوز مُدخلات `parameters` الفردية) |
| `returnValues` | ReturnValueDef[] |  | تعريفات إعادة قيم متغيرات تقرير الابن إلى الأب (راجع **`ReturnValueDef`** في الجدول أدناه) |
| `usingCache` | boolean | | ضمن تنفيذ واحد للتقرير الأب، تخزين قوالب الأبناء المحلولة مؤقتًا وإعادة استخدامها لكل اسم قالب |
| `runToBottom` | boolean | | بعد محتوى التقرير الفرعي، استهلاك المساحة المتبقية من الصفحة/العمود (دافعًا العناصر اللاحقة إلى ما دون المساحة المتبقية) |

**`SubreportParamDef`** (كل مُدخل في `parameters` = معامل يُمرَّر إلى تقرير الابن)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم المعامل الممرَّر إلى تقرير الابن (يُشار إليه على جانب الابن بـ `param.name`) |
| `expression` | Expression | ✓ | تعبير يحسب قيمة المعامل. يُقيَّم في سياق التقرير الأب |

**`ReturnValueDef`** (كل مُدخل في `returnValues` = تعريف لإعادة قيمة من الابن إلى الأب)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم المتغير الذي يستقبل القيمة على جانب الأب. يُستثنى هذا المتغير من الاستبدال بحساب المتغيرات العادي في الأب |
| `subreportVariable` | string | ✓ | اسم المتغير المصدر على جانب الابن. عند انتهاء تشغيل تقرير الابن، تُنشر قيمته إلى الأب |
| `calculation` | `'nothing'` = إسناد قيمة الابن كما هي (تُستبدل مع كل تشغيل) / `'count'` = العدد / `'sum'` = المجموع / `'average'` = المتوسط / `'min'` = الحد الأدنى / `'max'` = الحد الأقصى / `'first'` = الاحتفاظ بأول قيمة مُحصَّلة | ✓ | كيفية طيّ القيمة في متغير الأب. كل ما عدا `'nothing'` يجمّع عبر مرات التشغيل عندما يُنفَّذ التقرير الفرعي عدة مرات |

### طباعة الباركود ورموز QR — `barcode`

يقبل `barcodeType` القيم Code 39/93/128 وEAN وUPC وITF وCodabar وMSI وQR Code (‏`qrcode`) وData Matrix وPDF417 وغيرها. يضيف `showText` النص المقروء بشريًا كمرجع للمسح.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

بيانات العينة:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | نوع العنصر |
| `barcodeType` | string | ✓ | نظام الترميز الشريطي (غير حساس لحالة الأحرف). القيم المسموحة: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`، `'ean-13'` = EAN-13 / `'ean8'`، `'ean-8'` = EAN-8 / `'qrcode'`، `'qr'` = QR Code / `'datamatrix'`، `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`، `'upc-a'` = UPC-A / `'upce'`، `'upc-e'` = UPC-E / `'itf'`، `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. أي قيمة أخرى غير مدعومة وترسم شكلًا بديلًا |
| `expression` | Expression | ✓ | تعبير يعيد بيانات الباركود (تُحوَّل نتيجة التقييم إلى نص وتُرمَّز) |
| `showText` | boolean | | إظهار النص المقروء بشريًا أسفل الباركود أحادي البعد (ارتفاع منطقة النص 10pt وحجم الخط 8pt؛ ينكمش ارتفاع الأشرطة بذلك المقدار). لا يُستخدم للرموز ثنائية البعد (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | مستوى تصحيح الأخطاء لرمز QR — القدرة على البقاء قابلًا للقراءة حتى عندما يتلطخ جزء من الرمز أو يفقد. ترتفع المتانة من `'L'` إلى `'H'` على حساب نمط أدق. يوصى بـ `'Q'` أو `'H'` لوسائط الطباعة الخشنة. الافتراضي: `'M'`. فعّال لرموز QR فقط (مستوى تصحيح الأخطاء في PDF417 يُختار تلقائيًا من طول البيانات) |

### طباعة الصيغ الرياضية — `math`

ينضّد صيغًا بأسلوب LaTeX. يتطلب التنضيد الرياضي خطًا مخصصًا يحمل مقاييس خاصة بالرياضيات (جدول MATH في OpenType)؛ ومن الأمثلة المتاحة مجانًا STIX Two Math وLatin Modern Math. خط المتن العادي لا يصلح بديلًا. يُقيَّم `formula` كتعبير (يشير هذا المثال إلى الحقل `formula` في البيانات).

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

بيانات العينة:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

عند استخدام العنصر `math`، سجّل خطًا يملك جدول MATH من OpenType في كلٍّ من `fontMap` و`fonts` الخاصة بإخراج PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | نوع العنصر |
| `formula` | Expression | ✓ | تعبير يعيد سلسلة صيغة LaTeX (لفّ الصيغة الثابتة بـ `'...'` كسلسلة حرفية داخل التعبير). لا يُرسم شيء عندما تكون النتيجة سلسلة فارغة |
| `mathFontFamily` | string | | الخط المستخدم للعرض الرياضي (معرّف خط مسجَّل في fontMap). الافتراضي: fontFamily نمط العنصر، أو `'default'` إن كان ذلك غائبًا أيضًا |
| `fontSize` | number | | حجم الخط (pt). الافتراضي: fontSize نمط العنصر، أو 12 إن كان ذلك غائبًا أيضًا |
| `color` | string | | لون النص. الافتراضي: يُحل بالترتيب — forecolor العنصر ← forecolor النمط ← `#000000` |

### طباعة SVG — `svg`

يعرض مستند SVG مباشرةً داخل التقرير. يُقيَّم `svgContent` كتعبير (يمكن تمرير سلسلة SVG ثابتة عبر البيانات أو المعاملات).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

بيانات العينة:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | نوع العنصر |
| `svgContent` | Expression | ✓ | تعبير يعيد سلسلة ترميز SVG. تُحوَّل النتيجة إلى نص وتُعرض كـ SVG في موضع العنصر وبحجمه |

### إنشاء نماذج PDF قابلة للتعبئة — `formField`

يضع حقول نماذج يمكن لمن يفتح ملف PDF تعبئتها. يقبل `fieldType` القيم `text` و`checkbox` و`radio` و`pushbutton` و`dropdown` و`listbox` و`signature`.

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

بيانات العينة (تصبح القيمة الابتدائية للنموذج):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | نوع العنصر. حقل نموذج تفاعلي. ترسم خلفيات المعاينة مظهره الابتدائي، ويُخرجه إخراج PDF كحقل قابل للتعبئة فعلًا |
| `fieldType` | `'text'` = حقل إدخال نصي (PDF /Tx) / `'checkbox'` = خانة اختيار (/Btn) / `'radio'` = زر راديو (/Btn؛ الودجات المتشاركة في `fieldName` نفسه تشكّل مجموعة واحدة متنافية) / `'pushbutton'` = زر ضغط (/Btn؛ تسمية مع إجراء URI اختياري) / `'dropdown'` = قائمة منسدلة (صندوق تحرير وسرد، /Ch) / `'listbox'` = صندوق قائمة (/Ch) / `'signature'` = حقل توقيع (/Sig) | ✓ | نوع الحقل |
| `fieldName` | string | ✓ | اسم الحقل الكامل التأهيل. يجب أن يكون فريدًا داخل المستند (التكرارات ترمي استثناءً). الاستثناء هو `radio`، حيث يشكّل تشارك الاسم نفسه مجموعة واحدة متنافية |
| `value` | Expression |  | القيمة الابتدائية (text: قيمة الإدخال؛ dropdown/listbox: القيمة المحددة؛ ولصندوق قائمة `multiSelect` حدّد قيمًا متعددة مفصولة بأسطر جديدة). تُقيَّم كتعبير. الجمع مع `valueStream` يرمي استثناءً |
| `checked` | Expression |  | حالة التحديد الابتدائية (checkbox/radio). تُقيَّم كتعبير. للراديو، تصبح `exportValue` الخاصة بالزر المحدد قيمةَ المجموعة المختارة |
| `exportValue` | string |  | السلسلة المسجلة كقيمة تعني أن خانة الاختيار/الراديو هذه «مفعّلة» عند إرسال مدخلات النموذج أو استخراجها (checkbox/radio). الافتراضي: `'Yes'`. في مجموعة راديو، تميّز هذه القيمة الخيارات الفردية |
| `options` | FormFieldOption[] |  | مصفوفة الخيارات (dropdown/listbox). راجع الجدول أدناه |
| `editable` | boolean |  | السماح بإدخال حر إضافة إلى الخيارات (يجعل القائمة المنسدلة تقبل الكتابة بأسلوب صندوق التحرير والسرد) |
| `multiSelect` | boolean |  | السماح بالتحديد المتعدد (listbox) |
| `caption` | string |  | تسمية الزر (pushbutton) |
| `action` | string |  | عنوان URI يُفتح عند ضغط زر الضغط |
| `multiline` | boolean |  | إدخال متعدد الأسطر (text) |
| `readOnly` | boolean |  | جعل الحقل للقراءة فقط |
| `required` | boolean |  | جعل الحقل مطلوبًا |
| `noExport` | boolean |  | عدم تصدير قيمة هذا الحقل عند إرسال النموذج |
| `password` | boolean |  | إدخال كلمة مرور (text؛ تُحجب الحروف المكتوبة) |
| `fileSelect` | boolean |  | جعله حقل اختيار ملف (text). الجمع مع `multiline`/`password` يرمي استثناءً |
| `doNotSpellCheck` | boolean |  | تعطيل التدقيق الإملائي (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | منع التمرير للإدخال الذي يتجاوز المنطقة المرئية (text) |
| `comb` | boolean |  | العرض كصناديق حروف متساوية التباعد (comb) (text). يجب تحديد `maxLength`؛ والجمع مع `multiline`/`password`/`fileSelect` يرمي استثناءً |
| `richText` | string |  | قيمة نص منسق (PDF /RV) تُعرض بالتنسيق (غامق، ألوان، إلخ) في العارضات الداعمة. تعيينها يرفع راية النص المنسق للحقل. الجمع مع `richTextStream` يرمي استثناءً |
| `richTextStream` | Uint8Array |  | الشكل التدفقي لـ `richText`. للحفاظ على مستوى البايت عندما كانت /RV في ملف PDF المصدر تدفقًا أثناء استيراد PDF؛ القوالب المكتوبة يدويًا تستخدم `richText` عادةً. الجمع مع `richText` يرمي استثناءً |
| `defaultStyle` | string |  | النمط الافتراضي للنص المنسق (PDF /DS). سلسلة بصيغة شبيهة بـ CSS (مثل `font: Helvetica 12pt`) توفر الافتراضات لما لا يحدده `richText` |
| `valueStream` | Uint8Array |  | للحفاظ عليها عند استيراد PDF. عندما كانت قيمة الحقل (/V) في ملف PDF المصدر كائن تدفق بدلًا من سلسلة، يعيد إخراج تلك البايتات دون فقد. القوالب المكتوبة يدويًا تستخدم `value` عادةً. الجمع مع `value` يرمي استثناءً |
| `defaultValue` | string |  | القيمة الافتراضية التي يعود إليها الحقل عند إعادة تعيين النموذج (/DV) |
| `sort` | boolean |  | عرض الخيارات مرتّبة (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | اعتماد القيمة فور تغيّر التحديد (dropdown/listbox) |
| `radiosInUnison` | boolean |  | تبديل أزرار الراديو داخل مجموعة تتشارك `exportValue` نفسها تشغيلًا وإيقافًا معًا |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | يرفق بالحقل نصوص إدخال برمجية تعمل في عارضات PDF. ‏K = عند كل ضغطة مفتاح (مثل إزالة غير الأرقام)، وF = تنسيق العرض (مثل إظهار منزلتين عشريتين)، وV = التحقق من القيمة (مثل رفض الأرقام السالبة)، وC = إعادة الحساب (مثل الحساب التلقائي من قيم حقول أخرى). المحتوى عادةً `PdfActionDef` (الموضح لاحقًا) بـ `subtype: 'JavaScript'`. المحرك الأساسي يضمّن النصوص البرمجية في PDF فقط ولا ينفذها أبدًا. لمجموعة راديو، يجب أن تحمل جميع الودجات تعريفات متطابقة وإلا رُمي استثناء |
| `calculationOrder` | number |  | عندما تملك حقول متعددة إجراء `'C'` (إعادة حساب)، الترتيب الذي يعيد به العارض حسابها (PDF /CO). ترتيب تصاعدي لأعداد صحيحة ≥ 0. التكرارات والقيم السالبة وغير الصحيحة ترمي استثناءً |
| `maxLength` | number |  | الحد الأقصى لطول الإدخال (text) |
| `borderColor` | string |  | لون الحدود (`#RRGGBB`). لا حدود عند الحذف. تُرسم كإطار بعرض 1pt — دائري للراديو ومستطيل لغيره |
| `backgroundColor` | string |  | لون الخلفية (`#RRGGBB`). شفاف عند الحذف. يُملأ كدائرة للراديو ومستطيل لغيره |

**`FormFieldOption`** (كل مُدخل في `options` = تعريف خيار)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `value` | string | ✓ | قيمة التصدير المخزنة في قيمة الحقل (/V) |
| `label` | string |  | تسمية العرض. الافتراضي: مثل `value` |

ملاحظة: إضافة إلى ذلك، يجوز تحديد جميع الخصائص المشتركة بين العناصر وكل خصائص `TextProperties` (تُطبَّق على الخط والمحاذاة وغيرهما لنص الإدخال).

### فرض فاصل صفحة أو عمود في أي مكان — `break`

يفرض الانتقال إلى الصفحة التالية (`"breakType": "page"`) أو العمود التالي (`"column"`) في منتصف تدفق التفاصيل. ضعه مباشرة في شريط؛ لا يمكن وضعه داخل `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**قائمة الخصائص**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | نوع العنصر |
| `breakType` | `'page'` \| `'column'` | ✓ | نوع الفاصل. يقسم الشريط عند موضع y الخاص بالعنصر؛ `'page'` = المتابعة في الصفحة التالية / `'column'` = المتابعة في العمود التالي عندما يكون التخطيط متعدد الأعمدة (`columns.count` في القالب 2 أو أكثر؛ راجع **أساسيات تخطيط التقارير**) وهذا ليس العمود الأخير (وإلا عمل كفاصل صفحة) |

### طباعة عنصر فقط عند تحقق شرط — `printWhenExpression`

ليس `printWhenExpression` نوع عنصر مستقلًا بل **سمة مشتركة بين جميع العناصر**. يُطبع العنصر فقط في الصفوف التي يُقيَّم فيها التعبير إلى قيمة صادقة (truthy). يطبع المثال التالي «※ 至急» (عاجل) فقط في صفوف التفاصيل التي يكون فيها `urgent` بقيمة `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

بيانات العينة (يُطبع للصف الأول فقط):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

تقبل الأشرطة أيضًا `printWhenExpression` بالاسم نفسه، فيكبت إخراج الشريط بأكمله (مثلًا: إخراج شريط ملاحظات فقط عند تعيين `param.showNotes`). وعندما يكون القالب معرّفًا في TypeScript، تمنح دالة الاستدعاء `onBeforeRender` الخاصة بالعنصر تحكمًا أدق — أعد `null` لتخطي طباعة العنصر، أو أعد `ElementDef` للطباعة بسمات مستبدَلة في الحال مثل النص والأبعاد والألوان.
## مرجع خصائص العناصر

تغطي «قائمة الخصائص» المرفقة بعينة كل عنصر الخصائص الخاصة بذلك العنصر فقط. إضافة إلى ذلك، يقبل كل عنصر خصائص مشتركة للموضع والحجم وشروط الطباعة والألوان وغير ذلك. يلخص هذا القسم الخصائص المشتركة بين جميع العناصر وخصائص الأنماط المعرّفة في `styles` القالب.

### الخصائص المشتركة بين جميع العناصر

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `id` | string |  | معرّف للبحث عن عنصر وتعديله قبل العرض بـ `findElementById()`. لا يؤثر على المحتوى المطبوع نفسه. أبقِ المعرّفات المستخدمة كأهداف تعديل فريدة داخل القالب (عند التكرار يُعاد أول عنصر في ترتيب البحث) |
| `x` | number | ✓ | إحداثي X داخل الشريط/الحاوية الأب (pt) |
| `y` | number | ✓ | إحداثي Y داخل الشريط/الحاوية الأب (pt) |
| `width` | number | ✓ | العرض (pt) |
| `height` | number | ✓ | الارتفاع (pt) |
| `style` | string |  | اسم النمط المراد تطبيقه (يشير إلى `name` الخاص بـ `StyleDef` معرّف في `styles`؛ وعند عدم التحديد يُطبَّق النمط ذو `isDefault`) |
| `positionType` | `'float'` = يتحرك إلى الأسفل بمقدار تمدد العناصر التي فوقه / `'fixRelativeToTop'` = يثبّت الموضع من الحافة العلوية للشريط (الافتراضي) / `'fixRelativeToBottom'` = يحافظ على المسافة من الحافة السفلية للشريط (يتحرك إلى الأسفل بمقدار تمدد الشريط) |  | قاعدة التموضع عند تمدد الشريط. الافتراضي: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = لا يتمدد (الافتراضي) / `'containerHeight'` = يجعل ارتفاع العنصر مطابقًا للارتفاع الفعلي للشريط / `'containerBottom'` = يمدد الحافة السفلية للعنصر إلى القاع الفعلي للشريط (يغيّر الارتفاع فقط) |  | قاعدة تمدد العنصر عند تمدد الشريط. الافتراضي: `noStretch` |
| `printWhenExpression` | Expression \| null |  | عندما تكون نتيجة التقييم زائفة (falsy)، لا يُطبع هذا العنصر |
| `onBeforeRender` | OnBeforeRenderCallback |  | دالة استدعاء تُستدعى قبيل العرض مباشرة: `(elem, field, vars, param, report) => ElementDef \| null`. إعادة `null` تتخطى الطباعة (مجموعة أشمل من `printWhenExpression`)؛ وإعادة `ElementDef` تعرض بذلك التعريف (مستبدلة أي سمة ديناميكيًا). ترتيب التقييم: `onBeforeRender` ← `printWhenExpression` (يُقيَّم على التعريف المستبدَل) ← `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | عندما لا يُطبع العنصر، إذا لم يتقاطع أي عنصر مطبوع آخر مع الشريحة الرأسية التي يشغلها العنصر، تُزال تلك الشريحة وتُسحب العناصر التي تحتها إلى الأعلى فينكمش الشريط |
| `isPrintRepeatedValues` | boolean |  | عند تعيينها إلى `false`، تُكبت الطباعة عندما تكون القيمة (textField) مطابقة للسابقة (أثناء الكبت يُعامل العنصر كارتفاع 0 إذا كانت `isRemoveLineWhenBlank` صادقة) |
| `isPrintWhenDetailOverflows` | boolean |  | يعيد طباعة هذا العنصر في كل جزء صفحة/عمود يفيض إليه الشريط |
| `mode` | `'opaque'` = يملأ الخلفية بـ `backcolor` / `'transparent'` = لا يملأ الخلفية |  | وضع العرض. الافتراضي: `transparent` (يُحل بأولوية العنصر ثم النمط) |
| `forecolor` | string |  | اللون الأمامي (`#RRGGBB` أو `#RRGGBBAA`) |
| `backcolor` | string |  | لون الخلفية (يُرسم عندما يكون `mode` بقيمة `opaque`) |
| `border` | BorderDef |  | الحدود (راجع **`BorderDef`** أدناه). لعناصر line/rectangle/ellipse/path لا تُرسم الحدود (سواء أتت من نمط أو حُددت مباشرة على العنصر؛ فهذه العناصر تحدد الخطوط عبر خصائصها الخاصة مثل `stroke`) |
| `padding` | Padding |  | الحشو (راجع **`Padding`** أدناه) |
| `blendMode` | BlendModeDef |  | كيفية تركيب ألوان هذا العنصر مع المحتوى المرسوم تحته من قبل (راجع **`BlendModeDef`** أدناه). مثال نموذجي: تحديد `'multiply'` على صورة ختم يركّبها بشفافية دون إخفاء النص تحتها |
| `overprintFill` | boolean |  | لتجهيز الطباعة التجارية. يحدد الطباعة الفوقية للتعبئات (وجوه النصوص والأشكال): تُطبع فوق صفائح الألوان التحتية دون إسقاطها |
| `overprintStroke` | boolean |  | لتجهيز الطباعة التجارية. إعداد الطباعة الفوقية للخطوط (الحدود) |
| `overprintMode` | 0 \| 1 |  | يختار السلوك عند تفعيل `overprintFill`/`overprintStroke` (‏PDF /OPM). ‏`0` = كل مكوّن لوني يستبدل اللون التحتي (الافتراضي) / `1` = المكوّنات اللونية ذات القيمة 0 تترك اللون التحتي سليمًا |
| `renderingIntent` | `'AbsoluteColorimetric'` = وفيّ قياسًا لونيًا / `'RelativeColorimetric'` = وفيّ بعد مطابقة نقاط البياض / `'Saturation'` = يفضّل الزهاء / `'Perceptual'` = يفضّل المظهر الطبيعي |  | سياسة الأولوية لتحويل الألوان التي لا تقع ضمن نطاق ألوان جهاز الإخراج (نية العرض في PDF). موجهة للطباعة التجارية وإدارة الألوان؛ لا حاجة عادةً لتحديدها |
| `alphaIsShape` | boolean |  | تحكم دقيق في تركيب الشفافية في PDF (يفسّر العتامة والأقنعة على أنها «شكل»؛ /AIS). لا حاجة عادةً لتحديده؛ يُستخدم أساسًا لإعادة الإخراج الوفي لملفات PDF المستوردة |
| `textKnockout` | boolean |  | عند تراكب الحروف نصف الشفافة، يتجنب التركيب المزدوج للتراكبات داخل النص نفسه (PDF /TK). الافتراضي: `true`. لا حاجة عادةً لتحديده |
| `optionalContent` | OptionalContentDef |  | يضع هذا العنصر على «طبقة» PDF. يمكن تبديل الرؤية والطباعة من لوحة الطبقات في العارض (مثلًا: إظهار علامة مائية على الشاشة وإسقاطها عند الطباعة). راجع **`OptionalContentDef`** أدناه |
| `opacity` | number |  | عتامة العنصر (0.0–1.0). للعناصر ذات الأبناء، تُطبَّق بعد تركيبهم كمجموعة |

**`BlendModeDef`** (أوضاع المزج القابلة للتحديد في `blendMode`)

ترسم العناصر عادةً فوق ما رُسم تحتها (`'normal'`). تحديد وضع مزج يجمع اللونين العلوي والسفلي حسابيًا. في مستندات الأعمال، الاستخدامات النموذجية هي تركيب ختم شخصي أو ختم شركة فوق النص (`'multiply'`) وإنتاج تأثير شبيه بالإسقاط الأبيض على خلفية داكنة (`'screen'`).

| الثابت | التأثير |
| --- | --- |
| `'normal'` | يرسم باللون العلوي دون مزج (مكافئ للافتراضي) |
| `'multiply'` | ضرب. التراكبات تصبح أدكن دائمًا. للأختام والطوابع والتظليل بأسلوب قلم التحديد |
| `'screen'` | ضرب عكسي. التراكبات تصبح أفتح دائمًا |
| `'overlay'` | يضرب حيث تكون القاعدة داكنة ويعكس حيث تكون فاتحة. يبرز التباين |
| `'darken'` | يأخذ الأدكن من اللونين |
| `'lighten'` | يأخذ الأفتح من اللونين |
| `'color-dodge'` | يفتّح القاعدة (حتى الإشباع الضوئي) وفقًا للون العلوي |
| `'color-burn'` | يحرق القاعدة نحو الدكانة وفقًا للون العلوي |
| `'hard-light'` | يبدّل بين الضرب والضرب العكسي حسب إضاءة اللون العلوي (تأثير إضاءة قوي) |
| `'soft-light'` | نسخة أضعف من `'hard-light'` (تأثير إضاءة ناعم) |
| `'difference'` | القيمة المطلقة للفرق بين اللونين |
| `'exclusion'` | نسخة أقل تباينًا من `'difference'` |
| `'hue'` | صبغة اللون العلوي + إشباع وإضاءة السفلي |
| `'saturation'` | إشباع العلوي + صبغة وإضاءة السفلي |
| `'color'` | صبغة وإشباع العلوي + إضاءة السفلي (لتلوين قاعدة أحادية اللون) |
| `'luminosity'` | إضاءة العلوي + صبغة وإشباع السفلي |

**`Expression`** (راجع «إتقان التعبيرات» للتفاصيل)
| الشكل | الوصف |
| --- | --- |
| string | اللغة المصغرة للتعبيرات. أمثلة: `'field.customer.name'`، و`'field.price * field.quantity'`، و`` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``، و`'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | دالة TypeScript بالشكل `(field, vars, param, report) => unknown`. يوفر `report` (‏ReportContext) القيم `PAGE_NUMBER` (رقم الصفحة الحالي، يبدأ من 1)، و`COLUMN_NUMBER` (رقم العمود الحالي، يبدأ من 1)، و`REPORT_COUNT` (عدد السجلات المعالجة)، و`TOTAL_PAGES` (إجمالي عدد الصفحات؛ يصبح نهائيًا مع evaluationTime=report)، و`RETURN_VALUE` (موجود في تعريف النوع لكنه دائمًا undefined في التنفيذ الحالي — قيم إعادة التقارير الفرعية تُستقبل عبر `vars.*`)، و`format` (دوال التنسيق المدمجة)، و`formatters` (المُنسِّقات المخصصة المسجلة على القالب) |


**`BorderDef`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `width` | number |  | عرض الخط (pt). الافتراضي المشترك بين جميع الجوانب |
| `color` | string |  | لون الخط. الافتراضي المشترك بين جميع الجوانب |
| `style` | `'solid'` = خط متصل / `'dashed'` = خط متقطع / `'dotted'` = خط منقّط |  | نمط الخط. الافتراضي المشترك بين جميع الجوانب |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | إعدادات كل جانب على حدة (راجع **`BorderSideDef`** أدناه). لها الأولوية على إعدادات جميع الجوانب؛ و`null` تخفي ذلك الجانب |

**`BorderSideDef`** (تُستخدم في `top`/`bottom`/`left`/`right` الخاصة بـ `BorderDef`)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `width` | number | ✓ | عرض الخط (pt) |
| `color` | string | ✓ | لون الخط |
| `style` | `'solid'` = خط متصل / `'dashed'` = خط متقطع / `'dotted'` = خط منقّط | ✓ | نمط الخط |

**`Padding`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | الحشو على كل جانب (pt) |

**`HyperlinkDef`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'reference'` = عنوان URL خارجي / `'localAnchor'` = إلى مرساة داخل المستند نفسه / `'localPage'` = إلى رقم صفحة داخل المستند نفسه / `'remoteAnchor'` = إلى مرساة في مستند PDF آخر / `'remotePage'` = إلى صفحة في مستند PDF آخر | ✓ | نوع الرابط |
| `target` | Expression | ✓ | وجهة الرابط (عنوان URL أو اسم مرساة أو تعبير رقم صفحة) |
| `remoteDocument` | Expression |  | مسار ملف PDF البعيد (لـ remotePage / remoteAnchor) |

**`TextProperties`** (خصائص النص والفقرة لـ staticText / textField / formField)
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `markup` | `'none'` = نص عادي / `'styled'` = ترميز الأنماط (`<style forecolor=... isBold=...>`، و`<b>`/`<i>`/`<u>`، وما إليها) / `'html'` = مجموعة فرعية من HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | نوع الترميز |
| `hAlign` | `'left'` = محاذاة لليسار / `'center'` = توسيط / `'right'` = محاذاة لليمين / `'justify'` = ضبط |  | المحاذاة الأفقية |
| `vAlign` | `'top'` = محاذاة للأعلى / `'middle'` = محاذاة للوسط / `'bottom'` = محاذاة للأسفل |  | المحاذاة الرأسية |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | تدوير النص (بالدرجات) |
| `lineSpacing` | LineSpacingDef |  | إعدادات تباعد الأسطر (راجع **`LineSpacingDef`** أدناه) |
| `letterSpacing` | number |  | تباعد الحروف (pt). يضيف مقدارًا ثابتًا بين جميع الحروف (والقيم السالبة تضيّق) |
| `tracking` | number |  | نوع آخر من ضبط تباعد الحروف. فبينما تضيف `letterSpacing` مقدارًا ثابتًا بانتظام، يستخدم هذا جدول ضبط التباعد المدمج في الخط نفسه (جدول AAT ‏`trak`) لتضييق التباعد أو توسيعه بقيم تصميمية تعتمد على حجم الخط. والرقم هو «قيمة التتبع» في الجدول: 0 = عادي، والسالب = أضيق، والموجب = أوسع (وتُستوفى القيم الوسيطة بالاستيفاء). لا أثر له على الخطوط التي لا تحوي جدول `trak` |
| `wordSpacing` | number |  | تباعد الكلمات (pt؛ عرض إضافي يُضاف إلى حروف المسافة) |
| `horizontalScale` | number |  | معامل تحجيم يمطّ أشكال الحروف أفقيًا (أقل من 1 = مضغوط، فيضيق العرض؛ وأكبر من 1 = ممدد، فيتسع). ويُحسب الالتفاف وتقدّم السطر من العروض المحجّمة. الافتراضي: 1 |
| `baselineOffset` | number |  | يحدد صراحةً موضع خط الأساس (الخط المرجعي الذي تستقر عليه الحروف) بالـ pt من الحافة العلوية للعنصر. يُحسب عادةً تلقائيًا فلا حاجة لتحديده (يضبطه أساسًا استيراد PDF لإعادة إنتاج مواضع النص الأصلية) |
| `firstLineIndent` | number |  | إزاحة السطر الأول (pt) |
| `leftIndent` | number |  | الإزاحة اليسرى (pt) |
| `rightIndent` | number |  | الإزاحة اليمنى (pt) |
| `padding` | Padding |  | الحشو |
| `direction` | `'ltr'` = من اليسار إلى اليمين / `'rtl'` = من اليمين إلى اليسار / `'auto'` = يُكتشف تلقائيًا من المحتوى (تحليل النص ثنائي الاتجاه) |  | اتجاه النص |
| `openTypeScript` | string |  | وسم OpenType يحدد قواعد أي نظام كتابة في الخط تُستخدم عند تحويل النص إلى أشكال حروف (التشكيل) (مثلًا `'latn'` = الكتابة اللاتينية، و`'arab'` = الكتابة العربية). لا حاجة عادةً لتحديده (يُعالج تلقائيًا من محتوى النص) |
| `openTypeLanguage` | string |  | وسم OpenType يجعل اللغة صريحة للخطوط التي تغيّر أشكال الحروف بحسب اللغة داخل نظام الكتابة نفسه. لا حاجة عادةً لتحديده |
| `openTypeFeatures` | Record<string, number> |  | يشغّل أو يوقف ميزات تبديل الحروف المدمجة في الخط. أمثلة: `{ "palt": 1 }` = تضييق تباعد الحروف اليابانية، و`{ "liga": 0 }` = تعطيل الحروف المركبة، و`{ "zero": 1 }` = الصفر المشطوب. القيم: 0 = إيقاف / 1 = تشغيل؛ ولميزات اختيار الحروف، رقم الحرف البديل ابتداءً من 1 |
| `shrinkToFit` | boolean |  | التصغير التلقائي: يقلل حجم الخط ليتسع النص ضمن عرض العنصر وارتفاعه |
| `minFontSize` | number |  | الحد الأدنى لحجم الخط (pt) مع `shrinkToFit`. الافتراضي: 4 |
| `fitWidth` | boolean |  | يضبط حجم الخط تلقائيًا بحيث يتسع أطول سطر تمامًا ضمن عرض محتوى العنصر (في الاتجاهين، تصغيرًا وتكبيرًا) |
| `outlineText` | boolean |  | يحوّل النص إلى مخططات (مسارات). الافتراضي: `false` |
| `pdfFontMode` | `'embedded'` = يضمّن برنامج الخط / `'reference'` = يُخرج إشارة إلى خط النظام دون تضمين |  | كيفية التعامل مع برنامج خط PDF |
| `textPaintMode` | `'fill'` = تعبئة / `'stroke'` = مخطط فقط / `'fillStroke'` = تعبئة + مخطط |  | دلالات طلاء النص المحفوظة عبر استيراد PDF. الافتراضي: `fill` |
| `textStrokeColor` | string |  | لون الحد لـ stroke / fillStroke |
| `textStrokeWidth` | number |  | عرض حد مخطط النص (pt) |
| `tabStops` | TabStopDef[] |  | تعريفات مواقف الجدولة (راجع **`TabStopDef`** أدناه) |
| `tabStopWidth` | number |  | فاصل الجدولة الافتراضي (pt). ‏40pt عند عدم التحديد |
| `wrap` | boolean |  | التفاف النص. الافتراضي: `true` (تعني undefined أن الالتفاف مفعّل) |

**`LineSpacingDef`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'single'` = سطر مفرد / `'1.5'` = 1.5 سطر / `'double'` = مضاعف / `'proportional'` = نسبة / `'fixed'` = قيمة ثابتة / `'minimum'` = قيمة دنيا | ✓ | نوع تباعد الأسطر |
| `value` | number |  | القيمة لـ fixed / minimum / proportional |

**`TabStopDef`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `position` | number | ✓ | موضع الجدولة (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | محاذاة الجدولة. الافتراضي: `left` |

**`FillDef`** (اتحاد الأنواع المقبولة في تعبئة (`fill`) وحد (`stroke`) عنصر `path`، وفي تعبئة (`fill`) عنصري `rectangle`/`ellipse`. أما `stroke` الخاص بـ `rectangle`/`ellipse` فيقبل سلسلة لون مصمت فقط)
| الشكل | الوصف |
| --- | --- |
| string | لون مصمت (`#RRGGBB` أو `#RRGGBBAA`) |
| PdfSpecialColorDef | لون خاص (Separation/DeviceN). تحديد لوني لأحبار بعينها كالذهبي أو الفضي أو ألوان الشركة (راجع الجدول أدناه) |
| LinearGradientDef | تدرج خطي — تتغير الألوان على امتداد محور يصل بين نقطتين (راجع الجدول أدناه) |
| RadialGradientDef | تدرج شعاعي — تتغير الألوان انطلاقًا من مركز نحو الخارج (راجع الجدول أدناه) |
| MeshGradientDef | تدرج شبكي — تتغير الألوان على امتداد أشكال حرة (راجع الجدول أدناه) |
| TilingPatternDef | نمط تبليط — يملأ بتبليط زخرفة صغيرة (راجع الجدول أدناه) |
| FunctionShadingDef | تظليل دالّي — تُحسب الألوان من الإحداثيات بصيغة رياضية (راجع الجدول أدناه) |

**`GradientStopDef`** (محطات ألوان التدرج؛ تُستخدم في `stops` الخاص بكل تدرج)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `offset` | number | ✓ | الموضع على محور التدرج، كنسبة من 0 إلى 1 (‏0 = نقطة البداية، و1 = نقطة النهاية) |
| `color` | string | ✓ | اللون عند هذا الموضع (`#RRGGBB`) |
| `opacity` | number |  | العتامة عند هذا الموضع (0–1). الافتراضي: 1 |

**`LinearGradientDef`** (تدرج خطي — تعبئة تتغير ألوانها على امتداد محور يصل بين نقطتين)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | مميّز يدل على تدرج خطي |
| `x1` | number |  | الإحداثي X لنقطة البداية، **كنسبة من عرض صندوق إحاطة العنصر** (‏0 = الحافة اليسرى، و1 = الحافة اليمنى). الافتراضي: 0 |
| `y1` | number |  | الإحداثي Y لنقطة البداية، **كنسبة من ارتفاع صندوق إحاطة العنصر** (‏0 = الحافة العلوية، و1 = الحافة السفلية). الافتراضي: 0 |
| `x2` | number |  | الإحداثي X لنقطة النهاية (نسبة من العرض). الافتراضي: 1 (ومع بقاء الافتراضيات دون تغيير، ينتج تدرج أفقي من اليسار إلى اليمين) |
| `y2` | number |  | الإحداثي Y لنقطة النهاية (نسبة من الارتفاع). الافتراضي: 0 |
| `stops` | GradientStopDef[] | ✓ | مصفوفة محطات الألوان (راجع الجدول أعلاه) |
| `spreadMethod` | `'pad'` = يملأ بألوان الحافتين / `'reflect'` = يكرر مع الانعكاس / `'repeat'` = يكرر كما هو |  | كيفية الطلاء خارج نطاق التدرج. الافتراضي: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | بيانات وصفية للحفظ تتيح إعادة إخراج تدرج PDF المستورد دون فقد. لا حاجة لتحديدها في القوالب المكتوبة يدويًا |

**`RadialGradientDef`** (تدرج شعاعي — تعبئة تتغير ألوانها من مركز نحو الخارج)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | مميّز يدل على تدرج شعاعي |
| `cx` | number |  | الإحداثي X لمركز الدائرة الخارجية (نسبة من عرض صندوق إحاطة العنصر). الافتراضي: 0.5 |
| `cy` | number |  | الإحداثي Y لمركز الدائرة الخارجية (نسبة من الارتفاع). الافتراضي: 0.5 |
| `r` | number |  | نصف قطر الدائرة الخارجية، **كنسبة من الأكبر بين العرض والارتفاع**. الافتراضي: 0.5 |
| `fx` | number |  | الإحداثي X لنقطة البؤرة (حيث يبدأ التدرج) (نسبة من العرض). الافتراضي: `cx` |
| `fy` | number |  | الإحداثي Y لنقطة البؤرة (نسبة من الارتفاع). الافتراضي: `cy` |
| `fr` | number |  | نصف قطر دائرة البؤرة (نسبة من الأكبر بين العرض والارتفاع). الافتراضي: 0 |
| `stops` | GradientStopDef[] | ✓ | مصفوفة محطات الألوان |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | كيفية الطلاء خارج النطاق (كما في `LinearGradientDef`). الافتراضي: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | بيانات وصفية لإعادة إخراج استيراد PDF دون فقد. لا حاجة لتحديدها في القوالب المكتوبة يدويًا |

**`MeshGradientDef`** (تدرج شبكي — تعبئة تسند الألوان إلى رؤوس شبكات أو مثلثات وتنوّع الألوان على امتداد أشكال حرة)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | مميّز يدل على تدرج شبكي |
| `patches` | MeshPatchDef[] |  | مصفوفة رقع سطحية. لكل رقعة `points` (شبكة نقاط تحكم 4×4 معبَّر عنها بـ 32 رقمًا بترتيب x,y؛ **والإحداثيات بالـ pt المحلية للعنصر**) و`colors` (ألوان الزوايا الأربع) |
| `triangles` | MeshTriangleDef[] |  | مصفوفة مثلثات تدرج. لكل مثلث `points` (‏x0,y0,x1,y1,x2,y2؛ بالـ pt المحلية للعنصر) و`colors` (ألوان الرؤوس الثلاثة)؛ وتُستوفى الألوان بين الرؤوس |
| `lattice` | MeshLatticeDef |  | شبكة على هيئة مشبك. تحوي `columns` (عدد الرؤوس في كل صف، 2 فأكثر) و`points` (تسلسل إحداثيات الرؤوس؛ بالـ pt المحلية للعنصر) و`colors` (لون واحد لكل رأس، بالترتيب نفسه كـ `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | تمثيل مضغوط لبيانات الشبكة الأصلية المستوردة من PDF. لا حاجة لتحديده في القوالب المكتوبة يدويًا |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | مثل ما سبق، لمثلثات التدرج |
| `pdfShading` | PdfMeshShadingDef |  | بيانات وصفية لإعادة إخراج استيراد PDF دون فقد. لا حاجة لتحديدها في القوالب المكتوبة يدويًا |

**`TilingPatternDef`** (نمط تبليط — يملأ بتبليط زخرفة صغيرة؛ للتظليل الخطي ورقعة الشطرنج والشعارات المكررة وما شابهها)

«فضاء النمط» في الجدول هو نظام الإحداثيات الخاص بالنمط نفسه. وإذا لم تُحدد `matrix`، فإنه ينطبق على إحداثيات الـ pt المحلية للعنصر.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | مميّز يدل على نمط تبليط |
| `bbox` | [number, number, number, number] | ✓ | صندوق إحاطة زخرفة واحدة (خلية النمط)، بإحداثيات فضاء النمط |
| `xStep` | number | ✓ | فاصل التكرار الأفقي للخلية (فضاء النمط) |
| `yStep` | number | ✓ | فاصل التكرار الرأسي للخلية (فضاء النمط) |
| `graphics` | TileGraphicDef[] | ✓ | مصفوفة الرسوم المرسومة داخل الخلية، مميَّزة بـ `kind`: ‏`'path'` (بيانات مسار SVG + تعبئة/حد) / `'image'` (يشير إلى معرّف مورد صورة عبر `source`) / `'text'` (نص بخط وحجم ولون) / `'group'` (مجموعة متداخلة بتحويل وقصّ وعتامة وغيرها). وجميع الإحداثيات في فضاء النمط |
| `tilingType` | 1 = تباعد ثابت (وقد تُشوَّه الخلايا قليلًا لتلائم جهاز الإخراج) \| 2 = دون تشويه (وقد يتفاوت التباعد قليلًا) \| 3 = تباعد ثابت مع تبليط سريع |  | وضع دقة التبليط. الافتراضي: 1 |
| `paintType` | `'colored'` = يحمل النمط ألوانه الخاصة / `'uncolored'` = يُصبغ بلون واحد بحسب `color` المستهلك |  | كيفية حمل اللون. الافتراضي: `'colored'` |
| `color` | string |  | لون الصبغ عند استخدام نمط `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | مصفوفة تحويل أفيني من فضاء النمط إلى الفضاء المحلي للعنصر. الافتراضي: مصفوفة الوحدة |

**`FunctionShadingDef`** (تظليل دالّي — تعبئة يُحسب لونها بصيغة رياضية من الإحداثيين (x, y)؛ ويظهر أساسًا في استيراد PDF)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | مميّز يدل على تظليل دالّي. وله شكلان: شكل الصيغة الرياضية بـ `expression` وشكل العينات بـ `sampled` |
| `domain` | [number, number, number, number] | ✓ | مجال الإدخال `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (لشكل الصيغة الرياضية فقط) | تعبير حاسبة PostScript (‏PDF FunctionType 4). يأخذ x وy ويعيد r وg وb. مثال: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (لشكل العينات فقط) | بيانات الدالة المعيَّنة بالعينات (‏PDF FunctionType 0). تحوي `size` (أبعاد شبكة العينات) و`bitsPerSample` (‏1/2/4/8/12/16/24/32) و`range` (نطاق الإخراج) و`samples` (قيم العينات لكل نقطة شبكة) و`encode`/`decode` الاختياريتين |
| `matrix` | [number, number, number, number, number, number] |  | مصفوفة تعيين من مجال الإدخال إلى **الـ pt المحلية للعنصر**. الافتراضي: مصفوفة الوحدة |
| `background` | [number, number, number] |  | لون الخلفية خارج المجال (مكوّنات DeviceRGB، ‏0–1) |
| `bbox` | [number, number, number, number] |  | صندوق إحاطة يحدّ الطلاء |
| `antiAlias` | boolean |  | تلميح لتنعيم الحواف |
| `paintOperator` | `'pattern'` = يُطلى كنمط (الافتراضي) / `'sh'` = يُرسم مباشرةً تحت القصّ الحالي |  | طريقة الطلاء لإخراج PDF |

**`PdfSpecialColorDef`** (تعبئة بلون خاص — تحديد لوني للطباعة بأحبار بعينها، كالذهبي أو الفضي أو ألوان الشركة، مما لا يمكن لمزج CMYK الاعتيادي إعادة إنتاجه)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | مميّز يدل على تعبئة بلون خاص |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | فضاء ألوان اللون الخاص. الحبر الواحد يستخدم `kind: 'separation'` مع `name` (اسم الحبر) و`alternate` (فضاء الألوان الإجرائي المستخدم بدلًا منه في البيئات التي لا تتوفر فيها الأحبار الخاصة؛ راجع الجدول أدناه) و`tintTransform` (تحدد تحويل درجة الصبغة إلى اللون البديل كدالة PDF، مثلًا `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = أبيض عند الصبغة 0 وأزرق عند 1). وتعدد الأحبار يستخدم `kind: 'deviceN'` مع `names` (مصفوفة أسماء الأحبار) و`alternate` و`tintTransform` و`subtype` (`'DeviceN'` = قياسي / `'NChannel'` = شكل موسّع يمكنه حمل معلومات سمات لكل حبر) و`colorants` (خريطة من كل اسم حبر إلى تعريف حبر واحد) و`process` و`mixingHints` |
| `components` | number[] | ✓ | قيمة الصبغة لكل حبر (0–1) |
| `displayColor` | string | ✓ | اللون المستخدم بدلًا منه للعرض على الشاشة والمعاينات، حيث لا تتوفر الأحبار الخاصة |

**`PdfProcessColorSpaceDef`** (فضاء الألوان الإجرائي — فضاء ألوان «الألوان الاعتيادية» المعبَّر عنها بمزج أحبار قياسية كـ CMYK. يُستخدم في `alternate` الخاصة باللون الخاص وفي `colorSpace` الخاصة بالقناع الناعم، ويُميَّز بـ `kind`)

| النوع (`kind`) | الخصائص الإضافية | الوصف |
| --- | --- | --- |
| `'gray'` | لا شيء | تدرج رمادي (DeviceGray) |
| `'rgb'` | لا شيء | ‏RGB (DeviceRGB) |
| `'cmyk'` | لا شيء | ‏CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`، و`blackPoint`، و`gamma` (كلها مطلوبة) | رمادي معايَر قياسًا لونيًا (CalGray) |
| `'calrgb'` | `whitePoint`، و`blackPoint`، و`gamma` (لكل مكوّن)، و`matrix` (‏3×3) (كلها مطلوبة) | ‏RGB معايَر قياسًا لونيًا (CalRGB) |
| `'lab'` | `whitePoint`، و`blackPoint`، و`range` (كلها مطلوبة) | فضاء الألوان L\*a\*b\* |
| `'icc'` | `components` (‏1\|3\|4)، و`range`، و`profile` (بايتات ملف تعريف ICC) (كلها مطلوبة) | فضاء ألوان مبني على ملف تعريف ICC |

يُحدَّد `whitePoint`/`blackPoint` كمصفوفات `[x, y, z]` في فضاء الألوان CIE XYZ.

### خصائص الأشرطة (`bands`) والمجموعات (`groups`)

أنواع الأشرطة العشرة المحددة في `bands` الخاص بالقالب (راجع «الصفحة عبارة عن رصّة من الأشرطة») تُعرَّف كلها بـ `BandDef` التالي (و`details` وحده مصفوفة من `BandDef`).

**`BandDef`**

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `height` | number | ✓ | الارتفاع الأدنى للشريط (pt). ينمو مع تمدد العناصر |
| `elements` | ElementDef[] |  | العناصر الموضوعة على الشريط |
| `startNewPage` | boolean |  | يبدأ هذا الشريط دائمًا في صفحة جديدة |
| `spacingBefore` | number |  | المسافة قبل الشريط (pt) |
| `spacingAfter` | number |  | المسافة بعد الشريط (pt) |
| `splitType` | `'stretch'` = يطبع ما يتسع في الصفحة ويكمل الباقي في الصفحة التالية (الافتراضي) / `'prevent'` = لا يقسّم؛ يرسل الشريط كاملًا إلى الصفحة التالية (ويُقسَّم إن لم يتسع في الصفحة الجديدة أيضًا) / `'immediate'` = يقسّم فورًا عند الموضع الحالي، ولو في منتصف عنصر |  | كيفية تقسيم الشريط عندما لا يتسع عند حد الصفحة |
| `printWhenExpression` | Expression \| null |  | عندما تكون نتيجة التقييم زائفة (falsy)، لا يُخرَج هذا الشريط |

**`GroupDef`** (كل مدخل في `groups`)

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم المجموعة. يُشار إليه من `resetGroup` الخاص بمتغير ومن `evaluationGroup` الخاص بـ textField |
| `expression` | Expression | ✓ | مفتاح المجموعة. يُقيَّم لكل صف؛ وحيثما تتغير القيمة تُغلق المجموعة السابقة وتبدأ مجموعة جديدة |
| `header` | BandDef |  | الشريط المُخرَج عند بداية المجموعة |
| `footer` | BandDef |  | الشريط المُخرَج عند نهاية المجموعة |
| `keepTogether` | boolean |  | عندما لا تتسع المجموعة كاملة في المساحة المتبقية لكنها تتسع في صفحة جديدة، يبدؤها بعد فاصل صفحة |
| `minHeightToStartNewPage` | number |  | يبدأ المجموعة في صفحة جديدة عندما يكون الارتفاع المتبقي في الصفحة أقل من هذه القيمة (pt) |
| `reprintHeaderOnEachPage` | boolean |  | عندما تمتد المجموعة عبر عدة صفحات، يعيد طباعة الترويسة في كل صفحة استكمال |
| `resetPageNumber` | boolean |  | يعيد `PAGE_NUMBER` إلى 1 عند بدء المجموعة |
| `startNewPage` | boolean |  | يبدأ كل مجموعة في صفحة جديدة |
| `startNewColumn` | boolean |  | يبدأ كل مجموعة في عمود جديد |
| `footerPosition` | `'normal'` = يُخرَج مباشرةً بعد صفوف التفاصيل (الافتراضي) / `'stackAtBottom'` = يُرصّ نحو أسفل الصفحة / `'forceAtBottom'` = يوضع دائمًا في أقصى أسفل الصفحة، مستهلكًا المساحة المتبقية بينهما / `'collateAtBottom'` = يصطف في الأسفل فقط عندما يكون تذييل مجموعة أخرى محاذيًا للأسفل (ومثل `'normal'` بمفرده) |  | الموضع الرأسي لتذييل المجموعة |

### الخصائص المتاحة في الأنماط (`styles`)

تُعرَّف الأنماط في مصفوفة `styles` الخاصة بالقالب ويُشار إليها بـ `name` من خاصية `style` الخاصة بالعنصر. والخطوط ومحاذاة النص والألوان وسائر الإعدادات المتعلقة بالنص تُضبط أساسًا عبر الأنماط.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم النمط (يُشار إليه من `style` الخاص بالعناصر) |
| `parentStyle` | string |  | اسم النمط الأب. يرث خصائص الأب ويتجاوزها بإعداداته الخاصة (وتُتجاهل الإشارات الدائرية) |
| `isDefault` | boolean |  | النمط ذو القيمة `true` يُطبَّق كافتراضي على العناصر التي لا تحمل `style` |
| `fontFamily` | string |  | عائلة الخط. الافتراضي: `'default'` |
| `fontSize` | number |  | حجم الخط (pt). الافتراضي: 10 |
| `bold` | boolean |  | عريض. الافتراضي: `false` |
| `italic` | boolean |  | مائل. الافتراضي: `false` |
| `underline` | boolean |  | تسطير. الافتراضي: `false` |
| `strikethrough` | boolean |  | شطب. الافتراضي: `false` |
| `forecolor` | string |  | اللون الأمامي (`#RRGGBB` أو `#RRGGBBAA`). الافتراضي: `#000000` |
| `backcolor` | string |  | لون الخلفية. الافتراضي: `transparent` |
| `hAlign` | `'left'` = محاذاة لليسار / `'center'` = توسيط / `'right'` = محاذاة لليمين / `'justify'` = ضبط |  | المحاذاة الأفقية. الافتراضي: `left` |
| `vAlign` | `'top'` = محاذاة للأعلى / `'middle'` = محاذاة للوسط / `'bottom'` = محاذاة للأسفل |  | المحاذاة الرأسية. الافتراضي: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | تدوير النص (بالدرجات) |
| `padding` | Padding |  | الحشو |
| `border` | BorderDef |  | الحدود |
| `mode` | `'opaque'` = يملأ الخلفية بـ `backcolor` / `'transparent'` = لا يملأ الخلفية |  | وضع العرض |
| `opacity` | number |  | العتامة (0.0–1.0) |
| `variation` | Record<string, number> |  | قيم محاور الخط المتغير (مثلًا `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = كتابة أفقية / `'vertical-rl'` = كتابة رأسية تتقدم أسطرها من اليمين إلى اليسار / `'vertical-lr'` = كتابة رأسية تتقدم أسطرها من اليسار إلى اليمين |  | اتجاه الكتابة |
| `conditionalStyles` | ConditionalStyleDef[] |  | الأنماط الشرطية (راجع الجدول أدناه). عندما يتحقق شرط، تُتجاوز الخصائص المقابلة |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | اتجاه النص (ltr = من اليسار إلى اليمين / rtl = من اليمين إلى اليسار / auto = يُكتشف تلقائيًا من المحتوى) |
| `openTypeScript` | string |  | وسم OpenType يحدد قواعد أي نظام كتابة في الخط تُستخدم عند تحويل النص إلى أشكال حروف (التشكيل) (مثلًا `'latn'` = الكتابة اللاتينية، و`'arab'` = الكتابة العربية). لا حاجة عادةً لتحديده (يُعالج تلقائيًا من محتوى النص) |
| `openTypeLanguage` | string |  | وسم OpenType يجعل اللغة صريحة للخطوط التي تغيّر أشكال الحروف بحسب اللغة داخل نظام الكتابة نفسه. لا حاجة عادةً لتحديده |
| `openTypeFeatures` | Record<string, number> |  | يشغّل أو يوقف ميزات تبديل الحروف المدمجة في الخط. أمثلة: `{ "palt": 1 }` = تضييق تباعد الحروف اليابانية، و`{ "liga": 0 }` = تعطيل الحروف المركبة، و`{ "zero": 1 }` = الصفر المشطوب. القيم: 0 = إيقاف / 1 = تشغيل؛ ولميزات اختيار الحروف، رقم الحرف البديل ابتداءً من 1 |

**`ConditionalStyleDef`**
| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | شرط التطبيق. عندما يكون صادقًا (truthy)، تتجاوز الخصائص أدناه النمط |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | الأنواع نفسها كخصائص StyleDef المسماة بالأسماء ذاتها |  | القيم المتجاوَزة عند تحقق الشرط (والمعاني هي نفسها كخصائص StyleDef المقابلة) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | الأنواع نفسها كخصائص StyleDef المسماة بالأسماء ذاتها |  | مصرَّح بها في تعريف النوع، لكن التنفيذ الحالي لا يطبّق تجاوزاتها عند تحقق الشرط |

### أنواع لاستيراد PDF وميزات PDF المتقدمة

الأنواع المذكورة هنا تخدم غرضين: (1) أنواع «الحفظ» لإعادة إخراج ملف PDF مستورد دون فقد بايت واحد، و(2) أنواع لاستخدام ميزات متقدمة كطبقات PDF ونصوص النماذج البرمجية وإعدادات تجهيز الطباعة التجارية. ولن تحددها تقريبًا أبدًا عند كتابة تقرير اعتيادي يدويًا. والأنواع الموصوفة بأنها «يضبطها استيراد PDF» تظهر داخل العناصر التي تولدها `importPdfPage()`.

**`OptionalContentDef`** (ميزة طبقات PDF)

يمكن لـ PDF وضع المحتوى على «طبقات» (مجموعات محتوى اختيارية، OCG)، يمكن تبديل رؤيتها وطباعتها من لوحة الطبقات في العارض. وتحديد هذا في `optionalContent` الخاص بعنصر يضع ذلك العنصر على طبقة. مثال: وضع علامة مائية بكلمة «سري» على طبقة تظهر عند الطباعة فقط.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | string | ✓ | اسم الطبقة المعروض في لوحة الطبقات في العارض |
| `visible` | boolean |  | الرؤية الابتدائية على الشاشة. الافتراضي: true |
| `print` | boolean |  | حالة الطباعة الابتدائية. الافتراضي: يتبع `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | يضبطه استيراد PDF. يحفظ تعريف الطبقة في ملف PDF المصدر (OCG) أو تعريف عضوية (OCMD) يقرر الرؤية من تركيبة عدة طبقات. وللعضوية `groups` (الطبقات المستهدفة) و`policy` (`'AllOn'` = مرئي عندما تكون كلها مشغّلة / `'AnyOn'` = عندما يكون أيّها مشغّلًا / `'AnyOff'` = عندما يكون أيّها موقَفًا / `'AllOff'` = عندما تكون كلها موقَفة) وتعبير منطق رؤية اختياري `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | يضبطه استيراد PDF. يحفظ إعداد الطبقات على مستوى المستند كله (قائمة جميع الطبقات، والإعداد الافتراضي، وشجرة ترتيب العرض في لوحة الطبقات، ومجموعات الاختيار المتنافية، والقفل، وغير ذلك) |

**`PdfRawValueDef`** («القيم الخام» في PDF)

يحمل كثير من خصائص الحفظ بيانات PDF الداخلية على هيئة «قيم خام»، دون تفسيرها. والقيمة الخام هي قيمة JavaScript بالشكل التالي: `null` والقيم المنطقية والأرقام كما هي؛ واسم PDF هو `{ kind: 'name', value: 'DeviceRGB' }`؛ والسلسلة هي `{ kind: 'string', bytes: Uint8Array }`؛ والمصفوفة هي `{ kind: 'array', items: [...] }`؛ والقاموس هو `{ kind: 'dictionary', entries: { ... } }`؛ والدفق هو `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (الإجراءات التي ينفذها عارض PDF)

يُستخدم في `additionalActions` الخاصة بحقول النماذج وفي غيرها، ويعرّف «ما ينبغي للعارض فعله». والمحتويات تُسلسَل وتُستورَد فحسب — **ومحرك النواة لا ينفذها أبدًا** (التنفيذ يقوم به عارض يدعمها).

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | نوع الإجراء. `'JavaScript'` = تشغيل نص برمجي (تنسيق إدخال النماذج والتحقق والحساب التلقائي تستخدم هذا) / `'GoTo'` = الانتقال إلى وجهة داخل المستند / `'GoToR'` = الانتقال إلى مستند آخر / `'GoToE'` = الانتقال إلى مستند مضمَّن / `'URI'` = فتح عنوان URL / `'Launch'` = تشغيل تطبيق أو ملف / `'Named'` = أمر معرَّف مسبقًا (الصفحة التالية، وغيره) / `'SubmitForm'` = إرسال النموذج / `'ResetForm'` = تصفير النموذج / `'ImportData'` = استيراد بيانات / `'Hide'` = تبديل رؤية التعليق التوضيحي / `'SetOCGState'` = تبديل رؤية الطبقة / `'Thread'`، و`'Sound'`، و`'Movie'`، و`'Rendition'`، و`'Trans'`، و`'GoTo3DView'`، و`'RichMediaExecute'`، و`'GoToDp'` = إجراءات PDF القياسية الأخرى |
| `entries` | Record<string, PdfRawValueDef> | ✓ | قاموس يحمل إعدادات كل نوع إجراء كقيم خام (راجع **`PdfRawValueDef`** أعلاه). مثال: لـ `'JavaScript'`، `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | الوجهة لعائلة `'GoTo'`. إما مسمّاة (`{ kind: 'named', name, representation: 'name' \| 'string' }`) أو صريحة (الصفحة الهدف + كيفية ملاءمة العرض) |
| `structureDestination` | PdfStructureDestinationDef |  | وجهة قائمة على عنصر بنية المستند (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | يحدد التعليق التوضيحي الذي تستهدفه إجراءات الوسائط |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | تسلسل الطبقات والعمليات (`'ON'` / `'OFF'` / `'Toggle'`) التي يبدّلها `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | يحدد أسماء الحقول التي يستهدفها `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | تحديد الملف المضمَّن لـ `'GoToE'` (بنية عودية) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | معاملات خاصة بالمنصة لـ `'Launch'`. تُحفظ فحسب ولا تُنفَّذ أبدًا |
| `articleTarget` | PdfArticleActionTargetDef |  | تحديد خيط المقالة لـ `'Thread'` |
| `documentPartIndex` | number |  | رقم جزء المستند الوجهة لـ `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | رقم مثيل الوسائط الغنية |
| `next` | PdfActionDef \| PdfActionDef[] |  | الإجراء (أو الإجراءات) المراد تنفيذه تاليًا (التسلسل) |

**`PdfFormXObjectDef`** (حفظ البيانات الوصفية لمكوّنات PDF المستوردة)

داخل ملف PDF، يمكن تغليف محتوى الرسم المستخدم بشكل متكرر في مكوّنات تسمى «Form XObjects». ويحوّل استيراد PDF مثل هذا المكوّن إلى عنصر `frame` ويحتفظ بنظام إحداثيات المكوّن وبياناته الوصفية في هذا النوع ليمكن استعادتها عند إعادة الإخراج. لا حاجة لتحديده في القوالب المكتوبة يدويًا.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | صندوق إحاطة المكوّن (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | مصفوفة تحويل نظام إحداثيات المكوّن (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | تحويل الإحداثيات الذي كان ساريًا عند رسم هذا المكوّن في ملف PDF المصدر |
| `formType` | 1 |  | رقم نوع النموذج للمكوّن (مواصفة PDF تعرّف 1 فقط) |
| `group` | Record<string, PdfRawValueDef> |  | حفظ بالقيم الخام لقاموس مجموعة الشفافية |
| `reference` | Record<string, PdfRawValueDef> |  | حفظ بالقيم الخام لقاموس إشارة PDF الخارجية |
| `metadata` | شكل الدفق لـ PdfRawValueDef (`kind: 'stream'`) |  | يحفظ دفق البيانات الوصفية |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | يحفظ البيانات الخاصة بالتطبيق المنشئ (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | يحفظ الطابع الزمني لآخر تعديل |
| `structParent` / `structParents` | number |  | يحفظ مفاتيح التطابق مع PDF الموسوم (بنية المستند كترتيب القراءة) |
| `opi` | PdfOpiMetadataDef |  | يحفظ معلومات OPI (راجع الجدول أدناه) |
| `name` | string |  | اسم المكوّن |
| `measure` | PdfMeasurement |  | يحفظ معلومات القياس (راجع الجدول أدناه) |
| `pointData` | PdfPointData[] |  | يحفظ بيانات سحابة النقاط (راجع الجدول أدناه) |

**`PdfSourceVectorDef`** (التعريفات المشتركة للأشكال المتكررة المستوردة)

عند استيراد ملف PDF تتكرر فيه الأشكال نفسها بأعداد كبيرة — كرموز الخرائط — تُحفظ بيانات مخطط الشكل على هيئة «تعريف واحد + N من مواضع الوضع». ويظهر في `pdfSourceVector` الخاصة بعنصر `path`؛ وعند تحديده لا يُجرى أي تحليل لـ `d`. لا حاجة لتحديده في القوالب المكتوبة يدويًا.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | مصفوفة تعريفات الأشكال القابلة لإعادة الاستخدام. لكل تعريف `commands` (‏0 = الانتقال إلى نقطة البداية [إحداثيان]، و1 = خط مستقيم [2]، و2 = منحنى بيزييه تكعيبي [6]، و3 = إغلاق المسار [0]) و`coords` (مصفوفة مسطّحة من الإحداثيات بترتيب الأوامر) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | مصفوفة مواضع وضع التعريفات. لكل موضع `definitionIndex` (رقم التعريف) و`matrix` (مصفوفة أفينية من 6 عناصر) |

**`PdfOpiMetadataDef`** (معلومات استبدال الصور للطباعة التجارية)

‏OPI (‏Open Prepress Interface) آلية في الطباعة التجارية تُستخدم فيها صورة خفيفة منخفضة الدقة أثناء التحرير وتُستبدل بالصورة عالية الدقة عندما ينتج المطبعجي الإخراج. تُحفظ عندما يحمل ملف PDF المستورد هذا التحديد.

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | إصدار OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | يحمل محتويات قاموس OPI كقيم PDF خام (اسم الملف المصدر للاستبدال، ومنطقة القص، وغير ذلك) |

**`PdfMeasurement`** (معلومات القياس للرسومات الهندسية والخرائط)

في ملفات PDF الخاصة بالرسومات الهندسية والخرائط، تستطيع أدوات القياس في العارض قياس المسافات والمساحات بمقياس رسم مثل «‏1 سم على الورق يقابل 1 م في العالم الحقيقي». ويحفظ هذا النوع معلومات مقياس الرسم ونظام الإحداثيات تلك، ويأتي في شكل مستقيم الخطوط (`kind: 'rectilinear'`) وشكل جيومكاني (`kind: 'geospatial'`).

| الخاصية (`'rectilinear'`) | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | مميّز القياس مستقيم الخطوط |
| `scaleRatio` | string | ✓ | نص عرض مقياس الرسم (مثلًا `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (و`y` اختيارية) | سلسلة صيغ عرض الأرقام للاتجاهين X/Y (تسميات الوحدات، ومعاملات التحويل، والعرض العشري/الكسري، وغير ذلك). وعند حذف `y` تُستخدم `x` |
| `distance` / `area` | PdfNumberFormat[] | ✓ | صيغ عرض الأرقام للمسافة/المساحة |
| `angle` / `slope` | PdfNumberFormat[] |  | صيغ عرض الأرقام للزاوية/الميل |
| `origin` | [number, number] |  | نقطة أصل القياس |
| `yToX` | number |  | معامل التحويل من وحدات Y إلى وحدات X |

| الخاصية (`'geospatial'`) | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | مميّز القياس الجيومكاني |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | نظام الإحداثيات الجيوديسي. يلزم إما رمز EPSG أو سلسلة WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | نقاط تحكم بالإحداثيات الجيوديسية ونقاط التحكم المحلية المقابلة داخل الصورة أو المكوّن (بالعدد نفسه) |
| `dimension` | 2 \| 3 |  | بُعد الإحداثيات. الافتراضي: 2 |
| `bounds` | [number, number][] |  | مضلع المنطقة القابلة للقياس |
| `displayCoordinateSystem` | كما في `coordinateSystem` |  | نظام الإحداثيات للعرض |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | وحدات العرض المفضلة للمسافة والمساحة والزاوية |
| `projectedCoordinateSystemMatrix` | صف رقمي من 12 عنصرًا |  | مصفوفة أفينية 4×4 لنظام الإحداثيات المسقط (‏12 عنصرًا بترتيب الصفوف، مع حذف العمود الرابع الثابت) |

**`PdfPointData`** (بيانات سحابة نقاط الخرائط)

لحفظ جداول بيانات النقاط المضمَّنة في ملفات PDF الخاصة بالخرائط، بأعمدة مسماة مثل `LAT` (خط العرض) و`LON` (خط الطول) و`ALT` (الارتفاع).

| الخاصية | النوع / القيم المسموحة | مطلوب | الوصف |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | مصفوفة أسماء الأعمدة (فريدة وغير فارغة؛ ويجب أن تكون أعمدة `LAT`/`LON`/`ALT` رقمية) |
| `rows` | PdfRawValueDef[][] | ✓ | قيم كل صف. ويطابق طول الصف `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (دوال نقل التدرج اللوني لتجهيز الطباعة)

دوال تُستخدم في `deviceParams` الخاصة بـ `frame` وفي `softMask`، وتعيّن قيمة (0–1) إلى قيمة أخرى. وفي تجهيز الطباعة تعبّر عن منحنيات التدرج — «الحبر بهذه الكثافة يُطبع بتلك الكثافة». و`TransferFunctionDef` هو إما `CalculatorFunctionDef` (تعبير حاسبة PostScript، مثلًا `{ expression: '{ 1 exch sub }' }` = عكس الأبيض والأسود) أو `PdfFunctionDef` (كائن دالة PDF: جدول قيم معيَّنة بالعينات، أو استيفاء أسّي، أو تركيبة منهما)؛ وحيثما يُستخدم، يمكن أيضًا تحديد `'Identity'` (بلا تحويل).

**`HalftoneDef`** (تعريف النقطة الشبكية لتجهيز الطباعة)

تعبّر مطابع الطباعة عن تدرج النغمة اللونية بحجم نقاط صغيرة (نقاط الشبكة). ويحدد هذا كيفية بناء تلك النقاط، ويُستخدم لحفظ استيراد PDF ولإنشاء بيانات تجهيز الطباعة. ويميّز `type` بين خمسة أشكال:

| الشكل | الخصائص الرئيسية | الوصف |
| --- | --- | --- |
| type 1 (شاشة) | `frequency` (تردد الشاشة) ✓، و`angle` (الزاوية) ✓، و`spotFunction` (شكل النقطة؛ اسم معرَّف مسبقًا مثل `'Round'` أو تعبير حاسبة) ✓، و`accurateScreens` (يطلب بناء شاشة عالي الدقة؛ اختياري) | الشكل القياسي الذي يعرّف النقطة الشبكية بالتردد والزاوية وشكل النقطة (ويمكن حذف `type`) |
| type 6 (مصفوفة عتبات) | `width` ✓، و`height` ✓، و`thresholds` (‏width × height من القيم، ‏0–255) ✓ | يعرّف النقطة الشبكية مباشرةً بجدول عتبات |
| type 10 (عتبات مائلة) | `xsquare` ✓، و`ysquare` ✓، و`thresholds` ✓ | تعريف بالعتبات بخلايا مائلة |
| type 16 (عتبات 16 بت) | `width` ✓، و`height` ✓، و`thresholds` (قيم 16 بت) ✓، ومستطيل ثانٍ اختياري | تعريف بالعتبات عالي الدقة |
| type 5 (مجموعة لكل صفيحة) | `halftones` (مصفوفة من `{ colorant: اسم الحبر, halftone: أي من الأشكال أعلاه }`) ✓ | يسند نقطة شبكية مختلفة لكل صفيحة لون، كالسماوي والأرجواني |

الأشكال الأربعة عدا type 5 يمكنها حمل `transferFunction` اختيارية (`'Identity'` أو `TransferFunctionDef`) (أما في type 5 فيحمل كل تعريف نقطة شبكية داخلي خاص بصفيحة تعريفَه الخاص).

## واجهة البرمجة الأساسية

أكثر الواجهات استخدامًا، مسرودة واحدة تلو الأخرى مع عينة مصغرة لتتمكن من البحث عنها بحسب «ما تريد فعله». ويُفترض أن `template` و`dataSource` و`fontMap` و`fonts` هي بالضبط تلك المبنية في الدليل التعليمي.

### بناء تقرير

#### بناء تقرير من قالب وبيانات — `createReport()`

تخطّط القالب والبيانات وتعيد `RenderDocument` موجهًا للصفحات. وتستخدم التعبيرات لغة تعبيرات مدمجة آمنة يمكنها الإشارة إلى `field.*` و`vars.*` و`param.*` و`PAGE_NUMBER` و`TOTAL_PAGES` وغيرها — دون استخدام `eval` ولا `Function`. وتعبيرات دوال الاستدعاء بلغة TypeScript خيار متاح أيضًا.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // عدد الصفحات المخطَّطة
```

#### البحث عن عناصر القالب بالمعرّف وتعديلها — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

تعيد كلتا الواجهتين إشارات إلى عناصر القالب الأصلي. أجرِ تغييراتك قبل استدعاء `createReport()`. وتعيد `getElementChildren()` عناصر أبناء لـ `frame` و`table` فقط (العناصر داخل الخلايا)؛ ولسائر العناصر تعيد مصفوفة فارغة. وللتفاصيل حول نطاق البحث، راجع «البحث عن العناصر بالمعرّف وتعديلها قبل العرض».

#### بناء تقرير من ملف `.report` — `createReportFromFile()` (Node.js)

تقرأ قالب JSON وتحلّ المسارات النسبية للصور والتقارير الفرعية نسبةً إلى مجلد القالب.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### دمج عدة تقارير في مجلد واحد — `createReportBook()`

تسلسل عدة قوالب — غلاف ومتن وما إلى ذلك — في `RenderDocument` واحد بترقيم صفحات متصل.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### تسلسل مستندات `RenderDocument` مبنية سلفًا — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

تُعاد تسمية معرّفات الصور المتضاربة تلقائيًا.

#### توليد صفحة فهرس محتويات تلقائيًا — `insertTableOfContents()`

تجمع مدخلات فهرس المحتويات من المراسي (`anchorName`) في التقرير وتدرج صفحات الفهرس في المقدمة.

```ts
const withToc = insertTableOfContents(
  document,
  // حجم صفحة الفهرس وهوامشها بالـ pt (في هذا المثال: A4 طولي)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // معرّف الخط (مفتاح fontMap) المستخدم لنص الفهرس
  { title: '目次' },
)
```

#### الحصول على عدد صفحات ملف PDF موجود — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### استيراد ملف PDF موجود كعناصر تقرير — `importPdfPage()`

للتفاصيل، راجع **تحويل ملف PDF موجود إلى عناصر تقرير (استيراد PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### العرض والإخراج

#### إخراج ملف PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### معاينة صفحة واحدة — `renderPage()`

عرض صفحة بصفحة. استخدمها لرسم الصفحة المعروضة حاليًا فقط في معاينة المتصفح.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### عرض التقرير كاملًا إلى أي واجهة خلفية — `render()`

تعرض جميع الصفحات إلى أي هدف إخراج ينفّذ واجهة `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### الرسم على HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### إخراج SVG — `SvgBackend`

تولّد سلسلة `<svg>` واحدة مكتفية بذاتها لكل صفحة.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // مصفوفة من سلاسل <svg>، واحدة لكل صفحة
```

#### تحكم دقيق في توليد PDF — `PdfBackend`

تُمرَّر الخيارات الخاصة بـ PDF كمصغّرات الصفحات إلى الباني.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

تنطبق `pageOptions[i]` على الصفحة رقم i. ولـ `thumbnailImageId` (الصورة المصغّرة المعروضة في قائمة الصفحات)، حدد معرّف صورة موجودًا في `document.images`.

#### دمج ملفات PDF جاهزة — `mergePdfFiles()`

تدمج عدة ملفات PDF في ملف واحد بمحلل PDF مكتوب بـ TypeScript خالصة.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### العمل مع الخطوط

#### تحميل ملف خط — `Font.load()`

تحلّل TTF وOTF وTTC وOTC وWOFF وWOFF2 وEOT.

```ts
const font = Font.load(fontBuffer)
```

#### قياس عرض النص — `TextMeasurer`

قياس نص سريع مدعوم بذاكرة الغليفات المؤقتة في `Font`. وعند تسجيله في `fontMap`، يُستخدم للتخطيط أيضًا.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### تحويل سلسلة نصية إلى تسلسل غليفات — `font.shapeText()`

تستخدم معلومات OpenType و AAT (مواصفة التوسعة للخطوط من سلالة Apple) و Graphite (مواصفة التوسعة للخطوط من سلالة SIL) للحصول على تسلسل غليفات (أرقام غليفات مع مواضع وتقدّمات) مطبَّقًا عليه اختيار الغليفات والحروف المركبة وضبط التموضع.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### كشف الغليفات المفقودة قبل الطباعة — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### استخدام الباركود وSVG والصيغ الرياضية والصور بشكل مستقل

#### توليد باركود بشكل مستقل — `renderBarcode()`

تولّد عُقد رسم الباركود مباشرةً، دون المرور بعنصر تقرير.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### تحليل SVG وعرضه — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### تنضيد صيغة رياضية بشكل مستقل — `parseMathLaTeX()` / `layoutMathFormula()`

يتطلب خطًا يتضمن معلومات أبعاد الصيغ الرياضية (جدول OpenType ‏MATH) — مثل STIX Two Math أو Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// الوسائط: الصيغة المحلَّلة، وكائن Font، ومعرّف الخط (مفتاح fontMap)، وحجم الخط بالـ pt، ولون النص
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box هو النتيجة المخطَّطة؛ وعناصر math في القوالب تشغّل هذا التخطيط نفسه داخليًا
```

#### الحصول على أبعاد صورة — `getImageDimensions()`

تدعم PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### فك ترميز PNG — `decodePng()`

فاكّ ترميز PNG مكتوب بـ TypeScript خالصة.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### إخراج ملف PDF يحوي WebP/AVIF في المتصفح — `prepareBrowserPdfImageResources()`

يُخزَّن JPEG في ملف PDF مباشرةً، ويتولى فاكّ الترميز المدمج معالجة PNG. وعند توليد ملف PDF يحوي WebP/AVIF في المتصفح، تفكّ `tsreport-core/browser` أولًا ترميز الصور المشار إليها فعليًا من `RenderDocument` وحدها باستخدام مرمِّزات المتصفح القياسية، وتمرر النتائج إلى توليد PDF. أما الصور غير المشار إليها فتبقى كما هي ولا يُفك ترميزها.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: بايتات الصور المزوَّدة وقت العرض؛ catalog: إعدادات
// كتالوج مستند PDF؛ collection: إعدادات حافظة PDF — احذف ما لا تستخدمه منها
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

ولفك ترميز WebP/AVIF في Node.js، استخدم `createNodeExternalRasterImageDecoder()` من `tsreport-core/node`.

## قيود تحميل الموارد وقواعد معرّفات الصور

قواعد تفصيلية تُرجَع إليها عندما تصبح ذات صلة بتشغيل الخادم أو تضمين المكتبة.

### تقييد المجلدات التي تُحمَّل منها الصور والقوالب

يمكن حصر تحميل ملفات الصور في مجلدات مسموح بها صراحةً.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

تحلّ `createReportFromFile()` المسارات النسبية نسبةً إلى مجلد القالب الرئيسي افتراضيًا، لكنها للتوافق مع الإصدارات السابقة لا تقيّد ضمنًا نطاق التحميل نفسه. وعند تحديد `resources.fileRoot`، ينطبق القيد نفسه على الصور والقالب الرئيسي والتقارير الفرعية على حد سواء. وتُعالج الصور المفقودة وفقًا لإعداد `onError` الخاص بكل عنصر، أما الإشارات التي تشير إلى خارج المجلد المسموح به (بما في ذلك عبر الروابط الرمزية) فتؤدي دائمًا إلى خطأ.

### قواعد معرّفات الصور

يُبحث عن كل صورة في `RenderDocument` من `RenderDocument.images` باستخدام `RenderImage.imageId` (وكذلك `imageId` الخاص بالبديل) كمفتاح. **يجب على المستهلكين استخدام هذا المعرّف كمفتاح كما هو تمامًا وعدم إعادة تركيب المفاتيح عبر ضم المسارات أو ما شابه.** وتُسند المعرّفات وفق القواعد التالية.

- تحميل صورة عبر مسار نسبي لا يستبدل المعرّف بالمسار المطلق على الخادم ولا بالمسار المحلول من الرابط الرمزي. فالإشارة كما كُتبت في القالب تبقى هي المفتاح (وإن كُتبت كمسار مطلق، حُفظت تلك القيمة كما هي)
- يُستخدم المسار الفيزيائي المحلول من الرابط الرمزي داخليًا فقط لتقرير ما إذا كانت إشارتان تشيران إلى الملف نفسه. وحتى عند اختلاف المجلدات الأساسية، تعيد الصور التي تشير إلى الملف الفيزيائي نفسه استخدام المعرّف ذاته
- في التكوينات التي يؤجّل فيها التقرير الجذر صورةً إلى التزويد وقت العرض — باستخدام `createReport()` مباشرةً دون تمرير الصورة المعنية عبر `resources` أيضًا، فتصبح الإشارة المكتوبة في القالب هي المعرّف كما هي وتُزوَّد البايتات لاحقًا عبر `renderToPdf(document, { images })` — تُسنَد دائمًا معرّفات داخلية مستقلة عن المضيف للصور المحلية ذات المسارات النسبية التي تحمّلها التقارير الفرعية. ولأن الإشارات في التعبيرات والتقارير الفرعية الديناميكية لا يمكن حصرها مسبقًا، فإن هذا لا يعتمد على وقوع تضارب فعلي في الأسماء ولا على ترتيب التخطيط. ونتيجةً لذلك، لا يمكن أبدًا لصورة محلية في تقرير فرعي أن تختطف معرّف تزويد وقت العرض الذي يحمل الاسم نفسه

### تزويد الصور وقت العرض والبدائل

عندما يتعذر حلّ بديل وقت التخطيط، يُحتفظ بمعرّف الصورة الأصلية. ولذلك لا تتوقف معاينات Canvas/SVG، ويمكن تزويد البايتات لاحقًا عبر `renderToPdf(document, { images })`. وتُدمج `images` المُمرَّرة صراحةً في `document.images`، مع أولوية القيمة المُمرَّرة صراحةً للمعرّف نفسه. وأثناء توليد PDF كذلك، تُستبعد البدائل غير المزوَّدة من مرشحي البدائل فحسب — فلا يتوقف عرض الصورة الرئيسية ولا التقرير ككل.

### نطاق جمع إشارات الصور

يتعامل جمع إشارات الصور لا مع عناصر `image` الاعتيادية فحسب، بل أيضًا مع البدائل والأقنعة الناعمة للمجموعات وأنماط التبليط في التعبئات (fill/stroke) مع أقنعتها الناعمة المتداخلة، وذلك كله بالآلية نفسها. وعند استخدام مصغّرات الصفحات الخاصة بـ PDF أو مصغّرات مجلدات الحافظات أو صور Web Capture في المتصفح، مرّر `catalog` و`collection` و`pageOptions` نفسها إلى كل من `prepareBrowserPdfImageResources(document, options)` و`renderToPdf(document, options)` (ومع الواجهة الأولية، مرّر الخيارات نفسها إلى `new PdfBackend(options)` واستدعِ `render(document, backend)`). وصور WebP/AVIF هذه أيضًا لا يُفك ترميزها إلا عند الحاجة قبل توليد PDF.

## متطلبات وقت التشغيل

- Node.js 18 أو أحدث
- ES Modules / CommonJS
- المتصفحات الحديثة
- بلا حزم تبعيات وقت تشغيل

يستخدم ضغط WOFF2 بـ Brotli وفكّ ضغطه التنفيذَ المكتوب بـ TypeScript خالصة والمدمج في tsreport-core على Node.js والمتصفحات معًا. ولا يلزم أي حزم خارجية ولا WASM ولا مكتبات أصلية (native).

## الترخيص

‏tsreport-core متاح، حسب اختيارك، بموجب [رخصة MIT](./LICENSE-MIT) أو [رخصة Apache 2.0](./LICENSE-APACHE) (‏SPDX: `MIT OR Apache-2.0`). ولإشعارات حقوق النشر وشروط تراخيص الشيفرات والبيانات الخارجية، راجع [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
