import { GoogleGenerativeAI } from "./google-sdk.js";
import { GEMINI_API_KEY } from "./config.js";

const debuggingTabs = new Set();

// ==========================================
// 1. 基础事件监听
// ==========================================
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PICKER" });
  } catch (e) {
    console.warn("Content script not ready.", e);
  }
});

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "DEMO_ELEMENT_SELECTED") {
    if (sender.tab?.id) {
      chrome.sidePanel
        .open({ tabId: sender.tab.id, windowId: sender.tab.windowId })
        .catch(console.error);
    }
  }
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
  if (msg.type === "CDP_GET_STYLE") {
    handleCdpGetTreeStyles(msg, sender, sendResponse);
    return true;
  }
});

// ==========================================
// 2. AI 处理核心 (配合 V22 的逻辑 Prompt)
// ==========================================
async function handleGeminiTestStream(msg, port) {
  const stylesData = msg.styles;

  if (GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
    port.postMessage({ success: false, error: "请配置 API Key" });
    return;
  }

  const prompt = `Role: Pixel-Perfect HTML-to-Tailwind Converter.

Task: Convert the provided **Augmented HTML** into a React component.
Goal: 100% visual fidelity.

DATA CONTEXT:
The input was captured in a **FORCED HOVER STATE**.
- **Inline \`style\`**: Represents the element's FINAL state (including hover effects).
- **\`data-matched-rules\`**: Contains the transition logic.

STRATEGY:

1. **Z-INDEX (STRICT)**:
   - **DO NOT INVENT Z-INDEX values.** - Check the inline \`style\` or \`data-computed-style\`.
   - If \`z-index\` is \`auto\` or undefined -> **DO NOT** add a \`z-*\` class. Leave it as default.
   - If \`z-index\` is a number (e.g., \`3\`) -> Use \`z-[3]\` or \`z-30\` (Tailwind convention).
   - **Reason**: Adding arbitrary z-indexes breaks the natural DOM stacking order.

2. **LAYOUT & POSITION**:
   - Trust inline \`style\` implicitly. 
   - If \`style\` says \`width: 472px\`, use \`w-[472px]\`. Do not guess \`w-full\`.

3. **INTERACTION (Reverse Engineering)**:
   - Since input style shows the *Hover* state (e.g., \`transform: translateY(-32px)\`), you must check \`data-matched-rules\` to confirm this is a hover effect.
   - If confirmed, assume the *initial* state is \`transform-none\` (or whatever the base rule says).
   - Code pattern: \`transform-none hover:-translate-y-[32px]\`.

4. **SVG**:
   - Copy EXACTLY. Do NOT add \`stroke-width\` or \`stroke\` unless explicitly in the computed style.
   - If Input SVG path has attributes like \`stroke-width="1"\`, keep it. Don't change it to 2.

OUTPUT FORMAT:
- Returns raw JSX code.
- Define component as \`const Component = () => { ... }\`.
- No markdown.

INPUT HTML:
${stylesData}`;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-pro-preview",
      generationConfig: { temperature: 0.1 },
    });

    const result = await model.generateContentStream(prompt);
    port.postMessage({ type: "STREAM_START" });

    let fullText = "";
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      port.postMessage({
        type: "STREAM_CHUNK",
        chunk: chunkText,
        text: chunkText,
      });
    }

    const cleanAiText = fullText
      .replace(/^```(jsx|html|javascript)?\n/, "")
      .replace(/^```/, "")
      .replace(/```$/, "");
    port.postMessage({ type: "STREAM_DONE" });
    port.postMessage({ success: true, data: cleanAiText });
  } catch (error) {
    console.error("❌ SDK Error:", error);
    port.postMessage({ success: false, error: `SDK Error: ${error.message}` });
  }
}

// ==========================================
// 辅助函数：递归收集子树中所有节点的 ID
// ==========================================
function collectAllNodeIds(node, ids = []) {
  if (node.nodeId) {
    ids.push(node.nodeId);
  }
  if (node.children) {
    node.children.forEach((child) => collectAllNodeIds(child, ids));
  }
  return ids;
}

// ==========================================
// 3. CDP 核心逻辑 (V25.0 全员 Hover)
// ==========================================
async function handleCdpGetTreeStyles(msg, sender, sendResponse) {
  const tabId = sender.tab.id;
  // 提取 Selector ID
  const match = msg.selector.match(/data-divmagic-id="([^"]+)"/);
  const targetSelectorId = match ? match[1] : null;

  console.log(`⚖️ [Engine] Starting Capture for: ${targetSelectorId}`);

  try {
    // 1. 连接
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      debuggingTabs.add(tabId);
    } catch (e) {
      if (!e.message.includes("already attached")) {
        try {
          await chrome.debugger.detach({ tabId });
        } catch (_) {}
        await chrome.debugger.attach({ tabId }, "1.3");
      }
    }

    await sendDebuggerCommand(tabId, "DOM.enable");
    await sendDebuggerCommand(tabId, "CSS.enable");

    // 2. 定位根节点
    const doc = await sendDebuggerCommand(tabId, "DOM.getDocument", {
      depth: -1,
    }); // depth: -1 拿全量树
    const rootNode = findNodeByAttributeValue(
      doc.root,
      "data-divmagic-id",
      targetSelectorId
    );

    if (!rootNode) throw new Error("Target node not found.");
    console.log(`✅ Root Node Found ID: ${rootNode.nodeId}`);

    // 🔥 3. 圣诞树模式：强制所有节点 Hover 🔥
    // 这解决了“子元素独立 Hover 动画”丢失的问题
    const allNodeIds = collectAllNodeIds(rootNode);
    console.log(`⚡️ Forcing Hover on ${allNodeIds.length} nodes...`);

    // 并行发送指令，为了性能和稳定性，我们可以分批或者直接 Promise.all
    // 这里的 catch 是为了防止某个节点（比如 shadowRoot 里的）报错导致全盘崩溃
    await Promise.all(
      allNodeIds.map((id) =>
        sendDebuggerCommand(tabId, "CSS.forcePseudoState", {
          nodeId: id,
          forcedPseudoClasses: ["hover"],
        }).catch((e) => {})
      )
    );

    // 给浏览器一点喘息时间重算样式 (Layout Thrashing)
    await new Promise((r) => setTimeout(r, 100));

    // 4. 采集 (Inherited + Computed + Clean SVG + Full Rules)
    console.log("📸 Capturing Tree State (All-Hovered)...");
    const finalTree = await captureTreeState(tabId, rootNode);

    // 5. 还原状态 (打扫现场)
    // 同样需要递归还原，否则页面会乱套
    await Promise.all(
      allNodeIds.map((id) =>
        sendDebuggerCommand(tabId, "CSS.forcePseudoState", {
          nodeId: id,
          forcedPseudoClasses: [],
        }).catch((e) => {})
      )
    );

    // 6. 序列化
    console.log("📝 Serializing...");
    const htmlOutput = serializeTreeToHTML(finalTree);

    console.log(`✅ Complete.`);
    sendResponse({ success: true, data: htmlOutput });
  } catch (error) {
    console.error("❌ CDP Error:", error);
    sendResponse({ success: false, error: error.message });
    cleanupDebugging(tabId);
  }
}

async function captureTreeState(tabId, node) {
  if (!node) return null;
  if (node.nodeType === 3)
    return node.nodeValue.trim()
      ? { type: "text", content: node.nodeValue.trim() }
      : null;
  if (node.nodeType !== 1) return null;

  const tagName = node.nodeName.toLowerCase();
  if (["script", "style", "noscript", "iframe", "comment"].includes(tagName))
    return null;

  // 微小延时防丢包
  await new Promise((r) => setTimeout(r, 2));

  // 获取样式 (含 Inherited)
  const styles = await fetchStylesForNode(tabId, node.nodeId);
  if (!styles) return null;

  const attrs = formatAttributes(node.attributes);

  // SVG 处理 (V21 纯净版 - 无注入)
  if (tagName === "svg") {
    try {
      const outerObj = await sendDebuggerCommand(tabId, "DOM.getOuterHTML", {
        nodeId: node.nodeId,
      });
      let svgHtml = outerObj.outerHTML;

      // 仅做必要清洗
      svgHtml = svgHtml
        .replace(/style="[^"]*display:\s*none[^"]*"/gi, "")
        .replace(/display:\s*none;?/gi, "")
        .replace(/\bhidden\b/gi, "");

      // 注入 computed 颜色 (以防万一)，但不改 Path
      const computed = styles.computedStyle;
      let styleInj = "";
      if (computed.width && computed.width !== "auto")
        styleInj += `width:${computed.width};`;
      if (computed.height && computed.height !== "auto")
        styleInj += `height:${computed.height};`;
      if (computed.color)
        styleInj += `color:${computed.color}; fill:currentColor;`;

      if (svgHtml.includes('style="'))
        svgHtml = svgHtml.replace('style="', `style="${styleInj} `);
      else svgHtml = svgHtml.replace("<svg", `<svg style="${styleInj}"`);

      return { type: "svg_raw", html: svgHtml, computedStyle: computed };
    } catch (e) {
      return null;
    }
  }

  const children = [];
  if (node.children) {
    for (const child of node.children) {
      const processed = await captureTreeState(tabId, child);
      if (processed) children.push(processed);
    }
  }

  return {
    type: "element",
    tagName,
    attributes: attrs,
    computedStyle: styles.computedStyle,
    matchedRules: styles.matchedRules,
    children,
  };
}

