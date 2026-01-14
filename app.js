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

const INCOME_CATS = ["工资", "兼职", "理财", "礼金", "报销", "其他收入"];

// --- 状态 ---
let allData = [];
let chartInstance = null;
let currentChartType = 'pie';
let editingId = null;
let isBatchMode = false;
let chartFilter = null; 

let userQuickActions = JSON.parse(localStorage.getItem('my_quick_actions')) || [
    { label: "⚡️充电", amt: 1, desc: "充电", cat: "交通", tags: "充电" },
    { label: "☕️咖啡", amt: 9.9, desc: "瑞幸", cat: "餐饮", tags: "咖啡" }
];

const els = {
    dateStart: document.getElementById('date-start'),
    dateEnd: document.getElementById('date-end'),
    resetDateBtn: document.getElementById('reset-date-btn'),
    resetFilterBtn: document.getElementById('reset-filter-btn'),
    
    searchInput: document.getElementById('search-input'),
    list: document.getElementById('list'),
    
    statExp: document.getElementById('stat-expense'),
    statInc: document.getElementById('stat-income'),
    statBal: document.getElementById('stat-balance'),
    chartCanvas: document.getElementById('mainChart'),
    
    date: document.getElementById('date-input'),
    cat: document.getElementById('category-input'),
    desc: document.getElementById('desc-input'),
    amount: document.getElementById('amount-input'),
    tags: document.getElementById('tags-input'),
    saveBtn: document.getElementById('save-btn'),
    cancelBtn: document.getElementById('cancel-edit-btn'),
    
    quickContainer: document.getElementById('quick-actions-container'),
    tagCloud: document.getElementById('tag-cloud'),
    
    toggleBatch: document.getElementById('toggle-batch-btn'),
    batchBar: document.getElementById('batch-bar'),
    batchCount: document.getElementById('batch-count'),
    batchTagInput: document.getElementById('batch-tag-input'),
    selectAllWrapper: document.getElementById('select-all-wrapper'), // 全选框容器
    selectAllBox: document.getElementById('select-all-box'), // 全选框
    
    aiInput: document.getElementById('ai-input'),
    aiBtn: document.getElementById('ai-btn')
};

// 1. 初始化
const initDate = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = d => d.toISOString().split('T')[0];
    els.dateStart.value = fmt(firstDay);
    els.dateEnd.value = fmt(now);
};
initDate();
els.resetDateBtn.onclick = initDate;

const setTime = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    els.date.value = d.toISOString().slice(0, 16);
};
setTime();

