// Real-WebKit rendering check for the Object Editor's details view, Move dialog, lock editor and attribute
// context menu (see README.md). macOS only.
//
//   swiftc -O editor-probe.swift -o /tmp/editor-probe && /tmp/editor-probe http://127.0.0.1:8777/index.html?mock=1
//
// Loads the built front end in an offscreen WKWebView (the engine Wails uses), sends REAL mouse and key events
// with NSEvent through NSApp.sendEvent, and measures the DOM. Exit code 0 = all checks passed, 1 = a check failed.
import Cocoa
import WebKit

final class Probe: NSObject, NSApplicationDelegate {
  var win: NSWindow!
  var wv: WKWebView!
  var failures = 0
  let args = Array(CommandLine.arguments.dropFirst())
  typealias Step = (String, (@escaping () -> Void) -> Void)
  var steps: [Step] = []

  func applicationDidFinishLaunching(_ n: Notification) {
    win = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 1000, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
    wv = WKWebView(frame: win.contentView!.bounds)
    wv.autoresizingMask = [.width, .height]
    win.contentView!.addSubview(wv)
    guard let first = args.first, let url = URL(string: first) else {
      FileHandle.standardError.write("usage: editor-probe URL\n".data(using: .utf8)!)
      exit(2)
    }
    wv.load(URLRequest(url: url))
    win.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    build()
    after(4.0) { self.run(0) }
  }

  func after(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
  func js(_ s: String, _ done: @escaping (String) -> Void) {
    wv.evaluateJavaScript(s) { r, e in done(r.map { "\($0)" } ?? ("nil " + (e.map { "\($0)" } ?? ""))) }
  }

  // ---- real input
  func key(_ ch: String, _ ign: String, _ code: UInt16, _ flags: NSEvent.ModifierFlags = []) {
    for down in [true, false] {
      let ev = NSEvent.keyEvent(with: down ? .keyDown : .keyUp, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber, context: nil, characters: ch, charactersIgnoringModifiers: ign, isARepeat: false, keyCode: code)!
      win.makeFirstResponder(wv)
      NSApp.sendEvent(ev)
    }
  }
  func typeText(_ s: String) { for c in s { key(String(c), String(c), 0) } }
  func mouse(_ type: NSEvent.EventType, _ x: Double, _ yTop: Double) {
    let h = Double(win.contentView!.bounds.height)
    let ev = NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: h - yTop), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
    win.makeFirstResponder(wv)
    NSApp.sendEvent(ev)
  }
  /// Real click (or right click) at the centre of the first element matching `sel` whose text contains `text`.
  func click(_ sel: String, text: String = "", right: Bool = false, _ done: @escaping (Bool) -> Void) {
    let q = "(function(){var els=Array.from(document.querySelectorAll('\(sel)')).filter(function(e){return \(text.isEmpty ? "true" : "(e.textContent||'').indexOf('\(text)')>=0 || (e.getAttribute('aria-label')||'').indexOf('\(text)')>=0")}); var e=els[0]; if(!e) return 'null'; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2]);})()"
    js(q) { r in
      guard r != "null", let a = (try? JSONSerialization.jsonObject(with: r.data(using: .utf8)!)) as? [Double] else { return done(false) }
      self.mouse(right ? .rightMouseDown : .leftMouseDown, a[0], a[1])
      self.mouse(right ? .rightMouseUp : .leftMouseUp, a[0], a[1])
      done(true)
    }
  }

  // ---- steps
  func report(_ name: String, _ m: String) {
    let bad = m.hasPrefix("FAIL") || m.hasPrefix("nil")
    if bad { failures += 1 }
    print("\(name): \(m)")
  }
  func check(_ name: String, _ expr: String) -> Step {
    return (name, { done in self.js(expr) { m in self.report(name, m); done() } })
  }
  func act(_ name: String, wait: Double = 0.8, _ f: @escaping (@escaping (Bool) -> Void) -> Void) -> Step {
    return (name, { done in f { ok in
      if !ok { self.report(name, "FAIL target not found") }
      self.after(wait, done)
    } })
  }

