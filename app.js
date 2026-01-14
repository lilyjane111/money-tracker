import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, Timestamp } 
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

// --- 预设快捷项 (你可以自己改这里) ---
const QUICK_ACTIONS = [
    { label: "⚡️充电1元", amt: 1, desc: "电动车充电", cat: "交通", tags: "充电" },
    { label: "☕️冰美式", amt: 9.9, desc: "瑞幸冰美式", cat: "餐饮", tags: "咖啡 瑞幸" },
    { label: "🍔麦当劳", amt: 30, desc: "麦当劳套餐", cat: "餐饮", tags: "午餐 麦当劳" },
    { label: "🚇地铁", amt: 5, desc: "通勤地铁", cat: "交通", tags: "地铁 通勤" }
];

const els = {
    monthFilter: document.getElementById('month-filter'),
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
    // AI
    aiInput: document.getElementById('ai-input'),
    aiBtn: document.getElementById('ai-btn'),
    quickActions: document.getElementById('quick-actions')
};

// 1. 初始化
const now = new Date();
els.monthFilter.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

// 设置当前时间（只在页面加载时执行一次，保存后不重置！）
const setTime = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    els.date.value = d.toISOString().slice(0, 16);
};
setTime();

// 生成快捷按钮
els.quickActions.innerHTML = QUICK_ACTIONS.map((q, i) => 
    `<div class="qt-chip" onclick="applyQuick(${i})">${q.label}</div>`
).join('');

window.applyQuick = (idx) => {
    const q = QUICK_ACTIONS[idx];
    els.amount.value = q.amt;
    els.desc.value = q.desc;
    els.cat.value = q.cat;
    els.tags.value = q.tags;
};

// 2. 监听数据
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
onSnapshot(q, (snapshot) => {
    allData = [];
    snapshot.forEach(doc => allData.push({ id: doc.id, ...doc.data() }));
    render();
});

// 3. 渲染
function render() {
    const selectedMonth = els.monthFilter.value;
    const keyword = els.searchInput.value.trim().toLowerCase();

    const filtered = allData.filter(item => {
        const itemMonth = item.date.slice(0, 7);
        const matchMonth = itemMonth === selectedMonth;
        // 搜索逻辑：搜备注 OR 搜标签
        const tagStr = (item.tags || []).join(' ').toLowerCase();
        const matchKey = item.desc.toLowerCase().includes(keyword) || tagStr.includes(keyword);
        return matchMonth && matchKey;
    });

    // 统计
    let exp = 0, inc = 0;
    const catMap = {}; 
    const dayMap = {};
    if (currentChartType === 'line') {
        const [y, m] = selectedMonth.split('-');
        const days = new Date(y, m, 0).getDate();
        for(let i=1; i<=days; i++) dayMap[i] = 0; 
    }

    filtered.forEach(item => {
        const val = Math.abs(item.amount);
        if (item.category === '工资') inc += val;
        else {
            exp += val;
            catMap[item.category] = (catMap[item.category] || 0) + val;
            const day = new Date(item.date).getDate();
            dayMap[day] = (dayMap[day] || 0) + val;
        }
    });

    els.statExp.innerText = `¥${exp.toFixed(2)}`;
    els.statInc.innerText = `¥${inc.toFixed(2)}`;
    els.statBal.innerText = `¥${(inc - exp).toFixed(2)}`;

    // 列表
    els.list.innerHTML = filtered.length ? '' : '<li style="justify-content:center;color:#999">空空如也</li>';
    filtered.forEach(item => {
        const d = new Date(item.date);
        const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const isInc = item.category === '工资';
        const emoji = { "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", "工资":"💰", "其他":"📝" }[item.category] || "📝";
        
        // 渲染标签
        const tagHtml = (item.tags || []).map(t => `<span class="tag-pill">#${t}</span>`).join('');

        const li = document.createElement('li');
        li.innerHTML = `
            <div class="li-main">
                <div class="li-icon">${emoji}</div>
                <div class="li-content">
                    <h5>${item.desc}</h5>
                    <div class="li-tags">${tagHtml}</div>
                    <div class="li-time">${timeStr} · ${item.category}</div>
                </div>
            </div>
            <div class="li-right">
                <div class="li-money" style="color:${isInc?'#10b981':'#1f2937'}">
                    ${isInc?'+':'-'}¥${Math.abs(item.amount).toFixed(2)}
                </div>
                <div class="li-btns">
                    <span class="btn-edit">✏️</span>
                    <span class="btn-del">🗑️</span>
                </div>
            </div>
        `;
        els.list.appendChild(li);
        li.querySelector('.btn-edit').addEventListener('click', () => editItem(item));
        li.querySelector('.btn-del').addEventListener('click', () => deleteItem(item.id));
    });

    renderChart(catMap, dayMap);
}

