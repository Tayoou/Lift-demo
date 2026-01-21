// sidepanel.js - V48.0 (Editable Variables + All Previous Features)

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

// ==========================================
// 1. Library Logic
// ==========================================

function requestScreenshot() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn("⚠️ Screenshot attempt timed out.");
            resolve(null);
        }, 3500);

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

async function saveComponent() {
    if (!currentSourceCode || currentSourceCode === DEMO_DATA.code_html) return;

    const saveBtn = document.getElementById("save-btn");
    const originalHtml = saveBtn.innerHTML;

    saveBtn.innerHTML = `<span style="font-size:10px;">Capturing...</span>`;
    saveBtn.style.pointerEvents = "none";

    // 截图重试机制
    let thumbnailData = await requestScreenshot();

    if (!thumbnailData) {
        console.log("🔄 First capture failed. Retrying in 500ms...");
        saveBtn.innerHTML = `<span style="font-size:10px;">Retrying...</span>`;
        await new Promise(r => setTimeout(r, 500));
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

    saveBtn.innerHTML = `<span style="color:#10b981;font-weight:600;">Saved</span>`;
    saveBtn.style.pointerEvents = "auto";
    setTimeout(() => saveBtn.innerHTML = originalHtml, 1500);

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
        grid.innerHTML = `<div class="empty-state">No saved components yet.</div>`;
        return;
    }

    library.forEach(comp => {
        const card = document.createElement("div");
        card.className = "lib-card";

        let thumbContent = "";
        if (comp.thumbnail && comp.thumbnail.startsWith("data:image")) {
            thumbContent = `<img src="${comp.thumbnail}" style="width:100%; height:100%; object-fit:contain; background:#f8fafc; display:block;">`;
        } else {
            thumbContent = `<div style="display:flex;align-items:center;justify-content:center;color:#cbd5e1;height:100%;font-size:11px;">No Preview</div>`;
        }

        card.innerHTML = `
            <div class="lib-thumb">${thumbContent}</div>
            <div class="lib-info">
                <div class="lib-meta">
                    <div class="lib-name" title="${comp.name}">${comp.name}</div>
                    <div class="lib-date">${new Date(comp.timestamp).toLocaleDateString()}</div>
                </div>
                <div class="lib-actions">
                    <div class="lib-btn lib-rename" title="Rename">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </div>
                    <div class="lib-btn lib-delete" title="Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </div>
                </div>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (e.target.closest(".lib-btn")) return;
            loadComponent(comp);
        });

        card.querySelector(".lib-rename").addEventListener("click", async (e) => {
            e.stopPropagation();
            const newName = prompt("Rename component:", comp.name);
            if (newName && newName.trim()) {
                const data = await chrome.storage.local.get(['componentLibrary']);
                const list = data.componentLibrary || [];
                const item = list.find(c => c.id === comp.id);
                if (item) {
                    item.name = newName.trim();
                    await chrome.storage.local.set({ componentLibrary: list });
                    renderLibrary();
                }
            }
        });

        card.querySelector(".lib-delete").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm("Delete this component?")) {
                const data = await chrome.storage.local.get(['componentLibrary']);
                const list = data.componentLibrary || [];
                await chrome.storage.local.set({ componentLibrary: list.filter(c => c.id !== comp.id) });
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

    document.querySelectorAll(".view-btn").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-target="preview"]').classList.add("active");

    document.querySelectorAll(".view-section").forEach(el => el.classList.remove("active-view"));
    document.getElementById("preview-wrapper").classList.add("active-view");

    const fontText = document.querySelector("#custom-font-select .selected-text");
    const fontItem = FONT_LIBRARY.find(f => f.value === currentFont);
    if (fontText) fontText.textContent = fontItem ? fontItem.name : "System Default";

    renderDemo();
}

// ==========================================
// 2. Helper Functions
// ==========================================

function expandHex(hex) {
    if (!hex) return "#000000";
    if (hex.length === 4 && hex.startsWith("#")) {
        return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
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

    const createStyleAttr = (existingContent = "") => {
        let finalEntries = [...colorEntries];
        if (existingContent) {
            existingContent = existingContent.trim().replace(/,$/, '');
            finalEntries.push(existingContent);
        }
        if (finalEntries.length === 0) return "";
        return `style={{ ${finalEntries.join(", ")} }}`;
    };

    const rootTagRegex = /(return\s*\(?\s*|=>\s*\(?\s*)<([a-zA-Z0-9]+)([^>]*?)>/g;

    processedCode = processedCode.replace(rootTagRegex, (match, prefix, tagName, attributes) => {
        const styleMatch = attributes.match(/style=\{\{([\s\S]*?)\}\}/);
        let newAttributes = attributes;
        let existingStyle = "";

        if (styleMatch) {
            existingStyle = styleMatch[1];
            newAttributes = newAttributes.replace(styleMatch[0], "");
        }

        const newStyleStr = createStyleAttr(existingStyle);

        if (newStyleStr) {
            return `${prefix}<${tagName} ${newStyleStr}${newAttributes}>`;
        }
        return match;
    });

    return processedCode;
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
    if (colorMap.size === 0) return { processedCode: rawCode, variables: [] };

    let processedCode = rawCode;
    const sortedColors = Array.from(colorMap.keys()).sort((a, b) => b.length - a.length);
    sortedColors.forEach(hex => {
        const varName = colorMap.get(hex);
        processedCode = processedCode.split(hex).join(`var(${varName})`);
        processedCode = processedCode.split(hex.toUpperCase()).join(`var(${varName})`);
    });
    const variables = Array.from(colorMap.entries()).map(([hex, name]) => ({ key: name, value: hex }));
    return { processedCode, variables };
}

function updateTextInCode(oldText, newText) {
    if (!oldText || oldText === newText) return;
    currentSourceCode = currentSourceCode.replaceAll(oldText, newText);
    const editor = document.getElementById("code-editor");
    if (editor) editor.textContent = injectRootStyles(currentSourceCode, currentVariables, currentFont);
}

function cleanCode(code) {
    if (!code) return "";
    return code.replace(/^```(jsx|javascript|js|tsx|vue|html)?\n/, "").replace(/```$/, "");
}

// 🔥 V48.0 Update Variable Name Logic
function updateVariableName(oldKey, newKey) {
    if (oldKey === newKey) return;

    // 1. Check Duplicates
    const exists = currentVariables.find(v => v.key === newKey);
    if (exists) {
        alert(`Variable name "${newKey}" already exists!`);
        renderControls();
        return;
    }

    // 2. Update Data
    const targetVar = currentVariables.find(v => v.key === oldKey);
    if (targetVar) {
        targetVar.key = newKey;
    }

    // 3. Update Code References
    if (currentSourceCode) {
        // Safe global replace
        currentSourceCode = currentSourceCode.split(oldKey).join(newKey);
    }

    // 4. Render
    renderDemo();
}

// ==========================================
// 3. UI Renderers
// ==========================================

function renderControls() {
    const container = document.getElementById("color-controls");
    if (!container) return;
    container.innerHTML = "";
    if (currentVariables.length === 0) {
        container.innerHTML = `<div style="color: #cbd5e1; font-size: 12px; grid-column: span 2; text-align: center;">No colors detected</div>`;
        return;
    }
    currentVariables.forEach(v => {
        const div = document.createElement("div");
        div.className = "color-item";

        const safeHex = expandHex(v.value);
        const displayName = v.key.startsWith("--") ? v.key.substring(2) : v.key;

        div.innerHTML = `
            <input type="color" value="${safeHex}" title="Change Color Value">
            <input type="text" class="var-name-input" value="${displayName}" title="Rename Variable">
        `;

        // Color Change
        const colorInput = div.querySelector("input[type='color']");
        colorInput.addEventListener("input", (e) => {
            const iframe = document.getElementById("preview-iframe");
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: "UPDATE_STYLE", key: v.key, value: e.target.value }, "*");
            }
        });
        colorInput.addEventListener("change", (e) => {
            v.value = e.target.value;
            renderDemo();
        });

        // 🔥 Name Change
        const nameInput = div.querySelector(".var-name-input");
        nameInput.addEventListener("focus", () => nameInput.select());
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameInput.blur();
        });
        nameInput.addEventListener("change", (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== displayName) {
                const finalKey = newName.startsWith("--") ? newName : `--${newName}`;
                updateVariableName(v.key, finalKey);
            } else {
                nameInput.value = displayName;
            }
        });

        container.appendChild(div);
    });
}

function renderDemo(rawCode = null, layoutData = null) {
    const finalLayout = layoutData || cachedLayout;
    if (rawCode) {
        const result = processRawCode(rawCode);
        currentSourceCode = result.processedCode;
        currentVariables = result.variables;
    } else if (!currentSourceCode) {
        const result = processRawCode(DEMO_DATA.code_html);
        currentSourceCode = result.processedCode;
        currentVariables = result.variables;
    }
    const codeWithStyle = injectRootStyles(currentSourceCode, currentVariables, currentFont);

    renderControls();

    const editor = document.getElementById("code-editor");
    if (editor) editor.textContent = codeWithStyle;

    const iframe = document.getElementById("preview-iframe");
    if (iframe) {
        const cleanedCode = cleanCode(codeWithStyle);
        const payload = { type: "RENDER", code: cleanedCode, layout: finalLayout };

        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(payload, "*");
        } else {
            iframe.onload = () => iframe.contentWindow.postMessage(payload, "*");
        }

        if (isEditMode) {
            setTimeout(() => iframe.contentWindow.postMessage({ type: "TOGGLE_EDIT_MODE", enable: true }, "*"), 200);
        }
    }
}

// ==========================================
// 4. Initialization
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    document.getElementById("copy-btn").addEventListener("click", () => {
        const editor = document.getElementById("code-editor");
        const codeToCopy = editor ? editor.textContent : currentSourceCode;
        if (!codeToCopy) return;
        navigator.clipboard.writeText(codeToCopy).then(() => {
            const btn = document.getElementById("copy-btn");
            const original = btn.innerHTML;
            btn.innerHTML = `<span style="color: #10b981; font-weight: 600;">Copied!</span>`;
            setTimeout(() => btn.innerHTML = original, 1500);
        });
    });

    const editBtn = document.getElementById("edit-btn");
    editBtn.addEventListener("click", () => {
        isEditMode = !isEditMode;
        if (isEditMode) {
            editBtn.classList.add("active");
            editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg><span>Done</span>`;
        } else {
            editBtn.classList.remove("active");
            editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg><span>Edit</span>`;
        }
        const iframe = document.getElementById("preview-iframe");
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: "TOGGLE_EDIT_MODE", enable: isEditMode }, "*");
    });

    const saveBtn = document.getElementById("save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveComponent);

    // Tab Logic
    const tabs = document.querySelectorAll(".view-btn");
    const sections = document.querySelectorAll(".view-section");

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
        });
    });

    // Canvas Background Logic
    const bgPresets = document.querySelectorAll(".bg-preset");
    const bgPicker = document.getElementById("canvas-bg-picker");

    function setCanvasColor(color) {
        bgPresets.forEach(div => {
            if (div.getAttribute("data-color") === color) div.classList.add("selected");
            else div.classList.remove("selected");
        });
        const iframe = document.getElementById("preview-iframe");
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: "UPDATE_CANVAS_BG", color: color }, "*");
        }
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
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: "UPDATE_CANVAS_BG", color: e.target.value }, "*");
            }
        });
    }

    // Resizer Logic
    const resizer = document.getElementById("resizer");
    const iframeBox = document.getElementById("iframe-box");
    const controlsBox = document.getElementById("controls-box");
    const iframeElement = document.getElementById("preview-iframe");
    let isResizing = false;

    if (resizer) {
        resizer.addEventListener("mousedown", (e) => {
            isResizing = true;
            document.body.style.cursor = "row-resize";
            e.preventDefault();
            if (iframeElement) iframeElement.style.pointerEvents = "none";
        });
        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const mainContainer = document.getElementById("main-container");
            const containerRect = mainContainer.getBoundingClientRect();
            const y = e.clientY - containerRect.top;

            if (y > 40 && y < containerRect.height - 40) {
                iframeBox.style.flex = "none";
                iframeBox.style.height = `${y - 6}px`;
                controlsBox.style.flex = "1";
                controlsBox.style.height = "auto";
            }
        });
        const stopResizing = () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = "default";
                if (iframeElement) iframeElement.style.pointerEvents = "auto";
            }
        };
        document.addEventListener("mouseup", stopResizing);
        document.addEventListener("mouseleave", stopResizing);
    }

    // Font Combobox
    const customSelect = document.getElementById("custom-font-select");
    const trigger = customSelect.querySelector(".select-trigger");
    const triggerText = trigger.querySelector(".selected-text");
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
            optionsList.innerHTML = `<div class="empty-search">No fonts found</div>`;
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
        trigger.classList.remove("active");
        const iframe = document.getElementById("preview-iframe");
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: "UPDATE_STYLE", key: "fontFamily", value: value }, "*");
        renderDemo();
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = customSelect.classList.contains("open");
        if (isOpen) {
            customSelect.classList.remove("open");
            trigger.classList.remove("active");
        } else {
            customSelect.classList.add("open");
            trigger.classList.add("active");
            searchInput.value = "";
            renderFontOptions("");
            setTimeout(() => searchInput.focus(), 50);
        }
    });
    searchInput.addEventListener("input", (e) => renderFontOptions(e.target.value));
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
        if (!customSelect.contains(e.target)) {
            customSelect.classList.remove("open");
            trigger.classList.remove("active");
        }
    });
    renderFontOptions();

    window.addEventListener("message", (event) => {
        if (event.data.type === "SCREENSHOT_RESULT") {
            if (screenshotResolver) {
                screenshotResolver(event.data.dataUrl);
            }
        }
        if (event.data.type === "UPDATE_TEXT_CONTENT") {
            const { oldText, newText } = event.data;
            updateTextInCode(oldText, newText);
        }
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "BROADCAST_LAYOUT" && msg.layout) {
        cachedLayout = msg.layout;
        const iframe = document.getElementById("preview-iframe");
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: "UPDATE_LAYOUT", layout: msg.layout }, "*");
    }
    if (msg.type === "UPDATE_CODE_WITH_REAL_DATA") {
        renderDemo(msg.html || msg.code, cachedLayout);
    }
});