async function fetchStylesForNode(tabId, nodeId) {
  const result = { computedStyle: {}, matchedRules: [] };

  // 1. Computed Style (V18.4 全量版)
  try {
    const computedResult = await sendDebuggerCommand(
      tabId,
      "CSS.getComputedStyleForNode",
      { nodeId }
    );
    if (computedResult)
      result.computedStyle = processComputedStyle(computedResult.computedStyle);
  } catch (e) {
    return null;
  }

  // 2. Matched Rules + Inherited (V23 完整版)
  try {
    const matchedResult = await sendDebuggerCommand(
      tabId,
      "CSS.getMatchedStylesForNode",
      { nodeId }
    );
    if (matchedResult) {
      const allRules = [];
      // 自身规则
      if (matchedResult.matchedCSSRules) {
        allRules.push(...matchedResult.matchedCSSRules);
      }
      // 🔥 继承规则 (DevTools 视角)
      if (matchedResult.inherited) {
        matchedResult.inherited.forEach((entry) => {
          if (entry.matchedCSSRules) {
            allRules.push(...entry.matchedCSSRules);
          }
        });
      }
      result.matchedRules = allRules
        .filter((r) => r.rule.origin !== "user-agent")
        .map((r) => ({
          selector: r.rule.selectorList.text,
          cssText: r.rule.style.cssText,
        }));
    }
  } catch (e) {}
  return result;
}

