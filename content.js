// content.js - V52.0 (Infinite Guides & Custom Glass UI)

class GeminiInspector {
  constructor() {
    this.state = 'idle'; // 'idle' | 'picking' | 'locked'
    this.hoveredElement = null;
    this.lockedElement = null;

    // DOM Elements
    this.host = null;
    this.shadow = null;

    // Visual Elements
    this.guideTop = null;
    this.guideBottom = null;
    this.guideLeft = null;
    this.guideRight = null;
    this.overlayBox = null;
    this.tagLabel = null;
    this.hud = null;
    this.elInfo = null;

    // Binds
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    this.init();
  }

  init() {
    this.host = document.createElement('div');
    this.host.id = 'gemini-ui-host';
    // 确保 Host 不阻挡任何交互，且层级最高
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;';
    document.body.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.renderUI();
  }

  renderUI() {
    const style = document.createElement('style');
    style.textContent = `
          * { box-sizing: border-box; font-family: 'Inter', -apple-system, sans-serif; user-select: none; }
          
          /* --- Infinite Guides (十字辅助线) --- */
          .guide {
              position: fixed; background: #3b82f6; opacity: 0; pointer-events: none; z-index: 999;
              transition: opacity 0.1s ease, background-color 0.2s;
          }
          .guide-v { width: 1px; height: 100vh; top: 0; }
          .guide-h { height: 1px; width: 100vw; left: 0; }

          /* --- Central Box (核心选区) --- */
          #overlay-box {
              position: fixed; z-index: 1000; pointer-events: none;
              background: rgba(59, 130, 246, 0.05);
              border: 1px solid #3b82f6;
              display: none;
              transition: border-color 0.2s, background-color 0.2s;
          }
          #tag-label {
              position: absolute; top: -22px; left: -1px;
              background: #3b82f6; color: white;
              padding: 3px 6px; font-size: 10px; font-weight: 600;
              border-radius: 4px 4px 4px 0;
              white-space: nowrap;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              transition: background-color 0.2s;
          }

          /* --- Locked State Styles (Green) --- */
          .locked .guide { background: #10b981; } 
          .locked #overlay-box { border-color: #10b981; background: rgba(16, 185, 129, 0.1); }
          .locked #tag-label { background: #10b981; }

          /* --- HUD Panel (Glassmorphism) --- */
          #hud {
              position: fixed; bottom: 24px; right: 24px; width: 280px;
              background: rgba(15, 23, 42, 0.90); /* Slate 900 Glass */
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border: 1px solid rgba(255,255,255,0.1);
              border-radius: 16px;
              box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5);
              color: #e2e8f0; display: none; flex-direction: column;
              font-size: 13px; opacity: 0; transform: translateY(10px);
              transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          }
          #hud.visible { opacity: 1; transform: translateY(0); display: flex; }

          .hud-header {
              padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
              display: flex; justify-content: space-between; align-items: center;
          }
          .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: white; letter-spacing: 0.5px; }
          .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); color: #94a3b8; }
          
          .hud-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

          /* Custom Toggle Buttons (No more native select) */
          .toggle-group { display: flex; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 2px; }
          .toggle-item {
              flex: 1; text-align: center; padding: 6px; cursor: pointer;
              font-size: 11px; color: #94a3b8; border-radius: 6px; transition: all 0.2s;
          }
          .toggle-item:hover { color: #cbd5e1; }
          .toggle-item.active { background: #334155; color: white; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
          
          .element-info { 
              display: flex; align-items: center; gap: 8px; font-family: 'Menlo', monospace; 
              font-size: 11px; color: #cbd5e1; background: rgba(255,255,255,0.05);
              padding: 10px; border-radius: 8px; overflow: hidden;
          }

          /* D-Pad Buttons */
          .d-pad { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
          .nav-btn { 
              background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05);
              color: #94a3b8; padding: 8px; border-radius: 6px; text-align: center; 
              cursor: pointer; font-size: 12px; transition: all 0.1s; display: flex; justify-content: center; align-items: center;
          }
          .nav-btn:hover { background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.1); }
          .nav-btn:active { transform: scale(0.96); }

          /* Actions */
          .action-row { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 4px; }
          .btn {
              border: none; padding: 10px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer;
              transition: transform 0.1s, opacity 0.2s;
          }
          .btn:active { transform: scale(0.97); }
          .btn-cancel { background: rgba(255,255,255,0.08); color: #cbd5e1; }
          .btn-cancel:hover { background: rgba(255,255,255,0.12); }
          .btn-primary { 
              background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
              color: white; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
          }
          .btn-primary:hover { opacity: 0.9; }
      `;

    const container = document.createElement('div');
    container.innerHTML = `
          <div id="g-top" class="guide guide-h"></div>
          <div id="g-bottom" class="guide guide-h"></div>
          <div id="g-left" class="guide guide-v"></div>
          <div id="g-right" class="guide guide-v"></div>
          
          <div id="overlay-box">
              <div id="tag-label">div</div>
          </div>

          <div id="hud">
              <div class="hud-header">
                  <div class="brand">
                      <svg width="56" height="20" viewBox="0 0 180 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <g clip-path="url(#clip0_7_62-ct)">
                              <mask id="mask0_7_62-ct" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="64">
                                  <path d="M180 0H0V64H180V0Z" fill="white"/>
                              </mask>
                              <g mask="url(#mask0_7_62-ct)">
                                  <mask id="mask1_7_62-ct" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="65" height="64">
                                      <path d="M64.4882 0H0V64H64.4882V0Z" fill="white"/>
                                  </mask>
                                  <g mask="url(#mask1_7_62-ct)">
                                      <path d="M10.6355 46.4187L17.7072 53.4368L53.8583 17.5591V64H29.0551C13.0084 64 8.2192e-07 51.0899 0 35.1649V10.5495H46.7781L10.6355 46.4187ZM53.8583 17.5467L46.8078 10.5495H53.8583V17.5467Z" fill="white" fill-opacity="0.98"/>
                                      <path d="M35.4331 0C51.4796 0 64.4882 12.91 64.4882 28.8352V53.4505H10.6299V0H35.4331ZM10.6354 46.4186L17.7071 53.4368L53.8646 17.5529L46.7929 10.5347L10.6354 46.4186Z" fill="white" fill-opacity="0.98"/>
                                  </g>
                                  <path d="M179.996 48.6526V59.0544H173.707C169.225 59.0544 165.732 57.9783 163.226 55.8262C160.72 53.6263 159.467 50.0634 159.467 45.1375V29.2121H154.134V19.0256H159.467V9.26944H171.828V19.0256H179.923V29.2121H171.828V45.281C171.828 46.4766 172.117 47.3374 172.695 47.8635C173.273 48.3896 174.237 48.6526 175.586 48.6526H179.996Z" fill="white"/>
                                  <path d="M154.134 29.2121H145.057V59.0544H132.696V29.2121H128.215V19.0256H132.696V17.8778C132.696 12.9519 134.118 9.22161 136.961 6.68693C139.804 4.10443 143.973 2.81317 149.466 2.81317C150.382 2.81317 151.056 2.83708 151.49 2.8849V13.2867C149.129 13.1432 147.466 13.478 146.503 14.291C145.539 15.104 145.057 16.5626 145.057 18.6669V19.0256H154.134V29.2121Z" fill="white"/>
                                  <path d="M121.536 22.483V59.0544H110.197V22.483H121.536Z" fill="white"/>
                                  <path d="M108.941 12.3511L115.933 4.90057L122.924 12.3511L115.933 19.8017L108.941 12.3511Z" fill="white"/>
                                  <path d="M88.7711 49.5852H104.963V59.0544H76.4106V8.69556H88.7711V49.5852Z" fill="white"/>
                              </g>
                          </g>
                          <defs>
                              <clipPath id="clip0_7_62-ct">
                                  <rect width="180" height="64" fill="white"/>
                              </clipPath>
                          </defs>
                      </svg>
                  </div>
                  <div class="status-badge" id="hud-status">LOCKED</div>
              </div>

              <div class="hud-body">
                  <div class="toggle-group" id="group-format">
                      <div class="toggle-item active" data-val="react">React</div>
                      <div class="toggle-item" data-val="vue">Vue</div>
                      <div class="toggle-item" data-val="html">HTML</div>
                  </div>

                  <div class="toggle-group" id="group-style">
                      <div class="toggle-item active" data-val="tailwind">Tailwind</div>
                      <div class="toggle-item" data-val="inline">Inline</div>
                  </div>

                  <div class="element-info" id="el-info">
                      &lt;div&gt;
                  </div>

                  <div class="d-pad">
                      <div></div>
                      <div class="nav-btn" id="btn-up" title="Parent (Arrow Up)">⬆️</div>
                      <div></div>
                      <div class="nav-btn" id="btn-left" title="Previous (Arrow Left)">⬅️</div>
                      <div class="nav-btn" id="btn-down" title="Child (Arrow Down)">⬇️</div>
                      <div class="nav-btn" id="btn-right" title="Next (Arrow Right)">➡️</div>
                  </div>

                  <div class="action-row">
                      <button class="btn btn-cancel" id="btn-reselect">Cancel</button>
                      <button class="btn btn-primary" id="btn-capture">Capture</button>
                  </div>
              </div>
          </div>
      `;

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    // Cache DOM Refs
    this.guideTop = this.shadow.getElementById('g-top');
    this.guideBottom = this.shadow.getElementById('g-bottom');
    this.guideLeft = this.shadow.getElementById('g-left');
    this.guideRight = this.shadow.getElementById('g-right');
    this.overlayBox = this.shadow.getElementById('overlay-box');
    this.tagLabel = this.shadow.getElementById('tag-label');
    this.hud = this.shadow.getElementById('hud');
    this.elInfo = this.shadow.getElementById('el-info');

    // Setup Interactive Elements
    this.setupToggleGroup('group-format');
    this.setupToggleGroup('group-style');

    this.shadow.getElementById('btn-capture').addEventListener('click', () => this.executeCapture());
    this.shadow.getElementById('btn-reselect').addEventListener('click', () => this.enterPickingMode());

    this.shadow.getElementById('btn-up').addEventListener('click', () => this.navigateDOM('parent'));
    this.shadow.getElementById('btn-down').addEventListener('click', () => this.navigateDOM('child'));
    this.shadow.getElementById('btn-left').addEventListener('click', () => this.navigateDOM('prev'));
    this.shadow.getElementById('btn-right').addEventListener('click', () => this.navigateDOM('next'));
  }

