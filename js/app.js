// App — Main entry point, event binding, orchestration
(function() {
  'use strict';

  var GT = window.GitTutorial;

  // Initialize state
  var state = new GT.GitState();

  // Initialize renderer
  var renderer = new GT.Renderer(state);

  // Initialize parser with commands
  var parser = new GT.Parser(state, GT.commands);

  // Tutorial state
  var currentCardIndex = 0;
  var allCards = GT.tutorials;

  // Arrow reveal mapping: command → arrow name(s)
  var ARROW_MAP = {
    'add': ['add'],
    'commit': ['commit'],
    'push': ['push'],
    'pull': ['pull'],
    'fetch': ['pull'],
    'clone': ['clone'],
    'restore': ['restore'],
    'checkout': ['restore']
  };

  // === Terminal Input ===
  var inputEl = document.getElementById('terminal-input');

  function executeCommand(input) {
    if (!input || !input.trim()) return;

    // Show input in terminal
    renderer.renderTerminalInput(input);

    // Special: clear command (only clears terminal, not zones/arrows)
    if (input.trim() === 'clear') {
      parser.history.push(input.trim());
      parser.historyIndex = parser.history.length;
      renderer.terminalOutput.innerHTML = '';
      renderer.scrollTerminalToBottom();
      return;
    }

    // Parse and execute
    var result = parser.parse(input);

    if (result) {
      renderer.renderTerminalOutput(result);

      // Determine command name
      var parts = input.trim().split(/\s+/);
      var gitCmd = parts[0] === 'git' ? parts[1] : parts[0];

      // Refresh zones
      renderer.renderAll();

      // Special: reset-tutorial also clears arrows
      if (gitCmd === 'reset-tutorial') {
        renderer.visibleArrows = {};
        renderer.drawArrows();
      }

      // Reveal arrows based on command
      revealArrows(gitCmd);

      // Check if current task is completed
      checkTaskCompletion(input.trim());
    }

    renderer.scrollTerminalToBottom();
    inputEl.focus();
  }

  function revealArrows(cmd) {
    var arrowNames = ARROW_MAP[cmd];
    if (!arrowNames) return;
    for (var i = 0; i < arrowNames.length; i++) {
      renderer.showArrow(arrowNames[i]);
    }
  }

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var input = inputEl.value;
      inputEl.value = '';
      executeCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputEl.value = parser.getPrevHistory();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      inputEl.value = parser.getNextHistory();
    }
  });

  // Focus terminal input on click, but only if no text is selected
  document.querySelector('.terminal').addEventListener('click', function(e) {
    var selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    // Don't steal focus if user clicked on a link or button
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
    inputEl.focus();
  });

  // === Tutorial Navigation ===
  function showCard(index) {
    if (index < 0 || index >= allCards.length) return;
    currentCardIndex = index;
    var card = allCards[index];

    renderer.renderCard(card);
    renderer.renderSidebar(GT.chapters, card.id);
    renderer.updateProgress(index + 1, allCards.length);

    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').disabled = index === allCards.length - 1;

    bindSidebarEvents();
  }

  function checkTaskCompletion(input) {
    var card = allCards[currentCardIndex];
    if (!card || !card.task) return;

    var expected = card.task.prompt;
    var codeMatch = expected.match(/<code>([^<]+)<\/code>/g);
    if (!codeMatch) return;

    var normalizedInput = input.replace(/\s+/g, ' ').trim();

    for (var i = 0; i < codeMatch.length; i++) {
      var expectedCmd = codeMatch[i].replace(/<\/?code>/g, '').trim();
      if (!expectedCmd) continue;

      var normalizedExpected = expectedCmd.replace(/\s+/g, ' ');

      // Exact match, or the user typed the expected command with trailing
      // arguments. Compare token-wise so `git commit -m "first"` does not
      // satisfy a task that only asked for `git commit`.
      if (normalizedInput === normalizedExpected) {
        renderer.markTaskCompleted();
        if (card.id === 'ch5-pull') celebrate();
        return;
      }

      // A prompt with no flags (e.g. `git status`) also accepts extra args.
      var expectsFlags = /\s-/.test(normalizedExpected);
      if (!expectsFlags && normalizedInput.indexOf(normalizedExpected + ' ') === 0) {
        renderer.markTaskCompleted();
        if (card.id === 'ch5-pull') celebrate();
        return;
      }
    }
  }

  function celebrate() {
    // 1. 终端庆祝文字
    var lines = [
      '',
      '  ╔══════════════════════════════════════╗',
      '  ║                                      ║',
      '  ║   🎉 恭喜！你已掌握 Git 核心工作流     ║',
      '  ║                                      ║',
      '  ║      add → commit → push & pull      ║',
      '  ║                                      ║',
      '  ╚══════════════════════════════════════╝',
      ''
    ];
    var out = document.getElementById('terminal-output');
    lines.forEach(function(line) {
      var div = document.createElement('div');
      div.className = 'terminal-line celebrate-msg';
      div.textContent = line;
      out.appendChild(div);
    });
    renderer.scrollTerminalToBottom();

    // 2. 箭头逐个点亮，最后全部亮
    var arrows = ['add', 'commit', 'push', 'pull', 'clone', 'restore'];
    var delay = 0;
    var step = 1000;

    // 先熄灭所有箭头
    arrows.forEach(function(name) { renderer.hideArrow(name); });

    // 逐个点亮
    arrows.forEach(function(name, i) {
      setTimeout(function() {
        // 熄灭前一个，亮当前
        if (i > 0) renderer.hideArrow(arrows[i - 1]);
        renderer.showArrow(name);
      }, delay);
      delay += step;
    });

    // 最后全部亮
    setTimeout(function() {
      arrows.forEach(function(name) { renderer.showArrow(name); });
    }, delay);
  }

  // Nav buttons
  document.getElementById('btn-prev').addEventListener('click', function() {
    showCard(currentCardIndex - 1);
  });

  document.getElementById('btn-next').addEventListener('click', function() {
    showCard(currentCardIndex + 1);
  });

  // Sidebar events (delegated)
  function bindSidebarEvents() {
    var sidebar = document.getElementById('sidebar-chapters');

    sidebar.onclick = function(e) {
      var chapterTitle = e.target.closest('.chapter-title');
      if (chapterTitle) {
        var chapterCards = chapterTitle.parentElement.querySelector('.chapter-cards');
        if (chapterCards.style.display === 'none') {
          chapterCards.style.display = '';
          chapterTitle.classList.add('expanded');
        } else {
          chapterCards.style.display = 'none';
          chapterTitle.classList.remove('expanded');
        }
        return;
      }

      var cardItem = e.target.closest('.card-item');
      if (cardItem) {
        var cardId = cardItem.getAttribute('data-card-id');
        for (var i = 0; i < allCards.length; i++) {
          if (allCards[i].id === cardId) {
            showCard(i);
            break;
          }
        }
      }
    };
  }


  //right-click context menu
  function handleRightCtxAction(x, y, target) {
    var ctxMenu = document.getElementById('ctx-menu');
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.hidden = false;
    if (target!==null && target.classList.contains('zone-file')) {
      document.getElementById('ctx-create').hidden = true;
      document.getElementById('ctx-delete').hidden = false;
    } else {
      document.getElementById('ctx-create').hidden = false;
      document.getElementById('ctx-delete').hidden = true;
    }
  }
  var ctxMenu = document.getElementById('zone-working-files');
  var target = null;
  ctxMenu.addEventListener('contextmenu', function(e) {
    if(!state.initialized) return;
    e.preventDefault();
    target = e.target.closest('.zone-file, .zone-folder');
    handleRightCtxAction(e.clientX, e.clientY,target);
  });

  ctxMenu.addEventListener('dblclick', function(e) {
    e.stopPropagation();
    var target = e.target.closest('.zone-file');
    if (target) {
      // The .git directory row has no .file-name — ignore it instead of throwing.
      var nameEl = target.querySelector('.file-name');
      if (!nameEl) return;
      var fileName = nameEl.textContent;
      var file = state.workingDir[fileName];
      if (file) {
        document.getElementById('modal-title').textContent = fileName;
        document.getElementById('modal-editor').value = file.content;
        document.getElementById('ctx-menu').hidden = true;

        var diffEl = document.getElementById('modal-diff');
        var diff = computeFileDiff(fileName, file.content);
        if (diff) {
          diffEl.innerHTML = diff;
        } else {
          diffEl.innerHTML = '';
        }

        document.getElementById('file-modal').hidden = false;
        currentEditFile = fileName;
      }
    }
  });

  // Render the edit preview using the same LCS diff the terminal's `git diff`
  // uses, so the modal and the command output never disagree. An index-by-index
  // comparison would repaint every line after an insertion as changed.
  function computeFileDiff(fileName, wdContent) {
    var st = state.staging[fileName];
    var committedContent = '';

    if (state.HEAD) {
      var lastCommit = state._getCommit(state.HEAD);
      if (lastCommit && lastCommit.files[fileName]) {
        committedContent = lastCommit.files[fileName].content || '';
      }
    }
    var compareContent = st ? st.content : committedContent;

    if (wdContent === compareContent) {
      return '';
    }

    // Reuse the state's line diff: feed it the two versions and keep only the
    // body lines (skip the diff --git / --- / +++ / @@ headers).
    var raw = state._formatDiff(fileName, compareContent, wdContent);
    var lines = raw.split('\n');
    var html = '';
    var started = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!started) {
        if (line.charAt(0) === '@') started = true;   // first hunk header
        continue;
      }
      if (line.charAt(0) === '@') continue;           // later hunk headers

      var cls = 'diff-line';
      var text = line;
      if (line.charAt(0) === '+') { cls += ' diff-add'; text = line.substring(1); }
      else if (line.charAt(0) === '-') { cls += ' diff-del'; text = line.substring(1); }
      else if (line.charAt(0) === ' ') { text = line.substring(1); }

      html += '<span class="' + cls + '">' + escapeHtml(text) + '</span>\n';
    }
    return html;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var currentEditFile = null;
  document.getElementById('modal-save').addEventListener('click', function() {
    if (currentEditFile) {
      var newContent = document.getElementById('modal-editor').value;
      state.modifyFile(currentEditFile, newContent);
      renderer.renderAll();
    }
    document.getElementById('file-modal').hidden = true;
    currentEditFile = null;
  });
  document.getElementById('modal-cancel').addEventListener('click', function() {
    document.getElementById('file-modal').hidden = true;
    currentEditFile = null;
  });
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('file-modal').hidden = true;
    currentEditFile = null;
  });

  document.getElementById('ctx-create').addEventListener('click', function(e) {
    e.stopPropagation();
    var fileName = prompt('请输入文件名');
    if (!fileName) 
    {
      document.getElementById('ctx-menu').hidden = true;
      return;
    }
    state.createFile(fileName);
    document.getElementById('ctx-menu').hidden = true;
    renderer.renderAll();
  });
  document.getElementById('ctx-delete').addEventListener('click', function() {
    // `target` is the element captured on right-click; guard against it being
    // stale (e.g. the menu was opened before a re-render).
    if (target) {
      var nameEl = target.querySelector('.file-name');
      if (nameEl) {
        var res = state.deleteFile(nameEl.textContent);
        if (res && res.output) renderer.renderTerminalOutput(res);
      }
    }
    document.getElementById('ctx-menu').hidden = true;
    renderer.renderAll();
  });

  document.addEventListener('click', function() {
    document.getElementById('ctx-menu').hidden = true;
  });

  // === LocalStorage ===
  function saveState() {
    try {
      localStorage.setItem('git-tutorial-state', JSON.stringify({
        initialized: state.initialized,
        workingDir: state.workingDir,
        staging: state.staging,
        commits: state.commits,
        branches: state.branches,
        currentBranch: state.currentBranch,
        HEAD: state.HEAD,
        remote: state.remote,
        stash: state.stash,
        tags: state.tags,
        config: state.config,
        mergeConflict: state.mergeConflict,
        mergeConflictKinds: state.mergeConflictKinds,
        pendingMerge: state.pendingMerge,
        visibleArrows: renderer.visibleArrows
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var saved = localStorage.getItem('git-tutorial-state');
      if (!saved) return;
      var parsed = JSON.parse(saved);
      for (var key in parsed) {
        if (key === 'visibleArrows') {
          renderer.visibleArrows = parsed[key] || {};
        } else if (key in state) {
          state[key] = parsed[key];
        }
      }
      renderer.renderAll();
      renderer.drawArrows();
    } catch (e) {}
  }

  // === Initial Render ===
  function init() {
    renderer.renderAll();
    showCard(0);
    inputEl.focus();

    renderer.renderTerminalOutput({
      success: true,
      output: '欢迎使用 Git 交互式教程！\n输入 git help 查看所有命令，输入 reset-tutorial 重置所有状态。\n跟随左侧教程卡片，在终端中实践操作。\n'
    });
    renderer.scrollTerminalToBottom();

    // Restore saved state
    loadState();

    // Redraw arrows after layout settles
    setTimeout(function() { renderer.drawArrows(); }, 100);

    // Periodic save
    setInterval(saveState, 2000);
  }

  init();
})();