  /// JS that returns "ok ..." or "FAIL ..." for the details view layout.
  func detailsLayout(_ label: String) -> String {
    return """
    (function(){
      var sc = document.querySelector('.ew-detscroll'); if (!sc) return 'FAIL no .ew-detscroll';
      var s = sc.getBoundingClientRect(), tol = 2, bad = [];
      var secs = Array.from(document.querySelectorAll('.ew-sec'));
      if (secs.length < 7) bad.push('only ' + secs.length + ' sections');
      secs.forEach(function(e){ var r = e.getBoundingClientRect(); var h = (e.querySelector('h3')||{}).textContent;
        if (r.width < 100 || r.height < 20) bad.push(h + ' has size ' + Math.round(r.width) + 'x' + Math.round(r.height));
        if (r.left < s.left - tol || r.right > s.right + tol) bad.push(h + ' outside horizontally (' + Math.round(r.left) + '..' + Math.round(r.right) + ' vs ' + Math.round(s.left) + '..' + Math.round(s.right) + ')');
      });
      if (sc.scrollWidth > sc.clientWidth + tol) bad.push('scroll pane overflows horizontally ' + sc.scrollWidth + '>' + sc.clientWidth);
      if (document.documentElement.scrollWidth > window.innerWidth + tol) bad.push('page scrolls horizontally');
      var btns = Array.from(sc.querySelectorAll('button')).filter(function(b){ var r=b.getBoundingClientRect(); return r.width>0 && (r.right > s.right + tol); });
      if (btns.length) bad.push(btns.length + ' buttons stick out on the right');
      var names = secs.map(function(e){ return (e.querySelector('h3')||{}).textContent; }).join(',');
      return (bad.length ? 'FAIL ' + bad.join('; ') + ' | ' : 'ok ') + '\(label) window=' + window.innerWidth + 'x' + window.innerHeight + ' pane=' + Math.round(s.width) + 'x' + Math.round(s.height) + ' sections=' + names;
    })()
    """
  }

  /// The always-visible overview header: above the editor, inside the pane, non-zero height, nothing sticking out sideways.
  func overviewLayout(_ label: String) -> String {
    return """
    (function(){
      var o = document.querySelector('[role=region][aria-label="Object overview"]'); if (!o) return 'FAIL no overview region';
      var body = document.querySelector('.ew-body'), r = o.getBoundingClientRect(), b = body.getBoundingClientRect(), tol = 2, bad = [];
      if (r.height < 24 || r.height > 120) bad.push('height ' + Math.round(r.height));
      if (r.width < 100) bad.push('width ' + Math.round(r.width));
      if (r.bottom > b.top + tol) bad.push('not above the editor body (' + Math.round(r.bottom) + ' > ' + Math.round(b.top) + ')');
      if (r.left < -tol || r.right > window.innerWidth + tol) bad.push('outside the window');
      var out = Array.from(o.querySelectorAll('button')).filter(function(x){ var q = x.getBoundingClientRect(); return q.width > 0 && (q.right > r.right + tol || q.left < r.left - tol); });
      if (out.length) bad.push(out.length + ' buttons stick out sideways: ' + out.slice(0,3).map(function(x){return x.textContent;}).join('|'));
      if (document.documentElement.scrollWidth > window.innerWidth + tol) bad.push('page scrolls horizontally');
      var lines = o.querySelectorAll('.ew-ovline').length;
      return (bad.length ? 'FAIL ' + bad.join('; ') + ' | ' : 'ok ') + '\(label) header=' + Math.round(r.width) + 'x' + Math.round(r.height) + ' lines=' + lines + ' chips=' + o.querySelectorAll('.ew-ovchip').length;
    })()
    """
  }

  func inDialog(_ sel: String, min: Int) -> String {
    return """
    (function(){
      var d = document.querySelector('.dialog'); if (!d) return 'FAIL no dialog';
      var dr = d.getBoundingClientRect(), tol = 2, bad = [];
      var els = Array.from(d.querySelectorAll('\(sel)')).filter(function(e){ var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (els.length < \(min)) bad.push('only ' + els.length + ' visible \(sel) (want \(min))');
      function scrolledAway(e){ var p = e.parentElement, r = e.getBoundingClientRect(); while (p && p !== d) { var o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') { var pr = p.getBoundingClientRect(); if (r.bottom > pr.bottom + tol || r.top < pr.top - tol) return true; } p = p.parentElement; } return false; }
      var out = els.filter(function(e){ if (scrolledAway(e)) return false; var r = e.getBoundingClientRect(); return r.left < dr.left - tol || r.right > dr.right + tol || r.top < dr.top - tol || r.bottom > dr.bottom + tol; });
      if (out.length > 0) bad.push(out.length + ' outside the dialog rect');
      if (dr.left < -tol || dr.top < -tol || dr.right > window.innerWidth + tol || dr.bottom > window.innerHeight + tol) bad.push('dialog outside the window ' + Math.round(dr.left) + ',' + Math.round(dr.top) + ',' + Math.round(dr.right) + ',' + Math.round(dr.bottom));
      return (bad.length ? 'FAIL ' + bad.join('; ') + ' | ' : 'ok ') + els.length + ' \(sel), dialog ' + Math.round(dr.width) + 'x' + Math.round(dr.height);
    })()
    """
  }