function renderQuickActions(editMode = false) {
    els.quickContainer.innerHTML = userQuickActions.map((q, i) => `
        <div class="qt-chip" onclick="${editMode ? `deleteQuick(${i})` : `applyQuick(${i})`}">
            ${q.label} ${editMode ? '❌' : ''}
        </div>
    `).join('') + (editMode ? `<div class="qt-chip" onclick="addQuick()" style="background:#dbeafe">+ 新增</div> <div class="qt-chip" onclick="saveQuickActions()" style="background:#333;color:white">完成</div>` : '');
    els.quickContainer.classList.toggle('qt-edit-mode', editMode);
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

// 2. 监听数据库 (新增空标签过滤)
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
onSnapshot(q, (snapshot) => {
    allData = [];
    const tagSet = new Set();
    snapshot.forEach(doc => {
        const d = doc.data();
        // 数据清洗：如果存在空标签，过滤掉
        if (d.tags) {
            d.tags = d.tags.filter(t => t && t.trim() !== '');
        }
        allData.push({ id: doc.id, ...d });
        if(d.tags) d.tags.forEach(t => tagSet.add(t));
    });
    
    els.tagCloud.innerHTML = Array.from(tagSet).map(t => 
        `<div class="pre-tag" onclick="addTag('${t}')">${t}</div>`
    ).join('');
    
    render();
});

window.addTag = (t) => {
    const cur = els.tags.value.trim();
    if(!cur.includes(t)) els.tags.value = cur ? cur + " " + t : t;
};

// 3. 核心渲染
function render() {
    const startStr = els.dateStart.value;
    const endStr = els.dateEnd.value;
    const endDateObj = new Date(endStr); endDateObj.setDate(endDateObj.getDate()+1);
    const startTime = new Date(startStr).getTime();
    const endTime = endDateObj.getTime();
    
    const keyword = els.searchInput.value.trim().toLowerCase();

    const filtered = allData.filter(item => {
        const t = item.timestamp;
        const matchTime = t >= startTime && t < endTime;
        const tagStr = (item.tags || []).join(' ').toLowerCase();
        const matchKey = item.desc.toLowerCase().includes(keyword) || tagStr.includes(keyword);
        
        let matchChart = true;
        if (chartFilter) {
            if (chartFilter.type === 'category') {
                matchChart = item.category === chartFilter.value;
            } else if (chartFilter.type === 'date') {
                const itemDate = item.date.split('T')[0];
                matchChart = itemDate.endsWith(chartFilter.value);
            }
        }
        return matchTime && matchKey && matchChart;
    });

    let exp = 0, inc = 0;
    const catMap = {}; const dayMap = {};
    
    filtered.forEach(item => {
        const val = Math.abs(item.amount);
        if (INCOME_CATS.includes(item.category)) inc += val;
        else {
            exp += val;
            catMap[item.category] = (catMap[item.category] || 0) + val;
            const dateStr = item.date.split('T')[0].slice(5); 
            dayMap[dateStr] = (dayMap[dateStr] || 0) + val;
        }
    });

    els.statExp.innerText = `¥${exp.toFixed(2)}`;
    els.statInc.innerText = `¥${inc.toFixed(2)}`;
    els.statBal.innerText = `¥${(inc - exp).toFixed(2)}`;

    if (filtered.length === 0) {
        els.list.innerHTML = '<li style="justify-content:center;color:#999;padding:20px">无记录</li>';
    } else {
        els.list.innerHTML = '';
        filtered.forEach(item => {
            const timeStr = item.date.split('T')[0].slice(5) + ' ' + item.date.split('T')[1];
            const isInc = INCOME_CATS.includes(item.category);
            const emoji = { 
                "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", 
                "医疗":"💊", "教育":"📚", "人情":"🧧",
                "工资":"💰", "兼职":"💼", "理财":"📈", "礼金":"🧧", "报销":"🧾", "其他收入":"💎" 
            }[item.category] || "📝";
            
            // 过滤空标签再显示
            const validTags = (item.tags || []).filter(t => t && t.trim() !== '');
            const tagHtml = validTags.map(t => `<span class="tag-pill">#${t}</span>`).join('');
    
            const li = document.createElement('li');
            li.innerHTML = `
                <input type="checkbox" class="chk-box" value="${item.id}" onchange="updateBatchCount()">
                <div class="li-icon">${emoji}</div>
                <div class="li-main" onclick="editItem('${item.id}')">
                    <div class="li-header">
                        <h5>${item.desc}</h5>
                        <div class="li-money" style="color:${isInc?'#10b981':'#1f2937'}">
                            ${isInc?'+':'-'}¥${Math.abs(item.amount).toFixed(2)}
                        </div>
                    </div>
                    <div class="li-tags">${tagHtml}</div>
                    <div class="li-time">${timeStr} · ${item.category}</div>
                </div>
                <!-- 独立删除按钮，点击不触发编辑 -->
                <button class="btn-del-icon" onclick="deleteItem('${item.id}', event)">🗑️</button>
            `;
            els.list.appendChild(li);
        });
    }

    renderChart(catMap, dayMap);
    els.resetFilterBtn.style.display = chartFilter ? 'block' : 'none';
}

els.resetFilterBtn.onclick = () => { chartFilter = null; render(); };

function renderChart(catMap, dayMap) {
    if (chartInstance) chartInstance.destroy();
    const ctx = els.chartCanvas.getContext('2d');
    
    const commonOptions = {
        responsive: true, maintainAspectRatio: false,
        onClick: (e, elements) => {
            if (elements.length > 0) {
                const index = elements[0].index;
                if (currentChartType === 'pie') {
                    const label = Object.keys(catMap)[index];
                    chartFilter = { type: 'category', value: label };
                } else {
                    const label = Object.keys(dayMap).sort()[index];
                    chartFilter = { type: 'date', value: label };
                }
                render();
            }
        }
    };

    if (currentChartType === 'pie') {
        chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{ data: Object.values(catMap), backgroundColor: ['#ff9a9e', '#fad0c4', '#a18cd1', '#fbc2eb', '#8fd3f4', '#84fab0'], borderWidth: 0 }]
            },
            options: { ...commonOptions, plugins: { legend: { position: 'left', labels:{boxWidth:10} } } }
        });
    } else {
        const sortedDays = Object.keys(dayMap).sort();
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedDays,
                datasets: [{ label: '支出', data: sortedDays.map(d=>dayMap[d]), borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', fill: true, tension: 0.3 }]
            },
            options: { ...commonOptions, plugins: { legend: { display: false } } }
        });
    }
}