// 序列化 (V18.3 原生样式保留版 + Base64 防护)
function serializeTreeToHTML(node) {
  if (!node) return "";
  if (node.type === "text") return node.content;
  if (node.type === "svg_raw") return node.html;

  if (node.type === "element") {
    const tagName = node.tagName;

    const computedString = Object.entries(node.computedStyle || {})
      .map(([k, v]) => `${k}:${v}`)
      .join(";");

    let rulesAttr = "";
    if (node.matchedRules && node.matchedRules.length > 0) {
      const allRules = node.matchedRules
        .map((r) => `${r.selector} { ${r.cssText} }`)
        .join(" ");
      if (allRules.trim()) {
        rulesAttr = ` data-matched-rules="${allRules.replace(/"/g, "'")}"`;
      }
    }

    let otherAttrs = "";
    let originalStyle = "";

    if (node.attributes) {
      Object.entries(node.attributes).forEach(([key, value]) => {
        if (key === "class" || key === "data-divmagic-id") return;

        if (key === "style") {
          originalStyle = value;
          return;
        }

        if (key.startsWith("on")) return;

        let safeValue = String(value);
        if (safeValue.length > 500 && key !== "d") {
          safeValue = safeValue.substring(0, 100) + "...";
        }
        safeValue = safeValue.replace(/"/g, "&quot;");
        otherAttrs += ` ${key}="${safeValue}"`;
      });
    }

    const finalStyle = originalStyle || computedString;
    const classAttr = node.attributes.class
      ? `class="${node.attributes.class}"`
      : "";

    let openTag = `<${tagName} ${classAttr} style="${finalStyle}" data-computed-style="${computedString}"${otherAttrs}${rulesAttr}>`;

    const childrenHTML = node.children
      .map((child) => serializeTreeToHTML(child))
      .join("");
    return `${openTag}${childrenHTML}</${tagName}>`;
  }
  return "";
}

// Computed Style 全量清洗 (V18.4)
function processComputedStyle(cdpStyleArray) {
  const styleObj = {};
  const isGarbage = (name, value) => {
    if (name.startsWith("-webkit-")) return true;
    if (name.startsWith("-moz-")) return true;
    if (name.startsWith("-ms-")) return true;
    if (value === "initial") return true;
    if (
      value === "none" &&
      name !== "display" &&
      name !== "float" &&
      name !== "background-image"
    )
      return true;
    return false;
  };

  cdpStyleArray.forEach((p) => {
    if (!isGarbage(p.name, p.value)) {
      styleObj[p.name] = p.value;
    }
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
      if (
        node.attributes[i] === attrName &&
        node.attributes[i + 1] === attrValue
      )
        return node;
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
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
    } finally {
      debuggingTabs.delete(tabId);
    }
  }
}
chrome.tabs.onRemoved.addListener(cleanupDebugging);
