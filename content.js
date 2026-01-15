(function () {
  console.log("🚀 DivMagic Content Script Loaded (v_fix_html_output)");
  let lastHover = null;
  let selectionActive = false;
  let overlay, tagNameBadge;

  // 移除 replaceSvgsWithPlaceholders 和 restoreSvgs 函数

  // 初始化 UI (Overlay)
  function initUI() {
    if (document.querySelector(".divmagic-overlay")) return;
    const style = document.createElement("style");
    style.textContent = `
      .divmagic-overlay {
        position: fixed; z-index: 2147483647; border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.1); pointer-events: none;
        transition: all 0.1s ease; display: none; box-sizing: border-box;
      }
      .divmagic-badge {
        position: fixed; z-index: 2147483647; background: #3b82f6; color: white;
        padding: 2px 6px; font-size: 12px; border-radius: 4px;
        font-family: monospace; pointer-events: none; display: none;
      }
    `;
    document.head.appendChild(style);
    overlay = document.createElement("div");
    overlay.className = "divmagic-overlay";
    document.body.appendChild(overlay);
    tagNameBadge = document.createElement("div");
    tagNameBadge.className = "divmagic-badge";
    document.body.appendChild(tagNameBadge);
  }

  function updateOverlay(el) {
    if (!el || !overlay) return;
    const rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    if (tagNameBadge) {
      tagNameBadge.textContent = `<${el.tagName.toLowerCase()}>`;
      tagNameBadge.style.display = "block";
      tagNameBadge.style.top = rect.top - 24 + "px";
      tagNameBadge.style.left = rect.left + "px";
    }
  }

  // 监听激活
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_PICKER") {
      selectionActive = true;
      console.log("👉 Picker Active");
    }
  });

  // 鼠标移动
  document.addEventListener("mousemove", (e) => {
    if (!selectionActive) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el.className === "divmagic-overlay") return;
    if (el !== lastHover) {
      lastHover = el;
      updateOverlay(el);
    }
  });

  // 辅助函数
  function cropAndDownload(base64, rect) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = window.devicePixelRatio;
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        rect.left * scale,
        rect.top * scale,
        rect.width * scale,
        rect.height * scale,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const link = document.createElement("a");
      link.download = "divmagic-tree.png";
      link.href = canvas.toDataURL();
      link.click();
    };
    img.src = base64;
  }

  function copyToClipboard(text) {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }

  // 🔥🔥🔥 点击事件 (升级版：Tree Capture) 🔥🔥🔥
  document.addEventListener(
    "click",
    async (e) => {
      if (!selectionActive || !lastHover) return;
      e.preventDefault();
      e.stopPropagation();

      const targetEl = lastHover;
      const rect = targetEl.getBoundingClientRect();
      console.log("🎯 Selected Root:", targetEl);

      // 1. 隐藏 UI 并截图
      overlay.style.display = "none";
      tagNameBadge.style.display = "none";
      selectionActive = false;
      await new Promise((r) => setTimeout(r, 50));

      // 立即尝试打开 SidePanel (为了防止后续异步操作丢失用户手势上下文)
      chrome.runtime.sendMessage({ type: "DEMO_ELEMENT_SELECTED" });

      // 截图任务
      chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" }, (res) => {
        if (res?.success) cropAndDownload(res.dataUrl, rect);
      });

      // 2. CDP 抓取任务 (Tree Mode)
      const uniqueId = "dm-tree-" + Date.now();
      targetEl.setAttribute("data-divmagic-id", uniqueId);

      // 显示一个简单的 loading 提示 (可选)
      // alert("Fetching component tree... please wait...");

      chrome.runtime.sendMessage(
        {
          type: "CDP_GET_STYLE", // type 不变，但 Background 逻辑变了
          selector: `[data-divmagic-id="${uniqueId}"]`,
        },
        (response) => {
          targetEl.removeAttribute("data-divmagic-id");

          if (response && response.success) {
            console.log("✅ [TREE DATA RECEIVED] 👇");
            console.log(response.data); // 这里的 data 是一个包含几十个节点的数组

            // 🔥 核心修正：V12 返回的是字符串，不再是 { styles: ... } 对象
            const htmlOutput = response.data;
            console.log("Payload Length:", htmlOutput ? htmlOutput.length : 0);

            if (!htmlOutput) {
              console.error("❌ CDP Response Data is empty!");
              alert("抓取失败: 获取到的 HTML 为空");
              return;
            }

            console.log("🔌 正在建立长连接 (AI Stream Port)...");
            const port = chrome.runtime.connect({ name: "AI_STREAM_PORT" });

            // 监听结果
            let accumulatedText = "";

            port.onMessage.addListener((aiResponse) => {
              // --- 1. 处理流式消息 ---
              if (aiResponse.type === "STREAM_START") {
                console.log("🌊 [Content] 流式传输开始...");
                return;
              }

              if (aiResponse.type === "STREAM_CHUNK") {
                const chunkText = aiResponse.chunk || "";
                accumulatedText += chunkText;
                console.log(`🌊 [Content] Chunk: ${chunkText.length} chars`);
                return;
              }

              if (
                aiResponse.type === "KEEP_ALIVE" ||
                aiResponse.type === "STREAM_DONE"
              ) {
                return;
              }

              // --- 2. 处理最终结果 ---
              if (aiResponse.success) {
                console.log("🤖 AI 响应成功。");
                // 优先使用流式累积的文本，如果没有则回退到一次性 data
                const finalHtml = accumulatedText || aiResponse.data;

                alert(
                  `✅ 流程测试成功！\n1. CDP 样式树采集完成\n2. AI 重建完成 (纯 JSON 模式)\n\nSidebar 已更新预览！`
                );

                // 更新 SidePanel
                chrome.runtime.sendMessage({
                  type: "UPDATE_CODE_WITH_REAL_DATA",
                  html: finalHtml,
                });

                // 任务完成，断开连接
                port.disconnect();
              } else if (aiResponse.success === false) {
                console.error("❌ AI 处理失败:", aiResponse.error);
                alert("AI 处理失败: " + (aiResponse.error || "Unknown error"));
                port.disconnect();
              }
            });

            // 发送数据 (不再需要 html 字段，因为 AI 只看 styles JSON)
            port.postMessage({
              type: "TEST_AI_SVG_FLOW",
              styles: htmlOutput, // 这里名字叫 styles 其实存的是 HTML 字符串，为了兼容 background 不用改名
            });

            /* 
            alert(
              `✅ 抓取成功！共获取 ${response.data.length} 个节点样式。\nJSON 已复制到剪贴板。`
            ); 
            */
          } else {
            console.error("❌ CDP Failed:", response);
            alert("抓取失败: " + response?.error);
          }
        }
      );
    },
    true
  );

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUI);
  } else {
    initUI();
  }
})();
