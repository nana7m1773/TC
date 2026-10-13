$ErrorActionPreference = 'Stop'
try {
  $runtime = Get-ItemProperty 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
  if ($runtime.Installed -eq 1 -and [version]($runtime.Version.TrimStart('v')) -ge [version]'14.51.36247.0') { exit 0 }
  $installer = $env:TC_VC_INSTALLER
  if ([string]::IsNullOrWhiteSpace($installer)) { exit 20 }
  $expected = '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c'
  if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { exit 21 }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') { exit 22 }
  $process = Start-Process -FilePath $installer -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010) { exit 0 }
  exit 23
} catch { exit 24 }
