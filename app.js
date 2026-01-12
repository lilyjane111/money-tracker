import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, Timestamp } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ---------------- 配置区域 (已保留你的 Key) ----------------
const firebaseConfig = {
    apiKey: "AIzaSyCksVETnuOvJ4PI8O_stW_cnnzj1VUjVV8",
    authDomain: "moneytracker-49e63.firebaseapp.com",
    projectId: "moneytracker-49e63",
    storageBucket: "moneytracker-49e63.firebasestorage.app",
    messagingSenderId: "58282938382",
    appId: "1:58282938382:web:eedff47ed4f87a2fdb2c5f"
};
const GEMINI_API_KEY = "AIzaSyAaJ74fB9wmOmPkgiEqs31_PgG0UykhejY";

// ---------------- 初始化 ----------------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// DOM 元素
const els = {
    date: document.getElementById('date-input'),
    cat: document.getElementById('category-input'),
    desc: document.getElementById('desc-input'),
    amount: document.getElementById('amount-input'),
    saveBtn: document.getElementById('save-btn'),
    cancelBtn: document.getElementById('cancel-edit-btn'),
    aiInput: document.getElementById('ai-input'),
    aiBtn: document.getElementById('ai-btn'),
    list: document.getElementById('list'),
    statExp: document.getElementById('stat-expense'),
    statInc: document.getElementById('stat-income'),
    statBal: document.getElementById('stat-balance'),
    expenseChartCanvas: document.getElementById('expenseChart')
};

let editingId = null;
let expenseChart = null; // 图表实例

// 默认时间
const setNow = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    els.date.value = now.toISOString().slice(0, 16);
};
setNow();

// ================= AI 逻辑 (保留并适配) =================
els.aiBtn.addEventListener('click', async () => {
    const text = els.aiInput.value.trim();
    if (!text) { alert("请先输入内容"); return; }
    
    const originalText = els.aiBtn.innerText;
    els.aiBtn.innerText = "🤖 分析中...";
    els.aiBtn.disabled = true;

    try {
        const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
        // 使用 gemini-1.5-flash 最稳
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        
        const prompt = `
            你是一个记账助手。参考时间：${nowStr}。
            用户输入："${text}"。
            请提取：
            1. amount (数字)
            2. category (从[餐饮,交通,购物,娱乐,居住,工资,其他]选，外卖日用品算购物，饭菜算餐饮)
            3. desc (简短备注)
            4. date (YYYY-MM-DDTHH:mm，推算时间，未提及用当前)
            返回JSON: {"amount":0,"category":"","desc":"","date":""}
        `;
        
        const result = await model.generateContent(prompt);
        const jsonStr = (await result.response).text().replace(/```json|```/g, '').trim();
        const data = JSON.parse(jsonStr);

        els.amount.value = data.amount;
        els.cat.value = data.category;
        els.desc.value = data.desc;
        if(data.date) els.date.value = data.date;
        
        await saveTransaction();
        els.aiInput.value = '';

    } catch (e) {
        console.error(e);
        alert("AI 识别失败");
    } finally {
        els.aiBtn.innerText = originalText;
        els.aiBtn.disabled = false;
    }
});

// ================= CRUD 逻辑 =================
async function saveTransaction() {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value.trim();
    const dateVal = els.date.value; 
    const category = els.cat.value;

    if (!amount || !desc) { alert("请补全信息"); return; }
    
    els.saveBtn.disabled = true;
    try {
        const payload = {
            amount, desc, category, date: dateVal,
            timestamp: new Date(dateVal).getTime()
        };

        if (editingId) {
            await updateDoc(doc(db, "expenses", editingId), payload);
            exitEditMode();
        } else {
            await addDoc(collection(db, "expenses"), { ...payload, createdAt: Timestamp.now() });
            resetForm();
        }
    } catch (e) {
        console.error(e);
    } finally {
        els.saveBtn.disabled = false;
    }
}

function resetForm() {
    els.amount.value = '';
    els.desc.value = '';
    setNow();
}

els.saveBtn.addEventListener('click', saveTransaction);

// ================= 核心：数据监听 & 图表渲染 =================
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));

onSnapshot(q, (snapshot) => {
    els.list.innerHTML = "";
    
    let totalExp = 0;
    let totalInc = 0;
    
    // 用于图表的数据统计
    const catStats = { "餐饮":0, "交通":0, "购物":0, "娱乐":0, "居住":0, "其他":0 };

    if(snapshot.empty) els.list.innerHTML = '<li style="justify-content:center;color:#ccc;padding:20px;">暂无记录</li>';

    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const id = docSnap.id;
        const val = Math.abs(data.amount);

        // 统计总数
        if (data.category === '工资') {
            totalInc += val;
        } else {
            totalExp += val;
            // 统计分类支出（用于图表）
            if (catStats[data.category] !== undefined) {
                catStats[data.category] += val;
            } else {
                catStats["其他"] += val;
            }
        }

        // 渲染列表项
        const dateObj = new Date(data.date);
        const timeStr = `${dateObj.getMonth()+1}/${dateObj.getDate()} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;
        const emojiMap = { "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", "工资":"💰", "其他":"📝" };
        const isInc = data.category === '工资';

        const li = document.createElement('li');
        li.innerHTML = `
            <div class="li-content">
                <div class="li-icon">${emojiMap[data.category]||'📝'}</div>
                <div class="li-text">
                    <h5>${data.desc}</h5>
                    <span>${timeStr} · ${data.category}</span>
                </div>
            </div>
            <div class="li-amount">
                <span class="amount-num" style="color:${isInc?'var(--success)':'var(--text)'}">
                    ${isInc?'+':'-'}¥${val.toFixed(2)}
                </span>
                <div class="amount-actions">
                    <button class="btn-xs btn-edit">改</button>
                    <button class="btn-xs btn-del">删</button>
                </div>
            </div>
        `;
        els.list.appendChild(li);

        li.querySelector('.btn-edit').addEventListener('click', () => enterEditMode(id, data));
        li.querySelector('.btn-del').addEventListener('click', async () => {
            if(confirm('删除?')) await deleteDoc(doc(db, "expenses", id));
        });
    });

    // 更新顶部卡片
    els.statExp.innerText = `¥${totalExp.toFixed(2)}`;
    els.statInc.innerText = `¥${totalInc.toFixed(2)}`;
    els.statBal.innerText = `¥${(totalInc - totalExp).toFixed(2)}`;

    // 更新图表
    updateChart(catStats);
});

// ================= 图表绘制逻辑 =================
function updateChart(stats) {
    // 准备数据
    const labels = Object.keys(stats);
    const data = Object.values(stats);
    
    // 如果还没创建图表，新建一个
    if (!expenseChart) {
        expenseChart = new Chart(els.expenseChartCanvas, {
            type: 'doughnut', // 甜甜圈图
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 10 } }
                }
            }
        });
    } else {
        // 如果已有图表，只更新数据
        expenseChart.data.datasets[0].data = data;
        expenseChart.update();
    }
}

// 编辑模式逻辑
function enterEditMode(id, data) {
    editingId = id;
    els.saveBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>'; // 变成更新图标
    els.saveBtn.classList.add("update-mode");
    els.cancelBtn.style.display = "inline-block";
    els.amount.value = data.amount;
    els.desc.value = data.desc;
    els.cat.value = data.category;
    els.date.value = data.date;
}

function exitEditMode() {
    editingId = null;
    els.saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    els.saveBtn.classList.remove("update-mode");
    els.cancelBtn.style.display = "none";
    resetForm();
}

els.cancelBtn.addEventListener('click', exitEditMode);
