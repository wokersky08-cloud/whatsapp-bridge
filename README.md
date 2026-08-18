# WhatsApp Bridge (Green API аналогы)

Бұл — жеке WhatsApp нөміріңізді QR арқылы қосатын кішкентай Node сервисі.
Baileys (WhatsApp Web протоколы) қолданылады. Ешқандай серіктестік немесе төлем қажет емес.

## Railway-ге деплой (5 минут)

1. Осы `bridge/` папкасын жеке GitHub репозиторийіне жүктеңіз.
2. https://railway.app → **New Project → Deploy from GitHub repo** → сол репозиторийді таңдаңыз.
3. **Variables** бөліміне қосыңыз:
   - `BRIDGE_TOKEN` — өзіңіз ойлап тапқан ұзын құпия жол (мыс. `openssl rand -hex 32`).
   - `APP_URL` — `https://bot-blossom-toolkit.lovable.app`
   - `SESSIONS_DIR` — `/data/sessions`
4. **Settings → Volumes** → жаңа volume қосып, mount path ретінде `/data` көрсетіңіз
   (бұл WhatsApp сессиясын сақтайды, әйтпесе әр рестартта QR қайта сұралады).
5. Деплойдан кейін Railway берген URL-ды көшіріңіз (мыс. `https://xxx.up.railway.app`).

Render.com-да да дәл солай: **New → Web Service → Docker**, сол айнымалылар + Disk (`/data`).

## Сайтқа қосу

Lovable жобасында екі құпия қосыңыз:
- `BRIDGE_URL` — Railway берген URL
- `BRIDGE_TOKEN` — жоғарыдағы құпиямен бірдей мән

Одан кейін бот параметрлерінде **«Өз бриджім (QR)»** карточкасынан «Қосылу» → QR сканерлеу.

## API

| Метод | Жол | Сипаттама |
|---|---|---|
| GET | `/session/:botId/status` | күй + QR |
| POST | `/session/:botId/connect` | сессия ашу |
| POST | `/session/:botId/send` | хабарлама жіберу |
| POST | `/session/:botId/logout` | ажырату |

Барлығы `Authorization: Bearer $BRIDGE_TOKEN` талап етеді.

## Ескерту

Бұл WhatsApp-тың ресми емес жолы (Green API да солай жұмыс істейді). Спам жібермеңіз —
нөмір бұғатталуы мүмкін. Ресми жол керек болса, Meta Cloud API карточкасын қолданыңыз.
