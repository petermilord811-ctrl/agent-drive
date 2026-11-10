// qcard.cs -- the picture-quality check's TEST CARD (core/quality.js, the serve's `quality` verb).
//
// A borderless, topmost window over the visit's screen that shows REPRODUCIBLE stress, scene by scene on its own clock,
// then closes itself. Reproducible is the point: the desktop as it happens to be gives a different answer every run, and
// two runs (before and after a change) can only be compared when they were shown the same thing.
//
//   text    a document standing still: small ClearType text, coloured text on coloured ground (4:2:0 chroma),
//           hairlines, a 1 px checkerboard and a gradient -- the detail blur and a coarse quantiser take first
//   scroll  the same document scrolling at about half a screen a second -- text in motion
//   drag    a window moving over the still document -- what dragging a window does
//   video   full-screen moving colour with film grain and sharp moving shapes -- the encoder's worst case
//   cuts    the whole picture replaced 2.5 times a second -- scene changes, near-keyframe sized
//   rest    the document still again -- whether the picture recovers after the load
//
// Compiled ON the machine by PowerShell 5.1's Add-Type (C# 5: no string interpolation, no ?. ), from a file that is
// read as ANSI -- so this source stays ASCII (\u escapes for anything else). The card covers what the stream shows; a
// banner says what it is, that it closes by itself, and that Esc closes it now. Its bottom-left corner holds a solid
// MAGENTA square (24 px, 10 px in) that the agent waits for, so its phase marks start from the card being visible.
//
// QCard.Snap(scene, t, w, h, path) renders one scene to a PNG without a window: how tests/quality.js checks it draws.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class QCardPainter
{
    public int W, H, Hc;
    public const int Bh = 44;
    Bitmap doc, win, lo, blocky, grain;
    int lw, lh, lastCut = -1;
    int[] px;
    Font fBan;
    Random rnd = new Random(20261109);
    static readonly string[] Words = ("the quick brown fox jumps over a lazy dog picture quality remote desktop stream frame encoder bitrate " +
        "text window scroll motion colour sharp blur pixel latency network relay host viewer keyframe refine ladder codec screen " +
        "mirror test card agent check phase still video cuts drag pointer cursor").Split(' ');
    static readonly Color[] Hues = { Color.FromArgb(220, 30, 30), Color.FromArgb(30, 160, 60), Color.FromArgb(30, 80, 220),
                                     Color.FromArgb(240, 200, 20), Color.FromArgb(160, 40, 200), Color.FromArgb(20, 190, 200) };

    public QCardPainter(int w, int h)
    {
        W = Math.Max(320, w); H = Math.Max(240, h); Hc = H - Bh;
        doc = MakeDoc(W, Hc * 3);
        win = MakeWin(Math.Min(760, W * 2 / 5), Math.Min(520, Hc * 9 / 20));
        lw = Math.Max(64, W / 8); lh = Math.Max(36, Hc / 8);
        lo = new Bitmap(lw, lh, PixelFormat.Format32bppRgb);
        px = new int[lw * lh];
        blocky = new Bitmap(Math.Max(16, W / 4), Math.Max(12, Hc / 4), PixelFormat.Format32bppRgb);
        grain = MakeGrain(256);
    }

    string Sentence(int n)
    {
        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.Append(' '); sb.Append(Words[rnd.Next(Words.Length)]); }
        return sb.ToString();
    }
    static int Clamp(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

    Bitmap MakeDoc(int w, int h)
    {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppRgb);
        using (Graphics g = Graphics.FromImage(b))
        using (Font fH = new Font("Segoe UI", 18f, FontStyle.Bold))
        using (Font fP = new Font("Segoe UI", 9f))
        using (Font fS = new Font("Segoe UI", 7f))
        using (Font fC = new Font("Consolas", 9.5f))
        using (Font fK = new Font("Segoe UI", 10f, FontStyle.Bold))
        using (SolidBrush code = new SolidBrush(Color.FromArgb(244, 244, 246)))
        using (HatchBrush checker = new HatchBrush(HatchStyle.Percent50, Color.Black, Color.White))
        {
            g.Clear(Color.White);
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            int m = 40, y = 24, sec = 1, cw = w - 2 * m;
            while (y < h)
            {
                g.DrawString("Section " + sec + " \u2014 " + Sentence(4), fH, Brushes.Black, m, y);
                y += 44;
                string para = Sentence(90) + ".";
                SizeF sz = g.MeasureString(para, fP, cw);
                g.DrawString(para, fP, Brushes.Black, new RectangleF(m, y, cw, sz.Height + 4));
                y += (int)sz.Height + 10;
                // coloured text on a coloured ground: what 4:2:0 chroma smears first
                int x = m;
                for (int i = 0; i < 6; i++)
                {
                    string t = Sentence(2);
                    int tw = (int)g.MeasureString(t, fK).Width + 16;
                    if (x + tw > w - m) break;
                    using (SolidBrush bg = new SolidBrush(Hues[i])) g.FillRectangle(bg, x, y, tw, 26);
                    using (SolidBrush fg = new SolidBrush(Hues[(i + 3) % 6])) g.DrawString(t, fK, fg, x + 8, y + 4);
                    x += tw + 8;
                }
                y += 36;
                g.FillRectangle(code, m, y, cw, 6 * 17 + 12);
                for (int i = 0; i < 6; i++)
                    g.DrawString("  if (frame.keyframe && rate < floor) { encoder.Refine(" + rnd.Next(1000) + "); }  /* " + Sentence(3) + " */", fC, Brushes.DarkSlateGray, m + 6, y + 6 + i * 17);
                y += 6 * 17 + 22;
                // hairlines, a 1 px checkerboard, a gradient: the detail that blur takes first
                for (int i = 0; i < 160; i += 2) g.DrawLine(Pens.Black, m + i, y, m + i, y + 59);
                g.FillRectangle(checker, m + 180, y, 160, 60);
                int gw = Math.Max(10, cw - 360);
                using (LinearGradientBrush lg = new LinearGradientBrush(new Rectangle(m + 360, y, gw, 60), Color.Red, Color.Blue, 0f))
                {
                    ColorBlend cb = new ColorBlend();
                    cb.Colors = new Color[] { Color.Red, Color.Yellow, Color.Lime, Color.Cyan, Color.Blue, Color.Magenta };
                    cb.Positions = new float[] { 0f, 0.2f, 0.4f, 0.6f, 0.8f, 1f };
                    lg.InterpolationColors = cb;
                    g.FillRectangle(lg, m + 360, y, gw, 60);
                }
                y += 72;
                g.DrawString(Sentence(40), fS, Brushes.DimGray, new RectangleF(m, y, cw, 30));
                y += 34;
                sec++;
            }
        }
        return b;
    }

    Bitmap MakeWin(int w, int h)
    {
        w = Math.Max(160, w); h = Math.Max(120, h);
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppRgb);
        using (Graphics g = Graphics.FromImage(b))
        using (Font ft = new Font("Segoe UI", 10f, FontStyle.Bold))
        using (Font fp = new Font("Segoe UI", 9f))
        using (SolidBrush btn = new SolidBrush(Color.FromArgb(230, 230, 232)))
        using (LinearGradientBrush tb = new LinearGradientBrush(new Rectangle(0, 0, w, 32), Color.FromArgb(0, 90, 200), Color.FromArgb(40, 140, 240), 0f))
        {
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.Clear(Color.White);
            g.FillRectangle(tb, 0, 0, w, 32);
            g.DrawString("Notes \u2014 a window being dragged", ft, Brushes.White, 10, 7);
            g.DrawString(Sentence(120) + ".", fp, Brushes.Black, new RectangleF(12, 44, w - 24, Math.Max(20, h - 100)));
            string[] labels = { "OK", "Cancel", "Apply" };
            for (int i = 0; i < 3; i++)
            {
                Rectangle r = new Rectangle(12 + i * 110, h - 46, 100, 30);
                g.FillRectangle(btn, r);
                g.DrawRectangle(Pens.Gray, r);
                g.DrawString(labels[i], fp, Brushes.Black, r.X + 26, r.Y + 7);
            }
            g.DrawRectangle(Pens.DimGray, 0, 0, w - 1, h - 1);
        }
        return b;
    }

    Bitmap MakeGrain(int n)
    {
        Bitmap b = new Bitmap(n, n, PixelFormat.Format32bppArgb);
        int[] a = new int[n * n];
        for (int i = 0; i < a.Length; i++) { int v = rnd.Next(256); a[i] = (70 << 24) | (v << 16) | (v << 8) | v; }
        BitmapData d = b.LockBits(new Rectangle(0, 0, n, n), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(a, 0, d.Scan0, a.Length);
        b.UnlockBits(d);
        return b;
    }

    // a smooth moving colour field at one eighth of the size, with grain -- scaled up it reads as video
    void Plasma(double u)
    {
        double cx = lw * (0.5 + 0.3 * Math.Sin(u * 0.7)), cy = lh * (0.5 + 0.3 * Math.Cos(u * 0.9));
        int i = 0;
        for (int y = 0; y < lh; y++)
            for (int x = 0; x < lw; x++)
            {
                double dx = x - cx, dy = y - cy;
                double v = Math.Sin(x * 0.09 + u * 1.7) + Math.Sin(y * 0.11 - u * 1.3) + Math.Sin((x + y) * 0.06 + u * 2.1) +
                           Math.Sin(Math.Sqrt(dx * dx + dy * dy) * 0.18 - u * 2.6);
                double a = v * Math.PI / 2;
                int gr = rnd.Next(41) - 20;
                int r = Clamp((int)(128 + 127 * Math.Sin(a)) + gr), g = Clamp((int)(128 + 127 * Math.Sin(a + 2.094)) + gr), bl = Clamp((int)(128 + 127 * Math.Sin(a + 4.188)) + gr);
                px[i++] = (r << 16) | (g << 8) | bl;
            }
        BitmapData d = lo.LockBits(new Rectangle(0, 0, lw, lh), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
        Marshal.Copy(px, 0, d.Scan0, px.Length);
        lo.UnlockBits(d);
    }

    void Blocky()
    {
        int bw = blocky.Width, bh = blocky.Height;
        int[] a = new int[bw * bh];
        for (int i = 0; i < a.Length; i++) a[i] = rnd.Next(0x1000000);
        BitmapData d = blocky.LockBits(new Rectangle(0, 0, bw, bh), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
        Marshal.Copy(a, 0, d.Scan0, a.Length);
        blocky.UnlockBits(d);
    }

    void PaintVideo(Graphics g, Rectangle area, double u)
    {
        Plasma(u);
        g.InterpolationMode = InterpolationMode.Bilinear;
        g.DrawImage(lo, area);
        using (TextureBrush tb = new TextureBrush(grain))
        {
            tb.TranslateTransform(rnd.Next(256), rnd.Next(256));
            g.FillRectangle(tb, area);
        }
        for (int i = 0; i < 3; i++)
        {
            int r = Hc / (6 + i * 2);
            int x = (int)((W - r) * (0.5 + 0.45 * Math.Sin(u * (1.3 + i * 0.4) + i)));
            int y = (int)((Hc - r) * (0.5 + 0.45 * Math.Cos(u * (0.9 + i * 0.5) + i * 2)));
            using (SolidBrush sb = new SolidBrush(i == 1 ? Color.Black : Color.White)) g.FillEllipse(sb, x, y, r, r);
        }
    }

    // One frame of a scene, `u` seconds into it. Every draw names its destination rectangle in pixels: an
    // unscaled draw would be scaled by the bitmap's DPI against the screen's.
    public void Paint(Graphics g, string scene, double u, int idx, int count)
    {
        g.CompositingQuality = CompositingQuality.HighSpeed;
        g.InterpolationMode = InterpolationMode.NearestNeighbor;
        g.PixelOffsetMode = PixelOffsetMode.Half;
        Rectangle area = new Rectangle(0, 0, W, Hc);
        int span = Math.Max(1, doc.Height - Hc);
        switch (scene)
        {
            case "scroll":
                g.DrawImage(doc, area, new Rectangle(0, (int)((u * Hc * 0.55) % span), W, Hc), GraphicsUnit.Pixel);
                break;
            case "drag":
            {
                g.DrawImage(doc, area, area, GraphicsUnit.Pixel);
                int x = (int)((W - win.Width) * (0.5 + 0.45 * Math.Sin(u * 1.1)));
                int y = (int)((Hc - win.Height) * (0.5 + 0.45 * Math.Sin(u * 1.7 + 0.6)));
                g.DrawImage(win, new Rectangle(x, y, win.Width, win.Height), new Rectangle(0, 0, win.Width, win.Height), GraphicsUnit.Pixel);
                break;
            }
            case "video":
                PaintVideo(g, area, u);
                break;
            case "cuts":
            {
                int k = (int)(u / 0.4);
                switch (k % 5)
                {
                    case 0: g.DrawImage(doc, area, new Rectangle(0, (k * 137) % span, W, Hc), GraphicsUnit.Pixel); break;
                    case 1: using (SolidBrush sb = new SolidBrush(Hues[k % 6])) g.FillRectangle(sb, area); break;
                    case 2: Plasma(k * 1.7); g.InterpolationMode = InterpolationMode.Bilinear; g.DrawImage(lo, area); break;
                    case 3: if (k != lastCut) Blocky(); g.DrawImage(blocky, area); break;
                    default:
                        for (int i = 0; i < 8; i++) using (SolidBrush sb = new SolidBrush(Hues[(i + k) % 6])) g.FillRectangle(sb, i * W / 8, 0, W / 8 + 1, Hc);
                        break;
                }
                lastCut = k;
                break;
            }
            default:   // text, rest -- and any name it does not know: still
                g.DrawImage(doc, area, area, GraphicsUnit.Pixel);
                break;
        }
        PaintBanner(g, scene, idx, count);
    }

    void PaintBanner(Graphics g, string scene, int idx, int count)
    {
        using (SolidBrush bb = new SolidBrush(Color.FromArgb(24, 24, 28))) g.FillRectangle(bb, 0, Hc, W, Bh);
        using (SolidBrush mk = new SolidBrush(Color.FromArgb(255, 0, 255))) g.FillRectangle(mk, 10, H - 10 - 24, 24, 24);
        if (fBan == null) fBan = new Font("Segoe UI", 10f);
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.DrawString("ScreenMirror picture-quality test  \u00b7  " + scene + "  (" + (idx + 1) + " of " + count + ")  \u00b7  it closes by itself  \u00b7  Esc closes it now",
                     fBan, Brushes.White, 44, Hc + 12);
    }
}

public class QCard : Form
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    QCardPainter painter;
    string[] names;
    double[] ends;
    double total;
    System.Diagnostics.Stopwatch clock = new System.Diagnostics.Stopwatch();
    Timer tick = new Timer();
    int lastScene = -2, lastK = -2;
    // THE SCHEDULE'S CLOCK starts on a click, not on appearing: the agent sees the card by polling screenshots, a second
    // or more late, and clicks its corner the moment it does -- so the scenes and its phase marks start together. With
    // hold 0 (an agent that may not click) it starts on appearing; with hold > 0 it starts by itself after that long.
    double holdMax, startAt;
    bool started;

    // plan "text:8,scroll:10,...": the scenes and their seconds. rect "x,y,w,h" in the desktop's pixels (empty: the
    // primary screen's work area). lead: extra seconds on the first scene, for the agent's mark trailing the start.
    // hold: seconds to wait for the click that starts the clock (0: start at once).
    public static void Run(string plan, string rect, double lead, double hold)
    {
        try { SetProcessDPIAware(); } catch { }
        try { Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); } catch { }
        Application.Run(new QCard(plan, rect, lead, hold));
    }

    public static void Snap(string scene, double u, int w, int h, string path)
    {
        QCardPainter p = new QCardPainter(w, h);
        using (Bitmap b = new Bitmap(p.W, p.H, PixelFormat.Format32bppRgb))
        {
            using (Graphics g = Graphics.FromImage(b)) p.Paint(g, scene, u, 0, 1);
            b.Save(path, ImageFormat.Png);
        }
    }

    QCard(string plan, string rect, double lead, double hold)
    {
        holdMax = Math.Max(0, Math.Min(30, hold));
        started = holdMax <= 0;
        string[] parts = (string.IsNullOrEmpty(plan) ? "text:8" : plan).Split(',');
        names = new string[parts.Length];
        ends = new double[parts.Length];
        double acc = Math.Max(0, Math.Min(5, lead));
        for (int i = 0; i < parts.Length; i++)
        {
            string[] kv = parts[i].Split(':');
            names[i] = kv[0].Trim();
            double s = 8;
            if (kv.Length > 1 && !double.TryParse(kv[1], NumberStyles.Float, CultureInfo.InvariantCulture, out s)) s = 8;
            acc += Math.Max(1, Math.Min(120, s));
            ends[i] = acc;
        }
        total = acc;
        Rectangle r = Screen.PrimaryScreen.WorkingArea;
        if (!string.IsNullOrEmpty(rect))
        {
            string[] q = rect.Split(',');
            int x, y, w, h;
            if (q.Length == 4 && int.TryParse(q[0], out x) && int.TryParse(q[1], out y) && int.TryParse(q[2], out w) && int.TryParse(q[3], out h) && w > 0 && h > 0)
                r = new Rectangle(x, y, w, h);
        }
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = r;
        TopMost = true;
        ShowInTaskbar = true;
        KeyPreview = true;
        BackColor = Color.White;
        Text = "ScreenMirror picture-quality test";
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.Opaque, true);
        painter = new QCardPainter(r.Width, r.Height);
        KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Close(); };
        MouseDown += delegate { Begin(); };
        Shown += delegate { Activate(); clock.Start(); tick.Start(); Invalidate(); };
        FormClosed += delegate { tick.Stop(); };
        tick.Interval = 15;
        tick.Tick += delegate { Step(); };
    }

    int SceneAt(double t)
    {
        for (int i = 0; i < ends.Length; i++) if (t < ends[i]) return i;
        return ends.Length - 1;
    }
    double StartOf(int i) { return i <= 0 ? 0 : ends[i - 1]; }
    void Begin()
    {
        if (started) return;
        started = true;
        startAt = clock.Elapsed.TotalSeconds;
    }
    // seconds into the schedule: 0 while it waits for its click, so the first scene stands still until then
    double T() { return started ? clock.Elapsed.TotalSeconds - startAt : 0; }

    // Only what moves is redrawn: a still scene is ONE frame, so the stream sees a still screen, as it would a real one.
    void Step()
    {
        if (!started && clock.Elapsed.TotalSeconds >= holdMax) Begin();
        double t = T();
        if (t >= total + 0.3) { Close(); return; }
        int i = SceneAt(t);
        string n = names[i];
        bool moving = n == "scroll" || n == "drag" || n == "video";
        int k = n == "cuts" ? (int)((t - StartOf(i)) / 0.4) : -1;
        if (moving || i != lastScene || k != lastK) Invalidate();
        lastScene = i; lastK = k;
    }

    protected override void OnPaintBackground(PaintEventArgs e) { }
    protected override void OnPaint(PaintEventArgs e)
    {
        double t = clock.IsRunning ? T() : 0;
        int i = SceneAt(t);
        painter.Paint(e.Graphics, names[i], t - StartOf(i), i, names.Length);
    }
}