// 批量操作 (增强版)
els.toggleBatch.onclick = () => {
    isBatchMode = !isBatchMode;
    els.list.classList.toggle('batch-mode', isBatchMode);
    els.batchBar.style.display = isBatchMode ? 'flex' : 'none';
    els.toggleBatch.classList.toggle('active', isBatchMode);
    // 显示/隐藏全选框
    els.selectAllWrapper.style.display = isBatchMode ? 'flex' : 'none';
    els.selectAllBox.checked = false;
};

// 全选功能
els.selectAllBox.onchange = (e) => {
    const checkboxes = document.querySelectorAll('.chk-box');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateBatchCount();
};

window.updateBatchCount = () => {
    const checked = document.querySelectorAll('.chk-box:checked').length;
    els.batchCount.innerText = `已选 ${checked}`;
};

window.batchAddTags = async () => {
    const newTags = els.batchTagInput.value.trim().split(/\s+/).filter(t => t);
    if(!newTags.length) return;
    const ids = getCheckedIds();
    if(!ids.length) return alert("请勾选记录");
    
    const batch = writeBatch(db);
    ids.forEach(id => {
        const item = allData.find(d => d.id === id);
        const uniqueTags = [...new Set([...(item.tags||[]), ...newTags])].filter(t => t.trim() !== '');
        batch.update(doc(db, "expenses", id), { tags: uniqueTags });
    });
    await batch.commit();
    exitBatch();
};

window.batchRemoveTags = async () => {
    const removeTags = els.batchTagInput.value.trim().split(/\s+/);
    if(!removeTags[0]) return alert("请输入要删除的标签名");
    const ids = getCheckedIds();
    if(!ids.length) return alert("请勾选记录");

    const batch = writeBatch(db);
    ids.forEach(id => {
        const item = allData.find(d => d.id === id);
        if(!item.tags) return;
        const leftTags = item.tags.filter(t => !removeTags.includes(t));
        batch.update(doc(db, "expenses", id), { tags: leftTags });
    });
    await batch.commit();
    exitBatch();
}

window.batchDelete = async () => {
    if(!confirm("确定批量删除?")) return;
    const ids = getCheckedIds();
    const batch = writeBatch(db);
    ids.forEach(id => batch.delete(doc(db, "expenses", id)));
    await batch.commit();
    exitBatch();
};

function getCheckedIds() { return Array.from(document.querySelectorAll('.chk-box:checked')).map(c => c.value); }
function exitBatch() { els.toggleBatch.click(); }

// 7. 保存逻辑 (增强标签清洗)
els.saveBtn.addEventListener('click', async () => {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value;
    const date = els.date.value;
    // 自动过滤空标签
    const tags = els.tags.value.split(/\s+/).filter(t => t.trim() !== '');
    
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

els.aiBtn.addEventListener('click', async () => {
    const text = els.aiInput.value;
    if(!text) return;
    els.aiBtn.innerText = "⏳..."; els.aiBtn.disabled = true;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview"});
        const prompt = `分析: "${text}". 参考:${new Date().toLocaleString()}. 
        要求:
        1. category 从 [餐饮,交通,购物,娱乐,居住,医疗,教育,人情,工资,兼职,理财,礼金,报销,其他收入] 选。
        2. tags 提取物品或动作.
        3. date YYYY-MM-DDTHH:mm.
        返回JSON: {"amount":0,"category":"","tags":[],"desc":"","date":""}`;
        
        const res = await model.generateContent(prompt);
        const data = JSON.parse(res.response.text().replace(/```json|```/g,'').trim());
        
        els.amount.value = data.amount; els.cat.value = data.category;
        els.desc.value = data.desc; if(data.date) els.date.value = data.date;
        if(data.tags) els.tags.value = data.tags.join(' ');
        
        els.saveBtn.click();
        els.aiInput.value = '';
    } catch(e) { alert('AI失败'); }
    finally { els.aiBtn.innerText = "✨ 识别并保存"; els.aiBtn.disabled = false; }
});

// 编辑与删除
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
    switchInput('manual');
};

// 修复删除：阻止冒泡
window.deleteItem = (id, event) => {
    if (event) event.stopPropagation();
    if(confirm('删除?')) deleteDoc(doc(db, "expenses", id));
};

window.cancelEdit = () => {
    editingId = null;
    els.saveBtn.innerText = "记一笔";
    els.cancelBtn.style.display = "none";
    els.amount.value = ''; els.desc.value = ''; els.tags.value = '';
};
window.switchInput = (mode) => {
    document.querySelectorAll('.input-mode').forEach(d => d.style.display = 'none');
    document.getElementById(`mode-${mode}`).style.display = 'block';
};
window.switchChart = (type) => { currentChartType = type; render(); };
[els.dateStart, els.dateEnd, els.searchInput].forEach(el => el.addEventListener('input', render));
