import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, writeBatch, Timestamp } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const firebaseConfig = {
    apiKey: "AIzaSyCksVETnuOvJ4PI8O_stW_cnnzj1VUjVV8",
    authDomain: "moneytracker-49e63.firebaseapp.com",
    projectId: "moneytracker-49e63",
    storageBucket: "moneytracker-49e63.firebasestorage.app",
    messagingSenderId: "58282938382",
    appId: "1:58282938382:web:eedff47ed4f87a2fdb2c5f"
};
const GEMINI_API_KEY = "AIzaSyAaJ74fB9wmOmPkgiEqs31_PgG0UykhejY";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- 状态 ---
let allData = [];
let chartInstance = null;
let currentChartType = 'pie';
let editingId = null;
let isBatchMode = false;
let userQuickActions = JSON.parse(localStorage.getItem('my_quick_actions')) || [
    { label: "⚡️充电", amt: 1, desc: "充电", cat: "交通", tags: "充电" },
    { label: "☕️咖啡", amt: 9.9, desc: "瑞幸", cat: "餐饮", tags: "咖啡" }
];

const els = {
    dateStart: document.getElementById('date-start'),
    dateEnd: document.getElementById('date-end'),
    resetDateBtn: document.getElementById('reset-date-btn'),
    
    searchInput: document.getElementById('search-input'),
    list: document.getElementById('list'),
    
    statExp: document.getElementById('stat-expense'),
    statInc: document.getElementById('stat-income'),
    statBal: document.getElementById('stat-balance'),
    chartCanvas: document.getElementById('mainChart'),
    
    // 输入
    date: document.getElementById('date-input'),
    cat: document.getElementById('category-input'),
    desc: document.getElementById('desc-input'),
    amount: document.getElementById('amount-input'),
    tags: document.getElementById('tags-input'),
    saveBtn: document.getElementById('save-btn'),
    cancelBtn: document.getElementById('cancel-edit-btn'),
    
    // 辅助
    quickContainer: document.getElementById('quick-actions-container'),
    tagCloud: document.getElementById('tag-cloud'),
    
    // 批量
    toggleBatch: document.getElementById('toggle-batch-btn'),
    batchBar: document.getElementById('batch-bar'),
    batchCount: document.getElementById('batch-count'),
    batchTagInput: document.getElementById('batch-tag-input'),
    
    // AI
    aiInput: document.getElementById('ai-input'),
    aiBtn: document.getElementById('ai-btn')
};

// 1. 初始化日期 (本月第一天到今天)
const initDate = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    // 格式化 YYYY-MM-DD
    const fmt = d => d.toISOString().split('T')[0];
    els.dateStart.value = fmt(firstDay);
    els.dateEnd.value = fmt(now);
};
initDate();
els.resetDateBtn.onclick = initDate;

// 设置输入框默认时间
const setTime = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    els.date.value = d.toISOString().slice(0, 16);
};
setTime();

// 2. 渲染速记按钮
function renderQuickActions(editMode = false) {
    els.quickContainer.innerHTML = userQuickActions.map((q, i) => `
        <div class="qt-chip" onclick="${editMode ? `deleteQuick(${i})` : `applyQuick(${i})`}">
            ${q.label} ${editMode ? '❌' : ''}
        </div>
    `).join('') + (editMode ? `<div class="qt-chip" onclick="addQuick()" style="background:#dbeafe">+ 新增</div> <div class="qt-chip" onclick="saveQuickActions()" style="background:#333;color:white">完成</div>` : '');
    
    if(editMode) els.quickContainer.classList.add('qt-edit-mode');
    else els.quickContainer.classList.remove('qt-edit-mode');
}
renderQuickActions();

