$ErrorActionPreference = 'Stop'
$sourceDir = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $sourceDir 'SKILL.md'
if (-not (Test-Path -LiteralPath $sourceFile)) { throw 'Missing fpc-universal SKILL.md' }
if (-not (Select-String -LiteralPath $sourceFile -Pattern '^name: fpc-universal$' -Quiet)) { throw 'Invalid fpc-universal skill name' }
if (-not $HOME) { throw 'HOME is required' }
$destinations = @(
    (Join-Path $HOME '.agents/skills/fpc-universal'),
    (Join-Path $HOME '.codex/skills/fpc-universal'),
    (Join-Path $HOME '.claude/skills/fpc-universal')
)
foreach ($dest in $destinations) {
    $marker = Join-Path $dest '.fpc-universal-managed'
    if ((Test-Path -LiteralPath $dest) -and -not (Test-Path -LiteralPath $marker)) {
        Write-Warning "SKIP unmanaged destination: $dest"
        continue
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceDir 'SKILL.md') -Destination $dest -Force
    Copy-Item -LiteralPath (Join-Path $sourceDir 'README.md') -Destination $dest -Force
    foreach ($dirName in @('references', 'scripts')) {
        $src = Join-Path $sourceDir $dirName
        $target = Join-Path $dest $dirName
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
    }
    Set-Content -LiteralPath $marker -Value 'Managed by FPC Universal local installer' -Encoding UTF8
    Write-Output "Installed: $dest"
}
$ruleDir = Join-Path $HOME '.continue/rules'
$rule = Join-Path $ruleDir '99-fpc-universal.md'
if ((Test-Path -LiteralPath $rule) -and -not (Select-String -LiteralPath $rule -Pattern '^<!-- fpc-universal-managed -->$' -Quiet)) {
    Write-Warning "SKIP unmanaged Continue rule: $rule"
} else {
    New-Item -ItemType Directory -Force -Path $ruleDir | Out-Null
    $ruleText = @'
---
name: FPC Universal Coding and Research
alwaysApply: true
---
<!-- fpc-universal-managed -->
For substantive engineering or research requests, read the user-level `~/.agents/skills/fpc-universal/SKILL.md` and relevant on-demand references when they are accessible in this environment. Respect this workspace's local AGENTS.md, CLAUDE.md, security rules, approved specifications, and any specialized skill before the general skill. Do not presume access to unavailable tools or external accounts.
'@
    Set-Content -LiteralPath $rule -Value $ruleText -Encoding UTF8
    Write-Output "Installed Continue rule: $rule"
}
