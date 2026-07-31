// Vercel serverless function. Принимает правку главы с сайта-библии и
// заводит/обновляет Pull Request в репозитории — вместо прямого коммита
// в main, чтобы правку можно было проверить (supervisor.py + канон) до
// релиза.
//
// Требует переменную окружения GITHUB_TOKEN (Vercel → Settings →
// Environment Variables) — personal access token с правами Contents:write
// и Pull requests:write на этот репозиторий.

const OWNER = 'obscurusinf-lab';
const REPO = 'pervaya-mezhdumirovaya';
const BASE_BRANCH = 'main';
const EDIT_PASSWORD = '19411941';
const VALID_CHAPTER_ID = /^(1[0-7]|[1-9]|11-bis)$/;
const GH_API = 'https://api.github.com';

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pervaya-mezhdumirovaya-pravka',
    'Content-Type': 'application/json',
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Сервер не настроен: нет GITHUB_TOKEN в переменных окружения Vercel.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { password, chapterId, content } = body || {};

  if (password !== EDIT_PASSWORD) {
    res.status(401).json({ error: 'Неверный пароль.' });
    return;
  }
  if (!chapterId || !VALID_CHAPTER_ID.test(chapterId)) {
    res.status(400).json({ error: 'Некорректный номер главы.' });
    return;
  }
  if (!content || typeof content !== 'string' || content.trim().length < 50 || content.length > 200000) {
    res.status(400).json({ error: 'Пустой, слишком короткий или подозрительно большой текст.' });
    return;
  }

  const path = `pervaya-mezhdumirovaya-glava-${chapterId}.md`;
  const branch = `pravka/glava-${chapterId}`;

  try {
    const mainRefResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/git/ref/heads/${BASE_BRANCH}`, { headers: ghHeaders(token) });
    if (!mainRefResp.ok) throw new Error(`Не удалось прочитать ${BASE_BRANCH}: ${mainRefResp.status}`);
    const mainRef = await mainRefResp.json();
    const mainSha = mainRef.object.sha;

    const branchRefResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`, { headers: ghHeaders(token) });
    if (branchRefResp.status === 404) {
      const createRefResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/git/refs`, {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
      });
      if (!createRefResp.ok) throw new Error(`Не удалось создать ветку: ${createRefResp.status}`);
    } else if (!branchRefResp.ok) {
      throw new Error(`Не удалось проверить ветку: ${branchRefResp.status}`);
    }

    let fileSha;
    const fileResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`, { headers: ghHeaders(token) });
    if (fileResp.ok) {
      const fileJson = await fileResp.json();
      fileSha = fileJson.sha;
    }

    const contentB64 = Buffer.from(content, 'utf-8').toString('base64');
    const putResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: `Правка главы ${chapterId} с сайта-библии`,
        content: contentB64,
        branch,
        sha: fileSha,
      }),
    });
    if (!putResp.ok) {
      const errText = await putResp.text();
      throw new Error(`Не удалось закоммитить: ${putResp.status} ${errText}`);
    }

    let prUrl;
    const existingPrResp = await fetch(
      `${GH_API}/repos/${OWNER}/${REPO}/pulls?head=${OWNER}:${branch}&base=${BASE_BRANCH}&state=open`,
      { headers: ghHeaders(token) }
    );
    const existingPrs = existingPrResp.ok ? await existingPrResp.json() : [];
    if (existingPrs.length > 0) {
      prUrl = existingPrs[0].html_url;
    } else {
      const prResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/pulls`, {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({
          title: `Правка: глава ${chapterId} (с сайта-библии)`,
          head: branch,
          base: BASE_BRANCH,
          body: 'Правка отправлена через режим правки на сайте-библии. Не мёржить без проверки supervisor.py и канона.',
        }),
      });
      if (!prResp.ok) {
        const errText = await prResp.text();
        throw new Error(`Не удалось создать PR: ${prResp.status} ${errText}`);
      }
      const prJson = await prResp.json();
      prUrl = prJson.html_url;
    }

    res.status(200).json({ ok: true, prUrl, branch });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
