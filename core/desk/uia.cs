// uia.cs -- the UI Automation walk behind the `controls` op on Windows. controls.ps1 compiles it with Add-Type
// (desk.js puts this text into the shipped script; comment lines and indentation never travel). C# 5: Windows
// PowerShell 5.1's Add-Type compiles with the .NET Framework's csc -- no $"..", no ?., no => members.
//
// WHY NATIVE UIA THROUGH COM, NOT System.Windows.Automation. The managed client was tried first and, on a
// WinForms window, answered a password box as ControlType.Pane with IsPassword=false and Name = THE PASSWORD
// ITSELF, and a plain text box with Name = its contents. Its own Win32 proxies match class names exactly, so a
// superclassed control ("WindowsForms10.EDIT.app...", a Delphi TEdit, an MFC subclass) falls through to a
// generic window proxy whose Name is the window text. The native UIA core (what Inspect.exe and the host's own
// ScreenSender.cpp use) maps those controls properly: Edit, Name from the label (empty there), IsPassword=true.
// Measured on the same window, both ways.
//
// WHAT IS READ, AND WHAT NEVER IS. Per element: name, control type, automation id, class, bounding rectangle,
// enabled, keyboard-focusable, has-focus, is-password, is-offscreen, native window handle -- fetched in ONE
// cross-process call per parent (FindAllBuildCache with a cache request). No pattern is ever asked for, so no
// Value, no Text range, no LegacyIAccessible value: what a field CONTAINS is never read. A password field is
// flagged, keeps no name (a provider that reported content as the name would otherwise leak it), and is never
// descended into. Belt and braces for Win32 edit controls: a window whose REAL class (RealGetWindowClass sees
// through superclassing) is Edit/RichEdit with ES_PASSWORD counts as a password whatever the provider said.
//
// ONLY WHAT IS ON SCREEN: children are found with IsOffscreen == false (scrolled-out list items, hidden tabs and
// collapsed menus are not listed), and an offscreen element is neither listed nor descended.
//
// BOUNDED THREE WAYS: `max` elements, `depth` levels below the window, and a TIME budget -- the host kills the
// whole exec at 10 s and then nothing at all comes back. The walk runs on its own MTA thread; the caller joins
// it for the budget and takes whatever was gathered. A call into a hung app that never returns is left on that
// background thread (the process exits around it) instead of costing the answer. Breadth-first, so a cut keeps
// the window's overall layout (title bar, menus, toolbars, panes) rather than one deep branch.
//
// Output: a JSON array, every element {i, p, d, name, type, aid, class, rect:[x,y,w,h]|null, enabled, focusable,
// focused, isPassword} in BFS order, p = the parent's i (-1 for the window), d = depth; pure ASCII (\uXXXX for
// the rest). `type` is UIA's control type ID (50000 Button ... 50040 AppBar): desk.js's parse() names it, and
// reorders the list into document order -- the names cost command line here and nothing there.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// COM interop needs only the vtable ORDER (UIAutomationClient.h); slots never called are placeholders _N.
// IUIAutomation: 0 CompareElements, 1 CompareRuntimeIds, 2 GetRootElement, 3 ElementFromHandle, 4 ElementFromPoint,
// 5 GetFocusedElement, 6 GetRootElementBuildCache, 7 ElementFromHandleBuildCache, 8 ElementFromPointBuildCache,
// 9 GetFocusedElementBuildCache, 10 CreateTreeWalker, 11-13 the three view walkers, 14 RawViewCondition,
// 15 ControlViewCondition, 16 ContentViewCondition, 17 CreateCacheRequest, 18 CreateTrueCondition,
// 19 CreateFalseCondition, 20 CreatePropertyCondition, 21 CreatePropertyConditionEx, 22 CreateAndCondition.
[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDeskUia {
void _0(); void _1(); void _2(); void _3(); void _4(); void _5(); void _6();
[PreserveSig] int ElementFromHandleBuildCache(IntPtr hwnd, IDeskCache cache, out IDeskEl el);
void _8(); void _9(); void _10(); void _11(); void _12(); void _13(); void _14();
[PreserveSig] int ControlViewCondition(out IntPtr cond);
void _16();
[PreserveSig] int CreateCacheRequest(out IDeskCache cache);
void _18(); void _19();
[PreserveSig] int CreatePropertyCondition(int id, object value, out IntPtr cond);
void _21();
[PreserveSig] int CreateAndCondition(IntPtr a, IntPtr b, out IntPtr cond);
}
// IUIAutomationElement: 0 SetFocus, 1 GetRuntimeId, 2 FindFirst, 3 FindAll, 4 FindFirstBuildCache,
// 5 FindAllBuildCache, 6 BuildUpdatedCache, 7 GetCurrentPropertyValue, 8 ..Ex, 9 GetCachedPropertyValue.
[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDeskEl {
void _0(); void _1(); void _2(); void _3(); void _4();
[PreserveSig] int FindAllBuildCache(int scope, IntPtr cond, IDeskCache cache, out IDeskEls found);
void _6(); void _7(); void _8();
[PreserveSig] int GetCachedPropertyValue(int id, out object value);
}
// IUIAutomationCacheRequest: 0 AddProperty.  IUIAutomationElementArray: 0 get_Length, 1 GetElement.
[ComImport, Guid("b32a92b5-bc25-4078-9c08-d7ee95c48e03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDeskCache { [PreserveSig] int AddProperty(int id); }
[ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDeskEls { [PreserveSig] int Length(out int n); [PreserveSig] int GetElement(int i, out IDeskEl el); }

public class DeskUiaResult { public string Json; public int Count; public bool Truncated; public string Stop = "", Error = ""; }

public class DeskUia {
[DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RealGetWindowClassW(IntPtr h, StringBuilder s, uint n);
[DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int i);

// UIA property ids: Name, ControlType, AutomationId, ClassName, BoundingRectangle, IsEnabled,
// IsKeyboardFocusable, HasKeyboardFocus, IsPassword, IsOffscreen, NativeWindowHandle.
const int NAME = 30005, TYPE = 30003, AID = 30011, CLS = 30012, RECT = 30001, EN = 30010, KF = 30009, HF = 30008, PW = 30019, OFF = 30022, HWND = 30020;
static readonly int[] Props = { NAME, TYPE, AID, CLS, RECT, EN, KF, HF, PW, OFF, HWND };
// What is in these is in their name already, or is a value (a button's caption, an edit box's contents,
// a scroll bar's arrows): not descending them keeps `max` for the layout.
static readonly int[] Leaves = { 50000, 50002, 50004, 50005, 50006, 50012, 50013, 50014, 50015, 50020, 50027, 50038 };

int max, depth, budget, count;
Stopwatch clock;
StringBuilder json = new StringBuilder("[");
bool truncated, done;
string stop = "", error = "";

public static DeskUiaResult Walk(long hwnd, int max, int depth, int budgetMs) {
DeskUia w = new DeskUia();
w.max = max; w.depth = depth; w.budget = budgetMs; w.clock = Stopwatch.StartNew();
IntPtr h = new IntPtr(hwnd);
Thread t = new Thread(delegate () { w.Run(h); });
t.IsBackground = true;
t.SetApartmentState(ApartmentState.MTA);
t.Start();
// The worker watches the clock between calls; this join is the backstop for one call that never returns.
bool finished = t.Join(budgetMs + 400);
DeskUiaResult r = new DeskUiaResult();
lock (w) {
r.Json = w.json.ToString() + "]"; r.Count = w.count; r.Error = w.error;
r.Truncated = w.truncated || !finished || !w.done;
r.Stop = finished ? w.stop : "time";
}
return r;
}

class Node { public IDeskEl E; public int P, D; }

void Run(IntPtr hwnd) {
try {
// The process asked for per-monitor awareness; if Windows granted it only to the PowerShell thread, this
// thread asks for itself (-4 = per-monitor v2, -3 = v1). The rectangles are physical pixels then.
try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero) SetThreadDpiAwarenessContext(new IntPtr(-3)); } catch (Exception) { }
IDeskUia uia = (IDeskUia)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
IDeskCache cache; IntPtr view, onscreen, cond; IDeskEl root;
Check(uia.CreateCacheRequest(out cache), "CreateCacheRequest");
foreach (int p in Props) cache.AddProperty(p);
Check(uia.ControlViewCondition(out view), "ControlViewCondition");
Check(uia.CreatePropertyCondition(OFF, false, out onscreen), "CreatePropertyCondition");
Check(uia.CreateAndCondition(view, onscreen, out cond), "CreateAndCondition");
Check(uia.ElementFromHandleBuildCache(hwnd, cache, out root), "ElementFromHandle");
Queue<Node> q = new Queue<Node>();
q.Enqueue(new Node { E = root, P = -1, D = 0 });
while (q.Count > 0) {
if (count >= max) { lock (this) { truncated = true; stop = "max"; } break; }
if (clock.ElapsedMilliseconds > budget) { lock (this) { truncated = true; stop = "time"; } break; }
Node n = q.Dequeue();
if (n.D > 0 && Bool(n.E, OFF)) continue;
int ct = Int(n.E, TYPE), me;
bool pw = Bool(n.E, PW) || PasswordEdit(new IntPtr(Int(n.E, HWND)));
double[] r = Get(n.E, RECT) as double[];
// Whole numbers as longs: a double's ToString follows the culture, and .NET may print -0.
string rect = r == null || r.Length < 4 || !(r[2] > 0) || !(r[3] > 0) || double.IsInfinity(r[0]) ? "null" :
"[" + (long)Math.Round(r[0]) + "," + (long)Math.Round(r[1]) + "," + (long)Math.Round(r[2]) + "," + (long)Math.Round(r[3]) + "]";
lock (this) {
me = count++;
json.Append(me > 0 ? "," : "").AppendFormat("{{\"i\":{0},\"p\":{1},\"d\":{2},\"name\":{3},\"type\":{4},\"aid\":{5},\"class\":{6},\"rect\":{7},\"enabled\":{8},\"focusable\":{9},\"focused\":{10},\"isPassword\":{11}}}",
me, n.P, n.D, Q(pw ? "" : Text(n.E, NAME, 300)), ct, Q(Text(n.E, AID, 200)), Q(Text(n.E, CLS, 200)), rect, B(Bool(n.E, EN)), B(Bool(n.E, KF)), B(Bool(n.E, HF)), B(pw));
}
if (pw || n.D >= depth || Array.IndexOf(Leaves, ct) >= 0) continue;
IDeskEls kids; int len;
if (n.E.FindAllBuildCache(2, cond, cache, out kids) != 0 || kids == null || kids.Length(out len) != 0) continue;
for (int i = 0; i < len; i++) {
IDeskEl k;
if (kids.GetElement(i, out k) == 0 && k != null) q.Enqueue(new Node { E = k, P = me, D = n.D + 1 });
}
}
lock (this) { done = true; }
} catch (Exception e) {
lock (this) { error = e.Message; }
}
}

static void Check(int hr, string what) { if (hr != 0) throw new Exception(what + " failed (0x" + hr.ToString("x8") + ")"); }

static bool PasswordEdit(IntPtr h) {
if (h == IntPtr.Zero) return false;
StringBuilder s = new StringBuilder(64);
if (RealGetWindowClassW(h, s, 64) == 0) return false;
string c = s.ToString();
return (c.Equals("Edit", StringComparison.OrdinalIgnoreCase) || c.StartsWith("RichEdit", StringComparison.OrdinalIgnoreCase))
&& (GetWindowLongW(h, -16) & 0x20) != 0;   // GWL_STYLE has ES_PASSWORD
}

// A property UIA does not support comes back as its "not supported" sentinel object, never as a typed value:
// every reader falls back to empty for anything that is not the type it expects.
static object Get(IDeskEl e, int id) { object v; try { if (e.GetCachedPropertyValue(id, out v) == 0) return v; } catch (Exception) { } return null; }
static string Text(IDeskEl e, int id, int n) { string s = Get(e, id) as string ?? ""; return s.Length > n ? s.Substring(0, n) + "..." : s; }
static bool Bool(IDeskEl e, int id) { object v = Get(e, id); return v is bool && (bool)v; }
static int Int(IDeskEl e, int id) { object v = Get(e, id); return v is int ? (int)v : 0; }
static string B(bool b) { return b ? "true" : "false"; }
static string Q(string s) {
StringBuilder o = new StringBuilder("\"");
foreach (char c in s) {
if (c == '"' || c == '\\') o.Append('\\').Append(c);
else if (c < 0x20 || c > 0x7e) o.Append("\\u").Append(((int)c).ToString("x4"));
else o.Append(c);
}
return o.Append('"').ToString();
}
}
