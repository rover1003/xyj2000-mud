/**
 * XYJ2000 Web MUD 客户端
 *
 * 功能：
 * - xterm.js 终端
 * - WebSocket ↔ telnet 桥接
 * - 键绑定（方向键 / 小键盘 / F1-F5）
 * - 命令历史
 * - 状态条 (HP/MP/经验) 解析与显示
 * - 移动端适配：虚拟方向键、面板抽屉
 */

// ============================================================
// 按键绑定引擎
// ============================================================
class KeyBinder {
  constructor() {
    this.bindings = {
      'Numpad8':    { action: 'north', desc: '向北移动' },
      'Numpad2':    { action: 'south', desc: '向南移动' },
      'Numpad4':    { action: 'west',  desc: '向西移动' },
      'Numpad6':    { action: 'east',  desc: '向东移动' },
      'Numpad7':    { action: 'northwest', desc: '向西北移动' },
      'Numpad9':    { action: 'northeast', desc: '向东北移动' },
      'Numpad1':    { action: 'southwest', desc: '向西南移动' },
      'Numpad3':    { action: 'southeast', desc: '向东南移动' },
      'Numpad5':    { action: 'look',       desc: '查看四周' },
      'F1':         { action: 'help',       desc: '帮助' },
      'F2':         { action: 'hp',         desc: '查看状态' },
      'F3':         { action: 'skills',     desc: '查看技能' },
      'F4':         { action: 'score',      desc: '查看分数' },
      'F5':         { action: 'inventory',  desc: '查看物品' },
      'NumpadDivide':   { action: 'help',      desc: '帮助 (小/)' },
      'NumpadMultiply': { action: 'hp',        desc: '查看状态 (小*)' },
      'NumpadSubtract': { action: 'skills',    desc: '查看技能 (小-)' },
      'NumpadAdd':      { action: 'score',     desc: '查看分数 (小+)' },
      'NumpadDecimal':  { action: 'inventory', desc: '查看物品 (小.)' },
    };
    this.handler = null;
  }

  onTrigger(cb) { this.handler = cb; }
  getAll() { return { ...this.bindings }; }
  get(key) { return this.bindings[key] || null; }

  set(key, action, desc) {
    if (action === null || action === '') {
      delete this.bindings[key];
    } else {
      this.bindings[key] = { action, desc: desc || action };
    }
    this._save();
  }

  remove(key) { delete this.bindings[key]; this._save(); }

  handle(key, event) {
    const binding = this.bindings[key];
    if (binding && this.handler) {
      this.handler(key, binding.action, event);
      return true;
    }
    return false;
  }

  load() {
    try {
      const saved = localStorage.getItem('xyj_keybindings');
      if (saved) Object.assign(this.bindings, JSON.parse(saved));
    } catch(e) { /* ignore */ }
  }

  _save() {
    try { localStorage.setItem('xyj_keybindings', JSON.stringify(this.bindings)); }
    catch(e) { /* ignore */ }
  }
}


// ============================================================
// WebSocket 连接
// ============================================================
class MudConnection {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.onData = null;
    this.onStatus = null;
    this.reconnectTimer = null;
    this._manualDisconnect = false;
  }

  connect(url) {
    this._manualDisconnect = false;
    this._updateStatus('connecting');
    try { this.ws = new WebSocket(url); }
    catch(e) { this._updateStatus('error', e.message); return; }

    this.ws.onopen = () => {
      this.connected = true;
      this._updateStatus('connected');
      this.send({ type: 'connect' });
    };
    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'data' && this.onData) this.onData(msg.text);
        else if (msg.type === 'sys' && this.onData) this.onData(msg.msg + '\r\n');
      } catch(e) { /* ignore */ }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this._updateStatus('disconnected');
      if (!this._manualDisconnect) this._scheduleReconnect(url);
    };
    this.ws.onerror = () => this._updateStatus('error', '连接错误');
  }

  disconnect() {
    this._manualDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.send({ type: 'disconnect' }); this.ws.close(); this.ws = null; }
    this.connected = false;
    this._updateStatus('disconnected');
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  sendCommand(text) { return this.send({ type: 'cmd', text }); }
  isConnected() { return this.connected; }

  _scheduleReconnect(url) {
    if (this.reconnectTimer) return;
    this._updateStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(url);
    }, 3000);
  }

  _updateStatus(status, msg) { if (this.onStatus) this.onStatus(status, msg); }
}


