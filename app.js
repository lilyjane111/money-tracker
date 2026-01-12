// 1. 引入 Firebase 和 Google AI
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, Timestamp } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ------------------------------------------------------------------
// 2. 配置区域 (已填好你的 Key)
// ------------------------------------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCksVETnuOvJ4PI8O_stW_cnnzj1VUjVV8",
    authDomain: "moneytracker-49e63.firebaseapp.com",
    projectId: "moneytracker-49e63",
    storageBucket: "moneytracker-49e63.firebasestorage.app",
    messagingSenderId: "58282938382",
    appId: "1:58282938382:web:eedff47ed4f87a2fdb2c5f"
};

// 你的 Gemini API Key
const GEMINI_API_KEY = "AIzaSyAaJ74fB9wmOmPkgiEqs31_PgG0UykhejY";

// 3. 初始化服务
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 4. 获取页面元素
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
    total: document.getElementById('total-amount')
};

// 状态变量：当前是否正在编辑模式 (null 表示新增模式，有 ID 表示正在编辑这个 ID)
let editingId = null;

// 设置默认时间为当前时间的函数 (修正时区偏移)
const setNow = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    els.date.value = now.toISOString().slice(0, 16);
};
// 初始化时先调用一次
setNow();

// ==========================================
// 🤖 功能一：Gemini AI 智能记账
// ==========================================
els.aiBtn.addEventListener('click', async () => {
    const text = els.aiInput.value.trim();
    if (!text) {
        alert("请先输入内容，例如：刚刚买奶茶花了 18 元");
        return;
    }

    // 按钮变身
    const originalBtnText = els.aiBtn.innerText;
    els.aiBtn.innerText = "🤖 AI 正在分析...";
    els.aiBtn.disabled = true;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        // Prompt (提示词)：教 AI 怎么做
        const prompt = `
            你是一个记账助手。请分析用户的话，提取：金额(纯数字)、分类(必须从[餐饮,交通,购物,娱乐,居住,工资,其他]中选最符合的一个)、备注(简短)。
            用户输入："${text}"
            
            请直接返回JSON格式，不要Markdown，格式范例：
            {"amount": 10.5, "category": "餐饮", "desc": "备注内容"}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonStr = response.text();
        
        // 清理 AI 可能返回的 ```json ``` 标记
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        // 填入输入框
        els.amount.value = data.amount;
        els.cat.value = data.category;
        els.desc.value = data.desc;
        
        // 自动触发保存
        await saveTransaction();
        
        // 清空 AI 输入框
        els.aiInput.value = ''; 

    } catch (error) {
        console.error("AI Error:", error);
        alert("AI 识别失败，请检查网络或手动输入。");
    } finally {
        // 恢复按钮
        els.aiBtn.innerText = originalBtnText;
        els.aiBtn.disabled = false;
    }
});

// ==========================================
// 💾 功能二：保存/更新数据 (支持回车)
// ==========================================
async function saveTransaction() {
    const amount = parseFloat(els.amount.value);
    const desc = els.desc.value.trim();
    const dateVal = els.date.value; 
    const category = els.cat.value;

    if (!amount || !desc) {
        alert("金额和备注不能为空");
        return;
    }

    // 按钮防止重复点击
    els.saveBtn.disabled = true;
    const btnText = els.saveBtn.innerText;
    els.saveBtn.innerText = "保存中...";

    try {
        const payload = {
            amount: amount,
            desc: desc,
            category: category, 
            date: dateVal, // 存字符串 "2023-10-10T12:00"
            timestamp: new Date(dateVal).getTime() // 存时间戳用于排序
        };

        if (editingId) {
            // --- 更新模式 ---
            await updateDoc(doc(db, "expenses", editingId), payload);
            console.log("更新成功");
            exitEditMode(); // 退出编辑模式
        } else {
            // --- 新增模式 ---
            await addDoc(collection(db, "expenses"), {
                ...payload,
                createdAt: Timestamp.now()
            });
            console.log("新增成功");
            // 重置表单
            els.amount.value = '';
            els.desc.value = '';
            setNow();
        }
        
    } catch (e) {
        console.error(e);
        alert("保存失败，请检查控制台");
    } finally {
        els.saveBtn.disabled = false;
        if(!editingId) els.saveBtn.innerText = "记一笔";
    }
}

// 绑定点击事件
els.saveBtn.addEventListener('click', saveTransaction);

// 绑定回车事件 (在备注或金额框按回车直接保存)
[els.desc, els.amount].forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveTransaction();
    });
});

// ==========================================
// 📝 功能三：实时列表渲染 & 编辑 & 删除
// ==========================================
const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));

onSnapshot(q, (snapshot) => {
    els.list.innerHTML = "";
    let total = 0;

    if(snapshot.empty) {
        els.list.innerHTML = '<li style="justify-content:center;color:#ccc;padding:20px;">还没有记录，快用 AI 记一笔吧！</li>';
    }

    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const id = docSnap.id;
        
        // 计算总金额
        // 如果是工资，不计入支出（或者反向计算，这里简单累加，视觉上区分）
        if (data.category !== '工资') {
            total += Math.abs(data.amount);
        } else {
            total -= Math.abs(data.amount); // 收入抵消支出
        }

        // 格式化时间：10月24日 14:30
        const dateObj = new Date(data.date);
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        const hour = String(dateObj.getHours()).padStart(2, '0');
        const min = String(dateObj.getMinutes()).padStart(2, '0');
        const timeStr = `${month}月${day}日 ${hour}:${min}`;

        // 分类图标映射
        const emojiMap = { "餐饮":"🍔", "交通":"🚗", "购物":"🛍️", "娱乐":"🎮", "居住":"🏠", "工资":"💰", "其他":"📝" };
        const emoji = emojiMap[data.category] || "📝";
        
        // 金额颜色：收入绿色，支出黑色
        const isIncome = data.category === '工资';
        const color = isIncome ? '#28a745' : '#333';
        const prefix = isIncome ? '+' : '';

        // 创建列表项
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="li-left">
                <div class="category-tag">${emoji}</div>
                <div class="details">
                    <span class="desc">${data.desc}</span>
                    <span class="time">${timeStr} · ${data.category}</span>
                </div>
            </div>
            <div class="li-right">
                <span class="money" style="color: ${color}">
                    ${prefix}¥${Math.abs(data.amount).toFixed(2)}
                </span>
                <div class="actions">
                    <button class="btn-mini btn-edit">编辑</button>
                    <button class="btn-mini btn-del">删除</button>
                </div>
            </div>
        `;
        els.list.appendChild(li);

        // 绑定该行的按钮事件
        li.querySelector('.btn-edit').addEventListener('click', () => enterEditMode(id, data));
        li.querySelector('.btn-del').addEventListener('click', () => deleteItem(id));
    });

    // 更新顶部总额
    els.total.innerText = `¥${total.toFixed(2)}`;
});

// --- 删除逻辑 ---
async function deleteItem(id) {
    if (confirm("确定要删除这条记录吗？")) {
        await deleteDoc(doc(db, "expenses", id));
        if (editingId === id) exitEditMode();
    }
}

// --- 进入编辑模式 ---
function enterEditMode(id, data) {
    editingId = id;
    els.saveBtn.innerText = "确认修改";
    els.saveBtn.classList.add("update-mode");
    els.cancelBtn.style.display = "inline-block";

    // 把数据填回输入框
    els.amount.value = data.amount;
    els.desc.value = data.desc;
    els.cat.value = data.category;
    els.date.value = data.date;

    // 滚回顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 退出编辑模式 ---
function exitEditMode() {
    editingId = null;
    els.saveBtn.innerText = "记一笔";
    els.saveBtn.classList.remove("update-mode");
    els.cancelBtn.style.display = "none";
    
    // 清空并重置时间
    els.amount.value = '';
    els.desc.value = '';
    setNow();
}

// 绑定取消按钮
els.cancelBtn.addEventListener('click', exitEditMode);
