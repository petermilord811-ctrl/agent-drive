// loop.cs -- the loopback recorder behind the `audio` op on Windows: a few seconds of what the machine is PLAYING
// (its default output device), never a microphone. audio.ps1 compiles it with Add-Type; desk.js puts this text
// into the shipped script, and comment lines and indentation never travel. C# 5, as uia.cs: Windows PowerShell
// 5.1's Add-Type compiles with the .NET Framework's csc -- no $"..", no ?., no => members, no #if (a line that
// starts with # is a comment to desk.js and would not travel).
//
// WHY C#. Loopback is WASAPI's IAudioClient opened on an OUTPUT device with AUDCLNT_STREAMFLAGS_LOOPBACK: COM
// interfaces with no managed or WinRT wrapper (MediaCapture and AudioGraph record capture devices only), which
// reflection emit cannot declare cheaply. COM interop needs only each interface's IID and vtable ORDER
// (mmdeviceapi.h, audioclient.h, propsys.h); slots after the last one called are left out.
//
// TIME, NOT PACKETS. Loopback hands over packets only while something renders: over silence it delivers none,
// and when a sound starts mid-clip its first packet arrives with nothing before it. Laid end to end, a clip over
// a quiet second would come back short and a sound would land early. So the clip is a buffer of exactly the
// asked length, silent to begin with, and every packet is placed by its own timestamp -- the QPC position
// GetBuffer reports, in 100-ns units, the clock Stopwatch reads -- so a clip is as long as asked and a sound
// lands where it played. A driver that reports no timestamp gets its packets laid end to end instead.
//
// OUT: a 16-bit PCM WAV, mono (the channels averaged), at the device's own rate -- 96 KB a second at 48 kHz.
// FileMode.CreateNew: the file is new or nothing is written (audio.ps1 names it with a random part).
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class DeskDevEnum { }

// IMMDeviceEnumerator: 0 EnumAudioEndpoints, 1 GetDefaultAudioEndpoint.
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeskDevEnum {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDeskDev dev);
}

// IMMDevice: 0 Activate, 1 OpenPropertyStore.
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeskDev {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr prm, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
    [PreserveSig] int OpenPropertyStore(int access, out IDeskProps props);
}

// IPropertyStore: 0 GetCount, 1 GetAt, 2 GetValue -- only for the device's name, which the answer reports so a
// silent clip can be read against the device it came from ("CABLE Input" plays to nobody's ears).
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeskProps {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetAt(int i, out DeskKey key);
    [PreserveSig] int GetValue(ref DeskKey key, out DeskVar val);
}

[StructLayout(LayoutKind.Sequential)]
struct DeskKey { public Guid Fmt; public int Pid; }

// PROPVARIANT: vt, three reserved words, then a union two pointers wide (16 bytes on x86, 24 on x64).
[StructLayout(LayoutKind.Sequential)]
struct DeskVar { public ushort Vt; public ushort R1, R2, R3; public IntPtr P; public IntPtr P2; }

// IAudioClient: 0 Initialize ... 11 GetService.
[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeskClient {
    [PreserveSig] int Initialize(int share, int flags, long buffer, long period, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int share, IntPtr format, IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long dflt, out long min);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr ev);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
}

// IAudioCaptureClient: 0 GetBuffer, 1 ReleaseBuffer, 2 GetNextPacketSize.
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeskCapture {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devpos, out ulong qpc);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
}

public class DeskLoopInfo {
    public string Device = "";
    public string Format = "";
    public int Rate;
    public int Channels;
    public long Frames;
    public double Peak;
    public bool Timed;
}

