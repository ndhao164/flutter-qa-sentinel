param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Remaining
)

$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $root "tools/install-flutter-qa-skill.mjs"

node $installer @Remaining
exit $LASTEXITCODE
