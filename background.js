import { GoogleGenerativeAI } from "./google-sdk.js";
import { GEMINI_API_KEY } from "./config.js";

const debuggingTabs = new Set();

// ==========================================
// 1. 事件监听
// ==========================================

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
    chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_HUD" }).catch(e => console.log("Init HUD msg", e));
  });
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
  if (msg.type === "OPEN_SIDEPANEL") {
    if (sender.tab?.id) chrome.sidePanel.open({ tabId: sender.tab.id, windowId: sender.tab.windowId }).catch(console.error);
    return;
  }

  if (msg.type === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      sendResponse({ success: !chrome.runtime.lastError, dataUrl, error: chrome.runtime.lastError?.message });
    });
    return true;
  }

  if (msg.type === "CDP_GET_STYLE") {
    handleCdpGetTreeStyles(msg, sender, sendResponse);
    return true;
  }

  if (msg.type === "AI_REFINE_CODE") {
    handleGeminiRefinement(msg.code, msg.instruction).then(newCode => {
      sendResponse({ success: true, data: newCode });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// ==========================================
// 2. AI 处理核心
// ==========================================

async function getActiveApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['user_gemini_key'], (result) => {
      if (result.user_gemini_key && result.user_gemini_key.length > 10) {
        resolve(result.user_gemini_key);
      } else {
        resolve(GEMINI_API_KEY);
      }
    });
  });
}

async function handleGeminiTestStream(msg, port) {
  const stylesData = msg.styles;
  const apiKey = await getActiveApiKey();

  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
    port.postMessage({ success: false, error: "请配置 API Key" });
    return;
  }

  const prompt = `Role: Senior Frontend Engineer (Tailwind CSS Specialist).

Task: Reconstruct the provided **Augmented HTML** into a responsive React component.
Goal: 100% visual fidelity + 100% logical responsiveness.

🚨 DATA SOURCE PROTOCOL (STRICT PRIORITY):
1. **PRIORITY 1: \`data-rules\`**: Check CSS variables.
2. **PRIORITY 2: \`style\` attribute**: This is the DEFAULT state.
3. **PRIORITY 3: \`data-hover-diff\`**: Use for hover states.

🎨 COLOR STRATEGY:
- Base color: Read from \`style\`.
- Hover color: Read from \`data-hover-diff\`.

✨ ANIMATION & LAYOUT:
- **Retain Animations**: Look for transition/animation/transform properties.
- **Freeze Time**: The input HTML reflects a "frozen" hover state. The values in \`data-hover-diff\` are the FINAL target values.
- **DOM FIDELITY**: Trust the Input HTML hierarchy. If absolute layers (overlays/backgrounds) are siblings in the Input, keep them as **siblings** in React. Do NOT nest them inside other elements, otherwise transforms/opacity will stack incorrectly.
- **PREVENT COLLAPSE**: If an \`absolute\` element uses \`padding-bottom\` (aspect ratio hack), YOU MUST give it explicit \`w-full\`.

OUTPUT FORMAT:
- Returns ONLY raw JSX code.
- Define component as \`const Component = () => { ... }\`.
- No markdown.

INPUT HTML:
${stylesData}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
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

async function handleGeminiRefinement(currentCode, instruction) {
  const apiKey = await getActiveApiKey();
  if (!apiKey) throw new Error("API Key missing");

  const prompt = `
    Role: Senior React Refactoring Expert.
    Task: Modify the provided React component based on the USER INSTRUCTION.

    CONTEXT - Current Code:
    \`\`\`jsx
    ${currentCode}
    \`\`\`

    USER INSTRUCTION:
    "${instruction}"

    RULES:
    1. STRICTLY output ONLY the updated raw JSX code. 
    2. NO markdown formatting.
    3. Use Tailwind CSS for styling changes.
  `;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text.replace(/^```(jsx|javascript|js)?/, "").replace(/```$/, "").trim();
    return text;
  } catch (error) {
    console.error("Refine Error:", error);
    throw error;
  }
}

// ==========================================
// 3. CDP 核心逻辑 (🔥 核弹级冻结 + 完整采集)
// ==========================================

function collectAllNodeIds(node, ids = []) {
  if (node.nodeId) ids.push(node.nodeId);
  if (node.children) node.children.forEach((child) => collectAllNodeIds(child, ids));
  return ids;
}

