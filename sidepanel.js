// ==========================================
// Sidepanel Logic - V60.12 (Final Complete)
// ==========================================

// --- 1. Global Constants & State ---
const FONT_LIBRARY = [
    { name: "System Default", value: "", type: "sans" },
    { name: "Inter", value: "Inter", type: "sans" },
    { name: "Roboto", value: "Roboto", type: "sans" },
    { name: "Open Sans", value: "Open Sans", type: "sans" },
    { name: "Lato", value: "Lato", type: "sans" },
    { name: "Montserrat", value: "Montserrat", type: "sans" },
    { name: "Poppins", value: "Poppins", type: "sans" },
    { name: "Oswald", value: "Oswald", type: "sans" },
    { name: "Raleway", value: "Raleway", type: "sans" },
    { name: "Playfair Display", value: "Playfair Display", type: "serif" },
    { name: "Merriweather", value: "Merriweather", type: "serif" },
    { name: "Lora", value: "Lora", type: "serif" },
    { name: "PT Serif", value: "PT Serif", type: "serif" },
    { name: "Fira Code", value: "Fira Code", type: "mono" },
    { name: "JetBrains Mono", value: "JetBrains Mono", type: "mono" },
    { name: "Inconsolata", value: "Inconsolata", type: "mono" },
    { name: "Dancing Script", value: "Dancing Script", type: "hand" },
    { name: "Pacifico", value: "Pacifico", type: "hand" },
];

const DEMO_DATA = { code_html: `// Ready.` };
let currentSourceCode = "";
let currentVariables = [];
let currentFont = "";
let cachedLayout = null;
let isEditMode = false;
let screenshotResolver = null;
let historyStack = [];
let historyIndex = -1;

// ==========================================
// 2. Helper Logic: Screenshot
// ==========================================
function requestScreenshot() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn("⚠️ Screenshot attempt timed out.");
            resolve(null);
        }, 6000);

        screenshotResolver = (dataUrl) => {
            clearTimeout(timeout);
            resolve(dataUrl);
        };

        const iframe = document.getElementById("preview-iframe");
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: "GET_SCREENSHOT" }, "*");
        } else {
            resolve(null);
        }
    });
}

