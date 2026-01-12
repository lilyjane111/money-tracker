// 1. 引入 Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ------------------------------------------------------------------
// 2. 配置区域 (已填入你的密钥)
// ------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCksVETnuOvJ4PI8O_stW_cnnzj1VUjVV8",
  authDomain: "moneytracker-49e63.firebaseapp.com",
  projectId: "moneytracker-49e63",
  storageBucket: "moneytracker-49e63.firebasestorage.app",
  messagingSenderId: "58282938382",
  appId: "1:58282938382:web:eedff47ed4f87a2fdb2c5f"
};

// 3. 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 4. 获取页面元素
const dateInput = document.getElementById('date-input');
const descInput = document.getElementById('desc-input');
const amountInput = document.getElementById('amount-input');
const addBtn = document.getElementById('add-btn');
const list = document.getElementById('list');
const totalAmount = document.getElementById('total-amount');

// 设置默认日期为今天
dateInput.valueAsDate = new Date();

// 5. 【增加功能】点击按钮，保存数据
addBtn.addEventListener('click', async () => {
    const desc = descInput.value;
    const amount = parseFloat(amountInput.value);
    const date = dateInput.value;

    if (desc.trim() === '' || isNaN(amount)) {
        alert('请填写用途和金额！');
        return;
    }

    // 按钮变色提示正在保存
    const originalText = addBtn.innerText;
    addBtn.innerText = "保存中...";
    addBtn.disabled = true;

    try {
        await addDoc(collection(db, "expenses"), {
            desc: desc,
            amount: amount,
            date: date,
            createdAt: new Date() // 用于排序
        });
        
        // 清空输入框
        descInput.value = '';
        amountInput.value = '';
        console.log("写入成功！");
    } catch (e) {
        console.error("写入出错: ", e);
        alert("保存失败！请确认你在 Firebase 控制台开启了 Firestore 数据库，并选择了'测试模式'。");
    } finally {
        addBtn.innerText = originalText;
        addBtn.disabled = false;
    }
});

// 6. 【读取功能】实时监听数据库变化
const q = query(collection(db, "expenses"), orderBy("createdAt", "desc"));

onSnapshot(q, (snapshot) => {
    list.innerHTML = ""; // 清空列表
    let total = 0;

    if (snapshot.empty) {
        list.innerHTML = '<li style="justify-content:center; color:#999;">还没有记账记录，快记一笔吧！</li>';
    }

    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const id = docSnap.id; // 获取文档ID，用于删除
        total += data.amount;

        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <div style="font-weight:bold;">${data.desc}</div>
                <div class="info">${data.date}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="money">¥${data.amount.toFixed(2)}</span>
                <button class="del-btn" data-id="${id}" style="background:#ff4d4f; padding:5px 8px; font-size:12px;">×</button>
            </div>
        `;
        list.appendChild(li);
    });

    // 更新总金额
    totalAmount.innerText = `¥${total.toFixed(2)}`;

    // 给所有删除按钮添加事件
    document.querySelectorAll('.del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('确定要删除这条记录吗？')) {
                const id = e.target.getAttribute('data-id');
                await deleteDoc(doc(db, "expenses", id));
            }
        });
    });
});
