'use strict';

// ==========================================
// التخزين الآمن
// ==========================================
const KEYS = { today: 'wallet_today', archive: 'wallet_archive', theme: 'wallet_theme' };

function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const val = JSON.parse(raw);
        return Array.isArray(fallback) && !Array.isArray(val) ? fallback : val;
    } catch (e) {
        return fallback;
    }
}

function saveJSON(key, val) {
    try {
        localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
        alert('تعذّر الحفظ: ذاكرة التخزين ممتلئة. قم بتصدير نسخة احتياطية.');
    }
}

// طلب تخزين دائم حتى لا يمسح المتصفح البيانات تلقائياً
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
}

// ==========================================
// أدوات مساعدة
// ==========================================
function getLocalDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };

function isoToLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ar-DZ', dateOptions);
}

const numberFmt = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 });
function formatDZD(val) {
    return numberFmt.format(val) + ' د.ج';
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function getCurrentTime() {
    return new Date().toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// يقبل "1 500" أو "1500,50" أو أرقام عربية "١٥٠٠"
function parseAmount(text) {
    const western = String(text)
        .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
        .replace(/\s/g, '')
        .replace(',', '.');
    return parseFloat(western);
}

function sumByType(items, type) {
    return round2(items.filter(i => i.type === type).reduce((s, i) => s + (Number(i.amount) || 0), 0));
}

let uid = 0;
function newId() {
    return Date.now() * 100 + (uid++ % 100);
}

// ==========================================
// تنظيف البيانات (للبيانات القديمة والمستوردة)
// ==========================================
function cleanItem(it, fallbackIso) {
    if (!it || typeof it !== 'object') return null;
    const amount = Number(it.amount);
    if (it.type !== 'income' && it.type !== 'expense') return null;
    if (!isFinite(amount) || amount <= 0) return null;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(it.isoDate) ? it.isoDate : fallbackIso;
    return {
        id: Number(it.id) || newId(),
        title: String(it.title || '').slice(0, 60) || '—',
        amount: round2(amount),
        type: it.type,
        time: String(it.time || ''),
        isoDate: iso
    };
}

function cleanArchive(arr) {
    const byDate = {};
    (Array.isArray(arr) ? arr : []).forEach(day => {
        if (!day || !Array.isArray(day.items)) return;
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(day.isoDate)
            ? day.isoDate
            : getLocalDateString(new Date(Number(day.id) || Date.now()));
        day.items.forEach(raw => {
            const it = cleanItem(raw, iso);
            if (!it) return;
            // يُرتَّب حسب تاريخ العملية نفسها وليس تاريخ الإغلاق
            (byDate[it.isoDate] = byDate[it.isoDate] || []).push(it);
        });
    });
    return Object.keys(byDate)
        .sort((a, b) => b.localeCompare(a))
        .map(iso => ({ id: newId(), isoDate: iso, items: byDate[iso] }));
}

// ==========================================
// حالة التطبيق
// ==========================================
let todayData = loadJSON(KEYS.today, []).map(i => cleanItem(i, getLocalDateString())).filter(Boolean);
let archiveData = cleanArchive(loadJSON(KEYS.archive, []));
let currentDay = getLocalDateString();

function persistAll() {
    saveJSON(KEYS.today, todayData);
    saveJSON(KEYS.archive, archiveData);
}

function addToArchive(items) {
    items.forEach(it => {
        let day = archiveData.find(d => d.isoDate === it.isoDate);
        if (!day) {
            day = { id: newId(), isoDate: it.isoDate, items: [] };
            archiveData.push(day);
        }
        day.items.unshift(it);
    });
    archiveData.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
}

// ترحيل تلقائي: أي عملية من يوم سابق تنتقل إلى الأرشيف
function autoRollover() {
    const todayIso = getLocalDateString();
    const old = todayData.filter(i => i.isoDate !== todayIso);
    if (old.length) {
        todayData = todayData.filter(i => i.isoDate === todayIso);
        addToArchive([...old].reverse());
        persistAll();
        showToast(`تم ترحيل ${old.length} عملية من الأيام السابقة إلى الأرشيف`, null);
    }
    if (todayIso !== currentDay || old.length) {
        currentDay = todayIso;
        renderAll();
    }
}

// ==========================================
// المظهر
// ==========================================
const themeBtn = document.getElementById('themeToggleBtn');
const themeMeta = document.querySelector('meta[name="theme-color"]');
let currentTheme = localStorage.getItem(KEYS.theme) ||
    (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    themeBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    if (themeMeta) themeMeta.setAttribute('content', currentTheme === 'dark' ? '#0b1120' : '#f8fafc');
}
themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEYS.theme, currentTheme); } catch (e) {}
    applyTheme();
});
applyTheme();