// ==========================================
// 3. Library Functions
// ==========================================
async function saveComponent() {
    if (!currentSourceCode || currentSourceCode === DEMO_DATA.code_html) return;

    const saveBtn = document.getElementById("btn-save");
    const originalHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = `<span style="font-size:10px">Saving...</span>`;
    saveBtn.style.pointerEvents = "none";
    saveBtn.style.opacity = "0.7";

    let thumbnailData = await requestScreenshot();

    if (!thumbnailData) {
        console.log("🔄 Retry capture...");
        await new Promise(r => setTimeout(r, 800));
        thumbnailData = await requestScreenshot();
    }

    const component = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        name: `Component ${new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`,
        code: currentSourceCode,
        variables: currentVariables,
        font: currentFont,
        layout: cachedLayout,
        thumbnail: thumbnailData
    };

    const result = await chrome.storage.local.get(['componentLibrary']);
    const library = result.componentLibrary || [];
    library.unshift(component);
    await chrome.storage.local.set({ componentLibrary: library });

    saveBtn.style.color = "#4ade80";
    saveBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>`;

    setTimeout(() => {
        saveBtn.style.color = "";
        saveBtn.innerHTML = originalHtml;
        saveBtn.style.pointerEvents = "auto";
        saveBtn.style.opacity = "1";
    }, 1500);

    if (document.getElementById("library-wrapper").classList.contains("active-view")) {
        renderLibrary();
    }
}

async function renderLibrary() {
    const grid = document.getElementById("library-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const result = await chrome.storage.local.get(['componentLibrary']);
    const library = result.componentLibrary || [];

    if (library.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="text-align:center; color:#94a3b8; font-size:12px; grid-column:span 2; margin-top:20px;">No saved components yet.</div>`;
        return;
    }

    library.forEach(comp => {
        const card = document.createElement("div");
        card.className = "lib-card";

        let thumbContent = comp.thumbnail
            ? `<img src="${comp.thumbnail}" style="width:100%; height:100%; object-fit:contain; display:block;">`
            : `<div style="display:flex;align-items:center;justify-content:center;color:#cbd5e1;height:100%;font-size:10px;">No Preview</div>`;

        card.innerHTML = `
            <div class="lib-thumb">${thumbContent}</div>
            <div class="lib-info">
                <div style="font-weight:600; font-size:11px; color:#334155; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${comp.name}</div>
                <div style="font-size:9px; color:#94a3b8; display:flex; justify-content:space-between;">
                    <span>${new Date(comp.timestamp).toLocaleDateString()}</span>
                    <span class="lib-delete" style="cursor:pointer; color:#ef4444;">Delete</span>
                </div>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (e.target.classList.contains("lib-delete")) return;
            loadComponent(comp);
        });

        card.querySelector(".lib-delete").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm("Delete this component?")) {
                const data = await chrome.storage.local.get(['componentLibrary']);
                await chrome.storage.local.set({ componentLibrary: data.componentLibrary.filter(c => c.id !== comp.id) });
                renderLibrary();
            }
        });

        grid.appendChild(card);
    });
}

function loadComponent(comp) {
    currentSourceCode = comp.code;
    currentVariables = comp.variables || [];
    currentFont = comp.font || "";
    cachedLayout = comp.layout;

    document.querySelectorAll(".view-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("tab-preview").classList.add("active");
    document.querySelectorAll(".view-section").forEach(el => el.classList.remove("active-view"));
    document.getElementById("preview-wrapper").classList.add("active-view");

    const fontText = document.querySelector("#custom-font-select .selected-text");
    const fontItem = FONT_LIBRARY.find(f => f.value === currentFont);
    if (fontText) fontText.textContent = fontItem ? fontItem.name : "System Default";

    historyStack = [currentSourceCode];
    historyIndex = 0;
    updateHistoryButtons();

    renderDemo();
}

// ==========================================
// 4. Code Processing Helpers
// ==========================================

function expandHex(hex) {
    if (!hex) return "#000000";
    if (hex.length === 4 && hex.startsWith("#")) return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    return hex;
}

function purgeChildFonts(code) {
    let cleanCode = code.replace(/font-\['[^']+?'\]/g, "");
    cleanCode = cleanCode.replace(/font-(sans|serif|mono)/g, "");
    return cleanCode;
}

function injectRootStyles(code, variables, font) {
    let processedCode = purgeChildFonts(code);
    const colorEntries = variables.map(v => `"${v.key}": "${v.value}"`);
    if (font) {
        const fontValue = font.includes('serif') || font.includes('mono') ? font : `${font}, sans-serif`;
        colorEntries.push(`"fontFamily": "'${font}', sans-serif"`);
    }

    const rootTagRegex = /(return\s*\(?\s*|=>\s*\(?\s*)<([a-zA-Z0-9]+)([^>]*?)>/;
    return processedCode.replace(rootTagRegex, (match, prefix, tagName, attributes) => {
        const styleMatch = attributes.match(/style=\{\{([\s\S]*?)\}\}/);
        let newAttributes = attributes;
        let existingStyle = "";

        if (styleMatch) {
            existingStyle = styleMatch[1];
            newAttributes = newAttributes.replace(styleMatch[0], "");
        }

        let finalStyle = [...colorEntries];
        if (existingStyle) finalStyle.push(existingStyle);
        if (finalStyle.length === 0) return match;

        return `${prefix}<${tagName} style={{ ${finalStyle.join(", ")} }}${newAttributes}>`;
    });
}

function processRawCode(rawCode) {
    const hexRegex = /#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/gi;
    const colorMap = new Map();
    let counter = 1;
    let match;
    while ((match = hexRegex.exec(rawCode)) !== null) {
        const hex = match[0].toLowerCase();
        if (!colorMap.has(hex)) colorMap.set(hex, `--color-${counter++}`);
    }
    const variables = Array.from(colorMap.entries()).map(([hex, name]) => ({ key: name, value: hex }));

    let processedCode = rawCode;
    variables.forEach(v => {
        processedCode = processedCode.split(v.value).join(`var(${v.key})`);
        processedCode = processedCode.split(v.value.toUpperCase()).join(`var(${v.key})`);
    });

    return { processedCode, variables };
}

function stripInlineVariables(code) {
    return code.replace(/"--color-\d+":\s*"[^"]+",?/g, "");
}

function updateTextInCode(oldText, newText) {
    if (!oldText || oldText === newText) return;
    currentSourceCode = currentSourceCode.replaceAll(oldText, newText);
    pushToHistory(currentSourceCode);
    const editor = document.getElementById("code-editor");
    if (editor) editor.textContent = injectRootStyles(currentSourceCode, currentVariables, currentFont);
}

function cleanCode(code) {
    if (!code) return "";
    return code.replace(/^```(jsx|javascript|js|tsx|vue|html)?\n/, "").replace(/```$/, "");
}

function updateVariableName(oldKey, newKey) {
    if (oldKey === newKey) return;
    const exists = currentVariables.find(v => v.key === newKey);
    if (exists) {
        alert("Variable name exists!");
        renderControls();
        return;
    }
    const targetVar = currentVariables.find(v => v.key === oldKey);
    if (targetVar) targetVar.key = newKey;
    if (currentSourceCode) currentSourceCode = currentSourceCode.split(oldKey).join(newKey);
    renderDemo();
}

// ==========================================
// 5. Controls Renderer
// ==========================================

function renderControls() {
    const container = document.getElementById("color-controls");
    if (!container) return;
    container.innerHTML = "";

    if (currentVariables.length === 0) {
        container.innerHTML = `<div style="color:#cbd5e1;font-size:11px;grid-column:span 2;text-align:center;padding:10px;">No extracted colors</div>`;
        return;
    }

    currentVariables.forEach(v => {
        const div = document.createElement("div");
        div.className = "color-item";
        div.innerHTML = `
            <input type="color" value="${expandHex(v.value)}">
            <input type="text" class="var-name-input" value="${v.key.replace('--', '')}">
        `;

        div.querySelector("input[type='color']").addEventListener("input", (e) => {
            const iframe = document.getElementById("preview-iframe");
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: "UPDATE_STYLE", key: v.key, value: e.target.value }, "*");
            }
        });

        div.querySelector("input[type='color']").addEventListener("change", (e) => {
            v.value = e.target.value;
        });

        const nameInput = div.querySelector(".var-name-input");
        nameInput.addEventListener("change", (e) => {
            const newName = e.target.value.trim();
            if (newName) updateVariableName(v.key, newName.startsWith("--") ? newName : `--${newName}`);
        });

        container.appendChild(div);
    });
}

function renderDemo(rawCode = null, layoutData = null) {
    const finalLayout = layoutData || cachedLayout;

    if (rawCode) {
        const result = processRawCode(rawCode);
        currentSourceCode = result.processedCode;
        if (result.variables.length > 0) {
            currentVariables = result.variables;
        } else if (currentVariables.length > 0 && currentSourceCode.includes('var(--')) {
            // Keep old vars if code still uses them
        } else {
            // currentVariables = []; 
        }

        if (historyStack.length === 0 || historyStack[historyIndex] !== currentSourceCode) {
            pushToHistory(currentSourceCode);
        }
    } else if (!currentSourceCode) {
        const result = processRawCode(DEMO_DATA.code_html);
        currentSourceCode = result.processedCode;
        currentVariables = result.variables;
    }

    const codeWithStyle = injectRootStyles(currentSourceCode, currentVariables, currentFont);

    // 🔥 Fix: Typo corrected here (codeToRender -> codeForRender)
    const codeForRender = stripInlineVariables(codeWithStyle);
    const cleanedCode = cleanCode(codeForRender);

    renderControls();

    const editor = document.getElementById("code-editor");
    if (editor) {
        editor.textContent = codeWithStyle;
        if (window.hljs) window.hljs.highlightElement(editor);
    }

    const iframe = document.getElementById("preview-iframe");
    if (iframe) {
        const payload = {
            type: "RENDER",
            code: cleanedCode,
            layout: finalLayout
        };

        const postRenderActions = () => {
            // 🔥 Fix: Sync variables immediately after render
            setTimeout(() => {
                currentVariables.forEach(v => {
                    iframe.contentWindow.postMessage({ type: "UPDATE_STYLE", key: v.key, value: v.value }, "*");
                });
            }, 100);
        };

        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(payload, "*");
            postRenderActions();
        } else {
            iframe.onload = () => {
                iframe.contentWindow.postMessage(payload, "*");
                postRenderActions();
            };
        }

        if (isEditMode) {
            setTimeout(() => iframe.contentWindow.postMessage({ type: "TOGGLE_EDIT_MODE", enable: true }, "*"), 200);
        }
    }
}

// ==========================================
// 6. History Management
// ==========================================

function pushToHistory(code) {
    if (!code) return;
    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    historyStack.push(code);
    historyIndex = historyStack.length - 1;
    if (historyStack.length > 20) {
        historyStack.shift();
        historyIndex--;
    }
    updateHistoryButtons();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        currentSourceCode = historyStack[historyIndex];
        renderDemo(null, null);
        updateHistoryButtons();
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        currentSourceCode = historyStack[historyIndex];
        renderDemo(null, null);
        updateHistoryButtons();
    }
}

function updateHistoryButtons() {
    document.getElementById("btn-undo").style.opacity = historyIndex > 0 ? '1' : '0.3';
    document.getElementById("btn-redo").style.opacity = historyIndex < historyStack.length - 1 ? '1' : '0.3';
}

// ==========================================
// 7. Initialization & Event Listeners
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    document.getElementById("btn-copy").addEventListener("click", () => {
        const text = document.getElementById("code-editor").textContent;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById("btn-copy");
            const originalIcon = btn.innerHTML;
            btn.style.color = "#4ade80";
            btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>`;
            setTimeout(() => {
                btn.innerHTML = originalIcon;
                btn.style.color = "";
            }, 1500);
        });
    });

    document.getElementById("btn-save").addEventListener("click", saveComponent);

    const editBtn = document.getElementById("btn-edit-text");
    editBtn.addEventListener("click", () => {
        isEditMode = !isEditMode;
        editBtn.style.color = isEditMode ? "#38bdf8" : "";
        const iframe = document.getElementById("preview-iframe");
        if (iframe) iframe.contentWindow.postMessage({ type: "TOGGLE_EDIT_MODE", enable: isEditMode }, "*");
    });

    document.getElementById("btn-undo").addEventListener("click", undo);
    document.getElementById("btn-redo").addEventListener("click", redo);

    const aiInput = document.getElementById("ai-input");
    const aiBtn = document.getElementById("btn-send-ai");

    const handleAi = async () => {
        const prompt = aiInput.value.trim();
        if (!prompt || !currentSourceCode) return;

        aiInput.disabled = true;
        aiBtn.innerHTML = `<svg class="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;

        const iframe = document.getElementById("preview-iframe");
        if (iframe) iframe.contentWindow.postMessage({ type: "SHOW_LOADING" }, "*");

        try {
            const response = await chrome.runtime.sendMessage({
                type: "AI_REFINE_CODE",
                code: currentSourceCode,
                instruction: prompt
            });

            if (response && response.success) {
                renderDemo(response.data);
                aiInput.value = "";
            } else {
                alert("AI Error: " + (response?.error || "Unknown"));
            }
        } catch (e) {
            console.error(e);
        } finally {
            aiInput.disabled = false;
            aiInput.focus();
            aiBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
        }
    };

    aiBtn.addEventListener("click", handleAi);
    aiInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAi(); });

    const menuBtn = document.getElementById("btn-menu");
    const menuDropdown = document.getElementById("menu-dropdown");
    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        menuDropdown.style.display = menuDropdown.style.display === 'flex' ? 'none' : 'flex';
    });
    document.addEventListener("click", (e) => {
        if (!menuDropdown.contains(e.target) && !menuBtn.contains(e.target)) {
            menuDropdown.style.display = 'none';
        }
    });

    const tabs = document.querySelectorAll(".view-tab");
    const sections = document.querySelectorAll(".view-section");
    const mainContainer = document.getElementById("main-container");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            const targetId = tab.getAttribute("data-target") + "-wrapper";

            sections.forEach(sec => {
                if (sec.id === targetId) {
                    sec.classList.add("active-view");
                    if (sec.id === "library-wrapper") renderLibrary();
                } else {
                    sec.classList.remove("active-view");
                }
            });

            if (tab.getAttribute("data-target") === "preview") {
                mainContainer.className = "mode-preview";
            } else {
                mainContainer.className = "mode-other";
            }
        });
    });

    const bgPresets = document.querySelectorAll(".bg-preset");
    const bgPicker = document.getElementById("canvas-bg-picker");

    function setCanvasColor(color) {
        bgPresets.forEach(div => {
            if (div.getAttribute("data-color") === color) div.classList.add("selected");
            else div.classList.remove("selected");
        });
        const iframe = document.getElementById("preview-iframe");
        if (iframe) iframe.contentWindow.postMessage({ type: "UPDATE_CANVAS_BG", color }, "*");
    }

    bgPresets.forEach(btn => {
        btn.addEventListener("click", () => {
            const color = btn.getAttribute("data-color");
            setCanvasColor(color);
            if (bgPicker) bgPicker.value = expandHex(color);
        });
    });

    if (bgPicker) {
        bgPicker.addEventListener("input", (e) => {
            bgPresets.forEach(div => div.classList.remove("selected"));
            const iframe = document.getElementById("preview-iframe");
            if (iframe) iframe.contentWindow.postMessage({ type: "UPDATE_CANVAS_BG", color: e.target.value }, "*");
        });
    }

    // 🔥 Fix: Resizer logic optimized for Flexbox
    const resizer = document.getElementById("resizer");
    const iframeBox = document.getElementById("iframe-box");
    const controlsBox = document.getElementById("controls-box");
    let isResizing = false;

    if (resizer) {
        resizer.addEventListener("mousedown", (e) => {
            isResizing = true;
            document.body.style.cursor = "row-resize";
            document.getElementById("preview-iframe").style.pointerEvents = "none";
            e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const containerRect = mainContainer.getBoundingClientRect();
            const y = e.clientY - containerRect.top;

            if (y > 100 && y < containerRect.height - 100) {
                iframeBox.style.flex = "none";
                iframeBox.style.height = `${y}px`;
                if (controlsBox) {
                    controlsBox.style.flex = "1";
                    controlsBox.style.height = ""; // Reset height to let flex take over
                }
            }
        });
        document.addEventListener("mouseup", () => {
            isResizing = false;
            document.body.style.cursor = "default";
            document.getElementById("preview-iframe").style.pointerEvents = "auto";
        });
    }

    const customSelect = document.getElementById("custom-font-select");
    const triggerText = customSelect.querySelector(".selected-text");
    const searchInput = customSelect.querySelector(".font-search-input");

    function renderFontOptions(filter = "") {
        const optionsList = customSelect.querySelector(".options-list");
        if (!optionsList) return;
        optionsList.innerHTML = "";
        const lowerFilter = filter.toLowerCase();
        const filtered = FONT_LIBRARY.filter(f => f.name.toLowerCase().includes(lowerFilter));

        if (filter && !filtered.some(f => f.name.toLowerCase() === lowerFilter)) {
            const customOption = document.createElement("div");
            customOption.className = "option-item";
            customOption.innerHTML = `<span>Use "${filter}"</span>`;
            customOption.addEventListener("click", () => selectFont(filter, filter));
            optionsList.appendChild(customOption);
        }
        if (filtered.length === 0 && !filter) {
            optionsList.innerHTML = `<div class="empty-search" style="padding:8px;font-size:11px;color:#94a3b8;">No fonts found</div>`;
            return;
        }
        filtered.forEach(font => {
            const option = document.createElement("div");
            option.className = "option-item";
            if (font.value === currentFont) option.classList.add("selected");
            option.innerHTML = `<span class="font-preview" style="font-family: ${font.value || 'inherit'}">${font.name}</span>`;
            option.addEventListener("click", () => selectFont(font.name, font.value));
            optionsList.appendChild(option);
        });
    }

    function selectFont(name, value) {
        triggerText.textContent = name;
        currentFont = value;
        customSelect.classList.remove("open");
        const iframe = document.getElementById("preview-iframe");
        if (iframe) iframe.contentWindow.postMessage({ type: "UPDATE_STYLE", key: "fontFamily", value }, "*");
        renderDemo();
    }

    customSelect.querySelector(".select-trigger").addEventListener("click", (e) => {
        e.stopPropagation();
        customSelect.classList.toggle("open");
        if (customSelect.classList.contains("open")) {
            searchInput.value = "";
            renderFontOptions("");
            setTimeout(() => searchInput.focus(), 50);
        }
    });
    searchInput.addEventListener("input", (e) => renderFontOptions(e.target.value));
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
        if (!customSelect.contains(e.target)) customSelect.classList.remove("open");
    });
    renderFontOptions();

    window.addEventListener("message", (event) => {
        if (event.data.type === "SCREENSHOT_RESULT") {
            if (screenshotResolver) screenshotResolver(event.data.dataUrl);
        }
        if (event.data.type === "UPDATE_TEXT_CONTENT") {
            const { oldText, newText } = event.data;
            updateTextInCode(oldText, newText);
        }
    });
});

// Runtime Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 🔥 Fix: Update cached layout
    if (msg.type === "BROADCAST_LAYOUT") cachedLayout = msg.layout;

    if (msg.type === "UPDATE_CODE_WITH_REAL_DATA") {
        console.log("📥 Received new code from capture");
        if (msg.layout) cachedLayout = msg.layout;
        renderDemo(msg.html || msg.code, cachedLayout);
    }
});