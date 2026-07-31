const $ = (id) => document.getElementById(id);
let periods = [];

function showNotice(message) { const node = $('notice'); node.textContent = message; node.hidden = false; }
function formatRate(value) { return value == null ? '--' : `${(value * 100).toFixed(2)}%`; }
function formatScore(value) { return value == null ? '--' : Number(value).toFixed(1); }

function render(data) {
  $('averageScore').textContent = data.summary.averageScore == null ? '--' : data.summary.averageScore.toFixed(1);
  $('operatorCount').textContent = data.summary.operatorCount;
  $('includedCount').textContent = data.summary.includedCount;
  $('pendingCount').textContent = data.summary.pendingCount;
  $('resultMeta').textContent = `${data.results.length} 名人员`;
  const sorted = [...data.results].sort((a,b) => (a.score ?? -1) - (b.score ?? -1));
  $('riskList').innerHTML = sorted.filter(row => row.score != null && row.score < 60).map(row => `<div class="risk-row"><strong>${row.operatorName}</strong><span>下发率 ${formatRate(row.rate)}</span><strong class="risk-score">${formatScore(row.score)}</strong></div>`).join('') || '<p class="empty">暂无低分人员</p>';
  const bands = [{label:'90分及以上', count:data.results.filter(r=>r.score>=90).length},{label:'60-89分', count:data.results.filter(r=>r.score>=60&&r.score<90).length},{label:'1-59分', count:data.results.filter(r=>r.score>0&&r.score<60).length},{label:'0分', count:data.results.filter(r=>r.score===0).length}];
  const total = data.results.length || 1;
  $('distribution').innerHTML = bands.map(b => `<div class="dist-row"><label>${b.label}</label><div class="bar"><i style="width:${(b.count/total)*100}%"></i></div><strong>${((b.count/total)*100).toFixed(1)}%</strong></div>`).join('');
  $('resultTable').innerHTML = sorted.map((row,index) => { const status = row.score == null ? ['无分母','warn'] : row.score < 60 ? ['重点关注','danger'] : ['正常','']; return `<tr><td>${index+1}</td><td>${row.operatorName}</td><td>${formatRate(row.rate)}</td><td>${row.includedCount}</td><td>${row.denominator}</td><td class="score">${formatScore(row.score)}</td><td><span class="status ${status[1]}">${status[0]}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">暂无结果</td></tr>';
}

async function loadPeriods() {
  const response = await fetch('/api/periods');
  const data = await response.json();
  periods = data.periods ?? [];
  const years = [...new Set(periods.map(p => p.year))].sort((a,b)=>b-a);
  $('yearSelect').innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('') || '<option value="">暂无数据</option>';
  updateMonths();
}
function updateMonths() { const year = Number($('yearSelect').value); const months = periods.filter(p=>p.year===year).map(p=>p.month); $('monthSelect').innerHTML = `<option value="all">全部月份</option>` + months.map(month=>`<option value="${month}">${month}月</option>`).join(''); }
async function loadOverview() { if (!$('yearSelect').value) return; const year = Number($('yearSelect').value); const month = $('monthSelect').value; const query = month === 'all' ? `year=${year}` : `year=${year}&months=${month}`; const response = await fetch(`/api/overview?${query}`); if (!response.ok) { showNotice('当前期间暂无可计算数据'); return; } render(await response.json()); }

$('yearSelect').addEventListener('change', async () => { updateMonths(); await loadOverview(); });
$('monthSelect').addEventListener('change', loadOverview);
$('uploadButton').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; showNotice('正在解析清单，请稍候'); const preview = await fetch('/api/uploads/preview',{method:'POST',headers:{'X-Filename':file.name,'Content-Type':file.type||'application/octet-stream'},body:await file.arrayBuffer()}); const data=await preview.json(); if(!preview.ok){showNotice(data.message||'清单解析失败');return} if(!window.confirm(`已识别新增 ${data.counts.inserted} 笔、更新 ${data.counts.updated} 笔，确认合并并计算？`)){return} const committed=await fetch(`/api/uploads/${data.batchId}/commit`,{method:'POST'}); if(!committed.ok){showNotice('清单合并失败');return} showNotice('清单已更新'); await loadPeriods(); await loadOverview(); event.target.value=''; });

loadPeriods().then(loadOverview).catch(() => showNotice('看板数据加载失败，请检查本地服务'));
