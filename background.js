import { GoogleGenerativeAI } from "./google-sdk.js";
import { GEMINI_API_KEY } from "./config.js";

const debuggingTabs = new Set();

// ==========================================
// 1. 事件监听 (V50+ HUD 交互模式)
// ==========================================

// A. 点击图标 -> 激活 HUD
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  }, () => {
    chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_HUD" }).catch(e => console.log("Init HUD msg", e));
  });
});

// B. AI 流式端口
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "AI_STREAM_PORT") {
    console.log("🔗 [Background] AI Stream Port Connected");
    port.onMessage.addListener(async (msg) => {
      if (msg.type === "TEST_AI_SVG_FLOW") {
        await handleGeminiTestStream(msg, port);
      }
    });
  }
});

// C. 全局消息路由
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 1. HUD 请求打开 Sidepanel
  if (msg.type === "OPEN_SIDEPANEL") {
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id, windowId: sender.tab.windowId })
        .catch(console.error);
    }
    return;
  }

  // 2. 截图请求
  if (msg.type === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      sendResponse({
        success: !chrome.runtime.lastError,
        dataUrl,
        error: chrome.runtime.lastError?.message,
      });
    });
    return true;
  }

  // 3. CDP 样式采集 (核心入口)
  if (msg.type === "CDP_GET_STYLE") {
    handleCdpGetTreeStyles(msg, sender, sendResponse);
    return true;
  }
});

// ==========================================
// 2. AI 处理核心
// ==========================================
async function handleGeminiTestStream(msg, port) {
  const stylesData = msg.styles;

  if (GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
    port.postMessage({ success: false, error: "请配置 API Key" });
    return;
  }

  const prompt = `Role: Senior Frontend Engineer (Tailwind CSS Specialist).

Task: Reconstruct the provided **Augmented HTML** into a responsive React component.
Goal: 100% visual fidelity + 100% logical responsiveness.

🚨 DATA SOURCE PROTOCOL (STRICT PRIORITY):
1. **PRIORITY 1: \`data-rules\`**: Check CSS variables and logical widths (100%, 50%) here first.
2. **PRIORITY 2: \`computed-style\`**: Fallback for specific values.

⛔️ CRITICAL LAYOUT RULES:
1. **INTERACTIVE VISIBILITY**: Force \`z-10\` on absolute positioned interactive elements.
2. **SVG PURITY**: Keep SVG paths exact.
3. **RESPONSIVE WIDTH**: Prefer relative widths over fixed pixels.

OUTPUT FORMAT:
- Returns ONLY raw JSX code.
- Define component as \`const Component = () => { ... }\`.  <-- 🔥 把这一行加回来！
- No markdown.

INPUT HTML:
${stylesData}`;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: { temperature: 0.1 },
    });

    const result = await model.generateContentStream(prompt);
    port.postMessage({ type: "STREAM_START" });

    let fullText = "";
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      port.postMessage({ type: "STREAM_CHUNK", chunk: chunkText, text: chunkText });
    }

    const cleanAiText = fullText.replace(/^```(jsx|html|javascript)?\n/, "").replace(/```$/, "");
    port.postMessage({ type: "STREAM_DONE" });
    port.postMessage({ success: true, data: cleanAiText });
  } catch (error) {
    console.error("❌ SDK Error:", error);
    port.postMessage({ success: false, error: `SDK Error: ${error.message}` });
  }
}

// 辅助函数
function collectAllNodeIds(node, ids = []) {
  if (node.nodeId) ids.push(node.nodeId);
  if (node.children) node.children.forEach((child) => collectAllNodeIds(child, ids));
  return ids;
}

