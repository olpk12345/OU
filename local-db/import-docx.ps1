param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = "Stop"
$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "Python 3 with python-docx is required."
    }
    $python = $pythonCommand.Source
}

& $python (Join-Path $PSScriptRoot "import-docx.py") @Files
if ($LASTEXITCODE -ne 0) {
    throw "DOCX import failed with exit code $LASTEXITCODE."
}
