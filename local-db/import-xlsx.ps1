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
        throw "Python 3 with openpyxl is required."
    }
    $python = $pythonCommand.Source
}

& $python (Join-Path $PSScriptRoot "import-xlsx.py") @Files
if ($LASTEXITCODE -ne 0) {
    throw "XLSX import failed with exit code $LASTEXITCODE."
}