  setupToggleGroup(groupId) {
    const group = this.shadow.getElementById(groupId);
    const items = group.querySelectorAll('.toggle-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  getToggleValue(groupId) {
    return this.shadow.querySelector(`#${groupId} .active`).dataset.val;
  }

  // ==========================================
  // State Management
  // ==========================================

  start() {
    if (this.state !== 'idle') return;
    this.enterPickingMode();
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  stop() {
    this.state = 'idle';
    this.hud.classList.remove('visible');
    this.hideOverlay();
    document.body.style.cursor = 'default';
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  enterPickingMode() {
    this.state = 'picking';
    this.lockedElement = null;
    this.hud.classList.remove('visible');
    this.host.classList.remove('locked'); // Remove green theme

    // Reset to blue theme
    this.setOverlayColor('#3b82f6', 'rgba(59, 130, 246, 0.05)');

    document.body.style.cursor = 'crosshair';
  }

  enterLockedMode(el) {
    if (!el) return;
    this.state = 'locked';
    this.lockedElement = el;
    this.hoveredElement = el;

    this.hud.classList.add('visible');
    this.host.classList.add('locked'); // Switch to green theme via CSS

    // Set to green theme
    this.setOverlayColor('#10b981', 'rgba(16, 185, 129, 0.1)');

    this.updateOverlay(el);
    document.body.style.cursor = 'default';
  }

  setOverlayColor(borderColor, bgColor) {
    const guides = [this.guideTop, this.guideBottom, this.guideLeft, this.guideRight];
    guides.forEach(g => g.style.backgroundColor = borderColor);
    this.overlayBox.style.borderColor = borderColor;
    this.overlayBox.style.backgroundColor = bgColor;
    this.tagLabel.style.backgroundColor = borderColor;
  }

  // ==========================================
  // Interaction Handlers
  // ==========================================

  handleMouseMove(e) {
    if (this.state !== 'picking') return;
    if (e.composedPath().includes(this.host)) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== this.hoveredElement && el !== this.host) {
      this.hoveredElement = el;
      this.updateOverlay(el);
    }
  }

  handleClick(e) {
    if (e.composedPath().includes(this.host)) return; // Allow HUD clicks

    e.preventDefault();
    e.stopPropagation();

    if (this.state === 'picking' && this.hoveredElement) {
      this.enterLockedMode(this.hoveredElement);
    } else if (this.state === 'locked') {
      // Visual feedback to use HUD
      this.hud.style.transform = "translateX(5px)";
      setTimeout(() => this.hud.style.transform = "translateX(0)", 100);
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.state === 'locked') this.enterPickingMode();
      else this.stop();
    }
    if (this.state === 'locked' && this.lockedElement) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowUp') this.navigateDOM('parent');
        if (e.key === 'ArrowDown') this.navigateDOM('child');
        if (e.key === 'ArrowLeft') this.navigateDOM('prev');
        if (e.key === 'ArrowRight') this.navigateDOM('next');
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.executeCapture();
      }
    }
  }

  // ==========================================
  // Visual Engine
  // ==========================================

  updateOverlay(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();

    this.overlayBox.style.display = 'block';
    this.overlayBox.style.top = `${rect.top}px`;
    this.overlayBox.style.left = `${rect.left}px`;
    this.overlayBox.style.width = `${rect.width}px`;
    this.overlayBox.style.height = `${rect.height}px`;

    // Update Infinite Guides
    this.guideTop.style.opacity = 1; this.guideTop.style.top = `${rect.top}px`;
    this.guideBottom.style.opacity = 1; this.guideBottom.style.top = `${rect.bottom}px`;
    this.guideLeft.style.opacity = 1; this.guideLeft.style.left = `${rect.left}px`;
    this.guideRight.style.opacity = 1; this.guideRight.style.left = `${rect.right}px`;

    // Update Info
    const tagName = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).slice(0, 2).join('.');
    this.tagLabel.textContent = classes ? `${tagName}.${classes}` : tagName;

    this.elInfo.innerHTML = `
          <span style="color:#38bdf8">&lt;${tagName}&gt;</span>
          <span style="color:#94a3b8; margin-left:auto;">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>
      `;
  }

  hideOverlay() {
    this.overlayBox.style.display = 'none';
    [this.guideTop, this.guideBottom, this.guideLeft, this.guideRight].forEach(g => g.style.opacity = 0);
  }

  navigateDOM(direction) {
    if (!this.lockedElement) return;
    let target = null;
    if (direction === 'parent') target = this.lockedElement.parentElement;
    if (direction === 'child') target = this.lockedElement.firstElementChild;
    if (direction === 'prev') target = this.lockedElement.previousElementSibling;
    if (direction === 'next') target = this.lockedElement.nextElementSibling;

    if (target && target.tagName !== 'BODY' && target !== this.host) {
      this.lockedElement = target;
      this.updateOverlay(target);
    }
  }

  // ==========================================
  // Capture Action
  // ==========================================

  executeCapture() {
    if (!this.lockedElement) return;
    const targetEl = this.lockedElement;
    const format = this.getToggleValue('group-format');

    // 1. 隐藏 HUD 以截图
    this.host.style.display = 'none';

    setTimeout(() => {
      // 2. 打开 Sidepanel
      chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });

      // 3. 截图
      chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" }, () => { });

      // 4. CDP 采集
      const uniqueId = "dm-" + Date.now();
      targetEl.setAttribute("data-divmagic-id", uniqueId);

      chrome.runtime.sendMessage({
        type: "CDP_GET_STYLE",
        selector: `[data-divmagic-id="${uniqueId}"]`,
        format: format
      }, () => {
        targetEl.removeAttribute("data-divmagic-id");
        this.stop(); // 彻底完成
        this.host.style.display = 'block'; // 恢复显示供下次使用
      });
    }, 50);
  }
}

// 启动入口
let inspector = null;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ACTIVATE_HUD") {
    if (!inspector) inspector = new GeminiInspector();
    inspector.start();
  }
});