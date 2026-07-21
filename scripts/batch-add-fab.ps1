# 批量在业务页面末尾添加 AIFab + AIChatPanel
$pages = @(
    "dashboard",
    "records",
    "record-detail",
    "record-edit",
    "equipments",
    "users",
    "categories",
    "logs",
    "profile",
    "index"
)

$basePath = "c:\Users\SongYuanXinTong\Documents\trae_projects\器材装备管理小程序\frontend\src\pages"

foreach ($page in $pages) {
    $filePath = Join-Path $basePath "$page\index.tsx"
    if (-not (Test-Path $filePath)) {
        Write-Host "Skip (not found): $filePath"
        continue
    }
    $content = Get-Content $filePath -Raw

    # 1. 注入 import（如果还没有）
    if ($content -notmatch "from '@/components/AIFab'") {
        # 找到最后一个 import 行后插入
        $importLine = "import AIFab from '@/components/AIFab'`r`nimport AIChatPanel from '@/components/AIChatPanel'"
        # 在最后一个以 import 开头的行后插入
        $content = $content -replace "(?m)^(import [^\r\n]+)$(?![\s\S]*^import )", "`$1`r`n$importLine"
    }

    # 2. 在 return 之前定义组件
    # 实际上更简单：直接在 JSX 末尾插入 <AIFab /><AIChatPanel mode="floating" />
    # 找到 </View> 的最后一个出现位置（顶层容器结束），在其之前插入
    $fabLine = "      <AIFab />`r`n      <AIChatPanel mode=`"floating`" />"
    # 不再简单追加，避免破坏结构；改用注释标记
    Write-Host "Processed: $page"
    Set-Content -Path $filePath -Value $content -Encoding UTF8
}

Write-Host "Done. Phase 1 (imports) complete."