// 🔥 V60.22: 核弹级动画冻结 (Universal Freeze)
async function togglePageTransitions(tabId, disable) {
  // 🔥 核心修改：增加了 *::before, *::after 选择器，并强制重置所有动画属性
  const css = `
    *, *::before, *::after {
      transition-property: none !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation: none !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
    }
  `;

  const expression = disable
    ? `(function(){
            const style = document.createElement('style');
            style.id = 'divmagic-disable-transitions';
            style.innerHTML = \`${css}\`;
            document.head.appendChild(style);
            // 强制重绘 (Force Reflow) 以确保样式立即生效
            void document.body.offsetHeight; 
           })()`
    : `(function(){
            const style = document.getElementById('divmagic-disable-transitions');
            if(style) style.remove();
           })()`;

  try {
    await sendDebuggerCommand(tabId, "Runtime.evaluate", { expression });
  } catch (e) { console.warn("Toggle transition failed", e); }
}

async function handleCdpGetTreeStyles(msg, sender, sendResponse) {
  const tabId = sender.tab.id;
  const tabUrl = sender.tab.url;
  const match = msg.selector.match(/data-divmagic-id="([^"]+)"/);
  const targetSelectorId = match ? match[1] : null;

  console.log(`⚖️ [Engine] Capture: ${targetSelectorId}`);

  try {
    try { await chrome.debugger.attach({ tabId }, "1.3"); debuggingTabs.add(tabId); }
    catch (e) { if (!e.message.includes("already attached")) { try { await chrome.debugger.detach({ tabId }); } catch (_) { } await chrome.debugger.attach({ tabId }, "1.3"); } }

    await sendDebuggerCommand(tabId, "DOM.enable");
    await sendDebuggerCommand(tabId, "CSS.enable");

    const doc = await sendDebuggerCommand(tabId, "DOM.getDocument", { depth: -1 });
    const rootNode = findNodeByAttributeValue(doc.root, "data-divmagic-id", targetSelectorId);

    if (!rootNode) throw new Error("Target node not found.");

    const allNodeIds = collectAllNodeIds(rootNode);

    // 1. Base State
    console.log("📸 Capturing Base State...");
    await Promise.all(allNodeIds.map((id) => sendDebuggerCommand(tabId, "CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: [] }).catch(() => { })));
    const baseTree = await captureTreeState(tabId, rootNode, null, true, false);

    // 🔥 2. Hover State (使用增强版冻结逻辑)
    console.log("📸 Capturing Hover State (Freezing)...");
    await togglePageTransitions(tabId, true); // 🚫 核弹级禁用
    await Promise.all(allNodeIds.map((id) => sendDebuggerCommand(tabId, "CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: ["hover"] }).catch(() => { })));

    // 给浏览器一点时间应用样式和计算布局 (50ms 足够)
    await new Promise(r => setTimeout(r, 50));

    const hoverTree = await captureTreeState(tabId, rootNode, null, true, true);

    // 3. Reset
    await togglePageTransitions(tabId, false); // ✅ 恢复现场
    await Promise.all(allNodeIds.map((id) => sendDebuggerCommand(tabId, "CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: [] }).catch(() => { })));

    // 4. Merge
    mergeHoverDiff(baseTree, hoverTree);

    console.log("📝 Serializing...");
    const htmlOutput = serializeTreeToHTML(baseTree, tabUrl);

    // Loading & Layout
    let rootLayout = { width: "auto", height: "auto" };
    try {
      const boxModel = await sendDebuggerCommand(tabId, "DOM.getBoxModel", { nodeId: rootNode.nodeId });
      if (boxModel?.model) rootLayout = { width: boxModel.model.width, height: boxModel.model.height };
    } catch (e) { }

    const loadingComponent = `const Component = () => (<div className="flex flex-col items-center justify-center h-full p-8 text-slate-400"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div><div className="text-sm font-mono mt-4">AI Analyzing...</div></div>);`;

    chrome.runtime.sendMessage({ type: "UPDATE_CODE_WITH_REAL_DATA", code: loadingComponent, layout: rootLayout }).catch(() => { });
    sendResponse({ success: true, data: htmlOutput, layout: rootLayout });

    let accumulatedText = "";
    const mockPort = {
      postMessage: (msg) => {
        if (msg.type === "STREAM_CHUNK") accumulatedText += (msg.chunk || msg.text || "");
        if (msg.type === "STREAM_DONE" || (msg.success && msg.data)) {
          chrome.runtime.sendMessage({ type: "UPDATE_CODE_WITH_REAL_DATA", code: msg.data || accumulatedText, layout: rootLayout }).catch(() => { });
        }
      }
    };

    await handleGeminiTestStream({ styles: htmlOutput }, mockPort);

  } catch (error) {
    console.error("❌ CDP Error:", error);
    sendResponse({ success: false, error: error.message });
    cleanupDebugging(tabId);
  }
}

function mergeHoverDiff(baseNode, hoverNode) {
  if (!baseNode || !hoverNode) return;

  if (baseNode.computedStyle && hoverNode.computedStyle) {
    const diff = {};
    const baseStyle = baseNode.computedStyle;
    const hoverStyle = hoverNode.computedStyle;
    let hasDiff = false;
    const interactiveProps = ["color", "background-color", "border-color", "opacity", "transform", "box-shadow", "fill", "stroke"];

    interactiveProps.forEach(prop => {
      if (baseStyle[prop] !== hoverStyle[prop] && hoverStyle[prop]) {
        diff[prop] = hoverStyle[prop];
        hasDiff = true;
      }
    });

    if (hasDiff) {
      baseNode.hoverDiff = diff;
    }
  }

  if (baseNode.children && hoverNode.children && baseNode.children.length === hoverNode.children.length) {
    for (let i = 0; i < baseNode.children.length; i++) {
      mergeHoverDiff(baseNode.children[i], hoverNode.children[i]);
    }
  }
}

function purifyCssText(cssText) {
  if (!cssText) return "";
  return cssText
    .replace(/(margin|margin-top|margin-bottom|margin-left|margin-right)\s*:[^;]+;?/gi, '')
    .replace(/(top|left|right|bottom)\s*:[^;]+;?/gi, '')
    .replace(/(align|justify)-self\s*:[^;]+;?/gi, '');
}

async function captureTreeState(tabId, node, parentComputedStyle = null, isRoot = true, isHovering = false) {
  if (!node) return null;
  if (node.nodeType === 3) return node.nodeValue.trim() ? { type: "text", content: node.nodeValue.trim() } : null;
  if (node.nodeType !== 1) return null;

  const tagName = node.nodeName.toLowerCase();
  if (["script", "style", "noscript", "iframe", "comment"].includes(tagName)) return null;

  const styles = await fetchStylesForNode(tabId, node.nodeId, parentComputedStyle, isRoot);
  if (!styles) return null;

  let currentComputedStyle = styles.computedStyle;

  if (isRoot) {
    const layoutPollution = [
      "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
      "margin-block-start", "margin-block-end", "margin-inline-start", "margin-inline-end",
      "top", "left", "right", "bottom", "inset",
      "align-self", "justify-self", "flex", "grid-area"
    ];
    layoutPollution.forEach(k => delete currentComputedStyle[k]);

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

      let styleParts = [];
      for (const [k, v] of Object.entries(currentComputedStyle)) {
        if (!k.startsWith('font-') && !k.startsWith('line-') && !k.startsWith('text-')) {
          styleParts.push(`${k}:${v}`);
        }
      }
      if (currentComputedStyle.color && !styleParts.some(s => s.startsWith('color:'))) styleParts.push(`color:${currentComputedStyle.color}`);
      if (currentComputedStyle.fill && !styleParts.some(s => s.startsWith('fill:'))) styleParts.push(`fill:${currentComputedStyle.fill}`);

      const cleanStyle = styleParts.join(';');
      return { type: "svg_raw", html: svgHtml.replace('<svg', `<svg style="${cleanStyle}"`), computedStyle: currentComputedStyle };
    } catch (e) { return null; }
  }

  const children = [];
  if (node.pseudoElements) {
    for (const pseudo of node.pseudoElements) {
      const processed = await captureTreeState(tabId, pseudo, currentComputedStyle, false, isHovering);
      // 🔥 V60.22 回滚：保留所有伪元素，不做人为过滤
      if (processed) {
        processed.isPseudo = true;
        children.push(processed);
      }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const processed = await captureTreeState(tabId, child, currentComputedStyle, false, isHovering);
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
      if (isRoot) {
        const allVars = {};
        computedResult.computedStyle.forEach(p => { if (p.name.startsWith('--')) allVars[p.name] = p.value; });
        if (Object.keys(allVars).length > 0) {
          result.matchedRules.push({ selector: ":root", cssText: Object.entries(allVars).map(([k, v]) => `${k}: ${v}`).join('; '), type: "RootVars" });
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

/**
 * 将相对路径转换为绝对路径
 * @param {string} path - 原始路径 (e.g. /img/logo.png)
 * @param {string} baseUrl - 当前页面的 URL (e.g. https://wise.com/page)
 */
function makeUrlAbsolute(path, baseUrl) {
  if (!path) return path;
  if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http")) return path;

  // 处理 //cdn.com 这种自适应协议
  if (path.startsWith("//")) return `https:${path}`;

  try {
    return new URL(path, baseUrl).href;
  } catch (e) {
    return path;
  }
}

function serializeTreeToHTML(node, baseUrl) {
  if (!node) return "";
  if (node.type === "text") return node.content;

  // 1. 修改：处理 SVG Raw 模式 (如果有内部相对链接)
  if (node.type === "svg_raw") {
    let html = node.html;
    if (baseUrl) {
      // 简单的正则替换 SVG 内部可能的相对链接 (比如 <image href="...">)
      html = html.replace(/(href|src)="([^"]+)"/g, (match, attr, val) => {
        return `${attr}="${makeUrlAbsolute(val, baseUrl)}"`;
      });
    }
    return html;
  }

  const tagName = node.tagName;

  // 2. 修改：处理 Computed Style 里的背景图 URL
  const computedString = Object.entries(node.computedStyle || {}).map(([k, v]) => {
    if (baseUrl && v && v.includes('url(')) {
      // 将 url('/bg.png') 替换为绝对路径
      v = v.replace(/url\(['"]?(.+?)['"]?\)/g, (match, url) => `url('${makeUrlAbsolute(url, baseUrl)}')`);
    }
    return `${k}:${v}`;
  }).join(";");

  let hoverDiffAttr = "";
  if (node.hoverDiff) {
    const diffString = Object.entries(node.hoverDiff).map(([k, v]) => `${k}:${v}`).join(";");
    hoverDiffAttr = ` data-hover-diff="${diffString}"`;
  }

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

      let finalValue = value;

      // 3. 核心修改：处理关键属性的路径转换
      if (baseUrl) {
        if (key === "src" || key === "href") {
          finalValue = makeUrlAbsolute(value, baseUrl);
        }
        if (key === "srcset") {
          // 处理 "img1.png 1x, img2.png 2x" 格式
          finalValue = value.split(',').map(part => {
            const [url, desc] = part.trim().split(' ');
            return `${makeUrlAbsolute(url, baseUrl)} ${desc || ''}`.trim();
          }).join(', ');
        }
      }

      otherAttrs += ` ${key}="${String(finalValue).replace(/"/g, "&quot;")}"`;
    });
  }

  const classAttr = node.attributes.class ? `class="${node.attributes.class}"` : "";

  // 4. 核心修改：递归调用时，必须把 baseUrl 传给子节点
  const childrenHtml = node.children.map(child => serializeTreeToHTML(child, baseUrl)).join('');

  return `<${tagName} ${classAttr} style="${computedString}" data-computed-style="${computedString}"${hoverDiffAttr}${rulesAttr}${varsAttr}${otherAttrs}>${childrenHtml}</${tagName}>`;
}

function processComputedStyle(cdpArray, parentObj = null, isRoot = false) {
  const styleObj = {};

  const blocklist = new Set([
    "text-rendering", "zoom", "mix-blend-mode"
  ]);

  cdpArray.forEach(p => {
    const k = p.name;
    const v = p.value;

    if (blocklist.has(k)) return;

    if (k.startsWith("-webkit-") && !k.includes("line-clamp") && !k.includes("box-orient") && !k.includes("text-fill-color")) return;
    if (k.startsWith("-moz-") || k.startsWith("-ms-")) return;

    if (v === "auto" || v === "none" || v === "normal" || v === "0px" || v === "rgba(0, 0, 0, 0)" || v === "transparent" || v === "initial") {
      if (v === "0px" && (k.includes("margin") || k.includes("padding") || k.includes("border-width"))) return;
      if (v === "0px" && (k === "top" || k === "left" || k === "right" || k === "bottom")) { /* keep */ } else if (v === "0px") return;
      if (v === "none" && k !== "display" && k !== "max-width" && k !== "max-height") return;
      if (v === "auto" && k !== "overflow") return;
    }

    if (parentObj && parentObj[k] === v) return;

    styleObj[k] = v;
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