// ============================================================
// 自定义按钮 (用户可绑定的 5 个)
// ============================================================
class CustomButtons {
  constructor() {
    this.storageKey = 'xyj_custom_buttons';
    this.defaults = [
      { label: '查询', cmd: 'who' },
      { label: '时间', cmd: 'time' },
      { label: '看', cmd: 'look' },
      { label: '清屏', cmd: 'cls' },
      { label: '自定义', cmd: '' },
    ];
    this.buttons = this._load();
  }

  _load() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 5) return parsed;
      }
    } catch(e) { /* ignore */ }
    return this.defaults.map(b => ({ ...b }));
  }

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.buttons)); }
    catch(e) { /* ignore */ }
  }

  getAll() { return this.buttons.map(b => ({ ...b })); }

  set(idx, label, cmd) {
    if (idx < 0 || idx >= 5) return;
    this.buttons[idx] = {
      label: (label || '').trim() || `按钮${idx + 1}`,
      cmd: (cmd || '').trim(),
    };
    this._save();
  }

  getCmd(idx) {
    return (this.buttons[idx] && this.buttons[idx].cmd) || '';
  }
}


// ============================================================
// 游戏状态解析器 (XYJ2000 实际格式)
// ============================================================
class GameStats {
  constructor() {
    this.data = {
      hp: null,        // 气血 { current, max }
      mp: null,        // 法力 { current, max } (fallback 内力)
      spirit: null,    // 精神 { current, max }
      neili: null,     // 内力 { current, max }
      food: null,      // 食物 { current, max }
      water: null,     // 饮水 { current, max }
      potential: null, // 潜能
      kill: null,      // 杀气
      weapon: null,    // 兵器伤害力
      armor: null,     // 盔甲保护力
      martialScore: null, // 武学
      dao: null,       // 道行 (text)
      name: null,
      engName: null,
      age: null,
      daoLv: null,     // 道行境界
      martialLv: null, // 武学境界
      magicLv: null,   // 法力修为
      neiliLv: null,   // 内力修为
    };
    this.lastRaw = '';
    this._captureTimer = null;
    this._captureText = '';
    this.onUpdate = null;
  }

  startCapture() {
    if (this._captureTimer) clearTimeout(this._captureTimer);
    this._captureTimer = setTimeout(() => this._finishCapture(), 1500);
  }

  feed(text) {
    if (!this._captureTimer) return;
    this._captureText += text;
    this.lastRaw = this._captureText;
    if (this._captureTimer) clearTimeout(this._captureTimer);
    this._captureTimer = setTimeout(() => this._finishCapture(), 1500);
  }

  _finishCapture() {
    if (this._captureTimer) { clearTimeout(this._captureTimer); this._captureTimer = null; }
    const text = this._captureText;
    this._captureText = '';
    if (!text) return;
    this.lastRaw = text;
    const clean = this._stripAnsi(text);
    this._parse(clean);
    if (this.onUpdate) this.onUpdate(this.data, this.lastRaw);
  }