function renderChart(catMap, dayMap) {
    if (chartInstance) chartInstance.destroy();
    const ctx = els.chartCanvas.getContext('2d');
    
    if (currentChartType === 'pie') {
        chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{
                    data: Object.values(catMap),
                    backgroundColor: ['#ff9a9e', '#fad0c4', '#a18cd1', '#fbc2eb', '#8fd3f4', '#84fab0'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    } else {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Object.keys(dayMap).map(d => `${d}日`),
                datasets: [{
                    label: '支出趋势',
                    data: Object.values(dayMap),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true, tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

[els.monthFilter, els.searchInput].forEach(el => el.addEventListener('input', render));

window.switchInput = (mode) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.input-mode').forEach(d => d.style.display = 'none');
    event.target.classList.add('active');
    document.getElementById(`mode-${mode}`).style.display = 'block';
};

window.switchChart = (type) => {
    currentChartType = type;
    document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    render();
};

els.saveBtn.addEventListener('click', async () => {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value;
    const date = els.date.value;
    // 处理标签：字符串转数组 (空格分开)
    const tagStr = els.tags.value.trim();
    const tags = tagStr ? tagStr.split(/\s+/) : [];

    if(!amount || !desc) return alert('请补全信息');
    
    const payload = { amount, desc, category: els.cat.value, tags, date, timestamp: new Date(date).getTime() };
    els.saveBtn.disabled = true;
    
    try {
        if(editingId) {
            await updateDoc(doc(db, "expenses", editingId), payload);
            cancelEdit();
        } else {
            await addDoc(collection(db, "expenses"), { ...payload, createdAt: Timestamp.now() });
            // 保存成功后：不清空日期！不清空分类！只清空金额、备注和标签
            els.amount.value = '';
            els.desc.value = '';
            els.tags.value = '';
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
        // Prompt 升级：要求 AI 打标签
        const prompt = `分析: "${text}". 参考时间:${new Date().toLocaleString()}. 
        要求：
        1. category 从 [餐饮,交通,购物,娱乐,居住,工资,其他] 选。
        2. tags 是一个字符串数组，提取具体物品或动作，如 ["咖啡","瑞幸"] 或 ["充电","电动车"]。
        3. date 格式 YYYY-MM-DDTHH:mm。
        返回JSON: {"amount":0,"category":"","tags":[],"desc":"","date":""}`;
        
        const res = await model.generateContent(prompt);
        const data = JSON.parse(res.response.text().replace(/```json|```/g,'').trim());
        
        els.amount.value = data.amount; 
        els.cat.value = data.category;
        els.desc.value = data.desc; 
        if(data.date) els.date.value = data.date;
        // 填入标签
        if(data.tags && Array.isArray(data.tags)) els.tags.value = data.tags.join(' ');
        
        els.saveBtn.click();
        els.aiInput.value = '';
    } catch(e) { alert('AI失败'); console.log(e); }
    finally { els.aiBtn.innerText = "✨ 识别并保存"; els.aiBtn.disabled = false; }
});

function editItem(item) {
    editingId = item.id;
    els.saveBtn.innerText = "确认修改";
    els.cancelBtn.style.display = "inline-block";
    els.amount.value = item.amount;
    els.desc.value = item.desc;
    els.cat.value = item.category;
    els.date.value = item.date;
    els.tags.value = (item.tags || []).join(' ');
    switchInput('manual');
}

function deleteItem(id) { if(confirm('删除?')) deleteDoc(doc(db, "expenses", id)); }

function cancelEdit() {
    editingId = null;
    els.saveBtn.innerText = "记一笔";
    els.cancelBtn.style.display = "none";
    els.amount.value = ''; els.desc.value = ''; els.tags.value = '';
    // 这里也不重置日期，保持用户习惯
}
window.cancelEdit = cancelEdit;
