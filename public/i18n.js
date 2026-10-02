// i18n.js - Persian (Farsi) & English Translation Engine for IT Asset Master

const TRANSLATIONS = {
  fa: {
    // Nav & General
    app_name: "مدیریت دارایی ارکا",
    app_subtitle: "سامانه هوشمند ثبت و پایش تجهیزات IT و دارایی‌ها",
    nav_inventory: "انبار تجهیزات",
    nav_add: "افزودن دستگاه",
    nav_mobile_link: "اتصال موبایل",
    nav_settings: "تنظیمات",
    nav_users: "مدیریت کاربران",
    nav_logs: "لاگ‌های سیستم",
    logs_title: "لاگ‌های زنده و رویدادهای سیستم",
    nav_scanner_bat: "اسکنر ویندوز (.bat)",
    nav_scanner_sh: "اسکنر لینوکس (.sh)",
    nav_csv: "خروجی اکسل / CSV",
    nav_backup_db: "پشتیبان دیتابیس",
    nav_back: "بازگشت به لیست",
    lang_toggle: "English",
    theme_light: "☀️ تم روشن",
    theme_dark: "🌙 تم تاریک",
    role_admin: "مدیر سیستم (ادمین)",
    role_viewer: "کاربر عادی (بیننده)",
    btn_logout: "خروج",

    // Stats
    stat_total: "کل تجهیزات",
    stat_active_pcs: "سیستم‌های فعال",
    stat_monitors: "مانیتورها",
    stat_storage: "در انبار / یدکی",
    stat_pending_photos: "بدون عکس",

    // Filters & Search
    search_placeholder: "جستجو با شناسه اموال، شماره سریال، نام سیستم، کاربر، پردازنده، مدل...",
    filter_all_cats: "📁 همه دسته‌ها",
    filter_pc: "🖥️ کامپیوتر / کیس",
    filter_single_pc: "💻 تک کیس / سیستم کاربر",
    filter_laptop: "💻 لپ‌تاپ",
    filter_monitor: "📺 مانیتور",
    filter_printer: "🖨️ پرینتر / اسکنر",
    filter_network: "🌐 سوییچ و شبکه",
    filter_other: "🔌 سایر قطعات",

    filter_all_status: "⚡ همه وضعیت‌ها",
    status_active: "در حال استفاده",
    status_in_storage: "در انبار / یدکی",
    status_repair: "نیازمند تعمیر",
    status_retired: "اسقاط / خارج از رده",

    // Asset Cards
    user_label: "کاربر:",
    unassigned: "تخصیص‌نیافته",
    serial_label: "سریال:",
    cpu_label: "پردازنده:",
    ram_label: "رم:",
    storage_label: "حافظه:",
    monitors_label: "مانیتورها:",
    location_label: "مکان:",
    photos_count: "عکس",
    btn_snap: "عکس",
    btn_tag: "برچسب اموال",
    btn_details: "جزئیات ←",
    no_assets_title: "هیچ دستگاهی یافت نشد",
    no_assets_desc: "می‌توانید اسکریپت اسکنر bat را روی سیستم اجرا کنید یا از دکمه «افزودن دستگاه» برای ثبت دستی وسایل قدیمی و مانیتورها استفاده نمایید.",
    btn_add_first: "ثبت اولین دستگاه",

    // Add / Edit Form
    add_title: "ثبت مشخصات دستگاه / تجهیزات جدید",
    add_subtitle: "برای ثبت مانیتورها، کیس‌های قدیمی، قطعات انبار و لوازمی که اسکریپت روی آن‌ها اجرا نمی‌شود.",
    edit_title: "ویرایش مشخصات دستگاه",
    field_property_id: "شناسه / کد اموال *",
    field_property_id_hint: "در صورت خالی ماندن، خودکار تولید می‌شود",
    field_category: "دسته‌بندی *",
    field_status: "وضعیت دستگاه",
    field_user: "کاربر / کارمند تحویل‌گیرنده",
    field_comp_name: "نام کامپیوتر (Computer Name)",
    field_model: "سازنده / مدل دستگاه *",
    field_serial: "شماره سریال (Serial Number)",
    field_location: "محل استقرار / اتاق / انبار",
    field_department: "واحد / دپارتمان",
    field_purchase_date: "تاریخ خرید / تحویل",
    field_cpu: "پردازنده (CPU)",
    field_ram: "حافظه رم (RAM)",
    field_storage: "حافظه ذخیره‌سازی (SSD / HDD)",
    field_gpu: "کارت گرافیک (GPU)",
    field_monitors: "مانیتور / نمایشگر متصل",
    field_ip: "آدرس آی‌پی (IP)",
    field_notes: "توضیحات / وضعیت سلامت / گارانتی",
    field_notes_placeholder: "مثال: دارای ۲ پورت HDMI، بدنه خط و خش دارد، گارانتی تا پایان سال...",
    
    // AI Section
    ai_box_title: "تشخیص هوشمند مشخصات با هوش مصنوعی جمینای (Gemini AI)",
    ai_uploader_text: "برای عکس گرفتن یا انتخاب تصویر برچسب لمس کنید",
    ai_uploader_sub: "از برچسب مشخصات یا پشت مانیتور/کیس عکس بگیرید تا هوش مصنوعی فیلدها را خودکار پر کند.",
    btn_ai_scan: "اسکن هوشمند عکس با هوش مصنوعی (پر کردن خودکار)",
    btn_ai_rescan: "اسکن مجدد با هوش مصنوعی",
    ai_analyzing: "⏳ هوش مصنوعی در حال خواندن مشخصات و شماره سریال از روی تصویر...",
    ai_success: "✅ مشخصات با موفقیت توسط هوش مصنوعی استخراج و فرم پر شد!",
    btn_save: "ذخیره دستگاه",
    btn_cancel: "انصراف",

    // Detail Page
    tab_specs: "مشخصات فنی سیستم",
    tab_photos: "تصاویر دستگاه",
    tab_sticker: "برچسب بارکد اموال",
    last_scanned: "آخرین اسکن خودکار:",
    never_scanned: "ثبت دستی (اسکن نشده)",
    auto_scanned_badge: "اسکن خودکار شبکه",
    btn_print_sticker: "چاپ برچسب اموال",
    btn_edit: "ویرایش",
    btn_delete: "حذف دستگاه",
    btn_add_photo: "افزودن عکس جدید",
    btn_use_existing_photo: "استفاده از عکس موجود",
    btn_ai_extract: "استخراج مجدد با AI",
    confirm_delete_asset: "آیا از حذف دائمی این دستگاه اطمینان دارید؟",
    confirm_delete_photo: "آیا این عکس حذف شود؟",

    // Smart Features
    smart_preset_applied: "⚡ مشخصات پیش‌فرض برای این مدل اعمال شد!",
    duplicate_serial_warning: "⚠️ هشدار: این شماره سریال قبلاً برای دستگاه دیگری ثبت شده است!",
    
    // Settings
    settings_title: "⚙️ تنظیمات سیستم و بات پیام‌رسان بله",
    setting_company: "نام شرکت / سازمان",
    setting_prefix: "پیشوند کد اموال (مثال: AST-)",
    setting_gemini_key: "کلید API جمینای (Gemini API Key)",
    setting_gemini_model: "مدل هوش مصنوعی پیش‌فرض",
    setting_bale_title: "💬 هشدارهای بات پیام‌رسان بله (Bale Bot)",
    setting_bale_token: "توکن بات بله (Token)",
    setting_bale_chat_id: "شناسه چت / کانال بله (Chat ID)",
    btn_test_bale: "🔔 تست ارسال پیام به بله",
    btn_save_settings: "ذخیره تنظیمات",
    settings_saved: "تنظیمات با موفقیت ذخیره شد.",
    stat_disk_alerts: "هشدار سلامت هارد",
    nav_tools: "ابزارها",
    nav_theme: "تغییر تم روشن / تاریک",
    disk_badge_critical: "هارد در خطر",
    disk_badge_warning: "بررسی هارد",
    disk_critical_hint: "یکی از درایوهای این دستگاه در آستانه خرابی است",
    disk_warning_hint: "وضعیت یکی از درایوهای این دستگاه نیاز به بررسی دارد",
    disk_health_title: "سلامت درایوها (SMART)",
    disk_level_ok: "سالم",
    disk_level_warning: "نیاز به بررسی",
    disk_level_critical: "بحرانی",
    disk_level_unknown: "نامشخص",
    disk_life_left: "عمر باقی‌مانده",
    disk_temp: "دما",
    disk_hours: "ساعت کارکرد",
    disk_checked_at: "آخرین بررسی",
    disk_no_data: "هنوز اطلاعات سلامت درایو از اسکنر دریافت نشده است. اسکنر جدید ویندوز/لینوکس را روی این سیستم اجرا کنید.",
    disk_admin_tip: "برای دریافت درصد عمر و دمای درایو، اسکنر را با Run as administrator اجرا کنید.",
    setting_photo_priority: "اولویت نمایش عکس دستگاه‌ها",
    photo_priority_camera: "📱 اول عکس گرفته‌شده با گوشی (پیشنهادی)",
    photo_priority_newest: "🕒 جدیدترین عکس آپلود‌شده",
    photo_priority_stock: "🌐 اول عکس کاتالوگ / اینترنت",
    photo_priority_hint: "عکسی که در صفحه اصلی و صفحه جزئیات اول نمایش داده می‌شود. در صفحه هر دستگاه می‌توانید با ⭐ یک عکس را دستی به‌عنوان عکس اصلی انتخاب کنید."
  },

  en: {
    // Nav & General
    app_name: "IT Asset Master",
    app_subtitle: "Hardware & Device Inventory Management",
    nav_inventory: "Inventory",
    nav_add: "Add Device",
    nav_mobile_link: "Mobile Link",
    nav_settings: "Settings",
    nav_logs: "System Logs",
    logs_title: "Live System Logs & Events",
    nav_scanner_bat: "Windows Scanner (.bat)",
    nav_scanner_sh: "Linux Scanner (.sh)",
    nav_csv: "CSV Export",
    nav_backup_db: "Backup DB",
    nav_back: "Back to Inventory",
    lang_toggle: "فارسی",

    // Stats
    stat_total: "Total Assets",
    stat_active_pcs: "Active PCs",
    stat_monitors: "Monitors",
    stat_storage: "In Storage / Spare",
    stat_pending_photos: "Needs Photo",

    // Filters & Search
    search_placeholder: "Search by Property ID, Serial #, PC Name, User, CPU, Model...",
    filter_all_cats: "📁 All Categories",
    filter_pc: "🖥️ Computers / Towers",
    filter_single_pc: "💻 Single PC",
    filter_laptop: "💻 Laptops",
    filter_monitor: "📺 Monitors",
    filter_printer: "🖨️ Printers",
    filter_network: "🌐 Network Switches",
    filter_other: "🔌 Other Hardware",

    filter_all_status: "⚡ All Statuses",
    status_active: "🟢 Active in Use",
    status_in_storage: "🟡 In Storage / Spare",
    status_repair: "🔴 Needs Repair",
    status_retired: "⚪ Retired / Scrap",

    // Asset Cards
    user_label: "User:",
    unassigned: "Unassigned",
    serial_label: "Serial:",
    cpu_label: "CPU:",
    ram_label: "RAM:",
    storage_label: "Storage:",
    monitors_label: "Monitors:",
    location_label: "Location:",
    photos_count: "photo(s)",
    btn_snap: "Photo",
    btn_tag: "Tag",
    btn_details: "Details →",
    no_assets_title: "No devices found",
    no_assets_desc: "Run the .bat scanner on a PC or click '+ Add Device' to register old equipment manually.",
    btn_add_first: "Add First Device",

    // Add / Edit Form
    add_title: "Register New Device / Equipment",
    add_subtitle: "Use this for monitors, old PCs, spare parts, and items where the automated scanner cannot run.",
    edit_title: "Edit Device Details",
    field_property_id: "Property / Asset ID *",
    field_property_id_hint: "Auto-generated if left blank",
    field_category: "Category *",
    field_status: "Device Status",
    field_user: "Assigned User / Employee",
    field_comp_name: "Computer Name",
    field_model: "Manufacturer / Model *",
    field_serial: "Serial Number",
    field_location: "Location / Room",
    field_department: "Department",
    field_purchase_date: "Purchase Date",
    field_cpu: "Processor (CPU)",
    field_ram: "Memory (RAM)",
    field_storage: "Storage (SSD / HDD)",
    field_gpu: "Graphics Card (GPU)",
    field_monitors: "Monitor / Display",
    field_ip: "IP Address",
    field_notes: "Notes / Accessories / Condition",
    field_notes_placeholder: "e.g. 2x HDMI ports, minor scratches, warranty valid until 2027...",
    
    // AI Section
    ai_box_title: "Gemini AI Photo Spec Understanding & Auto-Fill",
    ai_uploader_text: "Tap to take a photo or select image",
    ai_uploader_sub: "Photograph the spec label or serial sticker to auto-fill the form using AI.",
    btn_ai_scan: "Scan Photos with Gemini AI (Auto-Fill)",
    btn_ai_rescan: "Re-scan with Gemini AI",
    ai_analyzing: "⏳ Gemini AI is analyzing image labels and hardware specs...",
    ai_success: "✅ Specifications extracted and form auto-filled!",
    btn_save: "Save Device",
    btn_cancel: "Cancel",

    // Detail Page
    tab_specs: "Hardware Specifications",
    tab_photos: "Device Photos",
    tab_sticker: "Asset Tag Sticker",
    last_scanned: "Last auto-scanned:",
    never_scanned: "Manual entry (not scanned)",
    auto_scanned_badge: "Auto-Scanned",
    btn_print_sticker: "Print Label",
    btn_edit: "Edit",
    btn_delete: "Delete",
    btn_add_photo: "Add Photo",
    btn_use_existing_photo: "Use Existing Photo",
    btn_ai_extract: "AI Extract Specs",
    confirm_delete_asset: "Are you sure you want to permanently delete this device?",
    confirm_delete_photo: "Delete this photo?",

    // Smart Features
    smart_preset_applied: "⚡ Default specs auto-applied for this model!",
    duplicate_serial_warning: "⚠️ Warning: This serial number is already registered to another device!",
    
    // Settings
    settings_title: "⚙️ System & Bale Messenger Settings",
    setting_company: "Company / Organization Name",
    setting_prefix: "Asset Tag Prefix (e.g. AST-)",
    setting_gemini_key: "Gemini API Key",
    setting_gemini_model: "Default Gemini Model",
    setting_bale_title: "💬 Bale Messenger Bot Alerts",
    setting_bale_token: "Bale Bot Token",
    setting_bale_chat_id: "Bale Chat ID",
    btn_test_bale: "🔔 Test Bale Notification",
    btn_save_settings: "Save Settings",
    settings_saved: "Settings saved successfully.",
    stat_disk_alerts: "Disk Health Alerts",
    nav_tools: "Tools",
    nav_theme: "Light / dark theme",
    disk_badge_critical: "Disk failing",
    disk_badge_warning: "Check disk",
    disk_critical_hint: "A drive in this device is close to failure",
    disk_warning_hint: "A drive in this device needs attention",
    disk_health_title: "Drive Health (SMART)",
    disk_level_ok: "Healthy",
    disk_level_warning: "Needs attention",
    disk_level_critical: "Critical",
    disk_level_unknown: "Unknown",
    disk_life_left: "Life left",
    disk_temp: "Temp",
    disk_hours: "Power-on hours",
    disk_checked_at: "Last checked",
    disk_no_data: "No drive health data from the scanner yet. Run the new Windows/Linux scanner on this machine.",
    disk_admin_tip: "Run the scanner as administrator to get life % and temperature.",
    setting_photo_priority: "Device photo display priority",
    photo_priority_camera: "📱 Phone camera photos first (recommended)",
    photo_priority_newest: "🕒 Newest uploaded photo",
    photo_priority_stock: "🌐 Catalog / internet photos first",
    photo_priority_hint: "Which photo is shown first on the dashboard and detail page. On each device page you can pick a cover photo manually with ⭐."
  }
};

// Current active language (Persian by default, persisted in localStorage)
let CURRENT_LANG = localStorage.getItem('iam_lang') || 'fa';

function getTranslation(key) {
  const dict = TRANSLATIONS[CURRENT_LANG] || TRANSLATIONS.fa;
  return dict[key] || TRANSLATIONS.en[key] || key;
}

function setLanguage(lang) {
  CURRENT_LANG = lang;
  localStorage.setItem('iam_lang', lang);
  applyTranslations();
  // Update document direction
  if (lang === 'fa') {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'fa');
    document.body.classList.add('rtl');
  } else {
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
    document.body.classList.remove('rtl');
  }
  // Dispatch event for other scripts
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

function toggleLanguage() {
  setLanguage(CURRENT_LANG === 'fa' ? 'en' : 'fa');
}

function applyTranslations() {
  // Translate elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = getTranslation(key);
  });

  // Translate placeholders with data-i18n-placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = getTranslation(key);
  });

  // Translate titles with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = getTranslation(key);
  });

  // Language toggle button text
  const toggleBtn = document.getElementById('lang-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = getTranslation('lang_toggle');
  }
}

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(CURRENT_LANG);
});
