# خادم MCP — `https://workspace.zakiai.io/mcp`

خادم **Model Context Protocol** (Streamable HTTP، JSON-RPC 2.0، بدون جلسة) عشان Claude يسجّل شغله المجدول بالورك سبيس بدون متصفح.

## شو انضاف (ملخّص)

- مسار واحد: `POST /mcp`. الـ `GET` و`DELETE` بيرجعوا 405 (ما في stream ولا جلسة).
- المفتاح من «الإعدادات ← توكنات الأنظمة»، النظام الجديد **Claude (MCP)** بصلاحيتين: `mcp.tasks` و`mcp.chat`.
- 8 أدوات: `list_tasks` · `create_task` · `move_task` · `comment_task` · `update_task` · `post_message` · `list_conversations` · `get_board`.
- كل أداة بتشغّل نفس مسارات التطبيق الموجودة (`/api/tasks`، `/api/tasks/:id`، `…/move`، `…/comments`، `/api/boards/:id`، `/api/chat/list`، `/api/chat/conversations/:id/messages`) **باسم صاحب المفتاح**. فكل قاعدة صلاحيات موجودة (الرتب، المساحات، الفرق، المهام الخاصة، «من يقدر يكتب بالموضوع») بتنطبق على المفتاح بالحرف. ما انكرر منطق شغل، وما تغيّر أي مسار موجود.
- كل استدعاء بيكتب سطر بسجل التدقيق: `mcp.tool` مع `via: "Claude MCP"`، غير سطور التدقيق اللي بتكتبها المسارات نفسها.
- الحد: 60 طلب بالدقيقة لكل مفتاح (الطلب المجمّع batch بيُحسب طلب واحد). فوقه: 429 مع `Retry-After`.
- النص العربي بيمرّ كما هو (UTF-8، بدون `\u` escapes).
- ما في إعداد بالسيرفر ولا بـ Coolify: المفتاح وصلاحياته من واجهة الإعدادات بس. المفتاح بيشتغل فقط وزر **«باب الربط»** شغّال بـ«الميزات» (متل باقي مفاتيح الأنظمة)، ولما بتطفّيه المسار بيرجع 404.

## الأدوات

| الأداة | الصلاحية | المدخلات |
|---|---|---|
| `list_tasks` | `mcp.tasks` | `projectId?` `boardId?` `columnId?` `query?` ← id, number, title, column, assignee, dueDate |
| `create_task` | `mcp.tasks` | `projectId` `boardId` `columnId` `title` `description?` `assigneeId?` `dueDate?` |
| `move_task` | `mcp.tasks` | `taskId` `columnId` |
| `comment_task` | `mcp.tasks` | `taskId` `body` |
| `update_task` | `mcp.tasks` | `taskId` `title?` `description?` `assigneeId?` `dueDate?` `archived?` (null بيشيل القيمة) |
| `post_message` | `mcp.chat` | `conversationId` `body` (بس بالمواضيع اللي صاحب المفتاح بيقدر يكتب فيها) |
| `list_conversations` | `mcp.chat` | `workspaceId` ← id, title, kind |
| `get_board` | `mcp.tasks` | `boardId` ← الأعمدة: id, name, stage |

الأداة اللي صلاحيتها مش بالمفتاح ما بتظهر بـ`tools/list`، وإذا انطلبت بيرجع خطأ أداة (`isError: true`) مش خطأ بروتوكول.

## أمثلة curl

```bash
TOKEN='zws_...'   # المفتاح اللي نسخته مرة وحدة من صفحة التوكنات
URL=https://workspace.zakiai.io/mcp

# 1) initialize
curl -s "$URL" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 2) tools/list  (لازم ترجع 8 أدوات إذا المفتاح فيه الصلاحيتين)
curl -s "$URL" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3) tools/call  (تعليق عربي على مهمة)
curl -s "$URL" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"comment_task","arguments":{"taskId":"<id المهمة>","body":"تمّ تشغيل المهمة المجدولة بنجاح"}}}'
```

## خطوات أحمد (بالعربي)

1. افتح الموقع كمالك: **الإعدادات ← إعدادات الشركة ← الميزات** وتأكد إنو **«باب الربط الخارجي»** (`apiDoor`) شغّال.
2. روح **الإعدادات ← توكنات الأنظمة** (توكنات الأنظمة).
3. بحقل **النظام** اختار **Claude (MCP)**. الصلاحيات بتتحدد لحالها: `mcp.tasks` و`mcp.chat`.
4. اختار أي مساحة (المفتاح بيشتغل باسمك بكل المساحات اللي بتوصلها، المساحة هون بس للتسجيل) وحدّد المدة (الافتراضي 90 يوم)، واضغط **اعمل المفتاح**.
5. انسخ المفتاح فورًا: **بيظهر مرة وحدة بس**.
6. بـ Claude: **Settings ← Connectors ← Add custom connector**:
   - **URL:** `https://workspace.zakiai.io/mcp`
   - **الترويسة (Header):** `Authorization` والقيمة `Bearer <المفتاح اللي نسخته>`
   (إذا واجهة Claude بتطلب Token بس، الصق المفتاح بدون كلمة Bearer.)
7. جرّب: اطلب من Claude «اعرض مهامي» أو «علّق على المهمة كذا».
8. إذا انكشف المفتاح: ارجع لنفس الصفحة واضغط **إلغاء** عنده بالحال. وإذا انوقف أو انحذف صاحب المفتاح من الشركة، المفتاح بيموت لحاله.

## أخطاء

- `401 door.unauthorized`: المفتاح غلط أو ملغي أو منتهي أو صاحبه ما عاد يقدر.
- `403 door.forbidden`: المفتاح ما فيه أي صلاحية MCP.
- `404 door.not_found`: زر «باب الربط الخارجي» مطفي.
- `429 door.rate_limited`: تعدّيت 60 طلب بالدقيقة.
- خطأ أداة (`isError: true`): قاعدة من التطبيق (ما بتقدر تكتب هون، المهمة مش موجودة، عمود غلط…) بنص قصير بدون تفاصيل داخلية.
