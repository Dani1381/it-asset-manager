# 🚀 راهنمای انتشار (Publish Playbook) — پروژه IT Asset Manager

این سند مراحل رسمی «دریافت کامیت جدید، اجرای سرور و انتشار» هست. دقیقاً همین ترتیب را اجرا کن.

---

## ۰. اطلاعات ثابت پروژه

| مورد | مقدار |
|---|---|
| مسیر پروژه | `it-asset-manager/` (ریشه: `C:\Users\ARKA\Documents\Dani-space`) |
| سرور | `node server.js` روی پورت `3000` |
| آدرس محلی | `http://localhost:3000` |
| آدرس شبکه | `http://192.168.10.194:3000` |
| شاخه | `main` روی `origin` |
| ریموت | توکن GitHub داخل ریموت embed شده؛ فقط از `origin` استفاده کن، توکن را جایی کپی یا لاگ نکن |
| لاگین تست | `admin` / `admin` (ادمین) و `viewer` / `123` (فقط‌خواندنی) |
| متغیر محیطی AI | `DANI_API_KEY` (در User scope ویندوز ذخیره شده) |
| کلید اسکنر | برای تست `/api/scan` هدر `x-iam-key` لازم دارد (مقدار خام در جدول `settings` کلید `scanner_key`) |

---

## ۱. بررسی کامیت جدید (fetch)

```powershell
git -C it-asset-manager status -sb
git -C it-asset-manager fetch origin main
git -C it-asset-manager log --oneline HEAD..origin/main   # کامیت‌های جدید از ریموت
```

- اگر لیست خالی بود ⇒ چیز جدیدی نیست، فقط مطمئن شو سرور بالاست و تمام کن.
- اگر کامیت جدید بود ⇒ مرحله ۲.

## ۲. دریافت (pull)

```powershell
git -C it-asset-manager pull origin main
```

- معمولاً `fast-forward` می‌شود و `working tree clean` می‌ماند.
- اگر pull رد شد یا کانفلیکت داد، **هرگز force نزن**؛ اول `git status` را ببین و گزارش بده.

## ۳. بازبینی تغییرات (قبل از اجرا)

```powershell
git -C it-asset-manager show --stat HEAD          # فایل‌های تغییرکرده
git -C it-asset-manager diff HEAD~1..HEAD server.js database.js
```

- فقط تغییرات مربوط به `server.js` و `database.js` را بخوان تا اندپوینت/رفتار جدید را یاد بگیری.
- اگر اندپوینت API جدیدی اضافه شد، اسم و پارامترهایش را یادداشت کن تا تست کنی.

## ۴. چک سینتکس

```powershell
node --check it-asset-manager/server.js
node --check it-asset-manager/database.js
```

- هیچ خروجی ⇒ سالم است. خطا داد؟ متوقف شو و فایل را تعمیر کن.

## ۵. ری‌استارت سرور

سرور قبلی را بکش و یک job جدید با `DANI_API_KEY` استارت بزن:

```powershell
$env:DANI_API_KEY = [Environment]::GetEnvironmentVariable('DANI_API_KEY','User')
Set-Location it-asset-manager
node server.js
```

> ⚠️ **نکته حیاتی:** `DANI_API_KEY` فقط در User scope ذخیره است؛ اگر داخل process سرور export نشود،
> تمام تست‌های هوش مصنوعی (`lookup-model`، `test-ai`، اسکن عکس) با خطا مواجه می‌شوند.

سپس روی لاگ job صبر کن تا بنر راه‌اندازی را ببینی:

```
🚀 IT Asset Manager Server is running!
👉 http://192.168.10.194:3000
[status: running]
```

## ۶. تست زنده (E2E)

یک اسکریپت `.js` موقت بساز و اجرا کن (در PowerShell داخل `node -e "..."` با آپاستریف/نقل‌قول مشکل پیش می‌آید؛
**حتماً فایل موقت بساز و بعد پاکش کن**):

```javascript
// verify_publish.js
async function main() {
  const login = await fetch("http://localhost:3000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" })
  });
  const cookie = login.headers.get("set-cookie");
  console.log("Login:", login.status);

  // صفحات اصلی
  for (const p of ["/", "/login.html", "/add.html", "/asset.html", "/style.css", "/app.js"]) {
    const r = await fetch("http://localhost:3000" + p, { headers: { Cookie: cookie } });
    console.log(p, "->", r.status);   // همه باید 200 باشند
  }

  // بدون نشست باید ریدایرکت شود
  const no = await fetch("http://localhost:3000/", { redirect: "manual" });
  console.log("no-session:", no.status, no.headers.get("location")); // 302 -> /login.html

  // APIهای کلیدی
  const stats = await fetch("http://localhost:3000/api/stats", { headers: { Cookie: cookie } });
  console.log("Stats:", await stats.json());

  const ai = await fetch("http://localhost:3000/api/test-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ provider: "9router" })
  });
  console.log("AI:", await ai.json());  // باید ok:true بدهد
}
main().catch(console.error);
```

```powershell
node verify_publish.js
Remove-Item verify_publish.js
```

**چک‌لیست قبولی:**
- [ ] لاگین `200` با `user.is_admin`
- [ ] همه صفحات `200`
- [ ] بدون نشست `302` به `/login.html`
- [ ] `/api/stats` داده برمی‌گرداند
- [ ] `/api/test-ai` می‌گوید `ok: true`
- [ ] اگر کامیت جدید اندپوینت API اضافه کرده، همان را هم تست کن

## ۷. انتشار (push)

```powershell
git -C it-asset-manager push origin main
```

- پیام موفقیت: **`Everything up-to-date`** یا `main -> main` (اگر خودت کامیتی داشتی).
- ⚠️ مسیر گیت از پراکسی `SOCKS5 127.0.0.1:10808` رد می‌شود و خطاهای msys (signal-pipe) چاپ می‌کند؛
  **صورتی است و push را خراب نمی‌کند.** خروجی را به `Select-Object -Last 3` محدود کن تا تمیز بماند.
- اگر `! [rejected] fetch first` گرفتی ⇒ برگرد به مرحله ۱ (ریموت جدید دارد).

## ۸. گزارش نهایی

به کاربر یک جدول کوتاه بده:
- کامیت جدید چه بود و چه کرد
- نتایج تست‌ها (لاگین/صفحات/AI)
- وضعیت push
- آدرس سرور

---

## ⛔ ممنوعیت‌ها

1. **هرگز `git push --force` نزن.**
2. **دیتای تستی رها نکن** — هر رکورد مصنوعی که برای تست ساختی باید همان جلسه حذف شود
   (asset، pending scan، لاگ اضافی). بعد از تست، شمارش آمار را با قبل مقایسه کن.
3. **توکن/کلید را لاگ یا کپی نکن** — داخل ریموت و متغیر محیطی هست.
4. **فایل‌های موقت** (`verify_*.js` و…) را بعد از اجرا پاک کن.
5. سرور دوم روی پورت ۳۰۰۰ بالا نزن؛ اول job قبلی را بکش.
6. اگر `node --check` خطا داد یا سرور بالا نیامد، منتشر نکن و گزارش بده.

## 🔁 خلاصه یک‌خطی

> `fetch` → `pull` → `show/diff` → `node --check` → ری‌استارت سرور با `DANI_API_KEY` → تست E2E → `push` → گزارش.