window.applyQuick = (i) => {
    const q = userQuickActions[i];
    els.amount.value = q.amt; els.desc.value = q.desc;
    els.cat.value = q.cat; els.tags.value = q.tags;
};
window.editQuickActions = () => renderQuickActions(true);
window.saveQuickActions = () => renderQuickActions(false);
window.deleteQuick = (i) => {
    userQuickActions.splice(i, 1);
    localStorage.setItem('my_quick_actions', JSON.stringify(userQuickActions));
    renderQuickActions(true);
};
window.addQuick = () => {
    const label = prompt("按钮名字 (如: 🍜吃面):");
    if(!label) return;
    userQuickActions.push({ label, amt: "", desc: "", cat: "餐饮", tags: "" });
    localStorage.setItem('my_quick_actions', JSON.stringify(userQuickActions));
    renderQuickActions(true);
};

// 3. 监听数据库
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
onSnapshot(q, (snapshot) => {
    allData = [];
    const tagSet = new Set();
    snapshot.forEach(doc => {
        const d = doc.data();
        allData.push({ id: doc.id, ...d });
        if(d.tags) d.tags.forEach(t => tagSet.add(t));
    });
    
    // 渲染标签云
    els.tagCloud.innerHTML = Array.from(tagSet).map(t => 
        `<div class="pre-tag" onclick="addTag('${t}')">${t}</div>`
    ).join('');
    
    render();
});

window.addTag = (t) => {
    const cur = els.tags.value.trim();
    if(!cur.includes(t)) els.tags.value = cur ? cur + " " + t : t;
};

// 4. 渲染主函数 (日期范围筛选)
function render() {
    const startStr = els.dateStart.value;
    const endStr = els.dateEnd.value;
    // 结束日期要加一天，确保包含当天
    const endDateObj = new Date(endStr); endDateObj.setDate(endDateObj.getDate()+1);
    const startTime = new Date(startStr).getTime();
    const endTime = endDateObj.getTime();
    
    const keyword = els.searchInput.value.trim().toLowerCase();

    const filtered = allData.filter(item => {
        const t = item.timestamp;
        const matchTime = t >= startTime && t < endTime;
        const tagStr = (item.tags || []).join(' ').toLowerCase();
        const matchKey = item.desc.toLowerCase().includes(keyword) || tagStr.includes(keyword);
        return matchTime && matchKey;
    });

    // 统计
    let exp = 0, inc = 0;
    const catMap = {}; const dayMap = {};
    
    filtered.forEach(item => {
        const val = Math.abs(item.amount);
        if (item.category === '工资') inc += val;
        else {
            exp += val;
            catMap[item.category] = (catMap[item.category] || 0) + val;
            const dateStr = item.date.split('T')[0].slice(5); // MM-DD
            dayMap[dateStr] = (dayMap[dateStr] || 0) + val;
        }
    });

    els.statExp.innerText = `¥${exp.toFixed(2)}`;
    els.statInc.innerText = `¥${inc.toFixed(2)}`;
    els.statBal.innerText = `¥${(inc - exp).toFixed(2)}`;

    // 列表渲染
    els.list.innerHTML = filtered.length ? '' : '<li style="justify-content:center;color:#999">该时间段无记录</li>';
    
    filtered.forEach(item => {
        const timeStr = item.date.split('T')[0].slice(5) + ' ' + item.date.split('T')[1];
        const isInc = item.category === '工资';
        const emoji = { "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", "工资":"💰", "其他":"📝" }[item.category] || "📝";
        const tagHtml = (item.tags || []).map(t => `<span class="tag-pill">#${t}</span>`).join('');

        const li = document.createElement('li');
        li.innerHTML = `
            <input type="checkbox" class="chk-box" value="${item.id}" onchange="updateBatchCount()">
            <div class="li-icon">${emoji}</div>
            <div class="li-main" onclick="editItem('${item.id}')"> <!-- 点击空白处编辑 -->
                <div class="li-header">
                    <h5>${item.desc}</h5>
                    <div class="li-money" style="color:${isInc?'#10b981':'#1f2937'}">
                        ${isInc?'+':'-'}¥${Math.abs(item.amount).toFixed(2)}
                    </div>
                </div>
                <div class="li-tags">${tagHtml}</div>
                <div class="li-time">${timeStr} · ${item.category}</div>
            </div>
        `;
        els.list.appendChild(li);
    });

    renderChart(catMap, dayMap);
}