  /// Real click, retried (a layout may still be settling) until `until` evaluates to true in the page.
  func clickUntil(_ name: String, _ sel: String, text: String = "", right: Bool = false, until: String) -> Step {
    return (name, { done in
      func attempt(_ n: Int) {
        self.click(sel, text: text, right: right) { found in
          self.after(0.9) {
            self.js("(function(){ return !!(\(until)); })()") { r in
              if r == "1" || r == "true" { return done() }
              if n >= 3 { self.report(name, "FAIL the click did not have its effect (found=\(found))"); return done() }
              attempt(n + 1)
            }
          }
        }
      }
      attempt(1)
    })
  }

  func resize(_ w: Double, _ h: Double) -> Step {
    return ("resize \(Int(w))x\(Int(h))", { done in
      self.win.setContentSize(NSSize(width: w, height: h))
      self.after(0.8, done)
    })
  }

  func build() {
    steps = [
      act("close any start-up dialog", wait: 0.5) { d in self.key("\u{1b}", "\u{1b}", 53); d(true) },
      act("focus the command input") { d in self.click("[aria-label=\"Command input\"]", d) },
      act("type /edit #12", wait: 0.3) { d in self.typeText("/edit #12"); d(true) },
      check("diag: input text", "'ok value=[' + (document.querySelector('[aria-label=\"Command input\"]')||{}).value + '] active=' + (document.activeElement||{}).tagName + ' dialog=' + !!document.querySelector('.dialog')"),
      act("press Enter", wait: 1.0) { d in self.key("\r", "\r", 36); d(true) },
      act("wait for the editor", wait: 2.0) { d in d(true) },
      ("overview header at 1000px", { done in self.js(self.overviewLayout("1000")) { m in self.report("overview header 1000px", m); done() } }),
      resize(900, 640),
      ("overview header at 900px", { done in self.js(self.overviewLayout("900")) { m in self.report("overview header 900px", m); done() } }),
      resize(600, 600),
      ("overview header at 600px", { done in self.js(self.overviewLayout("600")) { m in self.report("overview header 600px", m); done() } }),
      resize(1000, 700),
      check("diag: pin", "(function(){var p=document.querySelector('.ew-pin'); var r=p&&p.getBoundingClientRect(); return 'ok ' + (p? p.outerHTML.slice(0,120)+' rect='+Math.round(r.left)+','+Math.round(r.top)+','+Math.round(r.width)+'x'+Math.round(r.height) : 'none') + ' ws=' + !!document.querySelector('[data-testid=editor-workspace]') + ' win=' + innerWidth + 'x' + innerHeight;})()"),
      clickUntil("click Object details (real click)", ".ew-pin", until: "document.querySelector('[data-testid=\"details-pane\"]')"),
      check("details view is showing", "document.querySelector('[data-testid=\"details-pane\"]') ? 'ok' : 'FAIL no details pane'"),
      ("details layout at 1000px", { done in self.js(self.detailsLayout("1000")) { m in self.report("details layout 1000px", m); done() } }),
      resize(900, 640),
      ("details layout at 900px", { done in self.js(self.detailsLayout("900")) { m in self.report("details layout 900px", m); done() } }),
      resize(600, 600),
      ("details layout at 600px", { done in self.js(self.detailsLayout("600")) { m in self.report("details layout 600px", m); done() } }),
      resize(1000, 700),
      // ---- Move dialog
      clickUntil("click Move... (real click)", "button", text: "Move...", until: "document.querySelector('.ew-place-dlg')"),
      ("Move dialog renders", { done in self.js("document.querySelector('.dialog .ew-place-dlg') ? 'ok dialog open' : 'FAIL no Move dialog'") { m in self.report("Move dialog open", m); done() } }),
      act("click the search box", wait: 0.2) { d in self.click(".ew-pd-search input", d) },
      act("type garden", wait: 1.5) { d in self.typeText("garden"); d(true) },
      ("search list renders inside the dialog", { done in self.js(self.inDialog("ul[aria-label=\"Search results\"] button", min: 1)) { m in self.report("search results inside dialog", m); done() } }),
      act("click a result (real click)", wait: 1.2) { d in self.click("ul[aria-label=\"Search results\"] button", d) },
      ("look-around panel and confirmation", { done in self.js("(function(){var c=document.querySelector('[data-testid=\"place-confirm\"]'); var t=c?c.textContent:''; return /Move .* to Garden/.test(t) ? 'ok ' + t : 'FAIL confirm text: ' + t;})()") { m in self.report("confirmation sentence", m); done() } }),
      ("nearby list renders inside the dialog", { done in self.js(self.inDialog("ul[aria-label=\"Nearby places\"] button", min: 1)) { m in self.report("nearby inside dialog", m); done() } }),
      resize(600, 600),
      ("Move dialog at 600px", { done in self.js(self.inDialog(".ew-pd-confirm", min: 1)) { m in self.report("Move dialog 600px", m); done() } }),
      resize(1000, 700),
      act("Escape closes the dialog", wait: 0.6) { d in self.key("\u{1b}", "\u{1b}", 53); d(true) },
      check("dialog closed, details still there", "(!document.querySelector('.dialog') && document.querySelector('[data-testid=\"details-pane\"]')) ? 'ok' : 'FAIL dialog still open or details gone'"),
      // ---- lock editor
      clickUntil("click Edit Basic lock (real click)", "button", text: "Edit Basic lock", until: "document.querySelector('[data-testid=\"lock-editor\"]')"),
      ("lock editor renders", { done in self.js(self.inDialog("[data-testid=\"lock-editor\"] .ew-snip", min: 8)) { m in self.report("lock editor helper buttons inside dialog", m); done() } }),
      act("click the Test button (real click)", wait: 1.0) { d in self.click("button", text: "Test", d) },
      check("lock test result shown", "(function(){var r=document.querySelector('[data-testid=\"lock-test-result\"]'); return r && r.textContent.length>0 ? 'ok ' + r.textContent : 'FAIL no test result';})()"),
      act("Escape closes the lock editor", wait: 0.6) { d in self.key("\u{1b}", "\u{1b}", 53); d(true) },
      // ---- context menu
      clickUntil("right-click an attribute (real right click)", "[role=option]", right: true, until: "document.querySelector('[role=menu]')"),
      ("context menu appears inside the window", { done in
        self.js("""
        (function(){
          var m = document.querySelector('[role=menu]'); if (!m) return 'FAIL no context menu';
          var r = m.getBoundingClientRect(), bad = [];
          if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) bad.push('menu outside the window ' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom));
          var items = Array.from(m.querySelectorAll('[role^=menuitem]'));
          if (items.length < 18) bad.push('only ' + items.length + ' items');
          var cs = getComputedStyle(m); if (cs.position !== 'fixed') bad.push('menu position ' + cs.position);
          var top = document.elementFromPoint(r.left + r.width/2, r.top + 30);
          if (!top || !m.contains(top)) bad.push('menu is covered by another element at its centre');
          return (bad.length ? 'FAIL ' + bad.join('; ') + ' | ' : 'ok ') + items.length + ' items, ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' at ' + Math.round(r.left) + ',' + Math.round(r.top);
        })()
        """) { m in self.report("context menu", m); done() }
      }),
      act("click a flag item (real click)", wait: 1.2) { d in self.click("[role=menuitemcheckbox]", text: "no_command", d) },
      check("the flag is checked (item clickable)", "(function(){var i=Array.from(document.querySelectorAll('[role=menuitemcheckbox]')).filter(function(e){return e.textContent.indexOf('no_command')>=0})[0]; return i && i.getAttribute('aria-checked')==='true' ? 'ok checked' : 'FAIL not checked: ' + (i ? i.getAttribute('aria-checked') : 'missing');})()"),
      act("Escape closes the menu", wait: 0.5) { d in self.key("\u{1b}", "\u{1b}", 53); d(true) },
      check("menu closed", "document.querySelector('[role=menu]') ? 'FAIL menu still open' : 'ok'"),
    ]
  }

  func run(_ i: Int) {
    if i >= steps.count {
      print(failures == 0 ? "RESULT: all checks passed in WKWebView" : "RESULT: \(failures) check(s) FAILED")
      exit(failures == 0 ? 0 : 1)
    }
    steps[i].1 { self.run(i + 1) }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe()
app.delegate = probe
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { print("RESULT: timeout"); exit(3) }
app.run()
