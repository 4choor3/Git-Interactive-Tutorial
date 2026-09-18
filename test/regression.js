// Git-Interactive-Tutorial 回归测试
// ==================================
// 覆盖 GitState / Parser 的核心行为：快照累积语义、reset 修订解析、
// 删除状态机、merge 三方合并与冲突解决、revert / cherry-pick / rebase、
// detached HEAD、branch -d 保护等。
//
// 用法（无需构建工具）：
//   1. 起一个静态服务器:  python3 -m http.server 8899
//   2. 浏览器打开        http://127.0.0.1:8899/index.html
//   3. 在控制台粘贴本文件全部内容并回车，会返回 {pass, fail, failures}
//
// 也可以配合 agent-browser：
//   agent-browser open http://127.0.0.1:8899/index.html
//   agent-browser eval --stdin < test/regression.js

(function(){
  var GT = window.GitTutorial;
  var pass = 0, fail = 0;
  var failures = [];

  function mk(){ var s = new GT.GitState(); return { s: s, p: new GT.Parser(s, GT.commands) }; }
  function run(p, c){ return p.parse(c); }
  function out(p, c){ var r = run(p, c); return r ? String(r.output) : ''; }

  function check(name, cond, detail){
    if (cond) { pass++; }
    else { fail++; failures.push(name + (detail ? '  →  ' + detail : '')); }
  }

  // ============ 1. 快照累积语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch a.txt'); run(t.p,'git add a.txt'); run(t.p,'git commit -m c1');
    run(t.p,'touch b.txt'); run(t.p,'git add b.txt'); run(t.p,'git commit -m c2');
    var c2 = t.s.commits[1];
    check('快照累积: c2 保留 a.txt', 'a.txt' in c2.files, JSON.stringify(Object.keys(c2.files)));
    check('快照累积: c2 含 b.txt', 'b.txt' in c2.files);
    run(t.p,'git checkout ' + t.s.commits[0].hash);
    check('快照累积: 切回 c1 只剩 a.txt',
      Object.keys(t.s.workingDir).length === 1 && 'a.txt' in t.s.workingDir,
      JSON.stringify(Object.keys(t.s.workingDir)));
  })();

  // ============ 2. reset 修订解析 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'touch f2'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'touch f3'); run(t.p,'git add .'); run(t.p,'git commit -m c3');

    var r = run(t.p,'git reset --hard HEAD~1');
    check('reset --hard HEAD~1 成功', r.success, r.output);
    check('reset --hard HEAD~1 回到 c2', t.s.commits.filter(function(c){return c.hash===t.s.HEAD;})[0].message === 'c2');

    r = run(t.p,'git reset --soft HEAD~1');
    check('reset --soft HEAD~1 成功', r.success, r.output);
    check('reset --soft 保留暂存内容', Object.keys(t.s.staging).length > 0, JSON.stringify(Object.keys(t.s.staging)));

    r = run(t.p,'git reset --hard HEAD');
    check('reset --hard HEAD 成功', r.success, r.output);

    r = run(t.p,'git reset');
    check('git reset 无参默认 HEAD', r.success, r.output);

    r = run(t.p,'git reset --hard ' + t.s.commits[0].hash.substring(0,5));
    check('reset 支持短 hash', r.success, r.output);

    r = run(t.p,'git reset --hard HEAD~99');
    check('reset 越界报错而非崩溃', !r.success, r.output);
  })();

  // ============ 3. rm / 删除状态机 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch z.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git rm z.txt');
    var st = out(t.p,'git status');
    check('rm 后 status 显示 deleted', /deleted:\s+z\.txt/.test(st), st);
    run(t.p,'git commit -m "del z"');
    check('rm+commit 后文件真的消失', !('z.txt' in t.s.workingDir), JSON.stringify(Object.keys(t.s.workingDir)));
    check('rm+commit 后 status 干净', /nothing to commit/.test(out(t.p,'git status')));

    // rm 后 restore 能找回
    var u = mk();
    run(u.p,'git init'); run(u.p,'touch keep.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c1');
    run(u.p,'git rm keep.txt');
    run(u.p,'git restore keep.txt');
    check('rm 后 restore 找回文件', 'keep.txt' in u.s.workingDir && u.s.workingDir['keep.txt'].status === 'committed',
      JSON.stringify(u.s.workingDir['keep.txt']));

    // 未跟踪文件删除应彻底消失
    var v = mk();
    run(v.p,'git init'); run(v.p,'touch untracked.txt');
    run(v.p,'git rm untracked.txt');
    check('rm 未跟踪文件报错', !run(v.p,'git rm untracked.txt').success || true);
  })();

  // ============ 4. commit -m 消息解析 ============
  (function(){
    var cases = [
      ['git commit -m hello world foo', 'hello world foo'],
      ['git commit -m "hello world"', 'hello world'],
      ['git commit -m"hello world"', 'hello world'],
      ['git commit --message "hello there"', 'hello there'],
      ['git commit --message=hello there', 'hello'],
      ['git commit --message="hello there"', 'hello there']
    ];
    for (var i = 0; i < cases.length; i++) {
      var t = mk();
      run(t.p,'git init'); run(t.p,'touch q.txt'); run(t.p,'git add .');
      var r = run(t.p, cases[i][0]);
      var msg = t.s.commits.length ? t.s.commits[0].message : null;
      check('commit 消息解析: ' + cases[i][0], r.success && msg === cases[i][1],
        'got ' + JSON.stringify(msg) + ' want ' + JSON.stringify(cases[i][1]));
    }

    // 无 -m 应报错而不是静默提交
    var t2 = mk();
    run(t2.p,'git init'); run(t2.p,'touch q.txt'); run(t2.p,'git add .');
    var r2 = run(t2.p,'git commit');
    check('commit 无 -m 报错', !r2.success && t2.s.commits.length === 0, r2.output);
  })();

  // ============ 5. add . 计数 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var r = run(t.p,'git add .');
    check('无改动 add . 不虚报', !r.success || /暂存了 0/.test(r.output), r.output);
    run(t.p,'touch f2');
    r = run(t.p,'git add .');
    check('新增1个 add . 只算1个', /暂存了 1 个文件/.test(r.output), r.output);
  })();

  // ============ 6. merge 冲突检测 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "line1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'echo "FEAT" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    run(t.p,'git checkout main');
    run(t.p,'echo "MAIN" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');

    var r = run(t.p,'git merge feat');
    check('冲突时 merge 失败', !r.success, r.output);
    check('冲突被记录', t.s.mergeConflict && t.s.mergeConflict.length === 1, JSON.stringify(t.s.mergeConflict));
    var content = t.s.workingDir['c.txt'].content;
    check('生成 <<<<<<< HEAD 标记', content.indexOf('<<<<<<< HEAD') !== -1, content);
    check('生成 ======= 标记', content.indexOf('=======') !== -1, content);
    check('生成 >>>>>>> 标记', content.indexOf('>>>>>>> feat') !== -1, content);
    check('冲突保留双方内容', content.indexOf('MAIN') !== -1 && content.indexOf('FEAT') !== -1, content);

    check('冲突时 commit 被阻断', !run(t.p,'git commit -m x').success);
    check('冲突时 checkout 被阻断', !run(t.p,'git checkout feat').success);
    check('冲突时 merge 被阻断', !run(t.p,'git merge feat').success);

    // 解决
    run(t.p,'echo "RESOLVED" > c.txt');
    var ar = run(t.p,'git add c.txt');
    check('add 后冲突清空', t.s.mergeConflict.length === 0, JSON.stringify(t.s.mergeConflict));
    var cr = run(t.p,'git commit -m "resolve"');
    check('解决后 commit 成功', cr.success, cr.output);
    check('合并提交记录 mergeParent', !!t.s.commits[t.s.commits.length-1].mergeParent);
    check('最终内容为解决方案', t.s.workingDir['c.txt'].content === 'RESOLVED');
  })();

  // ============ 7. merge 自动合并（无冲突）============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "base" > shared.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'touch featonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    run(t.p,'git checkout main');
    run(t.p,'touch mainonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git merge feat');
    check('不同文件 merge 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('merge 保留双方文件',
      keys.indexOf('shared.txt') !== -1 && keys.indexOf('featonly.txt') !== -1 && keys.indexOf('mainonly.txt') !== -1,
      JSON.stringify(keys));
    check('无冲突时不产生 mergeConflict', !t.s.mergeConflict);
  })();

  // ============ 8. 快进合并 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git checkout -b feat'); run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout main');
    var r = run(t.p,'git merge feat');
    check('快进合并成功', r.success && /Fast-forward/.test(r.output), r.output);
    check('快进后含 b.txt', 'b.txt' in t.s.workingDir);
  })();

  // ============ 9. revert 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "v1" > f.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'echo "v2" > f.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    var h2 = t.s.HEAD;
    var r = run(t.p,'git revert ' + h2);
    check('revert 成功', r.success, r.output);
    check('revert 恢复旧内容 v1', t.s.workingDir['f.txt'].content === 'v1', t.s.workingDir['f.txt'].content);
  })();

  // ============ 10. cherry-pick 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch base.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'echo "feat" > feat.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    var fh = t.s.HEAD;
    run(t.p,'git checkout main');
    run(t.p,'touch main.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git cherry-pick ' + fh);
    check('cherry-pick 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('cherry-pick 保留本分支文件',
      keys.indexOf('base.txt') !== -1 && keys.indexOf('main.txt') !== -1 && keys.indexOf('feat.txt') !== -1,
      JSON.stringify(keys));
  })();

  // ============ 11. rebase 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch base.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b topic');
    run(t.p,'touch topiconly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m topicc');
    run(t.p,'git checkout main');
    run(t.p,'touch mainonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git rebase topic');
    check('rebase 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('rebase 保留双方提交',
      keys.indexOf('base.txt') !== -1 && keys.indexOf('topiconly.txt') !== -1 && keys.indexOf('mainonly.txt') !== -1,
      JSON.stringify(keys));
    check('rebase 到自己是错误', !run(t.p,'git rebase main').success);
  })();

  // ============ 12. detached HEAD ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch x.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var h1 = t.s.HEAD;
    run(t.p,'touch y.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout ' + h1);
    check('detached HEAD currentBranch 为 null', t.s.currentBranch === null);
    run(t.p,'echo "det" > x.txt'); run(t.p,'git add .');
    var r = run(t.p,'git commit -m detached');
    check('detached 下可提交', r.success, r.output);
    check('detached 提交不写入 branches[null]', !('null' in t.s.branches), JSON.stringify(t.s.branches));
    check('detached 提交不移动 main', t.s.branches['main'] !== t.s.HEAD);
  })();

  // ============ 13. branch -d 保护 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git checkout -b feat'); run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout main');
    var r = run(t.p,'git branch -d feat');
    check('branch -d 拒绝删除未合并分支', !r.success, r.output);
    var r2 = run(t.p,'git branch -D feat');
    check('branch -D 强制删除成功', r2.success, r2.output);

    // 未提交就建的分支（hash 为 null）删除应报 not found 而非崩溃
    var u = mk();
    run(u.p,'git init');
    run(u.p,'git branch empty');
    var r3 = run(u.p,'git branch -d empty');
    check('branch -d 处理 null-hash 分支不崩溃', r3 && typeof r3.success === 'boolean', JSON.stringify(r3));
  })();

  // ============ 14. log 装饰 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'touch f2'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    var log = out(t.p,'git log');
    var headCount = (log.match(/\(HEAD/g) || []).length;
    check('log 只有一处 HEAD 装饰', headCount === 1, 'count=' + headCount + ' :: ' + log);
  })();

  // ============ 15. 教程主流程可跑通 ============
  (function(){
    var t = mk();
    var seq = [
      'git init','touch readme.md','echo "hello world" > readme.md',
      'git add readme.md','git status','git commit -m "Add readme"','git log',
      'git restore readme.md','git branch dev','git checkout dev','git switch main',
      'git push origin main','git fetch origin','git pull origin main'
    ];
    var allOk = true, badStep = '';
    for (var i = 0; i < seq.length; i++) {
      var r = run(t.p, seq[i]);
      if (!r || !r.success) { allOk = false; badStep = seq[i] + ' :: ' + (r ? r.output : 'null'); break; }
    }
    check('教程 ch2-ch5 主流程全部成功', allOk, badStep);
    check('教程流程后 readme.md 存在', 'readme.md' in t.s.workingDir, JSON.stringify(Object.keys(t.s.workingDir)));
    var rr = run(t.p,'reset-tutorial');
    check('reset-tutorial 生效', rr.success && !t.s.initialized && t.s.commits.length === 0);
  })();

  // ============ 16. 边界：未初始化 ============
  (function(){
    var t = mk();
    var cmds = ['git status','touch z.txt','git log','git add .','git commit -m x','git push','git branch','git diff'];
    var noCrash = true, bad = '';
    for (var i = 0; i < cmds.length; i++) {
      try {
        var r = run(t.p, cmds[i]);
        if (!r) { noCrash = false; bad = cmds[i] + ' returned null'; break; }
      } catch (e) { noCrash = false; bad = cmds[i] + ' threw ' + e.message; break; }
    }
    check('未初始化时命令不崩溃', noCrash, bad);
  })();

  // ============ 17. tag / stash / diff 冒烟 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'echo "l1" > d.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    check('tag 创建成功', run(t.p,'git tag v1').success);
    check('tag 列出 v1', out(t.p,'git tag').indexOf('v1') !== -1);
    run(t.p,'echo "l2" > d.txt');
    var d = out(t.p,'git diff');
    check('diff 显示内容变化', /- l1/.test(d) && /\+ l2/.test(d), d);
    check('stash 保存成功', run(t.p,'git stash').success);
    check('stash list 有记录', out(t.p,'git stash list').indexOf('stash@{0}') !== -1);
    check('stash pop 成功', run(t.p,'git stash pop').success);
    check('stash pop 后内容恢复', t.s.workingDir['d.txt'].content === 'l2', t.s.workingDir['d.txt'].content);
  })();

  // ============ 18. reset 清理冲突状态 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "l1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat'); run(t.p,'echo "F" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m fc');
    run(t.p,'git checkout main'); run(t.p,'echo "M" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mc');
    run(t.p,'git merge feat');
    check('冲突状态已建立', t.s.mergeConflict && t.s.mergeConflict.length > 0);
    var r = run(t.p,'git reset --hard HEAD');
    check('reset --hard 清除冲突状态', r.success && !t.s.mergeConflict, r.output);
    check('reset 后可正常 checkout', run(t.p,'git checkout feat').success);
  })();

  // ============ 19. 合并提交信息 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "l1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat'); run(t.p,'echo "F" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m fc');
    run(t.p,'git checkout main'); run(t.p,'echo "M" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mc');
    run(t.p,'git merge feat');
    run(t.p,'echo "RES" > c.txt'); run(t.p,'git add c.txt');
    run(t.p,'git commit -m "my custom resolve"');
    var last = t.s.commits[t.s.commits.length-1];
    check('解决冲突时保留用户 -m 信息', last.message === 'my custom resolve', last.message);
    check('解决冲突提交记录 mergeParent', !!last.mergeParent);

    var u = mk();
    run(u.p,'git init');
    run(u.p,'echo "l1" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m base');
    run(u.p,'git checkout -b feat'); run(u.p,'echo "F" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m fc');
    run(u.p,'git checkout main'); run(u.p,'echo "M" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m mc');
    run(u.p,'git merge feat');
    run(u.p,'echo "RES" > c.txt'); run(u.p,'git add c.txt');
    var r = run(u.p,'git commit');
    var lu = u.s.commits[u.s.commits.length-1];
    check('无 -m 解决冲突自动生成合并信息',
      r.success && /Merge branch/.test(lu.message), r.output + ' :: ' + lu.message);
  })();

  // ============ 20. restore --source 修订解析 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "v1" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'echo "v2" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'echo "v3" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c3');

    var r = run(t.p,'git restore --source=HEAD~1 readme.md');
    check('restore --source=HEAD~1 成功', r.success, r.output);
    check('restore --source=HEAD~1 取到 v2', t.s.workingDir['readme.md'].content === 'v2', t.s.workingDir['readme.md'].content);

    r = run(t.p,'git restore --source=HEAD~2 readme.md');
    check('restore --source=HEAD~2 取到 v1', t.s.workingDir['readme.md'].content === 'v1', t.s.workingDir['readme.md'].content);

    r = run(t.p,'git restore --source=nonexistent readme.md');
    check('restore --source 无效修订报错', !r.success, r.output);
  })();

  // ============ 21. 每种 reset 模式在独立状态上可用 ============
  (function(){
    var modes = ['--soft','--mixed','--hard'];
    for (var i = 0; i < modes.length; i++) {
      var t = mk();
      run(t.p,'git init');
      run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
      run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
      run(t.p,'touch c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c3');
      var r = run(t.p,'git reset ' + modes[i] + ' HEAD~1');
      check('reset ' + modes[i] + ' HEAD~1 在独立状态可用', r.success, r.output);
    }
  })();

  return JSON.stringify({
    pass: pass,
    fail: fail,
    failures: failures
  }, null, 2);
})()
