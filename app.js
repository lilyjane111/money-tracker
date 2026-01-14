import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, Timestamp } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ---------------- 配置 (已保留你的 Key) ----------------
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

// ---------------- 状态管理 ----------------
let allData = []; // 存所有数据
let chartInstance = null; // 图表实例
let currentChartType = 'pie'; // 'pie' 或 'line'
let editingId = null;

// DOM 元素
const els = {
    monthFilter: document.getElementById('month-filter'),
    searchInput: document.getElementById('search-input'),
    catFilter: document.getElementById('filter-cat'),
    list: document.getElementById('list'),
    statExp: document.getElementById('stat-expense'),
    statInc: document.getElementById('stat-income'),
    statBal: document.getElementById('stat-balance'),
    chartCanvas: document.getElementById('mainChart'),
    // 输入相关
    date: document.getElementById('date-input'),
    cat: document.getElementById('category-input'),
    desc: document.getElementById('desc-input'),
    amount: document.getElementById('amount-input'),
    saveBtn: document.getElementById('save-btn'),
    cancelBtn: document.getElementById('cancel-edit-btn'),
    // AI
    aiInput: document.getElementById('ai-input'),
    aiBtn: document.getElementById('ai-btn')
};

// 1. 初始化月份选择器 (默认为当前月)
const now = new Date();
const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
els.monthFilter.value = currentMonthStr;

// 2. 监听数据库 (一次性拉取所有，前端做筛选，体验最丝滑)
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));

onSnapshot(q, (snapshot) => {
    allData = [];
    snapshot.forEach(doc => {
        allData.push({ id: doc.id, ...doc.data() });
    });
    render(); // 数据回来后渲染
});

