// Vercel serverless function. Читатель выделяет фрагмент текста главы на
// сайте-библии и отправляет его супервайзеру (Claude Code сессии) на
// проверку — например, если Ветвь использует топоним людей. Заметка
// просто дописывается в ЗАМЕЧАНИЯ-ЧИТАТЕЛЕЙ.md на ветке main: в тексте
// самой главы ничего не меняется, супервайзер разбирает очередь вручную.
//
// Без пароля — это только очередь на разбор, а не запись, способная что-то
// сломать: худшее, что может сделать анонимный отправитель, — засорить
// список мусорными пунктами, которые супервайзер просто вычеркнёт.
//
// Требует ту же переменную окружения GITHUB_TOKEN, что и submit-edit.js.

const OWNER = 'obscurusinf-lab';
const REPO = 'pervaya-mezhdumirovaya';
const BASE_BRANCH = 'main';
const VALID_CHAPTER_ID = /^(1[0-7]|[1-9]|11-bis)$/;
const NOTES_PATH = 'ЗАМЕЧАНИЯ-ЧИТАТЕЛЕЙ.md';
const GH_API = 'https://api.github.com';

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pervaya-mezhdumirovaya-flag',
    'Content-Type': 'application/json',
  };
}

const HEADER = `# Замечания читателей

Очередь заметок с сайта-библии: читатель выделяет фрагмент текста главы и
жмёт «Супервайзеру» — цитата попадает сюда. Ничего в тексте глав
автоматически не меняется, это только очередь на разбор.

Разобрав пункт, супервайзер убирает его отсюда: подтвердилось — переносит
суть в \`ZAMETKI-DLYA-PROZY.md\` (или чинит канон/главу напрямую); не
подтвердилось — просто вычёркивает.

## Очередь
`;

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
  const { chapterId, chapterLabel, quote, comment } = body || {};

  if (!chapterId || !VALID_CHAPTER_ID.test(chapterId)) {
    res.status(400).json({ error: 'Некорректный номер главы.' });
    return;
  }
  if (!quote || typeof quote !== 'string' || quote.trim().length < 2 || quote.length > 4000) {
    res.status(400).json({ error: 'Пустая или слишком большая цитата.' });
    return;
  }
  if (comment && (typeof comment !== 'string' || comment.length > 1000)) {
    res.status(400).json({ error: 'Слишком длинный комментарий.' });
    return;
  }

  const label = (typeof chapterLabel === 'string' ? chapterLabel : '').slice(0, 200) || `глава ${chapterId}`;
  const safeQuote = quote.trim().replace(/\r\n/g, '\n');
  const safeComment = (comment || '').trim().slice(0, 1000);

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const entryLines = [
    `### ${label} — ${stamp}`,
    '',
    '> ' + safeQuote.split('\n').join('\n> '),
    '',
  ];
  if (safeComment) {
    entryLines.push(`Комментарий читателя: ${safeComment}`, '');
  }
  const entry = entryLines.join('\n');

  try {
    let sha;
    let content = HEADER;
    const fileResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(NOTES_PATH)}?ref=${BASE_BRANCH}`, { headers: ghHeaders(token) });
    if (fileResp.ok) {
      const fileJson = await fileResp.json();
      sha = fileJson.sha;
      content = Buffer.from(fileJson.content, 'base64').toString('utf-8');
    } else if (fileResp.status !== 404) {
      throw new Error(`Не удалось прочитать файл: ${fileResp.status}`);
    }

    const newContent = content.replace(/\n*$/, '\n') + '\n' + entry;

    const putResp = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(NOTES_PATH)}`, {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: `Заметка читателя: ${label}`,
        content: Buffer.from(newContent, 'utf-8').toString('base64'),
        branch: BASE_BRANCH,
        sha,
      }),
    });
    if (!putResp.ok) {
      const errText = await putResp.text();
      throw new Error(`Не удалось закоммитить: ${putResp.status} ${errText}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
