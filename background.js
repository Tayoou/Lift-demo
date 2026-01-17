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

🚨 DATA CONTEXT:
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
      model: "gemini-2.5-pro",
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

      // 🔥 暴力清洗：只保留 viewBox, d, fill, xmlns
      // 移除所有 style, class, width, height, stroke (让 Tailwind 控制)
      svgHtml = svgHtml
        .replace(/style="[^"]*"/gi, "")
        .replace(/class="[^"]*"/gi, "")
        .replace(/width="[^"]*"/gi, "")
        .replace(/height="[^"]*"/gi, "")
        .replace(/stroke="[^"]*"/gi, "") // 删掉原生的 stroke，防止干扰
        .replace(/stroke-width="[^"]*"/gi, ""); // 删掉原生的 width

      // 重新把必要的 Computed 尺寸加回去，作为一个干净的 style
      const computed = styles.computedStyle;
      let cleanStyle = `width:${computed.width || "1em"};height:${
        computed.height || "1em"
      };`;
      // 颜色交给 AI 通过 class 处理，或者这里硬编码 currentColor

      svgHtml = svgHtml.replace(
        "<svg",
        `<svg style="${cleanStyle}" fill="currentColor"`
      );

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

// ==========================================
// 辅助函数：从 CSS 文本中提取所有被引用的变量名 var(--xxx)
// ==========================================
function extractUsedVariables(cssText) {
  const vars = new Set();
  // 匹配 var(--variable-name)
  const regex = /var\((--[a-zA-Z0-9-_]+)[^)]*\)/g;
  let match;
  while ((match = regex.exec(cssText)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

// ==========================================
// 辅助函数：解析 CSS 文本为对象 (简化版)
// 将 "color: red; width: 10px" 转换为 { color: "red", width: "10px" }
// ==========================================
function parseCssText(cssText) {
  const style = {};
  if (!cssText) return style;

  // 去除注释
  cssText = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

  const parts = cssText.split(";");
  for (const part of parts) {
    const [key, ...valParts] = part.split(":");
    if (key && valParts.length > 0) {
      const propName = key.trim().toLowerCase();
      style[propName] = valParts.join(":").trim();
    }
  }
  return style;
}

// ==========================================
// 核心逻辑：获取并清洗样式
// ==========================================
async function fetchStylesForNode(tabId, nodeId) {
  const result = { computedStyle: {}, matchedRules: [] };

  // 1. 获取 Computed Style (用于最终校验)
  // ... (保持 V27.5 的清洗逻辑)
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

  // 2. 获取原始 Matched Rules
  try {
    const matchedResult = await sendDebuggerCommand(
      tabId,
      "CSS.getMatchedStylesForNode",
      { nodeId }
    );

    if (matchedResult) {
      // A. 收集当前元素“自身”的所有规则
      const ownRules = matchedResult.matchedCSSRules || [];
      const ownCssText = ownRules.map((r) => r.rule.style.cssText).join(" ");
      const inlineStyleText = matchedResult.inlineStyle
        ? matchedResult.inlineStyle.cssText
        : "";

      // B. 分析“自身”用到了哪些变量
      // 只有当前元素明确用到的变量，我们才去继承链里找定义
      const usedVars = new Set([
        ...extractUsedVariables(ownCssText),
        ...extractUsedVariables(inlineStyleText),
      ]);

      // C. 分析“自身”定义了哪些属性 (用于判断覆盖)
      const ownProperties = new Set();
      [...ownRules].forEach((r) => {
        const props = parseCssText(r.rule.style.cssText);
        Object.keys(props).forEach((k) => ownProperties.add(k));
      });
      if (matchedResult.inlineStyle) {
        const inlineProps = parseCssText(matchedResult.inlineStyle.cssText);
        Object.keys(inlineProps).forEach((k) => ownProperties.add(k));
      }

      // D. 组装最终规则列表
      const finalRules = [];

      // D-1. 先放入自身的规则 (全部保留)
      ownRules.forEach((r) => {
        if (r.rule.origin !== "user-agent") {
          finalRules.push({
            selector: r.rule.selectorList.text,
            cssText: r.rule.style.cssText,
            type: "Own Rule",
          });
        }
      });

      // D-2. 处理继承规则 (Tree Shaking 核心!)
      if (matchedResult.inherited) {
        matchedResult.inherited.forEach((entry) => {
          if (!entry.matchedCSSRules) return;

          entry.matchedCSSRules.forEach((r) => {
            if (r.rule.origin === "user-agent") return;

            const parentCssText = r.rule.style.cssText;
            const parentProps = parseCssText(parentCssText);
            let keepRule = false;
            let cleanParentCss = [];

            // 遍历父级规则的每一个属性
            for (const [prop, val] of Object.entries(parentProps)) {
              // 情况 1: 是 CSS 变量
              if (prop.startsWith("--")) {
                // 只有当这个变量被子元素(usedVars)引用时，才保留定义
                if (usedVars.has(prop)) {
                  cleanParentCss.push(`${prop}: ${val}`);
                  keepRule = true;
                }
              }
              // 情况 2: 是普通属性 (如 color, font-family)
              else {
                // 只有当子元素没有重写这个属性时，才保留继承
                // (注意：这里还可以更激进，对比 Computed Style，但目前先做属性名碰撞检测)
                if (!ownProperties.has(prop)) {
                  cleanParentCss.push(`${prop}: ${val}`);
                  keepRule = true;
                  // 这是一个被继承下来的有效属性，也算作子元素拥有的属性，
                  // 防止更上层的祖先再次覆盖它 (CSS Cascading logic)
                  ownProperties.add(prop);
                }
              }
            }

            // 只有当这条规则里至少有一个属性是有用的，才加入 Input
            if (keepRule && cleanParentCss.length > 0) {
              finalRules.push({
                selector: r.rule.selectorList.text + " (Inherited)",
                cssText: cleanParentCss.join("; "), // 只发送精简后的 CSS
                type: "Inherited",
              });
            }
          });
        });
      }

      result.matchedRules = finalRules;
    }
  } catch (e) {
    console.warn("Rules fetch error", e);
  }
  return result;
}

// 序列化 (V30.0 逻辑分离版：Rules vs Vars)
function serializeTreeToHTML(node) {
  if (!node) return "";
  if (node.type === "text") return node.content;
  if (node.type === "svg_raw") return node.html;

  if (node.type === "element") {
    const tagName = node.tagName;

    // 1. 处理 Computed Style (保持 V18.3 逻辑)
    const computedString = Object.entries(node.computedStyle || {})
      .map(([k, v]) => `${k}:${v}`)
      .join(";");

    // 2. 🔥 V30.0 修改核心：规则分离 (Rule Separation) 🔥
    // 我们不再生成一个巨大的 data-matched-rules，而是拆分为 data-rules (逻辑) 和 data-vars (变量定义)
    let rulesAttr = "";
    let varsAttr = "";

    if (node.matchedRules && node.matchedRules.length > 0) {
      let ownCss = "";
      let inheritedVars = "";

      node.matchedRules.forEach((r) => {
        // 如果是继承规则 (来自 V28 fetchStylesForNode 的标记)
        if (r.type === "Inherited") {
          // 只提取 CSS 变量 (--variable: value)
          // 过滤掉非变量的普通属性，节省 Token
          const vars = r.cssText
            .split(";")
            .filter((s) => s.trim().startsWith("--"))
            .join(";");

          if (vars.trim()) {
            inheritedVars += vars + "; ";
          }
        }
        // 如果是自身的规则 (Own Rule)
        else {
          // 保留完整的选择器和内容 (用于 hover, active 等逻辑)
          ownCss += `${r.selector} { ${r.cssText} } `;
        }
      });

      // 组装属性字符串
      if (ownCss.trim()) {
        rulesAttr = ` data-rules="${ownCss.replace(/"/g, "'").trim()}"`;
      }
      if (inheritedVars.trim()) {
        varsAttr = ` data-vars="${inheritedVars.replace(/"/g, "'").trim()}"`;
      }
    }

    // 3. 处理常规属性 (保持 V18.3 逻辑 + Base64 防护)
    let otherAttrs = "";
    let originalStyle = "";

    if (node.attributes) {
      Object.entries(node.attributes).forEach(([key, value]) => {
        // 跳过黑名单
        if (key === "class" || key === "data-divmagic-id") return;

        // 提取原生内联 style
        if (key === "style") {
          originalStyle = value;
          return;
        }

        // 跳过事件监听
        if (key.startsWith("on")) return;

        // Base64 防护：截断超长属性
        let safeValue = String(value);
        if (safeValue.length > 500 && key !== "d") {
          safeValue = safeValue.substring(0, 100) + "...[TRUNCATED]";
        }

        // 转义引号
        safeValue = safeValue.replace(/"/g, "&quot;");
        otherAttrs += ` ${key}="${safeValue}"`;
      });
    }

    // 4. 组装最终标签
    // 优先使用原生内联 style (originalStyle)，如果没有才用 Computed (computedString)
    const finalStyle = originalStyle || computedString;

    // 恢复 class 属性
    const classAttr = node.attributes.class
      ? `class="${node.attributes.class}"`
      : "";

    // 🔥 注意：这里我们要把 data-rules 和 data-vars 都拼进去
    // data-computed-style 依然保留，作为兜底
    let openTag = `<${tagName} ${classAttr} style="${finalStyle}" data-computed-style="${computedString}"${rulesAttr}${varsAttr}${otherAttrs}>`;

    const childrenHTML = node.children
      .map((child) => serializeTreeToHTML(child))
      .join("");

    return `${openTag}${childrenHTML}</${tagName}>`;
  }
  return "";
}

// Computed Style 全量清洗
function processComputedStyle(cdpStyleArray, parentStyleObj = null) {
  const styleObj = {};

  // 🗑️ 垃圾过滤器
  const isGarbage = (name, value) => {
    // 🔥🔥🔥 核心修复：在这里！🔥🔥🔥
    // 凡是以 -- 开头的 CSS 变量，在 Computed Style 里一律杀无赦。
    // 理由：变量的定义已经在 data-vars 里了，这里只需要最终的像素值。
    if (name.startsWith("--")) return true;

    // 原有的黑名单逻辑
    if (
      name.startsWith("-webkit-") ||
      name.startsWith("-moz-") ||
      name.startsWith("-ms-")
    )
      return true;

    // 原有的省流逻辑
    if (
      value === "auto" ||
      value === "normal" ||
      value === "none" ||
      value === "0px"
    )
      return true;
    if (value === "rgba(0, 0, 0, 0)" || value === "transparent") return true;
    if (value === "repeat" || value === "scroll") return true;
    if (
      name.includes("animation") ||
      name.includes("transition") ||
      name.includes("mask") ||
      name.includes("break")
    )
      return false;

    return false;
  };

  // 🌟 必须保留的布局属性 (白名单)
  const mustKeep = new Set([
    "display",
    "position",
    "width",
    "height",
    "top",
    "left",
    "bottom",
    "right",
    "z-index",
    "opacity",
    "transform",
    "margin",
    "padding",
  ]);

  // V29 的数值精度处理
  const roundValue = (value) => {
    if (typeof value !== "string") return value;
    return value.replace(/(\d+\.\d{2})\d+/g, "$1"); // 保留2位小数
  };

  // V29 的可继承属性列表 (用于 Diff)
  const INHERITABLE_PROPS = new Set([
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "visibility",
    "cursor",
    "fill",
    "stroke",
  ]);

  cdpStyleArray.forEach((p) => {
    const name = p.name;
    const rawValue = p.value;
    const cleanValue = roundValue(rawValue);

    // 1. 执行垃圾过滤 (含变量过滤)
    if (!mustKeep.has(name) && isGarbage(name, cleanValue)) return;

    // 2. 执行继承 Diff (如果和父级一样，就不发)
    if (parentStyleObj && INHERITABLE_PROPS.has(name)) {
      if (parentStyleObj[name] === cleanValue) {
        return; // 丢弃重复的继承值
      }
    }

    styleObj[name] = cleanValue;
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