// 3. 渲染核心函数 (筛选 + 统计 + 列表 + 图表)
function render() {
    // A. 获取筛选条件
    const selectedMonth = els.monthFilter.value; // "2026-01"
    const keyword = els.searchInput.value.trim().toLowerCase();
    const selectedCat = els.catFilter.value;

    // B. 过滤数据
    const filtered = allData.filter(item => {
        const itemMonth = item.date.slice(0, 7); // "2026-01-12T..." -> "2026-01"
        const matchMonth = itemMonth === selectedMonth;
        const matchKey = item.desc.toLowerCase().includes(keyword);
        const matchCat = selectedCat === 'all' || item.category === selectedCat;
        return matchMonth && matchKey && matchCat;
    });

    // C. 计算统计
    let exp = 0, inc = 0;
    const catMap = {}; // 分类统计 for 饼图
    const dayMap = {}; // 日期统计 for 折线图

    // 初始化当月每一天 (为了折线图连续)
    if (currentChartType === 'line') {
        const [y, m] = selectedMonth.split('-');
        const daysInMonth = new Date(y, m, 0).getDate();
        for(let i=1; i<=daysInMonth; i++) dayMap[i] = 0; 
    }

    filtered.forEach(item => {
        const val = Math.abs(item.amount);
        if (item.category === '工资') {
            inc += val;
        } else {
            exp += val;
            // 饼图数据
            catMap[item.category] = (catMap[item.category] || 0) + val;
            // 折线图数据
            const day = new Date(item.date).getDate();
            dayMap[day] = (dayMap[day] || 0) + val;
        }
    });

    // 更新顶部卡片
    els.statExp.innerText = `¥${exp.toFixed(2)}`;
    els.statInc.innerText = `¥${inc.toFixed(2)}`;
    els.statBal.innerText = `¥${(inc - exp).toFixed(2)}`;

    // D. 渲染列表
    els.list.innerHTML = filtered.length ? '' : '<li style="justify-content:center;color:#999">本月无符合条件的记录</li>';
    
    filtered.forEach(item => {
        const d = new Date(item.date);
        const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const isInc = item.category === '工资';
        const emoji = { "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", "工资":"💰", "其他":"📝" }[item.category] || "📝";

        const li = document.createElement('li');
        li.innerHTML = `
            <div class="li-main">
                <div class="li-icon">${emoji}</div>
                <div class="li-content">
                    <h5>${item.desc}</h5>
                    <p>${timeStr} · ${item.category}</p>
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

    // E. 渲染图表
    renderChart(catMap, dayMap);
}

// 4. 图表渲染逻辑
function renderChart(catMap, dayMap) {
    if (chartInstance) chartInstance.destroy(); // 销毁旧图表

    const ctx = els.chartCanvas.getContext('2d');
    
    if (currentChartType === 'pie') {
        // --- 饼图 ---
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
        // --- 折线图 (每日趋势) ---
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Object.keys(dayMap).map(d => `${d}日`),
                datasets: [{
                    label: '每日支出',
                    data: Object.values(dayMap),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// 5. 事件监听 (筛选器变化时自动重绘)
[els.monthFilter, els.searchInput, els.catFilter].forEach(el => {
    el.addEventListener('input', render);
});

// 6. Tab 切换 (手动/AI)
window.switchInput = (mode) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.input-mode').forEach(d => d.style.display = 'none');
    event.target.classList.add('active');
    document.getElementById(`mode-${mode}`).style.display = mode === 'manual' ? 'block' : 'flex';
};

// 7. 图表切换 (饼图/趋势)
window.switchChart = (type) => {
    currentChartType = type;
    document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    render(); // 重绘
};

// 8. 数据保存/编辑逻辑 (基本没变)
const setTime = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    els.date.value = d.toISOString().slice(0, 16);
};
setTime();

els.saveBtn.addEventListener('click', async () => {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value;
    const date = els.date.value;
    if(!amount || !desc) return alert('请补全信息');
    
    const payload = { amount, desc, category: els.cat.value, date, timestamp: new Date(date).getTime() };
    els.saveBtn.disabled = true;
    
    try {
        if(editingId) {
            await updateDoc(doc(db, "expenses", editingId), payload);
            cancelEdit();
        } else {
            await addDoc(collection(db, "expenses"), { ...payload, createdAt: Timestamp.now() });
            resetForm();
        }
    } catch(e) { console.error(e); } 
    finally { els.saveBtn.disabled = false; }
});

// AI 逻辑 (保留之前的)
els.aiBtn.addEventListener('click', async () => {
    const text = els.aiInput.value;
    if(!text) return;
    els.aiBtn.innerText = "⏳..."; els.aiBtn.disabled = true;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview"});
        const prompt = `分析记账: "${text}". 参考时间:${new Date().toLocaleString()}. 返回JSON {"amount":0,"category":"","desc":"","date":"YYYY-MM-DDTHH:mm"}`;
        const res = await model.generateContent(prompt);
        const data = JSON.parse(res.response.text().replace(/```json|```/g,'').trim());
        els.amount.value = data.amount; els.cat.value = data.category;
        els.desc.value = data.desc; if(data.date) els.date.value = data.date;
        els.saveBtn.click();
        els.aiInput.value = '';
    } catch(e) { alert('AI失败'); }
    finally { els.aiBtn.innerText = "✨ 识别并保存"; els.aiBtn.disabled = false; }
});

// 编辑与删除
function editItem(item) {
    editingId = item.id;
    els.saveBtn.innerText = "确认修改";
    els.cancelBtn.style.display = "inline-block";
    els.amount.value = item.amount;
    els.desc.value = item.desc;
    els.cat.value = item.category;
    els.date.value = item.date;
    // 切换到手动 Tab
    switchInput('manual');
    document.querySelector('.tab-btn').click();
}

function deleteItem(id) {
    if(confirm('删除?')) deleteDoc(doc(db, "expenses", id));
}

function cancelEdit() {
    editingId = null;
    els.saveBtn.innerText = "记一笔";
    els.cancelBtn.style.display = "none";
    resetForm();
}
function resetForm() {
    els.amount.value = ''; els.desc.value = ''; setTime();
}
window.cancelEdit = cancelEdit; // 暴露给全局按钮