// ==========================================
// إشعار مع زر تراجع
// ==========================================
let toastTimer = null;
let undoAction = null;
const toastEl = document.getElementById('toast');

function showToast(msg, onUndo) {
    document.getElementById('toastMsg').textContent = msg;
    undoAction = onUndo;
    document.getElementById('toastUndo').style.display = onUndo ? '' : 'none';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.classList.remove('show'); undoAction = null; }, 4000);
}
document.getElementById('toastUndo').addEventListener('click', () => {
    if (undoAction) undoAction();
    undoAction = null;
    toastEl.classList.remove('show');
});

// ==========================================
// العرض
// ==========================================
function itemHtml(item, withDelete) {
    return `
        <div class="item-card ${item.type}">
            <div class="item-info">
                <span class="item-title">${escapeHtml(item.title)}</span>
                <span class="item-time">${escapeHtml(item.time)}</span>
            </div>
            <div class="item-right">
                <span class="item-amount">${item.type === 'income' ? '+' : '-'}${formatDZD(item.amount)}</span>
                ${withDelete ? `
                <button class="btn-delete" data-del="${item.id}" title="حذف العملية" aria-label="حذف">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>` : ''}
            </div>
        </div>`;
}

function setBalanceColor(el, v) {
    el.style.color = v < 0 ? 'var(--expense-color)' : (v > 0 ? 'var(--income-color)' : 'var(--text-main)');
}

function updateTodayDashboard() {
    const income = sumByType(todayData, 'income');
    const expense = sumByType(todayData, 'expense');
    const balance = round2(income - expense);
    document.getElementById('todayIncome').textContent = formatDZD(income);
    document.getElementById('todayExpense').textContent = formatDZD(expense);
    const el = document.getElementById('todayBalance');
    el.textContent = formatDZD(balance);
    setBalanceColor(el, balance);
}

function renderTodayList() {
    const c = document.getElementById('todayList');
    c.innerHTML = todayData.length
        ? todayData.map(i => itemHtml(i, true)).join('')
        : `<div class="empty-placeholder">لم تسجل أي عملية لليوم بعد.</div>`;
}

const openArchiveDays = new Set();

