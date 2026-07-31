# 出单员下发率指标看板

本地运行的累计看板。每次上传清单先预览，确认后才合并到累计数据；原始上传文件保留在本地数据库附件表中。

## 启动

```powershell
node .\downrate-dashboard\src\server.mjs
```

浏览器访问 `http://127.0.0.1:54800/`。端口被占用时可使用：

```powershell
$env:DOWNRATE_PORT='54801'
node .\downrate-dashboard\src\server.mjs
```

## 口径

- 只使用本地数据库中的正式出单员名单，排除宋键、梁欣宁等组长。
- 按源表字段名识别 `出单员`、`退回审核意见`、`出单时间`、`保单号`、`投保单号`，不按 Q/S 列号判断。
- 总笔数来自本地数据库的 `非车保单 + 非车批改`，不是上传清单行数。
- 未确认的退回审核意见进入待确认，不计入当前结果。
- 当前评分规则为 0.9%、1.8%、3%、5% 四个边界的线性取值。

## 验证

```powershell
$env:DOWNRATE_PYTHON='C:\Users\团意险\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
node --test .\downrate-dashboard\test\*.test.mjs
```

测试不读取或上传生产数据库；生产数据库和办公文件均不提交到 Git。
