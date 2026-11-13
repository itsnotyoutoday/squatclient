// Real-WebKit rendering check for the in-app help (see README.md). macOS only.
//
//   swiftc -O help-probe.swift -o /tmp/help-probe && /tmp/help-probe http://127.0.0.1:8777/index.html?mock=1 home scripting compat lua keys
//
// Loads the built front end in an offscreen WKWebView (the engine Wails uses), opens the help with F1, opens each
// topic by clicking it in the tree and measures the DOM. Exit code 0 = all checks passed, 1 = a check failed.
import Cocoa
import WebKit

final class Probe: NSObject, NSApplicationDelegate {
  var win: NSWindow!
  var wv: WKWebView!
  var failures = 0
  let args = Array(CommandLine.arguments.dropFirst())
  var topics: [String] { args.count > 1 ? Array(args.dropFirst()) : ["home", "scripting", "compat", "lua", "keys"] }

  func applicationDidFinishLaunching(_ n: Notification) {
    win = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 1000, height: 640), styleMask: [.titled], backing: .buffered, defer: false)
    wv = WKWebView(frame: win.contentView!.bounds)
    win.contentView!.addSubview(wv)
    guard let first = args.first, let url = URL(string: first) else {
      FileHandle.standardError.write("usage: help-probe URL [topic ...]\n".data(using: .utf8)!)
      exit(2)
    }
    wv.load(URLRequest(url: url))
    win.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    after(3.0) { self.openHelp() }
  }

  func after(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }

  func js(_ s: String, _ done: @escaping (String) -> Void) {
    wv.evaluateJavaScript(s) { r, e in done(r.map { "\($0)" } ?? ("nil " + (e.map { "\($0)" } ?? ""))) }
  }

  func openHelp() {
    js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',bubbles:true})); 'sent'") { _ in
      self.waitForTree(tries: 25)
    }
  }

  /// Poll until the help tree is in the DOM (the help is a lazily loaded chunk), then start measuring.
  func waitForTree(tries: Int) {
    js("document.querySelectorAll('.helptree .treeitem').length") { n in
      if (Int(n) ?? 0) > 0 { return self.after(0.5) { self.next(0) } }
      if tries == 0 {
        return self.js("'body: ' + (document.body ? document.body.innerText.slice(0, 300) : 'none')") { b in
          print("FAIL the help tree never appeared. \(b)")
          exit(1)
        }
      }
      self.after(0.4) { self.waitForTree(tries: tries - 1) }
    }
  }

  /// Returns "ok ..." or "FAIL ..." for the open topic.
  func measure(_ topic: String) -> String {
    return """
    (function(){
      var T = '\(topic)';
      var side = document.querySelector('.helpside'), content = document.querySelector('.helpcontent'), main = document.querySelector('.helpmain');
      if (!side || !content) return 'FAIL no .helpside/.helpcontent in the DOM';
      var s = side.getBoundingClientRect(), c = content.getBoundingClientRect();
      var items = Array.from(side.querySelectorAll('.treeitem .label'));
      var inside = items.filter(function(e){ var r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && r.left >= s.left - 1 && r.right <= s.right + 1; });
      var text = (content.innerText || '').trim();
      var tol = 2;
      var problems = [];
      if (s.width < 100 || s.height < 200) problems.push('sidebar too small ' + Math.round(s.width) + 'x' + Math.round(s.height));
      if (items.length < 10) problems.push('only ' + items.length + ' tree items');
      if (inside.length < 8) problems.push('only ' + inside.length + ' tree items inside the sidebar rect');
      if (text.length < 200) problems.push('page text too short (' + text.length + ' chars)');
      if (c.width < 300 || c.height < 200) problems.push('content pane too small ' + Math.round(c.width) + 'x' + Math.round(c.height));
      if (c.left < s.right - tol) problems.push('content overlaps the sidebar');
      if (c.right > window.innerWidth + tol || c.bottom > window.innerHeight + tol) problems.push('content outside the window');
      if (document.documentElement.scrollWidth > window.innerWidth + tol) problems.push('page scrolls horizontally (' + document.documentElement.scrollWidth + ' > ' + window.innerWidth + ')');
      if (content.scrollWidth > content.clientWidth + tol) problems.push('content pane overflows horizontally (' + content.scrollWidth + ' > ' + content.clientWidth + ')');
      var h1 = content.querySelector('h1, h2');
      if (!h1) problems.push('no heading in the page');
      var cur = document.querySelector('.helptree [aria-selected="true"]');
      if (!cur || cur.getAttribute('data-id') !== T) problems.push('tree selection is ' + (cur ? cur.getAttribute('data-id') : 'none'));
      var summary = 'tree=' + items.length + ' inSidebar=' + inside.length + ' side=' + Math.round(s.width) + 'x' + Math.round(s.height) + ' content=' + Math.round(c.width) + 'x' + Math.round(c.height) + ' text=' + text.length + ' scrollW=' + content.scrollWidth + '/' + content.clientWidth;
      return (problems.length ? 'FAIL ' + problems.join('; ') + ' | ' : 'ok ') + summary;
    })()
    """
  }

  func next(_ i: Int) {
    if i >= topics.count {
      print(failures == 0 ? "RESULT: all \(topics.count) topics render correctly in WKWebView" : "RESULT: \(failures) topic(s) FAILED")
      exit(failures == 0 ? 0 : 1)
    }
    let t = topics[i]
    let click = "(function(){ var el = document.querySelector('.helptree [data-id=\"\(t)\"] > .treerow'); if (!el) return 'missing'; el.click(); return 'clicked'; })()"
    js(click) { r in
      if r != "clicked" {
        print("\(t): FAIL tree row not found (\(r))")
        self.failures += 1
        return self.next(i + 1)
      }
      self.after(0.8) {
        self.js(self.measure(t)) { m in
          print("\(t): \(m)")
          if m.hasPrefix("FAIL") || m.hasPrefix("nil") { self.failures += 1 }
          self.next(i + 1)
        }
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe()
app.delegate = probe
// Safety net: never hang.
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("RESULT: timeout"); exit(3) }
app.run()