public static class DeskLoop {
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref DeskVar v);

    // An HRESULT as a sentence: the ones a person can act on are named, the rest keep their number.
    static void Check(int hr, string what) {
        if (hr >= 0) return;
        uint u = unchecked((uint)hr);
        string why = u == 0x80070490 ? "no playback device -- Windows has no default audio output here, so there is nothing to record"
            : u == 0x88890004 ? "the playback device went away (unplugged or disabled)"
            : u == 0x8889000A ? "another program holds the playback device exclusively"
            : u == 0x88890010 ? "the Windows Audio service is not running"
            : u == 0x80070005 ? "Windows refused access to the playback device"
            : what + " failed";
        throw new Exception(why + " (0x" + u.ToString("X8") + ")");
    }

    static long Now() { return (long)(Stopwatch.GetTimestamp() * (10000000.0 / Stopwatch.Frequency)); }

    static string Name(IDeskDev dev) {
        try {
            IDeskProps ps;
            if (dev.OpenPropertyStore(0, out ps) < 0 || ps == null) return "";
            DeskKey k = new DeskKey();
            k.Fmt = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0");
            k.Pid = 14;
            DeskVar v;
            if (ps.GetValue(ref k, out v) < 0) return "";
            string s = v.Vt == 31 && v.P != IntPtr.Zero ? Marshal.PtrToStringUni(v.P) : "";
            PropVariantClear(ref v);
            return s ?? "";
        } catch (Exception) { return ""; }
    }

    // One frame of the device's format as one sample in [-1, 1], its channels averaged. Public so the test can
    // feed it known bytes: the shared-mode mix format is 32-bit float almost everywhere, and 16/24/32-bit PCM
    // are the rest. A 24-bit sample is sign-extended through the top of an int.
    public static double Mix(byte[] b, int at, int ch, int bits, bool flt) {
        double sum = 0;
        int bps = bits / 8;
        for (int c = 0; c < ch; c++) {
            int o = at + c * bps;
            double v;
            if (flt) v = bits == 64 ? BitConverter.ToDouble(b, o) : BitConverter.ToSingle(b, o);
            else if (bits == 16) v = BitConverter.ToInt16(b, o) / 32768.0;
            else if (bits == 24) v = (((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8) / 8388608.0;
            else if (bits == 32) v = BitConverter.ToInt32(b, o) / 2147483648.0;
            else v = (b[o] - 128) / 128.0;
            sum += v;
        }
        return sum / ch;
    }

    public static short Pcm(double v) {
        if (v > 1) v = 1;
        if (v < -1) v = -1;
        return (short)Math.Round(v * 32767);
    }

    // Record `ms` of the default output into `path`; dry = open, start and stop the stream, keep nothing.
    public static DeskLoopInfo Record(string path, int ms, bool dry) {
        DeskLoopInfo r = new DeskLoopInfo();
        IDeskDevEnum en = (IDeskDevEnum)new DeskDevEnum();
        IDeskDev dev;
        Check(en.GetDefaultAudioEndpoint(0, 0, out dev), "finding the default playback device");
        r.Device = Name(dev);
        Guid iid = typeof(IDeskClient).GUID;
        object o;
        Check(dev.Activate(ref iid, 23, IntPtr.Zero, out o), "opening the playback device");
        IDeskClient ac = (IDeskClient)o;
        IntPtr wf;
        Check(ac.GetMixFormat(out wf), "reading the playback format");
        int tag, align, bits;
        try {
            tag = (ushort)Marshal.ReadInt16(wf, 0);
            r.Channels = Marshal.ReadInt16(wf, 2);
            r.Rate = Marshal.ReadInt32(wf, 4);
            align = Marshal.ReadInt16(wf, 12);
            bits = Marshal.ReadInt16(wf, 14);
            // WAVE_FORMAT_EXTENSIBLE: the real format is the first word of the SubFormat GUID (1 PCM, 3 float).
            if (tag == 0xFFFE && Marshal.ReadInt16(wf, 16) >= 22) tag = Marshal.ReadInt32(wf, 24);
            // Shared mode, loopback, a one-second buffer: polled every few ms, it never comes near to filling.
            Check(ac.Initialize(0, 0x20000, 10000000, 0, wf, IntPtr.Zero), "starting a loopback capture");
        } finally {
            Marshal.FreeCoTaskMem(wf);
        }
        bool flt = tag == 3;
        if ((!flt && tag != 1) || r.Channels < 1 || r.Rate < 1 || bits < 8 || bits % 8 != 0 || align < r.Channels * (bits / 8))
            throw new Exception("the playback format is not one this reads (format " + tag + ", " + bits + " bits, " + r.Channels + " channels)");
        r.Format = (flt ? "float" : "pcm") + bits;
        Guid cid = typeof(IDeskCapture).GUID;
        Check(ac.GetService(ref cid, out o), "opening the loopback stream");
        IDeskCapture cap = (IDeskCapture)o;
        long total = dry ? 0 : (long)r.Rate * ms / 1000;
        short[] pcm = new short[total];
        byte[] buf = new byte[0];
        double peak = 0;
        long next = 0;
        Check(ac.Start(), "starting the loopback stream");
        long t0 = Now(), end = t0 + (long)ms * 10000, hard = end + 20000000;
        try {
            while (!dry) {
                uint n;
                Check(cap.GetNextPacketSize(out n), "reading the loopback stream");
                long now = Now();
                if (n == 0) {
                    if (now > end) break;
                    Thread.Sleep(5);
                    continue;
                }
                if (now > hard) break;
                IntPtr data;
                uint frames, flags;
                ulong dp, qpc;
                Check(cap.GetBuffer(out data, out frames, out flags, out dp, out qpc), "reading the loopback stream");
                int bytes = (int)frames * align;
                // AUDCLNT_BUFFERFLAGS_SILENT (2): the packet is silence whatever the buffer holds.
                bool quiet = (flags & 2) != 0 || data == IntPtr.Zero;
                if (!quiet) {
                    if (buf.Length < bytes) buf = new byte[bytes];
                    Marshal.Copy(data, buf, 0, bytes);
                }
                cap.ReleaseBuffer(frames);
                long at = next;
                if (qpc != 0) {
                    long t = (long)(((long)qpc - t0) * (r.Rate / 10000000.0));
                    if (t > -r.Rate && t < total + r.Rate) { at = t; r.Timed = true; }
                }
                next = at + frames;
                if (!quiet) {
                    for (int i = 0; i < (int)frames; i++) {
                        long k = at + i;
                        if (k < 0 || k >= total) continue;
                        double v = Mix(buf, i * align, r.Channels, bits, flt);
                        pcm[k] = Pcm(v);
                        double a = Math.Abs(v);
                        if (a > peak) peak = a;
                    }
                }
                if (at >= total) break;
            }
        } finally {
            ac.Stop();
        }
        if (dry) return r;
        int len = (int)total * 2;
        byte[] raw = new byte[len];
        Buffer.BlockCopy(pcm, 0, raw, 0, len);
        using (FileStream fs = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
            BinaryWriter w = new BinaryWriter(fs);
            w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + len);
            w.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16);
            w.Write((short)1); w.Write((short)1); w.Write(r.Rate); w.Write(r.Rate * 2); w.Write((short)2); w.Write((short)16);
            w.Write(Encoding.ASCII.GetBytes("data")); w.Write(len);
            w.Write(raw);
            w.Flush();
        }
        r.Frames = total;
        r.Peak = peak > 1 ? 1 : peak;
        return r;
    }
}
