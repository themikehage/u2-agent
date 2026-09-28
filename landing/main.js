/**
 * u2-agent Landing Page Interactive Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  initHeroTerminal();
  initCalculator();
  initSimulator();
  initCopyButtons();
});

/* ==========================================================================
   Hero Terminal Interactive Simulation
   ========================================================================== */
function initHeroTerminal() {
  const terminalBody = document.getElementById('hero-terminal-body');
  const btnReplay = document.getElementById('terminal-replay-btn');
  if (!terminalBody) return;

  const script = [
    { type: 'comment', text: '# 1. Request ultra-compact semantic screen snapshot' },
    { type: 'cmd', text: 'u2-agent ui snapshot' },
    { type: 'pause', delay: 400 },
    { type: 'output', html: '<div class="t-app-header">[App: com.google.android.youtube]</div>' },
    { type: 'output', html: '<span class="t-handle">[@1]</span> <span class="t-role">Input</span> <span class="t-text">"Search YouTube"</span>' },
    { type: 'output', html: '<span class="t-handle">[@2]</span> <span class="t-role">Button</span> <span class="t-text">"Explore trending"</span>' },
    { type: 'output', html: '<span class="t-handle">[@3]</span> <span class="t-role">Item</span> <span class="t-text">"Live lo-fi hip hop radio - beats to relax/study to"</span>' },
    { type: 'output', html: '<span class="t-handle">[@4]</span> <span class="t-role">Button</span> <span class="t-text">"Subscribe"</span>' },
    { type: 'pause', delay: 700 },
    { type: 'comment', text: '\n# 2. Tap search bar by ephemeral RAM handle (<15ms via daemon)' },
    { type: 'cmd', text: 'u2-agent ui tap --ref @1' },
    { type: 'pause', delay: 300 },
    { type: 'output', html: '<span class="t-success">ok</span>' },
    { type: 'pause', delay: 600 },
    { type: 'comment', text: '\n# 3. Type query with instant Unicode & accent support' },
    { type: 'cmd', text: 'u2-agent ui type --ref @1 --text "lofi study beats"' },
    { type: 'pause', delay: 350 },
    { type: 'output', html: '<span class="t-success">ok</span>' },
    { type: 'pause', delay: 600 },
    { type: 'comment', text: '\n# 4. Press Enter to submit search' },
    { type: 'cmd', text: 'u2-agent ui press --key enter' },
    { type: 'pause', delay: 250 },
    { type: 'output', html: '<span class="t-success">ok</span>' },
  ];

  let currentStep = 0;
  let isRunning = false;
  let abortController = new AbortController();

  async function runScript() {
    if (isRunning) return;
    isRunning = true;
    terminalBody.innerHTML = '';

    try {
      for (const item of script) {
        if (abortController.signal.aborted) break;

        if (item.type === 'comment') {
          const div = document.createElement('div');
          div.className = 't-comment';
          div.textContent = item.text;
          terminalBody.appendChild(div);
          terminalBody.scrollTop = terminalBody.scrollHeight;
        } else if (item.type === 'cmd') {
          const row = document.createElement('div');
          row.innerHTML = `<span class="t-prompt">$ </span><span class="t-cmd"></span><span class="t-cursor"></span>`;
          terminalBody.appendChild(row);
          const cmdSpan = row.querySelector('.t-cmd');
          const cursor = row.querySelector('.t-cursor');

          // Typewriter effect
          for (let i = 0; i < item.text.length; i++) {
            if (abortController.signal.aborted) break;
            cmdSpan.textContent += item.text[i];
            terminalBody.scrollTop = terminalBody.scrollHeight;
            await sleep(28);
          }
          cursor.remove();
        } else if (item.type === 'pause') {
          await sleep(item.delay);
        } else if (item.type === 'output') {
          const div = document.createElement('div');
          div.innerHTML = item.html;
          terminalBody.appendChild(div);
          terminalBody.scrollTop = terminalBody.scrollHeight;
        }
      }
    } finally {
      isRunning = false;
      const finalPrompt = document.createElement('div');
      finalPrompt.innerHTML = `<span class="t-prompt">$ </span><span class="t-cursor"></span>`;
      terminalBody.appendChild(finalPrompt);
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  if (btnReplay) {
    btnReplay.addEventListener('click', () => {
      abortController.abort();
      abortController = new AbortController();
      setTimeout(runScript, 100);
    });
  }

  runScript();
}

/* ==========================================================================
   Token Savings Calculator
   ========================================================================== */
function initCalculator() {
  const slider = document.getElementById('calc-steps-slider');
  const sliderDisplay = document.getElementById('calc-steps-val');
  const xmlTokensEl = document.getElementById('calc-xml-tokens');
  const u2TokensEl = document.getElementById('calc-u2-tokens');
  const savedTokensEl = document.getElementById('calc-saved-tokens');
  const costSavingsEl = document.getElementById('calc-cost-savings');

  if (!slider) return;

  function update() {
    const steps = parseInt(slider.value, 10);
    if (sliderDisplay) sliderDisplay.textContent = steps;

    const xmlTokens = steps * 15000;
    const u2Tokens = steps * 240;
    const saved = xmlTokens - u2Tokens;
    const percent = Math.round((saved / xmlTokens) * 100);

    // Assume average LLM input pricing of $3.00 per 1M tokens (e.g. Claude 3.5 Sonnet / GPT-4o)
    const dollarsSaved = ((saved / 1_000_000) * 3.0).toFixed(2);

    if (xmlTokensEl) xmlTokensEl.textContent = xmlTokens.toLocaleString() + ' tokens';
    if (u2TokensEl) u2TokensEl.textContent = u2Tokens.toLocaleString() + ' tokens';
    if (savedTokensEl) savedTokensEl.textContent = `${percent}% (${saved.toLocaleString()})`;
    if (costSavingsEl) costSavingsEl.textContent = `$${dollarsSaved} / run`;
  }

  slider.addEventListener('input', update);
  update();
}

/* ==========================================================================
   CLI Interactive Simulator
   ========================================================================== */
function initSimulator() {
  const tabs = document.querySelectorAll('.sim-tab');
  const titleEl = document.getElementById('sim-active-title');
  const descEl = document.getElementById('sim-active-desc');
  const cmdEl = document.getElementById('sim-active-cmd');
  const outputEl = document.getElementById('sim-output');
  const runBtn = document.getElementById('sim-run-btn');

  if (!tabs.length || !outputEl) return;

  const data = {
    snapshot: {
      title: 'UI Snapshot (Semantic Extraction)',
      desc: 'Retrieves compact view tree and assigns memory handles (@1, @2, ...) with automatic structural noise filtering.',
      cmd: 'u2-agent ui snapshot --limit 30',
      output: `[App: com.android.settings | fingerprint: a8f9c1e0]
[@1] Input "Search settings"
[@2] Item "Network & internet (Wi-Fi, Mobile, Data usage)"
[@3] Item "Connected devices (Bluetooth, pairing)"
[@4] Item "Apps (Recent apps, default apps)"
[@5] Item "Notifications (Notification history, conversations)"
[@6] Item "Battery (84% - About 1 d, 4 hr left)"
[@7] Item "Storage (42% used - 74 GB free)"`
    },
    tap: {
      title: 'Handle Tap (sub-15ms via Daemon)',
      desc: 'Dispatches tap directly to the cached RAM handle coordinates without cold re-dumping.',
      cmd: 'u2-agent ui tap --ref @2',
      output: `ok`
    },
    type: {
      title: 'Focused Input (UTF-8 / AdbKeyboard)',
      desc: 'Focuses element by handle and broadcasts text via AdbKeyboard for flawless Unicode handling.',
      cmd: 'u2-agent ui type --ref @1 --text "Wi-Fi Hotspot"',
      output: `ok`
    },
    schema: {
      title: 'Agent Tool Schema Export',
      desc: 'Exports standard function-calling schemas for OpenAI, Anthropic, or Gemini tool configurations.',
      cmd: 'u2-agent tools schema --format openai',
      output: `{
  "type": "function",
  "function": {
    "name": "u2_ui_tap",
    "description": "Tap visible UI element matching selector handle or coordinates",
    "parameters": {
      "type": "object",
      "properties": {
        "ref": { "type": "string", "description": "Element handle (@1..@N)" },
        "pos": { "type": "string", "description": "Target X,Y coordinates" }
      }
    }
  }
}`
    },
    restart: {
      title: 'App Lifecycle Management',
      desc: 'Force-stops and restarts application package in a single atomic ADB invocation.',
      cmd: 'u2-agent app restart --package com.google.android.youtube',
      output: `ok`
    }
  };

  function switchTab(key) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.key === key));
    const item = data[key];
    if (!item) return;

    if (titleEl) titleEl.textContent = item.title;
    if (descEl) descEl.textContent = item.desc;
    if (cmdEl) cmdEl.textContent = item.cmd;

    // Simulate instant execution
    outputEl.innerHTML = `<span class="t-prompt">$ </span><span class="t-cmd">${item.cmd}</span>\n\n${escapeHtml(item.output)}`;
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.key));
  });

  if (runBtn) {
    runBtn.addEventListener('click', () => {
      const activeTab = document.querySelector('.sim-tab.active');
      if (activeTab) {
        outputEl.innerHTML = '<span class="t-comment">Executing command on device...</span>';
        setTimeout(() => switchTab(activeTab.dataset.key), 120);
      }
    });
  }

  // Initial tab
  switchTab('snapshot');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ==========================================================================
   Copy Code Snippets
   ========================================================================== */
function initCopyButtons() {
  document.querySelectorAll('.copy-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.copyTarget;
      let textToCopy = '';

      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) textToCopy = el.textContent || el.innerText;
      } else if (btn.dataset.copyText) {
        textToCopy = btn.dataset.copyText;
      }

      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy.trim()).then(() => {
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          btn.style.color = '#00ff9d';
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = '';
          }, 2000);
        });
      }
    });
  });
}
