// sidepanel.js

// ==========================================
// 1. 预设数据 (React + Tailwind 示例)
// ==========================================
const DEMO_DATA = {
  palette: [
    { name: "Primary", value: "#3b82f6", variable: "--primary" },
    { name: "Secondary", value: "#64748b", variable: "--secondary" },
  ],

  // 🔥 这是一个 React 组件代码示例
  code_html: `import React from 'react';
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-8 max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl border border-gray-100">
      <div className="uppercase tracking-wide text-sm text-indigo-500 font-semibold">Demo Component</div>
      <p className="mt-2 text-slate-500">这是一个在浏览器中实时编译的 React 组件，使用了 Tailwind CSS。</p>
      
      <div className="mt-4 flex items-center gap-4">
        <button 
          onClick={() => setCount(c => c + 1)}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
        >
          点击次数: {count}
        </button>
      </div>
    </div>
  );
}`,
};

// ==========================================
// 2. 渲染逻辑 (PostMessage 到 Iframe)
// ==========================================
function renderDemo(rawCode = null) {
  const codeToRender = rawCode || DEMO_DATA.code_html;

  // A. 渲染代码编辑器
  const editor = document.getElementById("code-editor");
  if (editor) {
    editor.textContent = codeToRender;
  }

  // B. 发送给 Iframe 渲染
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    // 清洗代码：去除 Markdown 代码块标记
    const cleanedCode = cleanCode(codeToRender);

    // 发送消息
    // 注意：如果是第一次加载，iframe 可能还没这就绪。
    // 实际生产中可能需要监听 iframe 的 load 事件，或者重试。
    // 这里简单处理：如果 iframe 已经加载完，直接发；否则等一下。
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "RENDER", code: cleanedCode },
        "*"
      );
    } else {
      iframe.onload = () => {
        iframe.contentWindow.postMessage(
          { type: "RENDER", code: cleanedCode },
          "*"
        );
      };
    }
  }
}

// 简单的代码清洗工具
function cleanCode(code) {
  if (!code) return "";
  // 去除 ```jsx ... ``` 或 ```javascript ... ```
  return code.replace(/^```(jsx|javascript|js|tsx)?\n/, "").replace(/```$/, "");
}

// ==========================================
// 3. 核心监听逻辑
// ==========================================
chrome.runtime.onMessage.addListener((msg) => {
  if (
    msg.type === "DEMO_ELEMENT_SELECTED" ||
    msg.type === "UPDATE_CODE_WITH_REAL_DATA"
  ) {
    // 假设 msg.html 现在包含了 AI 生成的 React 代码
    renderDemo(msg.html || msg.code);
  }
});

// ==========================================
// 4. 初始化和事件绑定
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // 1. 初始化 Tab 切换
  const tabs = document.querySelectorAll(".view-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll("#preview-panel, #code-panel")
        .forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-target");
      document.getElementById(targetId).classList.add("active");
    });
  });

  // 2. 初始渲染 Demo
  // 给 iframe 一点时间加载 React 环境
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    iframe.onload = () => {
      renderDemo();
    };
  } else {
    setTimeout(renderDemo, 500);
  }
});
