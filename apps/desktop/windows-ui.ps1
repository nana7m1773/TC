# Selected-window Windows 10/11 UI Automation. Keep a UTF-8 BOM for Windows PowerShell 5.1.
# Explicit confirmed replies use only ValuePattern and InvokePattern. No keyboard, clipboard, mouse, or network fallback.
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
  # Bound stdin before JSON parsing. Only the fixed five operations are accepted.
  $inputBuffer = New-Object char[] 16385
  $inputLength = 0
  while ($inputLength -lt $inputBuffer.Length) {
    $count = [Console]::In.Read($inputBuffer, $inputLength, $inputBuffer.Length - $inputLength)
    if ($count -eq 0) { break }
    $inputLength += $count
  }
  if ($inputLength -gt 16384) { Stop-Read 'WINDOWS_UI_OUTPUT' }
  $request = ConvertFrom-Json -InputObject ([string]::new($inputBuffer, 0, $inputLength))
  if ($request.operation -notin @('list', 'read', 'capture', 'prepare', 'commit')) { Stop-Read 'WINDOWS_UI_FAILED' }
  if ($request.operation -eq 'capture') { $maxOutputBytes = 7050000 }

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Drawing.dll' -TypeDefinition @'
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
            ProcessIdToSessionId(processId, out targetSession) && ownSession == targetSession;
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
    private static void AssertCapturable(IntPtr hwnd) {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) throw new Exception("WINDOWS_UI_CAPTURE");
        uint affinity;
        // Unknown affinity is not permission. Failure and any protection value are both refused.
        if (!GetWindowDisplayAffinity(hwnd, out affinity) || affinity != 0)
            throw new Exception("WINDOWS_UI_CAPTURE_PROTECTED");
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
                        width = width, height = height, bytes = stream.ToArray() };
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

  # A name alone is insufficient: require the official executable's valid publisher signature.
  $tencentPublisher = '(?i)^(Tencent Technology\s*\((Shenzhen|Shanghai)\)\s*(Company Limited|Co\.,?\s*Ltd\.?)|Shenzhen Tencent Computer Systems Company Limited|腾讯科技（深圳）有限公司|深圳市腾讯计算机系统有限公司)$'
  $publishers = @{
    wechat = $tencentPublisher; weixin = $tencentPublisher;
    qq = $tencentPublisher; qqnt = $tencentPublisher;
    whatsapp = '(?i)^(WhatsApp (LLC|Inc\.?)|Meta Platforms,? Inc\.?)$';
    bilibili = '(?i)^(Shanghai (Bilibili Technology|Hode Information Technology|Wide Entertainment Digital Technology) Co\.,?\s*Ltd\.?|上海宽娱数码科技有限公司|上海幻电信息科技有限公司)$';
    weibo = '(?i)^(SINA Corporation|Sina\.com Technology \(China\) Co\.,?\s*Ltd\.?|Beijing Weimeng Chuangke Network Technology Co\.,?\s*Ltd\.?|北京微梦创科网络技术有限公司|新浪网技术（中国）有限公司)$';
    msedge = '(?i)^Microsoft Corporation$'; chrome = '(?i)^Google (LLC|Inc\.?|Limited)$';
    firefox = '(?i)^Mozilla Corporation$'
  }
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
      if (-not $publishers.ContainsKey($name)) { return $null }
      $startedAt = $owner.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
      $cacheKey = "$ownerId|$startedAt"
      if ($forceSignature -or -not $signatureCache.ContainsKey($cacheKey)) {
        $executable = $owner.MainModule.FileName
        $publisher = [TCReadOnlyWindows]::OfflinePublisher($executable)
        $signatureCache[$cacheKey] = (-not [string]::IsNullOrWhiteSpace($publisher) -and $publisher -match $publishers[$name])
      }
      if (-not $signatureCache[$cacheKey]) { return $null }
      $kind = if ($name -in $browserNames) { 'browser' } else { 'client' }
      return @{ handle = $windowHandle.ToInt64().ToString(); title = $title; process = $name;
        processId = [int]$ownerId; startedAt = $startedAt; kind = $kind }
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
    # Preview reads names only; editor/password subtrees never contribute draft text.
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
      $password = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true)
      if ($password -ne $false) { continue }
      $type = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $true)
      if ($type -eq [System.Windows.Automation.AutomationElement]::NotSupported -or
          $type -eq [System.Windows.Automation.ControlType]::Edit -or
          $type -eq [System.Windows.Automation.ControlType]::ComboBox) { continue }
      $offscreen = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $true)
      if ($offscreen -ne $false) { continue }
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
    if ($controls.Count -eq 0 -or $textParts.Count -eq 0) { Stop-Read 'WINDOWS_UI_UNAVAILABLE' }
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
    foreach ($key in @('editorId', 'buttonId', 'inputFingerprint')) {
      if ($actual[$key] -isnot [string] -or $expectedBinding.$key -isnot [string] -or
          [string]::IsNullOrEmpty($actual[$key]) -or $actual[$key] -cne $expectedBinding.$key) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    }
  }
  function Assert-IdleEditor($access, [IntPtr]$windowHandle, [string]$expectedValue) {
    if ($null -eq $access.editor -or $null -eq $access.valuePattern -or
        [TCReadOnlyWindows]::GetForegroundWindow() -eq $windowHandle -or
        $access.editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true) -ne $false -or
        $access.editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -ne $true -or
        $access.valuePattern.Current.IsReadOnly -ne $false -or
        $access.valuePattern.Current.Value -cne $expectedValue) { Stop-Read 'WINDOWS_UI_DRAFT_CHANGED' }
  }
  function Get-ReplyAccess($root, [IntPtr]$windowHandle, [int]$ownerId) {
    $summary = @{ canSend = $false; reasonCode = 'WINDOWS_UI_UNSUPPORTED_INPUT'; inputFingerprint = $null;
      imeLayout = [TCReadOnlyWindows]::KeyboardLayout($windowHandle) }
    $result = @{ summary = $summary; editorId = $null; buttonId = $null; editor = $null;
      button = $null; valuePattern = $null; invokePattern = $null }
    try {
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $pending = New-Object 'System.Collections.Generic.Queue[object]'
      $pending.Enqueue(@{ element = $root; depth = 0 })
      $editors = New-Object 'System.Collections.Generic.List[object]'
      $buttons = New-Object 'System.Collections.Generic.List[object]'
      $visited = 0
      while ($pending.Count -gt 0) {
        $entry = $pending.Dequeue(); $visited++
        # An incomplete traversal cannot prove uniqueness. Refuse instead of picking the first match.
        if ($visited -gt 2000 -or $entry.depth -gt 12) { return $result }
        $element = $entry.element
        if ($element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true) -ne $false -or
            $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $true) -ne $false) { continue }
        if ($element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $true) -ne $ownerId) { return $result }
        $type = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $true)
        if ($type -eq [System.Windows.Automation.ControlType]::ComboBox -or
            $type -eq [System.Windows.Automation.AutomationElement]::NotSupported) { continue }
        if ($type -eq [System.Windows.Automation.ControlType]::Edit) {
          $editors.Add($element)
          continue
        }
        if ($type -eq [System.Windows.Automation.ControlType]::Button) {
          $name = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty, $true)
          if ($name -is [string] -and $name -cmatch '^(发送|Send)([（(][sS][）)])?$') { $buttons.Add($element) }
        }
        $child = $walker.GetFirstChild($element)
        $siblings = 0
        while ($null -ne $child) {
          $siblings++
          if ($pending.Count -ge 2000 -or $siblings -gt 2000) { return $result }
          $pending.Enqueue(@{ element = $child; depth = $entry.depth + 1 })
          $child = $walker.GetNextSibling($child)
        }
      }
      if ($editors.Count -ne 1 -or $buttons.Count -ne 1) { return $result }
      $editor = $editors[0]; $button = $buttons[0]
      $valuePattern = $null; $invokePattern = $null
      if (-not $editor.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -or
          -not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { return $result }
      $valuePattern = [System.Windows.Automation.ValuePattern]$valuePattern
      $invokePattern = [System.Windows.Automation.InvokePattern]$invokePattern
      if ($valuePattern.Current.IsReadOnly -ne $false -or
          $editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -ne $true) { return $result }
      $editorId = ($editor.GetRuntimeId() -join ','); $buttonId = ($button.GetRuntimeId() -join ',')
      if ($editorId -cnotmatch '^-?\d{1,10}(,-?\d{1,10}){0,63}$' -or $buttonId -cnotmatch '^-?\d{1,10}(,-?\d{1,10}){0,63}$' -or $editorId -ceq $buttonId) { return $result }
      $summary.inputFingerprint = Get-Hash @('TC-WINDOW-INPUT-1', $editorId, $buttonId)
      $result.editorId = $editorId; $result.buttonId = $buttonId; $result.editor = $editor; $result.button = $button
      $result.valuePattern = $valuePattern; $result.invokePattern = $invokePattern
      # Inspect only whether a draft exists. Its contents are never returned, hashed, or logged.
      if ($valuePattern.Current.Value -cne '') { $summary.reasonCode = 'WINDOWS_UI_DRAFT_PRESENT'; return $result }
      if ([TCReadOnlyWindows]::GetForegroundWindow() -eq $windowHandle -or
          $editor.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true) -ne $false) {
        $summary.reasonCode = 'WINDOWS_UI_DRAFT_CHANGED'; return $result
      }
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
      -not $publishers.ContainsKey([string]$expected.process)) { Stop-Read 'WINDOWS_UI_SELECTION' }
  $windowHandle = [IntPtr]::new([long]::Parse($expected.handle))
  $before = Get-Identity $windowHandle $true
  Assert-Identity $before $expected

  if ($request.operation -eq 'capture') {
    # Only this selected, verified HWND is passed to PrintWindow; all images stay in memory.
    $capture = [TCReadOnlyWindows]::CaptureSelected($windowHandle)
    $after = Get-Identity $windowHandle $true
    Assert-Identity $after $expected
    Write-Result @{ ok = $true; before = $before; after = $after; image = @{
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
  $access = Get-ReplyAccess $root $windowHandle $before.processId
  if ($preview.truncated) { $access.summary.canSend = $false; $access.summary.reasonCode = 'WINDOWS_UI_UNSUPPORTED_INPUT' }
  $snapshot = Get-PreviewSnapshot $preview $expected $access.summary.inputFingerprint
  # The preview and input binding are checked again by prepare/commit, never inferred from a screenshot.
  $after = Get-Identity $windowHandle $true
  Assert-Identity $after $expected
  if ($request.operation -in @('prepare', 'commit')) {
    if ($request.text -isnot [string] -or $request.text.Length -lt 1 -or $request.text.Length -gt 4000 -or
        [string]::IsNullOrWhiteSpace($request.text) -or $request.text -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]') { Stop-Read 'WINDOWS_UI_REPLY_TEXT' }
    if ($request.expectedSnapshot -isnot [string] -or $request.expectedSnapshot -cnotmatch '^[a-f0-9]{64}$' -or
        $snapshot -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_SNAPSHOT_CHANGED' }
    if (-not $access.summary.canSend) { Stop-Read $access.summary.reasonCode }
    $binding = @{ editorId = $access.editorId; buttonId = $access.buttonId; inputFingerprint = $access.summary.inputFingerprint }
    if ($request.operation -eq 'prepare') {
      Write-Result @{ ok = $true; before = $before; after = $after; text = $preview.text;
        controls = $preview.controls; truncated = $preview.truncated; snapshot = $snapshot; reply = $access.summary; binding = $binding }
      exit 0
    }
    Assert-Binding $binding $request.binding
    if ($request.expiresAt -isnot [long] -and $request.expiresAt -isnot [int] -and $request.expiresAt -isnot [double]) { Stop-Read 'WINDOWS_UI_TICKET' }
    # Last complete read before writing. There is no UIA atomic compare-and-set: user/provider
    # changes between the final check and SetValue remain possible. Background/unfocused refusal
    # reduces that risk but cannot eliminate it. Never clear, restore, or automatically retry a draft.
    $finalPreview = Read-Preview $root
    $access = Get-ReplyAccess $root $windowHandle $before.processId
    if ($finalPreview.truncated) { Stop-Read 'WINDOWS_UI_UNSUPPORTED_INPUT' }
    if ((Get-PreviewSnapshot $finalPreview $expected $access.summary.inputFingerprint) -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_SNAPSHOT_CHANGED' }
    if (-not $access.summary.canSend) { Stop-Read $access.summary.reasonCode }
    Assert-Binding @{ editorId = $access.editorId; buttonId = $access.buttonId; inputFingerprint = $access.summary.inputFingerprint } $request.binding
    Assert-Identity (Get-Identity $windowHandle $true) $expected
    Assert-IdleEditor $access $windowHandle ''
    if (([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() -ge $request.expiresAt) { Stop-Read 'WINDOWS_UI_TICKET' }
    $writeStarted = $true
    $access.valuePattern.SetValue([string]$request.text)
    # A partial provider write, user edit, identity change, or focus change leaves the draft alone.
    # Re-identify both unique controls and the visible conversation before invoking this button.
    $writtenPreview = Read-Preview $root
    $written = Get-ReplyAccess $root $windowHandle $before.processId
    Assert-Binding @{ editorId = $written.editorId; buttonId = $written.buttonId; inputFingerprint = $written.summary.inputFingerprint } $request.binding
    if ((Get-PreviewSnapshot $writtenPreview $expected $written.summary.inputFingerprint) -cne $request.expectedSnapshot) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
    Assert-Identity (Get-Identity $windowHandle $true) $expected
    Assert-IdleEditor $written $windowHandle ([string]$request.text)
    if ($written.button.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true) -ne $true) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
    if (([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() -ge $request.expiresAt) { Stop-Read 'WINDOWS_UI_REPLY_INTERRUPTED' }
    $written.invokePattern.Invoke()
    $after = Get-Identity $windowHandle $true
    Assert-Identity $after $expected
    # Invoke returning is not a delivery acknowledgement. No accepted/sent/delivered claim.
    Write-Result @{ ok = $true; before = $before; after = $after; status = 'unknown'; reply = $written.summary }
    exit 0
  }
  Write-Result @{ ok = $true; before = $before; after = $after; text = $preview.text;
    controls = $preview.controls; truncated = $preview.truncated; snapshot = $snapshot; reply = $access.summary }
} catch {
  # Never echo provider exceptions, PowerShell diagnostics, UI text or credentials.
  $allowed = @('WINDOWS_UI_UNSUPPORTED', 'WINDOWS_UI_CONSENT', 'WINDOWS_UI_SELECTION', 'WINDOWS_UI_CHANGED',
    'WINDOWS_UI_UNAVAILABLE', 'WINDOWS_UI_OUTPUT', 'WINDOWS_UI_CAPTURE', 'WINDOWS_UI_CAPTURE_PROTECTED', 'WINDOWS_UI_CAPTURE_DIMENSIONS',
    'WINDOWS_UI_UNSUPPORTED_INPUT', 'WINDOWS_UI_DRAFT_PRESENT', 'WINDOWS_UI_DRAFT_CHANGED', 'WINDOWS_UI_SNAPSHOT_CHANGED',
    'WINDOWS_UI_REPLY_TEXT', 'WINDOWS_UI_REPLY_INTERRUPTED', 'WINDOWS_UI_TICKET')
  $code = [string]$_.Exception.Message
  # C# static method failures are wrapped by PowerShell. Extract only a known fixed inner code.
  if ($code -notin $allowed -and $null -ne $_.Exception.InnerException) { $code = [string]$_.Exception.InnerException.Message }
  if ($writeStarted -eq $true) { $code = 'WINDOWS_UI_REPLY_INTERRUPTED' }
  elseif ($code -notin $allowed) { $code = if ($request.operation -eq 'capture') { 'WINDOWS_UI_CAPTURE' } elseif ($request.operation -eq 'commit') { 'WINDOWS_UI_REPLY_INTERRUPTED' } else { 'WINDOWS_UI_UNAVAILABLE' } }
  Write-Result @{ ok = $false; code = $code }
}