function renderArchive() {
    const c = document.getElementById('archiveContainer');
    if (!archiveData.length) {
        c.innerHTML = `<div class="card empty-placeholder">لا توجد أيام مؤرشفة حتى الآن.</div>`;
        return;
    }
    c.innerHTML = archiveData.map(day => {
        const income = sumByType(day.items, 'income');
        const expense = sumByType(day.items, 'expense');
        const balance = round2(income - expense);
        return `
        <div class="archive-card ${openArchiveDays.has(day.isoDate) ? 'open' : ''}" data-iso="${day.isoDate}">
            <div class="archive-header" data-toggle="${day.isoDate}">
                <div class="archive-top">
                    <span class="archive-date">📅 ${isoToLabel(day.isoDate)} (${day.items.length} عمليات)</span>
                    <span class="archive-arrow">▼</span>
                </div>
                <div class="archive-stats-row">
                    <span style="color: var(--income-color)">+ ${formatDZD(income)}</span>
                    <span style="color: var(--expense-color)">- ${formatDZD(expense)}</span>
                    <span style="font-weight:700">الصافي: ${formatDZD(balance)}</span>
                </div>
            </div>
            <div class="archive-details">
                <div class="archive-items-container">${day.items.map(i => itemHtml(i, false)).join('')}</div>
                <div class="archive-actions">
                    <button class="btn-del-archive" data-del-day="${day.isoDate}">🗑️ حذف هذا اليوم من الأرشيف</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderAll() {
    document.getElementById('currentDateDisplay').textContent = new Date().toLocaleDateString('ar-DZ', dateOptions);
    updateTodayDashboard();
    renderTodayList();
    renderArchive();
    computeAndDisplayPeriodStats();
}

// ==========================================
// الإضافة والحذف
// ==========================================
const titleInput = document.getElementById('txTitle');
const amountInput = document.getElementById('txAmount');

function addTransaction(type) {
    autoRollover();
    const title = titleInput.value.trim();
    const amount = parseAmount(amountInput.value);

    if (!title) {
        alert('يرجى إدخال اسم أو وصف للعملية.');
        titleInput.focus();
        return;
    }
    if (!isFinite(amount) || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح أكبر من الصفر.');
        amountInput.focus();
        return;
    }

    todayData.unshift({
        id: newId(),
        title: title.slice(0, 60),
        amount: round2(amount),
        type,
        time: getCurrentTime(),
        isoDate: getLocalDateString()
    });
    saveJSON(KEYS.today, todayData);
    renderAll();

    titleInput.value = '';
    amountInput.value = '';
    titleInput.focus();
    if (navigator.vibrate) navigator.vibrate(15);
}

document.getElementById('btnAddIncome').addEventListener('click', () => addTransaction('income'));
document.getElementById('btnAddExpense').addEventListener('click', () => addTransaction('expense'));

// "Entrée" dans le titre → passe au montant ; dans le montant → ajoute une dépense
document.getElementById('txForm').addEventListener('submit', e => {
    e.preventDefault();
    if (document.activeElement === titleInput) amountInput.focus();
    else addTransaction('expense');
});
titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); amountInput.focus(); }
});

document.getElementById('todayList').addEventListener('click', e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const id = Number(btn.dataset.del);
    const idx = todayData.findIndex(i => i.id === id);
    if (idx < 0) return;
    const [removed] = todayData.splice(idx, 1);
    saveJSON(KEYS.today, todayData);
    renderAll();
    showToast(`تم حذف «${removed.title}»`, () => {
        todayData.splice(idx, 0, removed);
        saveJSON(KEYS.today, todayData);
        renderAll();
    });
});

document.getElementById('archiveContainer').addEventListener('click', e => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
        const iso = toggle.dataset.toggle;
        const card = toggle.parentElement;
        card.classList.toggle('open');
        card.classList.contains('open') ? openArchiveDays.add(iso) : openArchiveDays.delete(iso);
        return;
    }
    const del = e.target.closest('[data-del-day]');
    if (del && confirm('هل تريد فعلاً حذف هذا اليوم بالكامل مع جميع تفاصيله من الأرشيف؟')) {
        const iso = del.dataset.delDay;
        const idx = archiveData.findIndex(d => d.isoDate === iso);
        const [removed] = archiveData.splice(idx, 1);
        saveJSON(KEYS.archive, archiveData);
        renderAll();
        showToast('تم حذف اليوم من الأرشيف', () => {
            archiveData.push(removed);
            archiveData.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
            saveJSON(KEYS.archive, archiveData);
            renderAll();
        });
    }
});

// إنهاء اليوم يدوياً (يُدمج مع نفس اليوم إن كان مؤرشفاً من قبل)
document.getElementById('btnCloseDay').addEventListener('click', () => {
    if (!todayData.length) {
        alert('لا توجد أي عمليات في سجل اليوم لنقلها إلى الأرشيف.');
        return;
    }
    if (confirm('هل أنت متأكد من إنهاء اليوم؟ سيتم حفظ كافة العمليات في الأرشيف المفصل وتفريغ شاشة اليوم.')) {
        addToArchive([...todayData].reverse());
        todayData = [];
        persistAll();
        renderAll();
    }
});

// ==========================================
// الإحصائيات العامة
// ==========================================
let currentFilterType = 'quick';
let currentQuickDays = 7;
let customStartDate = null;
let customEndDate = null;

function applyQuickFilter(days) {
    currentFilterType = 'quick';
    currentQuickDays = days;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
    document.getElementById('activeFilterBadge').textContent =
        days === 30 ? 'آخر 30 يوماً' : days === 0 ? 'كل الأيام المسجلة' : 'آخر 7 أيام';
    computeAndDisplayPeriodStats();
}

document.querySelectorAll('.filter-btn').forEach(b =>
    b.addEventListener('click', () => applyQuickFilter(Number(b.dataset.days))));

document.getElementById('btnCalcCustom').addEventListener('click', () => {
    const startVal = document.getElementById('rangeStart').value;
    const endVal = document.getElementById('rangeEnd').value;
    if (!startVal || !endVal) { alert('يرجى تحديد حقلي التاريخ (من / إلى) معاً.'); return; }
    if (startVal > endVal) { alert('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية.'); return; }
    currentFilterType = 'custom';
    customStartDate = startVal;
    customEndDate = endVal;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('activeFilterBadge').textContent = `من ${startVal} إلى ${endVal}`;
    computeAndDisplayPeriodStats();
});

function computeAndDisplayPeriodStats() {
    let minDate = '0000-00-00';
    let maxDate = getLocalDateString();
    if (currentFilterType === 'quick' && currentQuickDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() - (currentQuickDays - 1));
        minDate = getLocalDateString(d);
    } else if (currentFilterType === 'custom') {
        minDate = customStartDate;
        maxDate = customEndDate;
    }

    // كل عملية تُحتسب حسب تاريخها الحقيقي
    const all = todayData.concat(...archiveData.map(d => d.items));
    const inRange = all.filter(i => i.isoDate >= minDate && i.isoDate <= maxDate);
    const income = sumByType(inRange, 'income');
    const expense = sumByType(inRange, 'expense');
    const net = round2(income - expense);

    document.getElementById('periodIncome').textContent = formatDZD(income);
    document.getElementById('periodExpense').textContent = formatDZD(expense);
    const el = document.getElementById('periodBalance');
    el.textContent = formatDZD(net);
    setBalanceColor(el, net);
}

// ==========================================
// النسخ الاحتياطي
// ==========================================
document.getElementById('btnExport').addEventListener('click', async () => {
    const backup = {
        app: 'masroufy',
        version: '3.0',
        exportedAt: new Date().toISOString(),
        today: todayData,
        archive: archiveData
    };
    const name = `masroufy_backup_${getLocalDateString()}.json`;
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });

    // على الهاتف: نافذة المشاركة (واتساب، Drive، البريد...)
    try {
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'نسخة احتياطية - مصروفي' });
            return;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('btnImportTrigger').addEventListener('click', () => {
    document.getElementById('fileImport').click();
});

document.getElementById('fileImport').addEventListener('change', function () {
    const file = this.files[0];
    this.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        try {
            const parsed = JSON.parse(evt.target.result);
            if (!parsed || (!Array.isArray(parsed.archive) && !Array.isArray(parsed.today))) {
                throw new Error('الملف غير مطابق لصيغة بيانات التطبيق.');
            }
            const newToday = (parsed.today || []).map(i => cleanItem(i, getLocalDateString())).filter(Boolean);
            const newArchive = cleanArchive(parsed.archive || []);
            const count = newToday.length + newArchive.reduce((s, d) => s + d.items.length, 0);

            if (confirm(`سيتم استيراد ${count} عملية واستبدال بياناتك الحالية. هل تود المتابعة؟`)) {
                todayData = newToday;
                archiveData = newArchive;
                persistAll();
                autoRollover();
                renderAll();
                alert('تم استيراد البيانات بنجاح!');
            }
        } catch (err) {
            alert('حدث خطأ أثناء قراءة الملف: ' + err.message);
        }
    };
    reader.readAsText(file);
});

// ==========================================
// الإقلاع
// ==========================================
const initialToday = getLocalDateString();
document.getElementById('rangeStart').value = initialToday;
document.getElementById('rangeEnd').value = initialToday;

persistAll();       // يحفظ البيانات القديمة بعد تنظيفها
autoRollover();
renderAll();
applyQuickFilter(7);

// التحقق من تغيّر اليوم عند الرجوع للتطبيق وكل دقيقة
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRollover(); });
setInterval(autoRollover, 60 * 1000);

// تسجيل الـ Service Worker للعمل بدون إنترنت
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