  _stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '');
  }

  _matchBar(text, labels) {
    for (const label of labels) {
      // 文本格式: 允许 ANSI 码、空格、换行等在标签和数字之间 (最多 80 字符)
      const textM = text.match(new RegExp(`${label}[\\s\\S]{0,80}?(\\d+)\\s*[\\/／]\\s*(\\d+)`));
      if (textM) return { current: parseInt(textM[1], 10), max: parseInt(textM[2], 10) };
    }
    return null;
  }

  _matchNum(text, labels) {
    for (const label of labels) {
      const m = text.match(new RegExp(`${label}[：:]\\s*(\\d+)`));
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  _matchText(text, labels) {
    for (const label of labels) {
      const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n\\r\\s]+)`));
      if (m) return m[1].trim();
    }
    return null;
  }

  _parse(text) {
    // 气血/精神/法力/内力/食物/饮水
    this.data.hp     = this._matchBar(text, ['气血', '精', '生命值', 'HP']);
    this.data.spirit = this._matchBar(text, ['精神', '神']);
    this.data.mp     = this._matchBar(text, ['法力', '内力', 'MP']);
    this.data.neili  = this._matchBar(text, ['内力']);
    this.data.food   = this._matchBar(text, ['食物']);
    this.data.water  = this._matchBar(text, ['饮水']);

    // 标量
    this.data.potential    = this._matchNum(text, ['潜能']);
    this.data.kill         = this._matchNum(text, ['杀气']);
    this.data.weapon       = this._matchNum(text, ['兵器伤害力']);
    this.data.armor        = this._matchNum(text, ['盔甲保护力']);
    this.data.martialScore = this._matchNum(text, ['武学']);

    // 文本 (注意 道行 可能是"没有道行"等)
    this.data.dao = this._matchText(text, ['道行']);

    // 姓名: 【...】... 中文名(英文名)
    const nameMatch = text.match(/【[^】]+】[^\n]*?(\S+?)\s*\((\S+?)\)/);
    if (nameMatch) {
      this.data.name = nameMatch[1].trim();
      this.data.engName = nameMatch[2].trim();
    }
    // 年龄
    const ageMatch = text.match(/你是一位(\S+?岁)的/);
    if (ageMatch) this.data.age = ageMatch[1];
    // 境界
    this.data.daoLv     = this._matchText(text, ['道行境界']);
    this.data.martialLv = this._matchText(text, ['武学境界']);
    this.data.magicLv   = this._matchText(text, ['法力修为']);
    this.data.neiliLv   = this._matchText(text, ['内力修为']);
  }
}


// ============================================================
// 主应用
// ============================================================
class MudApp {
  constructor() {
    this.term = null;
    this.fitAddon = null;
    this.conn = new MudConnection();
    this.binder = new KeyBinder();
    this.stats = new GameStats();
    this.customBtns = new CustomButtons();

    this.cmdHistory = [];
    this.cmdHistoryIdx = -1;

    this.elements = {};
    this.wsUrl = `ws://${location.host}`;
    this._isMobile = window.matchMedia('(max-width: 768px)').matches;
  }

  init() {
    this._cacheDom();
    this._initTerminal();
    this._initStats();
    this._initConnection();
    this._initBindings();
    this._initUI();
    this._initTouchPad();
    this._initCustomButtons();
    this._initMobileUI();

    this.binder.load();

    window.addEventListener('resize', () => {
      if (this.fitAddon) this.fitAddon.fit();
      this._isMobile = window.matchMedia('(max-width: 768px)').matches;
    });

    setTimeout(() => this.conn.connect(this.wsUrl), 200);
  }

  _cacheDom() {
    this.elements = {
      terminal:    document.getElementById('terminal-container'),
      cmdInput:    document.getElementById('cmd-input'),
      btnSend:     document.getElementById('btn-send'),
      btnConnect:  document.getElementById('btn-connect'),
      btnDisconnect: document.getElementById('btn-disconnect'),
      statusDot:   document.getElementById('status-dot'),
      statusText:  document.getElementById('status-text'),
      sbMud:       document.getElementById('sb-mud'),
      sbKeys:      document.getElementById('sb-keys'),
      sbStats:     document.getElementById('sb-stats'),
      btnRefreshStats: document.getElementById('btn-refresh-stats'),
      touchPad:    document.getElementById('touch-pad'),
      sidePanel:   document.getElementById('side-panel'),
      panelOverlay: document.getElementById('panel-overlay'),
      btnPanelToggle: document.getElementById('btn-panel-toggle'),
      btnDpadToggle:  document.getElementById('btn-dpad-toggle'),
      statHp:      document.getElementById('stat-hp'),
      statSpirit:  document.getElementById('stat-spirit'),
      statFali:    document.getElementById('stat-fali'),
      statNeili:   document.getElementById('stat-neili'),
      dHp:         document.getElementById('d-hp'),
      dSpirit:     document.getElementById('d-spirit'),
      dFali:       document.getElementById('d-fali'),
      dNeili:      document.getElementById('d-neili'),
      dName:       document.getElementById('d-name'),
      dAge:        document.getElementById('d-age'),
      dPotential:  document.getElementById('d-potential'),
      dKill:       document.getElementById('d-kill'),
      dWeapon:     document.getElementById('d-weapon'),
      dArmor:      document.getElementById('d-armor'),
      dDao:        document.getElementById('d-dao'),
      dMartial:    document.getElementById('d-martial'),
      dMagic:      document.getElementById('d-magic'),
      dNeiliLv:    document.getElementById('d-neili-lv'),
      dRaw:        document.getElementById('d-raw'),
      customRow:   document.getElementById('custom-row'),
      customEdit:  document.getElementById('custom-edit'),
      btnEditCustom:   document.getElementById('btn-edit-custom'),
      btnSaveCustom:   document.getElementById('btn-save-custom'),
      btnCancelCustom: document.getElementById('btn-cancel-custom'),
    };
  }

  _initTerminal() {
    this.fitAddon = new FitAddon.FitAddon();
    this.term = new Terminal({
      cursorBlink: true, cursorStyle: 'block',
      fontSize: this._isMobile ? 11 : 14,
      fontFamily: "'Consolas', 'Courier New', 'YaHei Consolas Hybrid', monospace",
      lineHeight: 1.2, rows: this._isMobile ? 25 : 40, cols: this._isMobile ? 40 : 100,
      theme: {
        background: '#0d1117', foreground: '#c9d1d9', cursor: '#64ffda',
        selectionBackground: '#264f78',
        black:   '#484f58', red:     '#ff7b72', green:   '#3fb950',
        yellow:  '#d29922', blue:    '#58a6ff', magenta: '#bc8cff',
        cyan:    '#39c5cf', white:   '#b1bac4',
        brightBlack:   '#6e7681', brightRed:     '#ffa198',
        brightGreen:   '#56d364', brightYellow:  '#e3b341',
        brightBlue:    '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan:    '#56d4dd', brightWhite:   '#f0f6fc',
      },
    });

    this.term.open(this.elements.terminal);
    setTimeout(() => this.fitAddon.fit(), 50);

    document.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.activeElement === this.elements.cmdInput) {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this._historyBack();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this._historyForward();
          return;
        }
      }
      if (this.binder.handle(event.code, event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  _initStats() {
    this.stats.onUpdate = (data, raw) => this._renderStats(data, raw);
  }

  _initConnection() {
    this.conn.onData = (text) => {
      if (this.term) this.term.write(text);
      this.stats.feed(text);
    };
    this.conn.onStatus = (status, msg) => this._updateConnectionUI(status, msg);
  }

  _renderStats(data, raw) {
    this._setBarStat(this.elements.statHp,     this.elements.dHp,     data.hp);
    this._setBarStat(this.elements.statSpirit, this.elements.dSpirit, data.spirit);
    this._setBarStat(this.elements.statFali,   this.elements.dFali,   data.fali);
    this._setBarStat(this.elements.statNeili,  this.elements.dNeili,  data.neili);

    this._setTextOnly(this.elements.dName,      data.name);
    this._setTextOnly(this.elements.dAge,       data.age);
    this._setTextOnly(this.elements.dPotential, data.potential);
    this._setTextOnly(this.elements.dKill,      data.kill);
    this._setTextOnly(this.elements.dWeapon,    data.weapon);
    this._setTextOnly(this.elements.dArmor,     data.armor);
    this._setTextOnly(this.elements.dDao,       data.dao);
    this._setTextOnly(this.elements.dMartial,   data.martialLv);
    this._setTextOnly(this.elements.dMagic,     data.magicLv);
    this._setTextOnly(this.elements.dNeiliLv,   data.neiliLv);

    if (this.elements.dRaw) {
      this.elements.dRaw.textContent = raw ? raw.slice(-2000) : '(无数据)';
    }

    const updated = new Date().toLocaleTimeString();
    if (this.elements.sbStats) {
      this.elements.sbStats.textContent = `状态: ${updated} 更新`;
    }

    if (this.elements.btnRefreshStats) {
      this.elements.btnRefreshStats.classList.remove('loading');
    }
  }

  _setBarStat(itemEl, detailEl, val) {
    if (!itemEl || !detailEl) return;
    const valEl = itemEl.querySelector('.value');
    const fill = itemEl.querySelector('.fill');
    if (val && Number.isFinite(val.current) && Number.isFinite(val.max) && val.max > 0) {
      const pct = Math.max(0, Math.min(100, (val.current / val.max) * 100));
      fill.style.width = pct + '%';
      fill.className = 'fill' + (pct < 25 ? ' low' : pct < 50 ? ' medium' : '');
      valEl.textContent = `${val.current}/${val.max}`;
      detailEl.textContent = `${val.current}/${val.max}`;
      itemEl.classList.remove('empty');
    } else {
      valEl.textContent = '--/--';
      detailEl.textContent = '--/--';
      itemEl.classList.add('empty');
    }
  }

  _setTextStat(itemEl, detailEl, val) {
    if (!itemEl || !detailEl) return;
    const valEl = itemEl.querySelector('.value');
    if (val != null && Number.isFinite(val)) {
      valEl.textContent = val.toLocaleString();
      detailEl.textContent = val.toLocaleString();
      itemEl.classList.remove('empty');
    } else {
      valEl.textContent = '--';
      detailEl.textContent = '--';
      itemEl.classList.add('empty');
    }
  }

  _setTextOnly(el, val) {
    if (!el) return;
    el.textContent = (val != null) ? val : '--';
  }

  _updateConnectionUI(status, msg) {
    const dot = this.elements.statusDot;
    const txt = this.elements.statusText;
    const btnConn = this.elements.btnConnect;
    const btnDisc = this.elements.btnDisconnect;
    const sb = this.elements.sbMud;

    switch (status) {
      case 'connected':
        dot.className = 'connected';
        txt.textContent = '已连接';
        sb.textContent = 'MUD: 已连接';
        btnConn.style.display = 'none';
        btnDisc.style.display = '';
        btnDisc.textContent = '断开';
        this.elements.cmdInput.placeholder = '输入命令... (Enter发送)';
        break;
      case 'connecting':
        dot.className = 'connecting';
        txt.textContent = '连接中...';
        sb.textContent = 'MUD: 连接中...';
        btnConn.style.display = 'none';
        btnDisc.style.display = '';
        btnDisc.textContent = '取消';
        break;
      case 'disconnected':
        dot.className = '';
        txt.textContent = '未连接';
        sb.textContent = 'MUD: 未连接';
        btnConn.style.display = '';
        btnDisc.style.display = 'none';
        this.elements.cmdInput.placeholder = '点击「连接」进入游戏';
        break;
      case 'reconnecting':
        dot.className = 'connecting';
        txt.textContent = '重连中...';
        sb.textContent = 'MUD: 重连中...';
        break;
      case 'error':
        dot.className = '';
        txt.textContent = msg || '连接错误';
        sb.textContent = `MUD: ${msg || '错误'}`;
        btnConn.style.display = '';
        btnDisc.style.display = 'none';
        break;
    }
  }

  _initBindings() {
    this.binder.onTrigger((key, action, event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.conn.isConnected()) return;
      this._sendAction(action);
    });
  }

  /** 发送命令 (绑定/虚拟键共用) */
  _sendAction(action) {
    if (!this.conn.isConnected()) return;
    if (action === 'hp') {
      this.stats.startCapture();
      if (this.elements.btnRefreshStats) this.elements.btnRefreshStats.classList.add('loading');
    }
    this.conn.sendCommand(action);
  }

  _initUI() {
    this.elements.btnConnect.addEventListener('click', () => this.conn.connect(this.wsUrl));
    this.elements.btnDisconnect.addEventListener('click', () => this.conn.disconnect());

    this.elements.cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendFromInput();
    });
    this.elements.btnSend.addEventListener('click', () => this._sendFromInput());

    this.elements.terminal.addEventListener('click', () => this.elements.cmdInput.focus());

    if (this.elements.btnRefreshStats) {
      this.elements.btnRefreshStats.addEventListener('click', () => this._refreshStats());
    }

    window.addEventListener('beforeunload', () => {
      if (this.conn.isConnected()) this.conn.disconnect();
    });
  }

  _refreshStats() {
    if (!this.conn.isConnected()) {
      this.term.write('\r\n⚠ 未连接，无法刷新状态。\r\n');
      return;
    }
    this.elements.btnRefreshStats.classList.add('loading');
    this.stats.startCapture();
    this.conn.sendCommand('hp');
  }

  _initTouchPad() {
    if (!this.elements.touchPad) return;
    const buttons = this.elements.touchPad.querySelectorAll('button[data-action]');
    const send = (action) => {
      if (!this.conn.isConnected()) return;
      this._sendAction(action);
    };
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      btn.addEventListener('click', (e) => { e.preventDefault(); send(action); });
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); send(action); }, { passive: false });
    });
  }

  _initMobileUI() {
    if (this.elements.btnPanelToggle) {
      this.elements.btnPanelToggle.addEventListener('click', () => this._togglePanel());
    }
    if (this.elements.panelOverlay) {
      this.elements.panelOverlay.addEventListener('click', () => this._togglePanel(false));
    }
    if (this.elements.btnDpadToggle) {
      // 桌面端可手动开关虚拟方向键
      this.elements.btnDpadToggle.addEventListener('click', () => {
        const pad = this.elements.touchPad;
        const showing = pad.style.display === 'block';
        pad.style.display = showing ? 'none' : 'block';
        this.elements.btnDpadToggle.classList.toggle('active', !showing);
      });
      // 移动端默认隐藏（被 CSS 控制显示）
      if (this._isMobile) {
        this.elements.touchPad.style.display = 'block';
        this.elements.btnDpadToggle.classList.add('active');
      }
    }
  }

  _togglePanel(force) {
    const sp = this.elements.sidePanel;
    const ov = this.elements.panelOverlay;
    const willOpen = force !== undefined ? force : !sp.classList.contains('open');
    sp.classList.toggle('open', willOpen);
    if (ov) ov.classList.toggle('show', willOpen);
  }

  _sendFromInput() {
    const input = this.elements.cmdInput;
    const text = input.value.trim();
    if (!text) return;
    if (this.conn.isConnected()) {
      this._sendAction(text);
      this.cmdHistory.push(text);
      this.cmdHistoryIdx = this.cmdHistory.length;
    } else if (text === 'connect' || text === '/connect') {
      this.conn.connect(this.wsUrl);
    } else {
      this.term.write('\r\n⚠ 未连接到服务器。点击「连接」按钮。\r\n');
    }
    input.value = '';
  }

  _historyBack() {
    if (this.cmdHistory.length === 0) return;
    this.cmdHistoryIdx = Math.max(0, this.cmdHistoryIdx - 1);
    this.elements.cmdInput.value = this.cmdHistory[this.cmdHistoryIdx] || '';
  }

  _historyForward() {
    if (this.cmdHistoryIdx >= this.cmdHistory.length - 1) {
      this.cmdHistoryIdx = this.cmdHistory.length;
      this.elements.cmdInput.value = '';
    } else {
      this.cmdHistoryIdx++;
      this.elements.cmdInput.value = this.cmdHistory[this.cmdHistoryIdx] || '';
    }
  }

  _initCustomButtons() {
    if (!this.elements.customRow) return;
    this._renderCustomButtons();

    this.elements.btnEditCustom.addEventListener('click', () => this._enterCustomEdit());
    this.elements.btnSaveCustom.addEventListener('click', () => this._saveCustomEdit());
    this.elements.btnCancelCustom.addEventListener('click', () => this._exitCustomEdit());
  }

  _renderCustomButtons() {
    const row = this.elements.customRow;
    const buttons = this.customBtns.getAll();
    row.innerHTML = buttons.map((b, i) => {
      const empty = !b.cmd;
      return `<button class="${empty ? 'empty' : ''}" data-idx="${i}" title="${this._escapeHtml(b.cmd || '未配置命令')}">${this._escapeHtml(b.label)}</button>`;
    }).join('');
    row.querySelectorAll('button').forEach(btn => {
      const send = (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.idx, 10);
        const cmd = this.customBtns.getCmd(idx);
        if (!cmd) {
          this.term.write('\r\n⚠ 该按钮未配置命令。点 ✏ 编辑。\r\n');
          return;
        }
        this._sendAction(cmd);
      };
      btn.addEventListener('click', send);
      btn.addEventListener('touchstart', send, { passive: false });
    });
  }

  _enterCustomEdit() {
    const buttons = this.customBtns.getAll();
    this.elements.customEdit.innerHTML = buttons.map((b, i) => `
      <div class="cb-edit-item">
        <input class="cb-edit-label" data-idx="${i}" value="${this._escapeHtml(b.label)}" placeholder="按钮${i + 1}" maxlength="8">
        <input class="cb-edit-cmd" data-idx="${i}" value="${this._escapeHtml(b.cmd)}" placeholder="命令 (如 look)">
      </div>
    `).join('');
    this.elements.customRow.style.display = 'none';
    this.elements.customEdit.style.display = 'grid';
    this.elements.btnEditCustom.style.display = 'none';
    this.elements.btnSaveCustom.style.display = '';
    this.elements.btnCancelCustom.style.display = '';
    const first = this.elements.customEdit.querySelector('input');
    if (first) first.focus();
  }

  _saveCustomEdit() {
    const labels = this.elements.customEdit.querySelectorAll('.cb-edit-label');
    const cmds = this.elements.customEdit.querySelectorAll('.cb-edit-cmd');
    for (let i = 0; i < 5; i++) {
      this.customBtns.set(i, labels[i].value, cmds[i].value);
    }
    this._exitCustomEdit();
  }

  _exitCustomEdit() {
    this._renderCustomButtons();
    this.elements.customRow.style.display = '';
    this.elements.customEdit.style.display = 'none';
    this.elements.btnEditCustom.style.display = '';
    this.elements.btnSaveCustom.style.display = 'none';
    this.elements.btnCancelCustom.style.display = 'none';
  }

  _escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}


// ============================================================
// 启动
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const app = new MudApp();
  app.init();
  window.mudApp = app;
});
