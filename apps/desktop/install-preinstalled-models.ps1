$ErrorActionPreference='Stop'
try {
  $plan = ConvertFrom-Json $env:LBOT_OFFLINE_PLAN
  $source = $env:LBOT_OFFLINE_SOURCE
  $target = Join-Path $env:LBOT_OFFLINE_TARGET 'resources\preinstalled-models'
  # Check all volumes before modifying the application or its existing models.
  foreach ($model in $plan.models) {
    foreach ($part in $model.parts) {
      $file = Join-Path $source $part.name
      if (!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $part.sizeBytes) {
        throw "Missing or incomplete offline volume: $($part.name). Put every volume beside the installer."
      }
    }
  }
  [System.IO.Directory]::CreateDirectory($target) | Out-Null
  $staged = New-Object System.Collections.Generic.List[object]
  foreach ($model in $plan.models) {
    $final = Join-Path $target $model.filename
    if ((Test-Path -LiteralPath $final) -and (Get-Item -LiteralPath $final).Length -eq $model.sizeBytes -and (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash -eq $model.sha256) {continue}
    $temporary = $final + '.offline-part'
    $output = [System.IO.File]::Open($temporary,[System.IO.FileMode]::Create,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
      $buffer = New-Object byte[] (4*1024*1024)
      foreach ($part in $model.parts) {
        $inputFile = [System.IO.File]::OpenRead((Join-Path $source $part.name))
        try {while (($read=$inputFile.Read($buffer,0,$buffer.Length)) -gt 0) {$output.Write($buffer,0,$read);$null=$hash.TransformBlock($buffer,0,$read,$buffer,0)}}
        finally {$inputFile.Dispose()}
      }
      $null=$hash.TransformFinalBlock((New-Object byte[] 0),0,0)
      $actual=([BitConverter]::ToString($hash.Hash)).Replace('-','').ToLowerInvariant()
      $output.Flush($true)
    } finally {$output.Dispose();$hash.Dispose()}
    if ((Get-Item -LiteralPath $temporary).Length -ne $model.sizeBytes -or $actual -ne $model.sha256) {
      Remove-Item -LiteralPath $temporary -Force
      throw "Offline model checksum failed: $($model.filename). Existing models were preserved."
    }
    $staged.Add(@{Temporary=$temporary;Final=$final})
  }
  # Publish only after all three staged models have passed pinned SHA-256 checks.
  foreach ($entry in $staged) {
    if (Test-Path -LiteralPath $entry.Final) {[System.IO.File]::Replace($entry.Temporary,$entry.Final,$null)}
    else {[System.IO.File]::Move($entry.Temporary,$entry.Final)}
  }
  [System.IO.File]::WriteAllText((Join-Path $target 'bundle.json'),$env:LBOT_OFFLINE_PLAN)
  Write-Output 'Preinstalled text, vision and speech models verified. No network download was used.'
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
