# Selected-window Windows 10/11 UI Automation. Keep a UTF-8 BOM for Windows PowerShell 5.1.
# Owner-selected UIA inputs and explicitly selected Unicode keyboard targets; no clipboard or network fallback.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$maxOutputBytes = 262144

function Stop-Read([string]$code) { throw $code }
function Write-Result($value) {
  $json = ConvertTo-Json -InputObject $value -Compress -Depth 8
  if ($utf8.GetByteCount($json) -gt $maxOutputBytes) { $json = '{"ok":false,"code":"WINDOWS_UI_OUTPUT"}' }
  [Console]::Out.Write($json)
}

try {
  $osVersion = [Environment]::OSVersion.Version
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $osVersion.Major -lt 10) {
    Stop-Read 'WINDOWS_UI_UNSUPPORTED'
  }
  # Bound stdin before JSON parsing. Only fixed selected-window operations are accepted.
  $inputBuffer = New-Object char[] 16385
  $inputLength = 0
  while ($inputLength -lt $inputBuffer.Length) {
    $count = [Console]::In.Read($inputBuffer, $inputLength, $inputBuffer.Length - $inputLength)
    if ($count -eq 0) { break }
    $inputLength += $count
  }
  if ($inputLength -gt 16384) { Stop-Read 'WINDOWS_UI_OUTPUT' }
  $request = ConvertFrom-Json -InputObject ([string]::new($inputBuffer, 0, $inputLength))
  if ($request.operation -notin @('list', 'read', 'capture', 'prepare', 'commit', 'activate')) { Stop-Read 'WINDOWS_UI_FAILED' }
  if ($request.operation -eq 'capture') { $maxOutputBytes = 7050000 }

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'WindowsBase.dll', ([System.Windows.Automation.AutomationElement].Assembly.Location), ([System.Windows.Automation.ControlType].Assembly.Location) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
public static class TCReadOnlyWindows {
    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }
    public sealed class CapturedWindow {
        public int originalWidth;
        public int originalHeight;
        public int width;
        public int height;
        public byte[] bytes;
        public string protection;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TrustFile {
        public uint size;
        [MarshalAs(UnmanagedType.LPWStr)] public string path;
        public IntPtr file;
        public IntPtr knownSubject;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TrustData {
        public uint size;
        public IntPtr policy;
        public IntPtr sip;
        public uint uiChoice;
        public uint revocationChecks;
        public uint unionChoice;
        public IntPtr file;
        public uint stateAction;
        public IntPtr stateData;
        public IntPtr url;
        public uint providerFlags;
        public uint uiContext;
    }
    [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
    private static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref TrustData data);
    private delegate bool EnumCallback(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out WindowRect rect);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { public int x, y; public uint mouseData, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput { public ushort virtualKey, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyboardInput keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint type; public InputUnion data; }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    public static bool ActivateSelected(IntPtr hwnd) {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd)) return false;
        if (IsIconic(hwnd)) ShowWindowAsync(hwnd, 9);
        return SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd;
    }
    private static void AssertFocusedEditor(IntPtr hwnd, uint ownerId, string editorId) {
        if (!IsWindow(hwnd) || Owner(hwnd) != ownerId || GetForegroundWindow() != hwnd)
            throw new Exception("WINDOWS_UI_DRAFT_CHANGED");
        var focused = System.Windows.Automation.AutomationElement.FocusedElement;
        if (focused == null || String.Join(",", focused.GetRuntimeId()) != editorId || focused.Current.IsPassword)
            throw new Exception("WINDOWS_UI_DRAFT_CHANGED");
    }
    private static void AssertNoModifiers() {
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new Exception("WINDOWS_UI_DRAFT_CHANGED");
    }
    private static Input Key(ushort key, ushort scan, uint flags) {
        return new Input { type = 1, data = new InputUnion { keyboard =
            new KeyboardInput { virtualKey = key, scan = scan, flags = flags } } };
    }
    public static void SendUnicodeSelected(IntPtr hwnd, uint ownerId, string editorId, string text) {
        // Each UTF-16 pair is bounded to the exact selected and focused UIA editor.
        // No SelectAll, clearing, paste, IME switching, or automatic retry is permitted.
        foreach (char character in text) {
            AssertFocusedEditor(hwnd, ownerId, editorId);
            AssertNoModifiers();
            var inputs = new Input[] { Key(0, character, 4), Key(0, character, 4 | 2) };
            if (SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) != 2)
                throw new Exception("WINDOWS_UI_REPLY_INTERRUPTED");
        }
        AssertFocusedEditor(hwnd, ownerId, editorId);
    }
    public static void SendSelectedShortcut(IntPtr hwnd, uint ownerId, string editorId, string action) {
        AssertFocusedEditor(hwnd, ownerId, editorId);
        AssertNoModifiers();
        Input[] inputs;
        if (action == "enter") inputs = new Input[] { Key(13, 0, 0), Key(13, 0, 2) };
        else if (action == "ctrl-enter") inputs = new Input[] {
            Key(17, 0, 0), Key(13, 0, 0), Key(13, 0, 2), Key(17, 0, 2) };
        else throw new Exception("WINDOWS_UI_UNSUPPORTED_INPUT");
        uint inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (inserted != inputs.Length) {
            // Release only keys this operation may have pressed if Windows accepted a partial batch.
            if (inserted > 0) SendInput(2, new Input[] { Key(13, 0, 2), Key(17, 0, 2) }, Marshal.SizeOf(typeof(Input)));
            throw new Exception("WINDOWS_UI_REPLY_INTERRUPTED");
        }
    }
    [DllImport("user32.dll")]
    private static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("shcore.dll")]
    private static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
    public static string KeyboardLayout(IntPtr hwnd) {
        uint processId;
        uint threadId = GetWindowThreadProcessId(hwnd, out processId);
        if (threadId == 0) return null;
        return "0x" + GetKeyboardLayout(threadId).ToInt64().ToString("x");
    }
    [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] public static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint length, out uint needed);
    private static bool SameOwner(uint processId) {
        IntPtr process = OpenProcess(0x1000, false, processId); // QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) return false;
        IntPtr token = IntPtr.Zero, buffer = IntPtr.Zero;
        try {
            if (!OpenProcessToken(process, 8, out token)) return false; // TOKEN_QUERY
            uint needed;
            GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed); // TokenUser
            if (needed == 0 || needed > 4096) return false;
            buffer = Marshal.AllocHGlobal((int)needed);
            if (!GetTokenInformation(token, 1, buffer, needed, out needed)) return false;
            var target = new System.Security.Principal.SecurityIdentifier(Marshal.ReadIntPtr(buffer));
            using (var current = System.Security.Principal.WindowsIdentity.GetCurrent())
                return current.User != null && current.User.Equals(target);
        } catch { return false; }
        finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (token != IntPtr.Zero) CloseHandle(token);
            CloseHandle(process);
        }
    }
    public static IntPtr[] VisibleWindows() {
        var windows = new List<IntPtr>();
        int visited = 0;
        EnumWindows((hwnd, parameter) => {
            if (++visited > 2048) return false;
            if (IsWindowVisible(hwnd) && GetWindowTextLength(hwnd) > 0) windows.Add(hwnd);
            return windows.Count < 256;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
    public static string Title(IntPtr hwnd) {
        int length = GetWindowTextLength(hwnd);
        if (length <= 0 || length > 1024) return null;
        var text = new StringBuilder(length + 1);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }
    public static uint Owner(IntPtr hwnd) {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        return processId;
    }
    public static bool SameSession(uint processId) {
        uint ownSession, targetSession;
        return ProcessIdToSessionId(GetCurrentProcessId(), out ownSession) &&
            ProcessIdToSessionId(processId, out targetSession) && ownSession == targetSession && SameOwner(processId);
    }
    private static int[] CaptureSize(IntPtr hwnd) {
        WindowRect rect;
        if (!GetWindowRect(hwnd, out rect)) throw new Exception("WINDOWS_UI_CAPTURE_DIMENSIONS");
        long width = (long)rect.right - rect.left;
        long height = (long)rect.bottom - rect.top;
        if (width <= 0 || height <= 0 || width > 4000000 || height > 4000000 || width * height > 4000000)
            throw new Exception("WINDOWS_UI_CAPTURE_DIMENSIONS");
        return new int[] { (int)width, (int)height };
    }
    public static string CaptureProtection(IntPtr hwnd) {
        uint affinity;
        // GetWindowDisplayAffinity can fail for an ordinary external/non-layered window.
        // Only a successfully queried nonzero flag establishes capture protection.
        if (!GetWindowDisplayAffinity(hwnd, out affinity)) return "unavailable";
        if (affinity != 0) throw new Exception("WINDOWS_UI_CAPTURE_PROTECTED");
        return "none";
    }
    public static bool CanCapture(IntPtr hwnd) {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
        try { CaptureProtection(hwnd); CaptureSize(hwnd); return true; } catch { return false; }
    }
    private static void AssertCapturable(IntPtr hwnd) {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) throw new Exception("WINDOWS_UI_CAPTURE");
        CaptureProtection(hwnd);
    }
    private static IntPtr PhysicalPixelContext() {
        try {
            // PER_MONITOR_AWARE (-3), supported since Windows 10 1607; target UI is untouched.
            IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-3));
            if (previous == IntPtr.Zero) throw new Exception("WINDOWS_UI_CAPTURE");
            if (GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()) != 2) {
                SetThreadDpiAwarenessContext(previous);
                throw new Exception("WINDOWS_UI_CAPTURE");
            }
            return previous;
        } catch (EntryPointNotFoundException) {
            // Windows 10 1507/1511: only this short-lived PowerShell process becomes DPI aware.
            SetProcessDpiAwareness(2);
            int awareness;
            if (GetProcessDpiAwareness(IntPtr.Zero, out awareness) != 0 || awareness != 2)
                throw new Exception("WINDOWS_UI_CAPTURE");
            return IntPtr.Zero;
        }
    }
    public static CapturedWindow CaptureSelected(IntPtr hwnd) {
        IntPtr previous = PhysicalPixelContext();
        try { return CaptureSelectedPixels(hwnd); }
        finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
    }
    private static CapturedWindow CaptureSelectedPixels(IntPtr hwnd) {
        AssertCapturable(hwnd);
        int[] original = CaptureSize(hwnd);
        // No bitmap/GDI allocation happens before validating the original window's <=4MP area.
        // GDI PrintWindow does not provide reliable alpha. Keep the screenshot opaque.
        using (var bitmap = new Bitmap(original[0], original[1], PixelFormat.Format32bppRgb)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                graphics.Clear(Color.White);
                IntPtr context = graphics.GetHdc();
                try {
                    // PW_RENDERFULLCONTENT=2. No desktop, screen copy, or other-window fallback.
                    if (!PrintWindow(hwnd, context, 2)) throw new Exception("WINDOWS_UI_CAPTURE");
                } finally { graphics.ReleaseHdc(context); }
            }
            // Protected/GPU-only clients can return an empty black image even when PrintWindow succeeds.
            int samples = 0, dark = 0;
            for (int y = 0; y < original[1]; y += Math.Max(1, original[1] / 40))
                for (int x = 0; x < original[0]; x += Math.Max(1, original[0] / 40)) {
                    Color pixel = bitmap.GetPixel(x, y); samples++;
                    if (pixel.R < 8 && pixel.G < 8 && pixel.B < 8) dark++;
                }
            if (samples == dark) throw new Exception("WINDOWS_UI_CAPTURE");
            AssertCapturable(hwnd);
            int[] afterSize = CaptureSize(hwnd);
            if (original[0] != afterSize[0] || original[1] != afterSize[1]) throw new Exception("WINDOWS_UI_CHANGED");
            double scale = Math.Min(1.0, 1280.0 / Math.Max(original[0], original[1]));
            int width = Math.Max(1, (int)Math.Floor(original[0] * scale));
            int height = Math.Max(1, (int)Math.Floor(original[1] * scale));
            using (var resized = new Bitmap(width, height, PixelFormat.Format32bppRgb)) {
                using (var graphics = Graphics.FromImage(resized)) {
                    graphics.CompositingMode = CompositingMode.SourceCopy;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.DrawImage(bitmap, new Rectangle(0, 0, width, height), 0, 0, original[0], original[1], GraphicsUnit.Pixel);
                }
                using (var stream = new MemoryStream()) {
                    resized.Save(stream, ImageFormat.Png);
                    if (stream.Length > 5 * 1024 * 1024) throw new Exception("WINDOWS_UI_OUTPUT");
                    return new CapturedWindow { originalWidth = original[0], originalHeight = original[1],
                        width = width, height = height, bytes = stream.ToArray(), protection = CaptureProtection(hwnd) };
                }
            }
        }
    }
    public static string OfflinePublisher(string filePath) {
        IntPtr filePointer = IntPtr.Zero;
        try {
            var file = new TrustFile { size = (uint)Marshal.SizeOf(typeof(TrustFile)), path = filePath };
            filePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TrustFile)));
            Marshal.StructureToPtr(file, filePointer, false);
            var data = new TrustData {
                size = (uint)Marshal.SizeOf(typeof(TrustData)), uiChoice = 2, unionChoice = 1,
                file = filePointer,
                // CACHE_ONLY_URL_RETRIEVAL + REVOCATION_CHECK_NONE + DISABLE_MD2_MD4.
                // Verification must not fetch certificates, roots or revocation data online.
                providerFlags = 0x1000 | 0x10 | 0x2000
            };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            if (WinVerifyTrust(new IntPtr(-1), ref action, ref data) != 0) return null;
            using (var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(filePath))) {
                return certificate.GetNameInfo(X509NameType.SimpleName, false);
            }
        } catch { return null; }
        finally {
            if (filePointer != IntPtr.Zero) {
                Marshal.DestroyStructure(filePointer, typeof(TrustFile));
                Marshal.FreeHGlobal(filePointer);
            }
        }
    }
}
'@

  # Publisher verification is useful identity information, not platform permission.
  # Explicit owner selection also permits legitimate unsigned/newly signed clients.
  $clientNames = @('wechat', 'weixin', 'qq', 'qqnt', 'whatsapp', 'bilibili', 'weibo')
  $browserNames = @('msedge', 'chrome', 'firefox')
  $signatureCache = @{}
  function Get-Identity([IntPtr]$windowHandle, [bool]$forceSignature = $false) {
    if (-not [TCReadOnlyWindows]::IsWindow($windowHandle) -or -not [TCReadOnlyWindows]::IsWindowVisible($windowHandle)) { return $null }
    $title = [TCReadOnlyWindows]::Title($windowHandle)
    if ([string]::IsNullOrWhiteSpace($title)) { return $null }
    $ownerId = [TCReadOnlyWindows]::Owner($windowHandle)
    if ($ownerId -eq 0 -or -not [TCReadOnlyWindows]::SameSession($ownerId)) { return $null }
    try {
      $owner = Get-Process -Id $ownerId -ErrorAction Stop
      $name = $owner.ProcessName.ToLowerInvariant()
      if ($name.Length -gt 64 -or [string]::IsNullOrWhiteSpace($name) -or $name -match '[\x00-\x1f\x7f/\\]') { return $null }
      $startedAt = $owner.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
      $cacheKey = "$ownerId|$startedAt"
      if (-not $signatureCache.ContainsKey($cacheKey)) {
        $publisher = $null
        try { $publisher = [TCReadOnlyWindows]::OfflinePublisher($owner.MainModule.FileName) } catch { }
        if ($null -ne $publisher -and $publisher.Length -gt 256) { $publisher = $publisher.Substring(0, 256) }
        $signatureCache[$cacheKey] = @{ status = $(if ([string]::IsNullOrWhiteSpace($publisher)) { 'unverified' } else { 'verified' }); publisher = $publisher }
      }
      $kind = if ($name -in $browserNames) { 'browser' } elseif ($name -in $clientNames) { 'client' } else { 'application' }
      return @{ handle = $windowHandle.ToInt64().ToString(); title = $title; process = $name;
        processId = [int]$ownerId; startedAt = $startedAt; kind = $kind; signature = $signatureCache[$cacheKey] }
    } catch { return $null }
  }
  function Assert-Identity($actual, $expected) {
    if ($null -eq $actual) { Stop-Read 'WINDOWS_UI_CHANGED' }
    foreach ($key in @('handle', 'title', 'process', 'processId', 'startedAt', 'kind')) {
      # Case-sensitive title/process equality also protects browser navigation/title changes.
      if ([string]$actual[$key] -cne [string]$expected.$key) { Stop-Read 'WINDOWS_UI_CHANGED' }
    }
  }

  function Read-Preview($root) {
    # Preview reads visible names; standard Edit/password subtrees never contribute draft text.
    # Use UIA's documented false default for IsPassword on normal containers;
    # ignoreDefaultValue=true would prune ordinary Pane/Group roots as unsupported.
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $pending = New-Object 'System.Collections.Generic.Queue[object]'
    $pending.Enqueue(@{ element = $root; depth = 0 })
    $controls = New-Object 'System.Collections.Generic.List[object]'
    $textParts = New-Object 'System.Collections.Generic.List[string]'
    $textLength = 0
    $visited = 0
    $truncated = $false
    while ($pending.Count -gt 0) {
      $entry = $pending.Dequeue()
      $visited++
      if ($visited -gt 2000 -or $controls.Count -ge 160 -or $textLength -ge 16000) { $truncated = $true; break }
      $element = $entry.element
      $password = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty)
      if ($password -ne $false) { continue }
      $type = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $true)
      if ($type -eq [System.Windows.Automation.AutomationElement]::NotSupported -or
          $type -eq [System.Windows.Automation.ControlType]::Edit -or
          $type -eq [System.Windows.Automation.ControlType]::ComboBox) { continue }
      $offscreen = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $true)
      if ($offscreen -ne $false) { continue }
      if ($type -eq [System.Windows.Automation.ControlType]::Document -or $type -eq [System.Windows.Automation.ControlType]::Custom) {
        # RichEdit and contenteditable providers may expose Document/Custom rather than Edit.
        # Their draft names/child text must not change or leak into the conversation snapshot.
        $draftValue = $null; $draftText = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$draftValue) -and
            ([System.Windows.Automation.ValuePattern]$draftValue).Current.IsReadOnly -eq $false) { continue }
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$draftText)) {
          $readOnly = ([System.Windows.Automation.TextPattern]$draftText).DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
          if ($readOnly -is [bool] -and $readOnly -eq $false) { continue }
        }
      }
      if ($entry.depth -gt 0) {
        $name = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty, $true)
        if ($name -is [string] -and -not [string]::IsNullOrWhiteSpace($name)) {
          $name = $name.Replace([string][char]0, '').Trim()
          if ($name.Length -gt 512) { $name = $name.Substring(0, 512); $truncated = $true }
          $room = 16000 - $textLength - $(if ($textParts.Count -gt 0) { 1 } else { 0 })
          if ($room -le 0) { $truncated = $true; break }
          if ($name.Length -gt $room) { $name = $name.Substring(0, $room); $truncated = $true }
          $role = $type.ProgrammaticName -replace '^ControlType\.', ''
          $controls.Add(@{ type = $role; name = $name })
          $textParts.Add($name)
          $textLength += $name.Length + $(if ($textParts.Count -gt 1) { 1 } else { 0 })
        }
      }
      if ($entry.depth -ge 12) { $truncated = $true; continue }
      $child = $walker.GetFirstChild($element)
      $siblings = 0
      while ($null -ne $child) {
        $siblings++
        if ($pending.Count -ge 2000 -or $siblings -gt 2000) { $truncated = $true; break }
        $pending.Enqueue(@{ element = $child; depth = $entry.depth + 1 })
        $child = $walker.GetNextSibling($child)
      }
    }
    return @{ text = ($textParts -join "`n"); controls = @($controls.ToArray()); truncated = $truncated }
  }
  function Get-Hash([string[]]$parts) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($utf8.GetBytes([string]::Join([string][char]0, $parts))))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  }
  function Get-PreviewSnapshot($preview, $expected, $inputFingerprint) {
    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($part in @('TC-WINDOW-PREVIEW-1', $expected.handle, [string]$expected.processId,
        $expected.startedAt, $expected.title, $expected.process, $expected.kind, $preview.text,
        $(if ($preview.truncated) { '1' } else { '0' }), [string]$inputFingerprint)) { $parts.Add([string]$part) }
    foreach ($control in $preview.controls) { $parts.Add([string]$control.type); $parts.Add([string]$control.name) }
    return Get-Hash $parts.ToArray()
  }
  function Assert-Binding($actual, $expectedBinding) {
    if ($null -eq $expectedBinding) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    foreach ($key in @('editorId', 'buttonId', 'inputFingerprint', 'targetId', 'method', 'sendAction')) {
      if ($actual[$key] -isnot [string] -or $expectedBinding.$key -isnot [string] -or
          $actual[$key] -cne $expectedBinding.$key) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    }
  }
  function Get-Binding($access) {
    return @{ editorId = $access.editorId; buttonId = $access.buttonId; inputFingerprint = $access.summary.inputFingerprint;
      targetId = $access.summary.selectedInputTarget; method = $access.summary.method; sendAction = $access.summary.sendAction }
  }
  function Get-EditorText($access) {
    if ($null -ne $access.valuePattern) { return [string]$access.valuePattern.Current.Value }
    if ($null -eq $access.textPattern) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    $value = [string]$access.textPattern.DocumentRange.GetText(4002)
    # RichEdit TextPattern exposes one synthetic paragraph terminator, even for an empty editor.
    if ($value.EndsWith("`r")) { $value = $value.Substring(0, $value.Length - 1) }
    return $value.Replace("`r`n", "`n")
  }
  function Assert-IdleEditor($access, [IntPtr]$windowHandle, [string]$expectedValue) {
    if ($null -eq $access.editor -or
        $access.editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -ne $true -or
        $access.editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $true) -ne $false -or
        (Get-EditorText $access) -cne $expectedValue) { Stop-Read 'WINDOWS_UI_DRAFT_CHANGED' }
    if ($null -ne $access.valuePattern -and $access.valuePattern.Current.IsReadOnly -ne $false) { Stop-Read 'WINDOWS_UI_DRAFT_CHANGED' }
    if ($access.summary.method -eq 'unicode-keyboard') {
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ([TCReadOnlyWindows]::GetForegroundWindow() -ne $windowHandle -or $null -eq $focused -or
          ($focused.GetRuntimeId() -join ',') -cne $access.editorId -or
          $access.editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true) -ne $true) { Stop-Read 'WINDOWS_UI_DRAFT_CHANGED' }
    }
  }
  function Get-ReplyAccess($root, [IntPtr]$windowHandle, [int]$ownerId, [string]$requestedTarget) {
    $summary = @{ canSend = $false; reasonCode = 'WINDOWS_UI_UNSUPPORTED_INPUT'; inputFingerprint = $null;
      imeLayout = [TCReadOnlyWindows]::KeyboardLayout($windowHandle); method = 'uia-value-pattern'; sendAction = 'button'; selectedInputTarget = $null }
    $result = @{ summary = $summary; targets = @(); editorId = $null; buttonId = ''; editor = $null;
      button = $null; valuePattern = $null; textPattern = $null; invokePattern = $null }
    try {
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $pending = New-Object 'System.Collections.Generic.Queue[object]'
      $pending.Enqueue(@{ element = $root; depth = 0 })
      $editors = New-Object 'System.Collections.Generic.List[object]'
      $buttons = New-Object 'System.Collections.Generic.List[object]'
      $visited = 0
      while ($pending.Count -gt 0) {
        $entry = $pending.Dequeue(); $visited++
        if ($visited -gt 2400 -or $entry.depth -gt 16) { return $result }
        $element = $entry.element
        if ($element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty) -ne $false -or
            $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $true) -ne $false) { continue }
        # Browser UIA descendants may be owned by renderer PIDs. Scope comes from this selected
        # HWND's tree and root identity, rather than incorrectly requiring every descendant PID.
        $type = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $true)
        if ($type -eq [System.Windows.Automation.ControlType]::ComboBox -or
            $type -eq [System.Windows.Automation.AutomationElement]::NotSupported) { continue }
        $focusable = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty, $true)
        if ($type -eq [System.Windows.Automation.ControlType]::Edit -or
            (($type -eq [System.Windows.Automation.ControlType]::Document -or $type -eq [System.Windows.Automation.ControlType]::Custom) -and $focusable -eq $true)) {
          $valuePattern = $null; $textPattern = $null
          if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
            $valuePattern = [System.Windows.Automation.ValuePattern]$valuePattern
            if ($valuePattern.Current.IsReadOnly) { continue }
          } else { $valuePattern = $null }
          if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
            $textPattern = [System.Windows.Automation.TextPattern]$textPattern
            $readOnly = $textPattern.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
            # A whole browser page with mixed/unknown editability is not a verified editor.
            if ($readOnly -isnot [bool] -or $readOnly -ne $false) { $textPattern = $null }
          } else { $textPattern = $null }
          if (($null -ne $valuePattern -or $null -ne $textPattern) -and
              $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -eq $true) {
            $id = ($element.GetRuntimeId() -join ',')
            if ($id -cmatch '^-?\d{1,10}(,-?\d{1,10}){0,63}$') {
              $class = [string]$element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ClassNameProperty, $true)
              $class = $class.Replace([string][char]0, '')
              if ($class.Length -gt 48) { $class = $class.Substring(0, 48) }
              $bounds = $element.Current.BoundingRectangle; $rootBounds = $root.Current.BoundingRectangle
              $position = ''
              if (-not $bounds.IsEmpty -and -not $rootBounds.IsEmpty) {
                $position = ' · 左' + [Math]::Round($bounds.Left - $rootBounds.Left) + ' 上' + [Math]::Round($bounds.Top - $rootBounds.Top)
              }
              $label = '编辑框 ' + ($editors.Count + 1) + $position + $(if ($class) { ' · ' + $class } else { '' })
              $editors.Add(@{ element = $element; id = $id; valuePattern = $valuePattern; textPattern = $textPattern; label = $label; focusable = ($focusable -eq $true) })
              if ($editors.Count -gt 8) { return $result }
            }
          }
          if ($type -eq [System.Windows.Automation.ControlType]::Edit) { continue }
        }
        if ($type -eq [System.Windows.Automation.ControlType]::Button) {
          $name = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty, $true)
          $invoke = $null
          if ($name -is [string] -and $name -match '^(发送|傳送|傳送訊息|发送消息|Send|Send message)(\s*[（(](s|Enter|Ctrl\s*\+\s*Enter)[）)])?$' -and
              $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
            $id = ($element.GetRuntimeId() -join ',')
            if ($id -cmatch '^-?\d{1,10}(,-?\d{1,10}){0,63}$') {
              $bounds = $element.Current.BoundingRectangle; $rootBounds = $root.Current.BoundingRectangle
              $position = ''
              if (-not $bounds.IsEmpty -and -not $rootBounds.IsEmpty) {
                $position = ' · 左' + [Math]::Round($bounds.Left - $rootBounds.Left) + ' 上' + [Math]::Round($bounds.Top - $rootBounds.Top)
              }
              $buttons.Add(@{ element = $element; id = $id; invokePattern = [System.Windows.Automation.InvokePattern]$invoke;
                label = ('发送按钮 ' + ($buttons.Count + 1) + $position) })
            }
          }
        }
        $child = $walker.GetFirstChild($element)
        $siblings = 0
        while ($null -ne $child) {
          $siblings++
          if ($pending.Count -ge 2400 -or $siblings -gt 2400) { return $result }
          $pending.Enqueue(@{ element = $child; depth = $entry.depth + 1 })
          $child = $walker.GetNextSibling($child)
        }
      }
      $targets = New-Object 'System.Collections.Generic.List[object]'
      foreach ($editor in $editors) {
        $plans = New-Object 'System.Collections.Generic.List[object]'
        foreach ($button in $buttons) {
          if ($null -ne $editor.valuePattern) { $plans.Add(@{ method = 'uia-value-pattern'; action = 'button'; button = $button; label = ('UIA 写入 + ' + $button.label) }) }
          if ($editor.focusable) { $plans.Add(@{ method = 'unicode-keyboard'; action = 'button'; button = $button; label = ('Unicode 键盘 + ' + $button.label) }) }
        }
        if ($editor.focusable) {
          $plans.Add(@{ method = 'unicode-keyboard'; action = 'enter'; button = $null; label = 'Unicode 键盘 + Enter 发送' })
          $plans.Add(@{ method = 'unicode-keyboard'; action = 'ctrl-enter'; button = $null; label = 'Unicode 键盘 + Ctrl+Enter 发送' })
        }
        foreach ($plan in $plans) {
          if ($targets.Count -ge 32) { break }
          $buttonId = if ($null -eq $plan.button) { '' } else { $plan.button.id }
          $targetId = Get-Hash @('TC-WINDOW-INPUT-2', $editor.id, $buttonId, $plan.method, $plan.action)
          $targets.Add(@{ id = $targetId; label = ($editor.label + ' · ' + $plan.label); method = $plan.method;
            sendAction = $plan.action; editor = $editor; button = $plan.button; buttonId = $buttonId })
        }
      }
      $result.targets = @($targets | ForEach-Object { @{ id = $_.id; label = $_.label; method = $_.method; sendAction = $_.sendAction } })
      $selected = $null
      if (-not [string]::IsNullOrEmpty($requestedTarget)) {
        foreach ($target in $targets) { if ($target.id -ceq $requestedTarget) { $selected = $target; break } }
      } elseif ($editors.Count -eq 1 -and $buttons.Count -eq 1) {
        foreach ($target in $targets) { if ($target.method -eq 'uia-value-pattern') { $selected = $target; break } }
      }
      if ($null -eq $selected) { return $result }
      $summary.inputFingerprint = $selected.id; $summary.selectedInputTarget = $selected.id
      $summary.method = $selected.method; $summary.sendAction = $selected.sendAction
      $result.editorId = $selected.editor.id; $result.buttonId = $selected.buttonId; $result.editor = $selected.editor.element
      $result.valuePattern = $selected.editor.valuePattern; $result.textPattern = $selected.editor.textPattern
      if ($null -ne $selected.button) { $result.button = $selected.button.element; $result.invokePattern = $selected.button.invokePattern }
      # Inspect draft existence only. Draft content is never returned, hashed, cleared, or logged.
      if ((Get-EditorText $result) -cne '') { $summary.reasonCode = 'WINDOWS_UI_DRAFT_PRESENT'; return $result }
      $summary.canSend = $true
      return $result
    } catch { return $result }
  }

  if ($request.operation -eq 'list') {
    $windows = New-Object 'System.Collections.Generic.List[object]'
    foreach ($windowHandle in [TCReadOnlyWindows]::VisibleWindows()) {
      $window = Get-Identity $windowHandle
      if ($null -ne $window) { $windows.Add($window) }
      if ($windows.Count -ge 100) { break }
    }
    Write-Result @{ ok = $true; windows = @($windows.ToArray()) }
    exit 0
  }

  if ($request.consent -isnot [bool] -or $request.consent -ne $true) { Stop-Read 'WINDOWS_UI_CONSENT' }
  $expected = $request.window
  if ($null -eq $expected -or [string]$expected.handle -notmatch '^[1-9]\d{0,18}$' -or
      $expected.title -isnot [string] -or $expected.title.Length -gt 1024 -or
      $expected.process -isnot [string] -or $expected.process.Length -gt 64 -or [string]::IsNullOrWhiteSpace($expected.process) -or $expected.process -match '[\x00-\x1f\x7f/\\]') { Stop-Read 'WINDOWS_UI_SELECTION' }
  if ($null -ne $request.inputTarget -and ($request.inputTarget -isnot [string] -or $request.inputTarget -cnotmatch '^[a-f0-9]{64}$')) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
  $windowHandle = [IntPtr]::new([long]::Parse($expected.handle))
  $before = Get-Identity $windowHandle $true
  Assert-Identity $before $expected

  if ($request.operation -eq 'activate') {
    if (-not [TCReadOnlyWindows]::ActivateSelected($windowHandle)) { Stop-Read 'WINDOWS_UI_FAILED' }
    $after = Get-Identity $windowHandle $true
    Assert-Identity $after $expected
    Write-Result @{ ok = $true; before = $before; after = $after; activated = $true }
    exit 0
  }
  if ($request.operation -eq 'capture') {
    $capture = [TCReadOnlyWindows]::CaptureSelected($windowHandle)
    $after = Get-Identity $windowHandle $true
    Assert-Identity $after $expected
    Write-Result @{ ok = $true; before = $before; after = $after; captureProtection = $capture.protection; image = @{
      data = ('data:image/png;base64,' + [Convert]::ToBase64String($capture.bytes));
      width = $capture.width; height = $capture.height; sizeBytes = $capture.bytes.Length; mime = 'image/png';
      originalWidth = $capture.originalWidth; originalHeight = $capture.originalHeight } }
    exit 0
  }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  if ($null -eq $root) { Stop-Read 'WINDOWS_UI_UNAVAILABLE' }
  $rootOwner = $root.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $true)
  if ($rootOwner -ne $before.processId) { Stop-Read 'WINDOWS_UI_CHANGED' }
  $preview = Read-Preview $root
  $access = Get-ReplyAccess $root $windowHandle $before.processId ([string]$request.inputTarget)
  if ($preview.truncated) { $access.summary.canSend = $false; $access.summary.reasonCode = 'WINDOWS_UI_UNSUPPORTED_INPUT' }
  $snapshot = Get-PreviewSnapshot $preview $expected $access.summary.inputFingerprint
  $after = Get-Identity $windowHandle $true
  Assert-Identity $after $expected
  if ($request.operation -in @('prepare', 'commit')) {
    if ($request.text -isnot [string] -or $request.text.Length -lt 1 -or $request.text.Length -gt 4000 -or
        [string]::IsNullOrWhiteSpace($request.text) -or $request.text -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]') { Stop-Read 'WINDOWS_UI_REPLY_TEXT' }
    if ($request.expectedSnapshot -isnot [string] -or $request.expectedSnapshot -cnotmatch '^[a-f0-9]{64}$' -or
        $snapshot -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_SNAPSHOT_CHANGED' }
    if (-not $access.summary.canSend) { Stop-Read $access.summary.reasonCode }
    if ($access.summary.method -eq 'unicode-keyboard' -and $request.text -match '[\r\n\t]') { Stop-Read 'WINDOWS_UI_KEYBOARD_TEXT' }
    $binding = Get-Binding $access
    if ($request.operation -eq 'prepare') {
      Write-Result @{ ok = $true; before = $before; after = $after; text = $preview.text;
        controls = $preview.controls; truncated = $preview.truncated; snapshot = $snapshot; reply = $access.summary;
        binding = $binding; inputTargets = $access.targets; canCapture = [TCReadOnlyWindows]::CanCapture($windowHandle) }
      exit 0
    }
    Assert-Binding $binding $request.binding
    if ($request.expiresAt -isnot [long] -and $request.expiresAt -isnot [int] -and $request.expiresAt -isnot [double]) { Stop-Read 'WINDOWS_UI_TICKET' }
    if ($access.summary.method -eq 'unicode-keyboard') {
      # Only this owner-selected keyboard target can activate and focus its selected window.
      if (-not [TCReadOnlyWindows]::ActivateSelected($windowHandle)) { Stop-Read 'WINDOWS_UI_DRAFT_CHANGED' }
      $access.editor.SetFocus()
    }
    # Last complete read before writing. There is no UIA atomic compare-and-set; user/provider
    # changes between the final check and writing remain possible. Never erase or retry a draft.
    $finalPreview = Read-Preview $root
    $access = Get-ReplyAccess $root $windowHandle $before.processId ([string]$request.inputTarget)
    if ($finalPreview.truncated) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    if ((Get-PreviewSnapshot $finalPreview $expected $access.summary.inputFingerprint) -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_SNAPSHOT_CHANGED' }
    if (-not $access.summary.canSend) { Stop-Read $access.summary.reasonCode }
    Assert-Binding (Get-Binding $access) $request.binding
    Assert-Identity (Get-Identity $windowHandle $true) $expected
    Assert-IdleEditor $access $windowHandle ''
    if (([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() -ge $request.expiresAt) { Stop-Read 'WINDOWS_UI_TICKET' }
    $writeStarted = $true
    if ($access.summary.method -eq 'uia-value-pattern') { $access.valuePattern.SetValue([string]$request.text) }
    else {
      [TCReadOnlyWindows]::SendUnicodeSelected($windowHandle, [uint32]$before.processId, $access.editorId, [string]$request.text)
      # SendInput queues events. Observe their result for up to one second without retyping.
      # Every observation keeps the exact focused editor and process identity bound.
      $observeUntil = [DateTime]::UtcNow.AddSeconds(1)
      while ((Get-EditorText $access) -cne [string]$request.text) {
        Assert-Identity (Get-Identity $windowHandle $true) $expected
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ([TCReadOnlyWindows]::GetForegroundWindow() -ne $windowHandle -or $null -eq $focused -or
            ($focused.GetRuntimeId() -join ',') -cne $access.editorId -or [DateTime]::UtcNow -ge $observeUntil -or
            ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() -ge $request.expiresAt) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
        Start-Sleep -Milliseconds 25
      }
    }
    # Re-identify the selected editor, action and conversation; preserve any partial draft on error.
    $writtenPreview = Read-Preview $root
    $written = Get-ReplyAccess $root $windowHandle $before.processId ([string]$request.inputTarget)
    Assert-Binding (Get-Binding $written) $request.binding
    if ((Get-PreviewSnapshot $writtenPreview $expected $written.summary.inputFingerprint) -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
    Assert-Identity (Get-Identity $windowHandle $true) $expected
    Assert-IdleEditor $written $windowHandle ([string]$request.text)
    if (([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() -ge $request.expiresAt) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
    if ($written.summary.sendAction -eq 'button') {
      if ($written.button.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -ne $true) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
      $written.invokePattern.Invoke()
    } else { [TCReadOnlyWindows]::SendSelectedShortcut($windowHandle, [uint32]$before.processId, $written.editorId, $written.summary.sendAction) }
    $after = Get-Identity $windowHandle $true
    Assert-Identity $after $expected
    # Returning from input/invoke is not a delivery acknowledgement.
    Write-Result @{ ok = $true; before = $before; after = $after; status = 'unknown'; reply = $written.summary }
    exit 0
  }
  Write-Result @{ ok = $true; before = $before; after = $after; text = $preview.text;
    controls = $preview.controls; truncated = $preview.truncated; snapshot = $snapshot; reply = $access.summary;
    inputTargets = $access.targets; canCapture = [TCReadOnlyWindows]::CanCapture($windowHandle) }
} catch {
  # Never echo provider exceptions, PowerShell diagnostics, UI text or credentials.
  $allowed = @('WINDOWS_UI_UNSUPPORTED', 'WINDOWS_UI_CONSENT', 'WINDOWS_UI_SELECTION', 'WINDOWS_UI_CHANGED',
    'WINDOWS_UI_UNAVAILABLE', 'WINDOWS_UI_OUTPUT', 'WINDOWS_UI_CAPTURE', 'WINDOWS_UI_CAPTURE_PROTECTED', 'WINDOWS_UI_CAPTURE_DIMENSIONS',
    'WINDOWS_UI_UNSUPPORTED_INPUT', 'WINDOWS_UI_DRAFT_PRESENT', 'WINDOWS_UI_DRAFT_CHANGED', 'WINDOWS_UI_SNAPSHOT_CHANGED',
    'WINDOWS_UI_REPLY_TEXT', 'WINDOWS_UI_REPLY_INTERRUPTED', 'WINDOWS_UI_TICKET', 'WINDOWS_UI_FAILED', 'WINDOWS_UI_KEYBOARD_TEXT')
  $code = [string]$_.Exception.Message
  if ($code -notin $allowed -and $null -ne $_.Exception.InnerException) { $code = [string]$_.Exception.InnerException.Message }
  if ($writeStarted -eq $true) { $code = 'WINDOWS_UI_REPLY_INTERRUPTED' }
  elseif ($code -notin $allowed) { $code = if ($request.operation -eq 'capture') { 'WINDOWS_UI_CAPTURE' } elseif ($request.operation -eq 'commit') { 'WINDOWS_UI_REPLY_INTERRUPTED' } else { 'WINDOWS_UI_UNAVAILABLE' } }
  Write-Result @{ ok = $false; code = $code }
}