// ==========================================
// 3. CDP 核心逻辑 (V53.0: 采集 + AI 自动触发 + 模拟端口转发)
// ==========================================
async function handleCdpGetTreeStyles(msg, sender, sendResponse) {
  const tabId = sender.tab.id;
  const match = msg.selector.match(/data-divmagic-id="([^"]+)"/);
  const targetSelectorId = match ? match[1] : null;

  console.log(`⚖️ [Engine] Starting Capture for: ${targetSelectorId}`);

  try {
    // 1. 连接调试器
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      debuggingTabs.add(tabId);
    } catch (e) {
      if (!e.message.includes("already attached")) {
        try { await chrome.debugger.detach({ tabId }); } catch (_) { }
        await chrome.debugger.attach({ tabId }, "1.3");
      }
    }

    await sendDebuggerCommand(tabId, "DOM.enable");
    await sendDebuggerCommand(tabId, "CSS.enable");

    const doc = await sendDebuggerCommand(tabId, "DOM.getDocument", { depth: -1 });
    const rootNode = findNodeByAttributeValue(doc.root, "data-divmagic-id", targetSelectorId);

    if (!rootNode) throw new Error("Target node not found.");

    // 2. 强制 Hover
    const allNodeIds = collectAllNodeIds(rootNode);
    await Promise.all(allNodeIds.map((id) => sendDebuggerCommand(tabId, "CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: ["hover"] }).catch((e) => { })));
    await new Promise((r) => setTimeout(r, 100));

    // 3. 采集数据
    console.log("📸 Capturing Tree State...");
    const finalTree = await captureTreeState(tabId, rootNode);

    // 4. 获取尺寸
    let rootLayout = { width: "auto", height: "auto" };
    try {
      const boxModel = await sendDebuggerCommand(tabId, "DOM.getBoxModel", { nodeId: rootNode.nodeId });
      if (boxModel && boxModel.model) {
        rootLayout = { width: boxModel.model.width, height: boxModel.model.height };
      }
    } catch (e) { }

    // 5. 还原状态
    await Promise.all(allNodeIds.map((id) => sendDebuggerCommand(tabId, "CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: [] }).catch((e) => { })));

    console.log("📝 Serializing...");
    const htmlOutput = serializeTreeToHTML(finalTree);
    console.log(`✅ Complete. HTML Length: ${htmlOutput.length}`);

    // ============================================================
    // 🔥 修复 1: 发送一个“合法的” React 组件作为 Loading 占位符
    // ============================================================
    // 这样 preview.html 就不会报 ReferenceError 了
    const loadingComponent = `
      const Component = () => {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-4 p-8 text-slate-400">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-sm font-mono animate-pulse">AI is analyzing structure...</div>
          </div>
        );
      };
    `;

    const broadcastPayload = {
      type: "UPDATE_CODE_WITH_REAL_DATA",
      code: loadingComponent,
      layout: rootLayout
    };

    // 发送 Loading 状态 (多次尝试确保 Sidepanel 收到)
    chrome.runtime.sendMessage(broadcastPayload).catch(() => { });
    setTimeout(() => chrome.runtime.sendMessage(broadcastPayload).catch(() => { }), 500);

    // 回复 content script (让遮罩层恢复)
    sendResponse({ success: true, data: htmlOutput, layout: rootLayout });

    // ============================================================
    // 🔥 修复 2: 自动触发 AI (Internal Bridge)
    // ============================================================
    // 我们不需要等待 Content Script 再发请求，直接在这里调用 AI
    console.log("🚀 Triggering AI Internally...");

    // 创建一个“伪造”的 Port 对象，拦截 AI 的输出并转发给 Sidepanel
    let accumulatedText = "";
    const mockPort = {
      postMessage: (msg) => {
        // 如果是流式片段
        if (msg.type === "STREAM_CHUNK") {
          accumulatedText += (msg.chunk || msg.text || "");
          // 可选：实时把半成品代码发给 Sidepanel (这看起来很酷)
          // chrome.runtime.sendMessage({ 
          //    type: "UPDATE_CODE_WITH_REAL_DATA", 
          //    code: accumulatedText, 
          //    layout: rootLayout 
          // }).catch(()=>{});
        }
        // 如果是完成信号
        if (msg.type === "STREAM_DONE" || (msg.success && msg.data)) {
          const finalCode = msg.data || accumulatedText;
          console.log("🤖 AI Finished. Broadcasting Code.");

          // 发送最终代码给 Sidepanel
          chrome.runtime.sendMessage({
            type: "UPDATE_CODE_WITH_REAL_DATA",
            code: finalCode,
            layout: rootLayout
          }).catch((err) => console.warn("Sidepanel closed?", err));
        }
      }
    };

    // 立即执行 AI
    await handleGeminiTestStream({ styles: htmlOutput }, mockPort);

  } catch (error) {
    console.error("❌ CDP Error:", error);
    sendResponse({ success: false, error: error.message });
    cleanupDebugging(tabId);
  }
}

// 辅助：清洗 CSS
function purifyCssText(cssText) {
  if (!cssText) return "";
  return cssText
    .replace(/(margin|margin-top|margin-bottom|margin-left|margin-right)\s*:[^;]+;?/gi, '')
    .replace(/(top|left|right|bottom)\s*:[^;]+;?/gi, '')
    .replace(/(align|justify)-self\s*:[^;]+;?/gi, '');
}

// 递归采集
async function captureTreeState(tabId, node, parentComputedStyle = null, isRoot = true) {
  if (!node) return null;
  if (node.nodeType === 3) return node.nodeValue.trim() ? { type: "text", content: node.nodeValue.trim() } : null;
  if (node.nodeType !== 1) return null;

  const tagName = node.nodeName.toLowerCase();
  if (["script", "style", "noscript", "iframe", "comment"].includes(tagName)) return null;

  const styles = await fetchStylesForNode(tabId, node.nodeId, parentComputedStyle, isRoot);
  if (!styles) return null;

  let currentComputedStyle = styles.computedStyle;

  if (isRoot) {
    // 根节点净化
    ["margin", "top", "left", "right", "bottom", "alignSelf", "justifySelf"].forEach(k => delete currentComputedStyle[k]);
    ["marginTop", "marginBottom", "marginLeft", "marginRight"].forEach(k => delete currentComputedStyle[k]);

    if (styles.matchedRules) {
      styles.matchedRules = styles.matchedRules.map(rule => {
        if (rule.type !== "Inherited" && rule.type !== "RootVars") {
          return { ...rule, cssText: purifyCssText(rule.cssText) };
        }
        return rule;
      });
    }
  }

  if (tagName === "svg") {
    try {
      const outerObj = await sendDebuggerCommand(tabId, "DOM.getOuterHTML", { nodeId: node.nodeId });
      let svgHtml = outerObj.outerHTML
        .replace(/style="[^"]*"/gi, '')
        .replace(/width="[^"]*"/gi, '')
        .replace(/height="[^"]*"/gi, '');
      let cleanStyle = `width:${currentComputedStyle.width};height:${currentComputedStyle.height};${currentComputedStyle.color ? `color:${currentComputedStyle.color};fill:currentColor;` : ''}`;
      return { type: "svg_raw", html: svgHtml.replace('<svg', `<svg style="${cleanStyle}"`), computedStyle: currentComputedStyle };
    } catch (e) { return null; }
  }

  const children = [];
  if (node.pseudoElements) {
    for (const pseudo of node.pseudoElements) {
      const processed = await captureTreeState(tabId, pseudo, currentComputedStyle, false);
      if (processed) { processed.isPseudo = true; children.push(processed); }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const processed = await captureTreeState(tabId, child, currentComputedStyle, false);
      if (processed) children.push(processed);
    }
  }

  const finalTagName = tagName.startsWith("::") ? "div" : tagName;
  const finalAttributes = formatAttributes(node.attributes);
  if (tagName.startsWith("::")) finalAttributes["data-pseudo"] = tagName.replace("::", "");

  return {
    type: "element",
    tagName: finalTagName,
    attributes: finalAttributes,
    computedStyle: currentComputedStyle,
    matchedRules: styles.matchedRules,
    children
  };
}

function extractUsedVariables(cssText) {
  const vars = new Set();
  const regex = /var\((--[a-zA-Z0-9-_]+)[^)]*\)/g;
  let match;
  while ((match = regex.exec(cssText)) !== null) vars.add(match[1]);
  return vars;
}

function parseCssText(cssText) {
  const style = {};
  if (!cssText) return style;
  cssText.split(";").forEach(part => {
    const [key, ...valParts] = part.split(":");
    if (key && valParts.length) style[key.trim().toLowerCase()] = valParts.join(":").trim();
  });
  return style;
}

async function fetchStylesForNode(tabId, nodeId, parentComputedStyle, isRoot = false) {
  const result = { computedStyle: {}, matchedRules: [] };

  try {
    const computedResult = await sendDebuggerCommand(tabId, "CSS.getComputedStyleForNode", { nodeId });
    if (computedResult) {
      result.computedStyle = processComputedStyle(computedResult.computedStyle, parentComputedStyle, isRoot);
      // Root Vars Rescue
      if (isRoot) {
        const allVars = {};
        computedResult.computedStyle.forEach(p => { if (p.name.startsWith('--')) allVars[p.name] = p.value; });
        if (Object.keys(allVars).length > 0) {
          result.matchedRules.push({
            selector: ":root",
            cssText: Object.entries(allVars).map(([k, v]) => `${k}: ${v}`).join('; '),
            type: "RootVars"
          });
        }
      }
    }
  } catch (e) { return null; }

  try {
    const matchedResult = await sendDebuggerCommand(tabId, "CSS.getMatchedStylesForNode", { nodeId });
    if (matchedResult) {
      const ownRules = matchedResult.matchedCSSRules || [];
      const ownCssText = ownRules.map(r => r.rule.style.cssText).join(" ");
      const inlineStyleText = matchedResult.inlineStyle ? matchedResult.inlineStyle.cssText : "";
      const usedVars = new Set([...extractUsedVariables(ownCssText), ...extractUsedVariables(inlineStyleText)]);
      const ownProperties = new Set();

      const finalRules = [];
      ownRules.forEach(r => {
        if (r.rule.origin !== "user-agent") {
          finalRules.push({ selector: r.rule.selectorList.text, cssText: r.rule.style.cssText, type: "Own Rule" });
          Object.keys(parseCssText(r.rule.style.cssText)).forEach(k => ownProperties.add(k));
        }
      });

      if (matchedResult.inherited) {
        matchedResult.inherited.forEach(entry => {
          if (entry.matchedCSSRules) {
            entry.matchedCSSRules.forEach(r => {
              if (r.rule.origin === "user-agent") return;
              const props = parseCssText(r.rule.style.cssText);
              const clean = [];
              for (const [k, v] of Object.entries(props)) {
                if ((k.startsWith('--') && usedVars.has(k)) || (!k.startsWith('--') && !ownProperties.has(k))) {
                  clean.push(`${k}:${v}`);
                  if (!k.startsWith('--')) ownProperties.add(k);
                }
              }
              if (clean.length) finalRules.push({ selector: r.rule.selectorList.text + " (Inherited)", cssText: clean.join(';'), type: "Inherited" });
            });
          }
        });
      }
      result.matchedRules = [...result.matchedRules, ...finalRules];
    }
  } catch (e) { }
  return result;
}

function serializeTreeToHTML(node) {
  if (!node) return "";
  if (node.type === "text") return node.content;
  if (node.type === "svg_raw") return node.html;

  const tagName = node.tagName;
  const computedString = Object.entries(node.computedStyle || {}).map(([k, v]) => `${k}:${v}`).join(";");
  let rulesAttr = "", varsAttr = "";

  if (node.matchedRules) {
    let ownCss = "", inheritedVars = "";
    node.matchedRules.forEach(r => {
      if (r.type === "Inherited") {
        const vars = r.cssText.split(";").filter(s => s.trim().startsWith("--")).join(";");
        if (vars) inheritedVars += vars + "; ";
      } else {
        ownCss += `${r.selector} { ${r.cssText} } `;
      }
    });
    if (ownCss) rulesAttr = ` data-rules="${ownCss.replace(/"/g, "'").trim()}"`;
    if (inheritedVars) varsAttr = ` data-vars="${inheritedVars.replace(/"/g, "'").trim()}"`;
  }

  let otherAttrs = "";
  if (node.attributes) {
    Object.entries(node.attributes).forEach(([key, value]) => {
      if (key === "class" || key === "data-divmagic-id" || key === "style" || key.startsWith("on")) return;
      otherAttrs += ` ${key}="${String(value).replace(/"/g, "&quot;")}"`;
    });
  }

  const classAttr = node.attributes.class ? `class="${node.attributes.class}"` : "";
  return `<${tagName} ${classAttr} style="${computedString}" data-computed-style="${computedString}"${rulesAttr}${varsAttr}${otherAttrs}>${node.children.map(serializeTreeToHTML).join('')}</${tagName}>`;
}

function processComputedStyle(cdpStyleArray, parentStyleObj = null, isRoot = false) {
  const styleObj = {};
  const mustKeep = new Set(["display", "position", "width", "height", "top", "left", "bottom", "right", "z-index", "opacity", "transform", "margin", "padding"]);
  const isGarbage = (name, value) => {
    if (name.startsWith("--")) return !isRoot;
    if (name.startsWith("-webkit") || value === "auto" || value === "normal" || value === "none" || value === "0px" || value === "transparent") return true;
    return false;
  };

  cdpStyleArray.forEach(p => {
    if (!mustKeep.has(p.name) && isGarbage(p.name, p.value)) return;
    if (parentStyleObj && parentStyleObj[p.name] === p.value) return; // Simple inheritance check
    styleObj[p.name] = p.value;
  });
  return styleObj;
}

function formatAttributes(attrs) {
  if (!attrs) return {};
  const obj = {};
  for (let i = 0; i < attrs.length; i += 2) obj[attrs[i]] = attrs[i + 1];
  return obj;
}

function findNodeByAttributeValue(node, attrName, attrValue) {
  if (node.nodeType === 1 && node.attributes) {
    for (let i = 0; i < node.attributes.length; i += 2) {
      if (node.attributes[i] === attrName && node.attributes[i + 1] === attrValue) return node;
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByAttributeValue(child, attrName, attrValue);
      if (found) return found;
    }
  }
  return null;
}

async function sendDebuggerCommand(tabId, method, params) {
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}

async function cleanupDebugging(tabId) {
  if (debuggingTabs.has(tabId)) {
    try { await chrome.debugger.detach({ tabId }); } catch (e) { }
    debuggingTabs.delete(tabId);
  }
}
chrome.tabs.onRemoved.addListener(cleanupDebugging);