// 5. 图表
function renderChart(catMap, dayMap) {
    if (chartInstance) chartInstance.destroy();
    const ctx = els.chartCanvas.getContext('2d');
    
    if (currentChartType === 'pie') {
        chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{ data: Object.values(catMap), backgroundColor: ['#ff9a9e', '#fad0c4', '#a18cd1', '#fbc2eb', '#8fd3f4', '#84fab0'], borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'left', labels:{boxWidth:10} } } }
        });
    } else {
        // 排序日期
        const sortedDays = Object.keys(dayMap).sort();
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedDays,
                datasets: [{ label: '每日支出', data: sortedDays.map(d=>dayMap[d]), borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', fill: true, tension: 0.3 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// 6. 批量操作逻辑
els.toggleBatch.onclick = () => {
    isBatchMode = !isBatchMode;
    els.list.classList.toggle('batch-mode', isBatchMode);
    els.batchBar.style.display = isBatchMode ? 'flex' : 'none';
    els.toggleBatch.classList.toggle('active', isBatchMode);
};

window.updateBatchCount = () => {
    const checked = document.querySelectorAll('.chk-box:checked').length;
    els.batchCount.innerText = `已选 ${checked}`;
};

window.batchAddTags = async () => {
    const newTags = els.batchTagInput.value.trim().split(/\s+/);
    if(!newTags.length) return;
    const ids = Array.from(document.querySelectorAll('.chk-box:checked')).map(c => c.value);
    if(!ids.length) return alert("请先勾选");
    
    const batch = writeBatch(db);
    ids.forEach(id => {
        const item = allData.find(d => d.id === id);
        const uniqueTags = [...new Set([...(item.tags||[]), ...newTags])];
        batch.update(doc(db, "expenses", id), { tags: uniqueTags });
    });
    await batch.commit();
    alert("批量添加成功");
    els.toggleBatch.click(); // 退出批量
};

window.batchDelete = async () => {
    if(!confirm("确定批量删除?")) return;
    const ids = Array.from(document.querySelectorAll('.chk-box:checked')).map(c => c.value);
    const batch = writeBatch(db);
    ids.forEach(id => batch.delete(doc(db, "expenses", id)));
    await batch.commit();
    els.toggleBatch.click();
};

// 7. 保存逻辑
els.saveBtn.addEventListener('click', async () => {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value;
    const date = els.date.value;
    const tags = els.tags.value.trim() ? els.tags.value.trim().split(/\s+/) : [];
    
    if(!amount || !desc) return alert('请补全信息');
    
    const payload = { amount, desc, category: els.cat.value, tags, date, timestamp: new Date(date).getTime() };
    els.saveBtn.disabled = true;
    
    try {
        if(editingId) {
            await updateDoc(doc(db, "expenses", editingId), payload);
            cancelEdit();
        } else {
            await addDoc(collection(db, "expenses"), { ...payload, createdAt: Timestamp.now() });
            els.amount.value = ''; els.desc.value = ''; els.tags.value = '';
        }
    } catch(e) { console.error(e); } 
    finally { els.saveBtn.disabled = false; }
});

// 编辑辅助
window.editItem = (id) => {
    const item = allData.find(d => d.id === id);
    editingId = id;
    els.saveBtn.innerText = "确认修改";
    els.cancelBtn.style.display = "inline-block";
    els.amount.value = item.amount;
    els.desc.value = item.desc;
    els.cat.value = item.category;
    els.date.value = item.date;
    els.tags.value = (item.tags || []).join(' ');
};

window.cancelEdit = () => {
    editingId = null;
    els.saveBtn.innerText = "记一笔";
    els.cancelBtn.style.display = "none";
    els.amount.value = ''; els.desc.value = ''; els.tags.value = '';
};

// 切换 Tab
window.switchInput = (mode) => {
    document.querySelectorAll('.input-mode').forEach(d => d.style.display = 'none');
    document.getElementById(`mode-${mode}`).style.display = 'block';
};
window.switchChart = (type) => {
    currentChartType = type;
    render();
};

// 事件监听
[els.dateStart, els.dateEnd, els.searchInput].forEach(el => el.addEventListener('input', render));
