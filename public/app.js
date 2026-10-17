const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat().format(value ?? 0);
const api = async (path, options) => { const response = await fetch(path, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Request failed'); return body; };

async function loadDashboard() {
  try {
    const [account, posts, quota] = await Promise.all([api('/api/account'), api('/api/posts?limit=12'), api('/api/publishing-limit')]);
    $('#connection-status').textContent = `@${account.username || 'connected'}`;
    $('#account-name').textContent = account.name || `@${account.username || account.id}`;
    $('#account-bio').textContent = account.biography || 'Professional Instagram account connected to Orion.';
    $('#followers').textContent = money(account.followers_count);
    $('#media-count').textContent = money(account.media_count);
    $('#following').textContent = money(account.follows_count);
    if (account.profile_picture_url) { $('#avatar').src = account.profile_picture_url; $('#avatar').hidden = false; }
    renderQuota(quota);
    renderPosts(posts.data || []);
  } catch (error) {
    $('#connection-status').textContent = 'Connection needs setup';
    $('#connection-status').closest('.status-pill').classList.add('error');
    $('#posts').innerHTML = `<p class="muted">${escapeHtml(error.message)} Add Instagram credentials to .env and refresh.</p>`;
  }
}
function renderQuota(payload) {
  const item = payload.data?.[0] || payload;
  const used = item.quota_usage ?? payload.quota_usage ?? 0;
  const total = item.config?.quota_total ?? payload.quota_total ?? 100;
  $('#quota').textContent = `${money(used)} / ${money(total)}`;
  $('#quota-label').textContent = `${Math.max(total - used, 0)} publishing slots remain in the current window.`;
  $('#quota-meter').style.width = `${Math.min((used / total) * 100, 100)}%`;
}
function renderPosts(posts) {
  if (!posts.length) { $('#posts').innerHTML = '<p class="muted">No media returned for this account.</p>'; return; }
  $('#posts').innerHTML = posts.map((post) => `<a class="post" href="${escapeAttr(post.permalink || '#')}" target="_blank" rel="noreferrer"><img loading="lazy" src="${escapeAttr(post.media_url || post.thumbnail_url || '')}" alt="${escapeAttr(post.caption || post.media_type || 'Instagram post')}" /><div class="post-info"><p>${escapeHtml(post.caption || 'No caption')}</p><small>${escapeHtml(post.media_product_type || post.media_type || 'MEDIA')} · ${post.like_count ?? 0} likes</small></div></a>`).join('');
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
const escapeAttr = escapeHtml;
$('#refresh').addEventListener('click', loadDashboard);
$('#publish-form').addEventListener('submit', async (event) => { event.preventDefault(); const result = $('#publish-result'); const form = new FormData(event.target); result.className = 'form-result'; result.textContent = 'Creating container and publishing…'; try { const published = await api('/api/publish', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mediaType: 'IMAGE', imageUrl: form.get('imageUrl'), caption: form.get('caption'), altText: form.get('altText') }) }); result.className = 'form-result success'; result.textContent = `Published media ${published.mediaId}.`; event.target.reset(); await loadDashboard(); } catch (error) { result.className = 'form-result error'; result.textContent = error.message; } });
loadDashboard();
