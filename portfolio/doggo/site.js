// Local-first prototype: preferences stay on this device.
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('doggo.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('doggo.' + key, JSON.stringify(value)); } catch { showToast('浏览器未允许保存，当前会话仍可使用'); } }
};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
state.favorites = new Set(storage.get('favorites', []));
let profile = storage.get('profile', {});
let checklist = storage.get('checklist', []);
const climates = {chengdu:'temperate',hangzhou:'temperate',xiamen:'warm',shanghai:'temperate',guangzhou:'warm',beijing:'cool'};
let destination = storage.get('destination', 'chengdu');
const originalNavigate = navigate;
navigate = function(view) {
  if (!['find','move','live','care','profile'].includes(view)) view = 'find';
  originalNavigate(view);
  history.replaceState(null, '', '#' + view);
  if (view === 'profile') renderProfile();
  if (view === 'care') renderCare();
};
function cityMatches(city, dog) {
  return (!dog || DOG_REGION_FIT[dog.id].includes(climates[city.id])) && (state.climate === 'all' || climates[city.id] === state.climate) && (state.policy === 'all' || city.policy === state.policy);
}
renderChoices = function() {
  const isCity = state.mode === 'city';
  const choices = isCity ? CITIES : DOGS;
  const query = normalizeSearch(state.query);
  const matches = choices.filter(x => [x.name, x.en || '', ...(x.aliases || [])].some(v => normalizeSearch(v).includes(query)));
  $('#choiceLabel').textContent = isCity ? '选择你的目标城市' : '选择与你一起出发的狗狗';
  $('#choiceGrid').innerHTML = matches.map(x => `<button class="choice-chip ${state.selected?.id === x.id ? 'selected' : ''}" data-choice="${x.id}" aria-pressed="${state.selected?.id === x.id}"><strong>${x.name}</strong><small>${isCity ? x.province + ' · ' + x.climate : x.size}</small></button>`).join('');
  $('#searchEmpty').hidden = !!matches.length;
  $('#searchEmpty').textContent = '没有找到匹配项，试试其他关键词。';
  $('#resultCount').textContent = matches.length;
  $$('[data-choice]').forEach(b => b.onclick = () => { state.selected = choices.find(x => x.id === b.dataset.choice); renderChoices(); renderResults(); });
};
renderResults = function() {
  const isCity = state.mode === 'city';
  const selected = state.selected;
  const results = isCity ? DOGS.filter(d => (!selected || cityMatches(selected, d)) && (selected || state.climate === 'all' || DOG_REGION_FIT[d.id].includes(state.climate))) : CITIES.filter(c => cityMatches(c, selected));
  $('#filterCount').textContent = Number(state.climate !== 'all') + Number(state.policy !== 'all');
  $('#stepNumber').textContent = selected ? '02' : '01';
  $('#resultsTitle').textContent = selected ? `${selected.name} · ${isCity ? '认识适合的狗狗' : '探索生活的城市'}` : '下一站，也许就在这里';
  $('#selectionSummary').innerHTML = `<div class="summary-icon">${isCity ? '⌂' : '✦'}</div><p class="kicker">${isCity ? 'CITY' : 'DOGGO'} × YOUR LIFE</p><h3>${selected?.name || '每一种生活，都有可能'}</h3><p>${results.length} 个探索结果 · 按基础气候偏好筛选。城市内的限养区域、犬只体高与禁养目录需单独核验。</p>`;
  $('#resultGrid').innerHTML = results.map(x => `<article class="city-card"><div class="city-visual" style="background-image:url('${x.image}')"><span class="city-badge">${isCity ? x.en : x.province}</span><button class="favorite" data-save="${x.id}" aria-label="收藏${x.name}" aria-pressed="${state.favorites.has(x.id)}">${state.favorites.has(x.id) ? '♥' : '♡'}</button></div><div class="city-body"><h3>${x.name}</h3><p class="city-meta">${isCity ? x.size : x.climate}</p><div class="score-row">${(x.scores || [x.climate + '气候偏好','了解犬种特征']).map(s => `<span class="score">${s}</span>`).join('')}</div><div class="city-foot"><small>探索示例 · 当地养犬政策待核验</small><button class="arrow-button" data-open="${x.id}" aria-label="了解${x.name}">↗</button></div></div></article>`).join('') || '<div class="data-card"><h3>暂时没有匹配结果</h3><p>试试放宽筛选，让更多可能出现。</p></div>';
  $$('[data-save]').forEach(b => b.onclick = () => { const id = b.dataset.save; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); storage.set('favorites', [...state.favorites]); renderResults(); });
  $$('[data-open]').forEach(b => b.onclick = () => { if (isCity) { profile.dog = b.dataset.open; storage.set('profile', profile); navigate('care'); } else { destination = b.dataset.open; storage.set('destination', destination); navigate('move'); } });
};
const citySelect = () => `<label class="destination">目标城市 <select id="destination">${CITIES.map(c => `<option value="${c.id}" ${c.id === destination ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>`;
renderMove = function(tab) {
  $$('[data-move-tab]').forEach(b => b.classList.toggle('active', b.dataset.moveTab === tab));
  const city = CITIES.find(c => c.id === destination) || CITIES[0];
  const tasks = ['核对目的地禁养目录与管理区域','确认租房合同允许养宠','准备免疫记录与检疫资料','确认承运方要求、预订运输','打包熟悉的食物、牵引与用品','抵达后核对当地养犬登记流程'];
  const policies = POLICIES.filter(p => p.level === 'city' && p.place.startsWith(city.name));
  const items = tab === 'transport' ? TRANSPORT : policies.length ? policies : [{title:city.name + '养犬资料待核验',detail:city.policyNote,source:'https://flk.npc.gov.cn/',updated:'尚未核验'}];
  $('#moveContent').innerHTML = citySelect() + (tab === 'checklist' ? `<div class="data-card"><p class="kicker">READY, SET, GO</p><h3>搬家准备 · ${checklist.length} / ${tasks.length}</h3>${tasks.map((t,i) => `<label class="task"><input type="checkbox" data-task="${i}" ${checklist.includes(i) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>` : `<div class="data-list">${items.map(i => `<article class="data-card"><span class="data-tag">${tab === 'policy' ? '城市资料 · 尚需确认时效' : i.tag}</span><h3>${i.title}</h3><p>${i.detail}</p><p>原始资料整理：${i.updated} · 未进行实时核验</p>${i.source.startsWith('https://') ? `<a class="source-link" href="${i.source}" target="_blank" rel="noopener noreferrer">访问公开查询入口 ↗</a>` : '<p>暂无可靠公开来源</p>'}</article>`).join('')}</div>`);
  $('#destination').onchange = e => { destination = e.target.value; storage.set('destination', destination); renderMove(tab); };
  $$('[data-task]').forEach(input => input.onchange = () => { const id = Number(input.dataset.task); checklist = input.checked ? [...new Set([...checklist,id])] : checklist.filter(x => x !== id); storage.set('checklist', checklist); renderMove(tab); });
};
renderLive = function() {
  $('#liveGrid').innerHTML = CITIES.map(c => `<article class="live-card"><p class="kicker">${c.province}</p><h3>${c.name}</h3><p>${c.climate} · ${c.scores.join(' / ')}<br>城市印象示例，设施与政策待核验。</p><button class="text-button live-action" data-city="${c.id}">了解城市与搬家资料 ↗</button></article>`).join('');
  $$('[data-city]').forEach(b => b.onclick = () => { destination = b.dataset.city; storage.set('destination', destination); navigate('move'); });
};
function renderProfile() {
  const panel = $('#view-profile');
  panel.querySelector('.profile-card').outerHTML = `<div class="profile-card"><form id="profileForm"><p class="kicker">MY LITTLE WORLD · 保存在此浏览器</p><h2>你和狗狗的生活档案</h2><label>你的称呼<input name="name" maxlength="30" value="${escapeHTML(profile.name)}" placeholder="怎么称呼你？"></label><label>所在城市<input name="city" maxlength="30" value="${escapeHTML(profile.city)}" placeholder="例如：上海"></label><label>我的状态<select name="status"><option value="want">想养狗</option><option value="have" ${profile.status === 'have' ? 'selected' : ''}>已养狗</option></select></label><label>我的狗狗<select name="dog">${DOGS.map(d => `<option value="${d.id}" ${profile.dog === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}</select></label><label>年龄（月）<input name="age" type="number" min="0" max="360" value="${escapeHTML(profile.age)}" placeholder="例如：8"></label><button class="primary-button" type="submit">保存档案 ↗</button></form></div>`;
  panel.querySelector('.saved-list')?.remove();
  const saved = [...CITIES,...DOGS].filter(x => state.favorites.has(x.id));
  panel.insertAdjacentHTML('beforeend', `<section class="saved-list"><div class="section-heading"><h2>我的收藏 <small>${saved.length}</small></h2></div><div class="live-grid">${saved.map(x => `<article class="live-card"><h3>${x.name}</h3><p>${x.province || x.size}</p><button class="text-button live-action" data-remove="${x.id}">取消收藏</button></article>`).join('') || '<p>还没有收藏。在 FIND 中点一下爱心，把下一站留在这里。</p>'}</div></section>`);
  $('#profileForm').onsubmit = e => { e.preventDefault(); profile = Object.fromEntries(new FormData(e.target)); storage.set('profile',profile); showToast('档案已保存，下次回来继续'); };
  $$('[data-remove]').forEach(b => b.onclick = () => {state.favorites.delete(b.dataset.remove); storage.set('favorites',[...state.favorites]); renderProfile(); renderResults();});
}
function renderCare() {
  const dog = DOGS.find(d => d.id === profile.dog);
  const topics = [['第一次养狗','先准备固定休息区、牵引绳、水碗和熟悉的食物。与兽医确认免疫与驱虫计划。'],['饮食与健康','按生命阶段选择完整均衡的犬粮。葡萄、葡萄干、巧克力与木糖醇应避免摄入；误食请及时联系兽医。'],['运动与训练','从短时间散步和正向奖励开始，逐渐增加活动。幼犬避免强迫长跑与反复跳跃。'],['日常护理','定期检查耳朵、牙齿、指甲与皮肤，梳毛时也留意异常肿块或寄生虫。'],['气候与出行','炎热天气避开午间遛狗，随身带水。切勿把狗狗独自留在停放的汽车内。'],['建立健康记录','记录疫苗、驱虫、体重和异常症状。持续呕吐、呼吸困难或精神明显异常时及时就医。']];
  $('#view-care .page-intro > p:last-child').textContent = dog ? `与你的${dog.name}${profile.age ? ' · ' + profile.age + '个月' : ''}一起，建立日常照护习惯。以下为通用照护建议，具体方案请向兽医确认。` : '从第一次见面到每一天的陪伴。填写个人档案，让这里记住你的狗狗。';
  $('.care-grid').innerHTML = topics.map(([title,body],i) => `<article><span>0${i+1} / GOOD DAYS TOGETHER</span><h3>${title}</h3><p>${body}</p></article>`).join('');
}
function resetFinder(mode = state.mode) {
  state.mode = mode; state.selected = null; state.query = ''; state.climate = 'all'; state.policy = 'all';
  $('#searchInput').value = ''; $('#searchInput').placeholder = mode === 'city' ? '搜索城市，例如：成都、杭州、上海' : '搜索犬种，例如：金毛、泰迪、柯基';
  $('#climateFilter').value = 'all'; $('#policyFilter').value = 'all';
  $$('.mode').forEach(b => {b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-selected',String(b.dataset.mode === mode));});
  renderChoices(); renderResults();
}
$$('.mode').forEach(b => b.onclick = () => resetFinder(b.dataset.mode === 'explore' ? 'dog' : b.dataset.mode));
$('#resetButton').onclick = () => resetFinder();
$('#savedButton').onclick = () => navigate('profile');
$('.brand').onclick = e => {e.preventDefault(); navigate('find');};
$('#filterButton').onclick = () => { const drawer = $('#filterDrawer'); drawer.hidden = !drawer.hidden; $('#filterButton').setAttribute('aria-expanded',String(!drawer.hidden)); };
$('.hero-note').textContent = '一个人，一只狗，一座刚刚好的城市。让下一站，更像你们的家。';
$('.source-card').innerHTML = '<p class="kicker">BEFORE YOU GO</p><h3>出发前，再确认一次。</h3><p>这里保留原项目的公开查询入口，尚未核验最新时效。具体管理区域、禁养目录、登记和运输要求，请向目的地官方与承运方确认。</p><div class="source-stat"><strong>06</strong><span>座示例城市</span></div>';
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
resetFinder(); navigate(location.hash.slice(1) || 'find');
